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
import logging
import os
from typing import Any, Optional

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


class ScrapeRequest(BaseModel):
    url: str
    goto_timeout_ms: int = 20_000
    wait_selector: Optional[str] = None
    wait_selector_timeout_ms: int = 8_000
    settle_ms: int = 0
    evaluate_script: Optional[str] = None
    attempts: int = Field(default=1, ge=1, le=3)


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
    try:
        from camoufox.async_api import AsyncCamoufox  # noqa: F401

        browser = "available"
    except Exception as exc:  # pragma: no cover - depends on the installed image
        logger.warning("Camoufox is not available: %s", _short_error(exc))
    return {"ok": True, "browser": browser, "impersonate": DEFAULT_IMPERSONATE}


async def _scrape_once(req: ScrapeRequest) -> ScrapeResponse:
    # Imported here so a broken/absent browser install does not stop the process from serving
    # /fetch (and so /health can report the problem instead of crashing at import time).
    from camoufox.async_api import AsyncCamoufox

    async with AsyncCamoufox(headless=True) as browser:
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
    # Caller-supplied headers are already stripped of browser-owned values by the Node client
    # (User-Agent, Accept-Encoding, sec-ch-ua*, Connection). Anything left (Accept, Referer,
    # Content-Type, API keys) is safe to merge over curl_cffi's profile defaults.
    try:
        async with AsyncSession() as session:
            response = await session.request(
                req.method.upper(),
                req.url,
                headers=req.headers or None,
                data=req.body,
                impersonate=req.impersonate,
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
