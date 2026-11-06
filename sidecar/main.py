"""Browser and HTTP sidecar for HammerPoint.

The Node server owns the auction logic; this process owns only the two things Node cannot fake
convincingly:

* ``POST /scrape`` - a real Firefox session (Camoufox, patched at the binary level) for the two
  providers that need JavaScript: BidSpotter/ATG and HiBid's fallback.
* ``POST /fetch``  - plain HTTP requests with a real browser TLS/HTTP2 fingerprint (curl_cffi) for
  providers that only need server-rendered HTML or JSON.

Run it next to the Node process (the container entrypoint starts it automatically) or on its own:

    uvicorn sidecar.main:app --host 127.0.0.1 --port 8877

Everything is deliberately stateless. Node keeps the caching and normalization.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi.requests import AsyncSession
from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger("hammerpoint.sidecar")

app = FastAPI(title="HammerPoint sidecar", version="1.0.0")

# curl_cffi's "chrome" means the newest Chrome profile it knows. The package version is pinned in
# requirements.txt, so this only changes when we deliberately upgrade the dependency.
DEFAULT_IMPERSONATE = os.environ.get("SIDECAR_IMPERSONATE", "chrome")

# Keep the last few request errors visible in the log without leaking whole pages.
_MAX_ERROR_LENGTH = 300

# Proxy profiles, keyed by a short name the Node providers reference. Loaded from SIDECAR_PROXIES
# (JSON, for hosted deploys) or from a provider-format proxyList.txt/proxylist.txt file (local dev).
# Credentials stay here, never in the Node process or the git history.
PROXIES: dict[str, dict[str, str]] = {}


def _parse_proxy_line(line: str) -> Optional[dict[str, str]]:
    """Turns ``username:password@server:port`` into Playwright's proxy dict."""
    line = line.strip()
    if not line or line.startswith("#") or "@" not in line:
        return None
    userpass, hostport = line.rsplit("@", 1)
    if ":" not in userpass or ":" not in hostport:
        return None
    username, password = userpass.split(":", 1)
    host, port = hostport.rsplit(":", 1)
    return {"server": f"http://{host}:{port}", "username": username, "password": password}


def _proxy_url(profile: dict[str, str]) -> str:
    """``http://user:pass@host:port`` for curl_cffi's ``proxies`` argument."""
    hostport = profile["server"].split("://", 1)[-1]
    user = quote(profile.get("username", ""), safe="")
    password = quote(profile.get("password", ""), safe="")
    return f"http://{user}:{password}@{hostport}"


def _load_proxies() -> dict[str, dict[str, str]]:
    raw = os.environ.get("SIDECAR_PROXIES")
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                return {
                    str(name): value
                    for name, value in data.items()
                    if isinstance(value, dict) and isinstance(value.get("server"), str)
                }
        except Exception as exc:  # pragma: no cover - depends on operator input
            logger.warning("SIDECAR_PROXIES is not valid JSON; ignoring: %s", _short_error(exc))

    proxies: dict[str, dict[str, str]] = {}
    for filename in ("proxyList.txt", "proxylist.txt"):
        path = Path(filename)
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            parsed = _parse_proxy_line(line)
            if parsed and parsed not in proxies.values():
                key = "mobile" if not proxies else f"mobile-{len(proxies) + 1}"
                proxies[key] = parsed
        if proxies:
            break
    return proxies


PROXIES = _load_proxies()

# Headers the HTTP fingerprint owns: passing a caller-supplied value would either break compression
# (Accept-Encoding) or mismatch the impersonated browser (User-Agent, sec-ch-ua*). curl_cffi sets
# these itself, including Accept-Encoding with br, and decompresses the body it returns.
_FETCH_STRIP_HEADERS = {"user-agent", "accept-encoding", "connection", "host", "content-length"}


def _sanitize_fetch_headers(headers: Optional[dict[str, str]]) -> Optional[dict[str, str]]:
    if not headers:
        return headers
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in _FETCH_STRIP_HEADERS and not name.lower().startswith("sec-ch-ua")
    }


def _geoip_ready() -> bool:
    """True when the geoip extra is installed and a database has been downloaded."""
    try:
        from camoufox.geolocation import ALLOW_GEOIP, get_mmdb_path

        return bool(ALLOW_GEOIP and get_mmdb_path("ipv4").exists())
    except Exception:  # pragma: no cover - depends on the installed image
        return False


class ScrapeRequest(BaseModel):
    url: str
    goto_timeout_ms: int = 20_000
    wait_selector: Optional[str] = None
    wait_selector_timeout_ms: int = 8_000
    settle_ms: int = 0
    evaluate_script: Optional[str] = None
    attempts: int = Field(default=1, ge=1, le=3)
    # Named profile in PROXIES; None means no proxy.
    proxy_profile: Optional[str] = None
    # Don't download image bytes: the extraction scripts read src/data-src attributes, not pixels.
    # This is the main proxy-data saving knob for the browser providers.
    block_images: bool = True


class ScrapeResponse(BaseModel):
    result: Any = None
    title: str = ""
    url: str = ""
    status: int = 0
    error: Optional[str] = None


class FetchRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[dict[str, str]] = None
    body: Optional[str] = None
    impersonate: str = DEFAULT_IMPERSONATE
    timeout_ms: int = 20_000
    proxy_profile: Optional[str] = None


class FetchResponse(BaseModel):
    status: int = 0
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    final_url: str = ""
    error: Optional[str] = None


def _short_error(exc: BaseException) -> str:
    text = str(exc).replace("\n", " ").strip()
    return (text or exc.__class__.__name__)[:_MAX_ERROR_LENGTH]


@app.get("/health")
async def health() -> dict[str, Any]:
    # Camoufox is imported lazily so that /fetch still works in a deployment that only installed
    # curl_cffi (for example, a small dev box without the 1 GB Firefox download).
    browser = "unavailable"
    browser_installed = False
    cache_entries: list[str] = []
    cache_dir = ""
    try:
        from camoufox.async_api import AsyncCamoufox  # noqa: F401

        browser = "available"
        import platformdirs
        from pathlib import Path

        install_dir = Path(platformdirs.user_cache_dir("camoufox"))
        cache_dir = str(install_dir)
        if install_dir.exists():
            cache_entries = sorted(p.name for p in install_dir.iterdir())[:20]
        # Camoufox stores fetched builds in <cache>/browsers/<repo>/<build>/.
        browser_installed = (install_dir / "browsers").exists()
    except Exception as exc:  # pragma: no cover - depends on the installed image
        logger.warning("Camoufox is not available: %s", _short_error(exc))
    return {
        "ok": True,
        "browser": browser,
        "browser_installed": browser_installed,
        "cache_dir": cache_dir,
        "cache_entries": cache_entries,
        "impersonate": DEFAULT_IMPERSONATE,
        "proxies": list(PROXIES.keys()),
    }


async def _scrape_page(browser: Any, req: ScrapeRequest) -> ScrapeResponse:
    page = await browser.new_page()
    response = await page.goto(req.url, wait_until="domcontentloaded", timeout=req.goto_timeout_ms)

    # Let late XHRs settle, but never let an analytics long-poll turn a good page into a
    # timeout: the selector wait below is the real readiness check.
    try:
        await page.wait_for_load_state("networkidle", timeout=min(5_000, req.wait_selector_timeout_ms))
    except Exception:
        pass

    matched = False
    if req.wait_selector:
        try:
            await page.wait_for_selector(req.wait_selector, timeout=req.wait_selector_timeout_ms)
            matched = True
        except Exception:
            # Mirror the old `.catch(() => {})`: a missing selector is not a failed navigation.
            pass
    if matched and req.settle_ms:
        # BidSpotter fills prices from a script after the cards exist.
        await page.wait_for_timeout(req.settle_ms)

    result = await page.evaluate(req.evaluate_script) if req.evaluate_script else None
    return ScrapeResponse(
        result=result,
        title=await page.title(),
        url=page.url,
        status=response.status if response is not None else 0,
    )


async def _scrape_once(req: ScrapeRequest) -> ScrapeResponse:
    # Imported here so a broken/absent browser install does not stop the process from serving
    # /fetch (and so /health can report the problem instead of crashing at import time).
    from camoufox.async_api import AsyncCamoufox

    proxy = PROXIES.get(req.proxy_profile) if req.proxy_profile else None
    # geoip aligns timezone/locale/WebRTC with the proxy's exit IP. It needs the [geoip] extra and
    # a downloaded DB; the exit-IP lookup itself goes through the proxy (a single ip-api.com call).
    geoip = bool(proxy) and os.environ.get("SIDECAR_GEOIP", "1") == "1" and _geoip_ready()

    last_error: Optional[BaseException] = None
    for use_geoip in ([True, False] if geoip else [False]):
        try:
            async with AsyncCamoufox(
                headless=True,
                proxy=proxy,
                geoip=use_geoip,
                block_images=req.block_images,
            ) as browser:
                return await _scrape_page(browser, req)
        except Exception as exc:
            last_error = exc
            if use_geoip:
                # geoip's exit-IP lookup can fail on its own (ip-api.com unreachable) even when the
                # proxy itself is fine; retry once without geoip instead of dropping the scrape.
                logger.warning("scrape with geoip failed for %s (%s); retrying without geoip", req.url, _short_error(exc))
            else:
                break
    raise last_error or RuntimeError("scrape failed")


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape(req: ScrapeRequest) -> ScrapeResponse:
    last_error: Optional[str] = None
    for attempt in range(1, req.attempts + 1):
        try:
            # A hard ceiling stops a wedged browser from holding the request forever. Playwright's
            # own timeouts should fire first; this is the backstop.
            budget_ms = req.goto_timeout_ms + req.wait_selector_timeout_ms + req.settle_ms + 10_000
            return await asyncio.wait_for(_scrape_once(req), timeout=budget_ms / 1000)
        except Exception as exc:
            last_error = _short_error(exc)
            logger.warning("scrape attempt %s/%s failed for %s: %s", attempt, req.attempts, req.url, last_error)

    return ScrapeResponse(result=None, url=req.url, error=last_error or "scrape failed")


@app.post("/fetch", response_model=FetchResponse)
async def fetch(req: FetchRequest) -> FetchResponse:
    proxy = PROXIES.get(req.proxy_profile) if req.proxy_profile else None
    proxies = {"http": _proxy_url(proxy), "https": _proxy_url(proxy)} if proxy else None
    # Headers are sanitized so curl_cffi owns User-Agent / sec-ch-ua* / Accept-Encoding: it
    # negotiates gzip/deflate/br compression and decompresses the body it returns.
    headers = _sanitize_fetch_headers(req.headers)
    try:
        async with AsyncSession() as session:
            response = await session.request(
                req.method.upper(),
                req.url,
                headers=headers or None,
                data=req.body,
                impersonate=req.impersonate,
                proxies=proxies,
                timeout=max(req.timeout_ms, 1) / 1000,
            )
            return FetchResponse(
                status=response.status_code,
                headers=dict(response.headers),
                body=response.text,
                final_url=str(response.url),
            )
    except Exception as exc:
        error = _short_error(exc)
        logger.warning("fetch failed for %s: %s", req.url, error)
        return FetchResponse(status=0, body="", final_url=req.url, error=error)
