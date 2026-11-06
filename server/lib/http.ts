// The HTTP transport every provider uses. In production this goes through the Python sidecar so
// requests carry a real browser TLS/HTTP2 fingerprint (curl_cffi); in development, and whenever
// the sidecar is not configured, it falls back to Node's fetch.
import { withCancel } from "./cancel";
import { isSidecarEnabled, sidecarFetch } from "./sidecar";

// A plausible desktop Chrome UA for the Node fallback. The sidecar supplies its own, matching the
// impersonated TLS profile; sending this one over curl_cffi would create a mismatch.
const FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface HttpFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  // curl_cffi profile, e.g. "chrome124". Defaults to the newest Chrome the pinned sidecar knows.
  impersonate?: string;
  timeoutMs?: number;
  // Named proxy profile in the sidecar's PROXIES map.
  proxyProfile?: string;
}

// Headers curl_cffi owns. Passing these through is worse than omitting them: a Chrome UA over a
// different TLS profile, or Chrome-only Client Hints from Firefox, is itself a bot signal.
const SIDECAR_OWNED_HEADERS = new Set([
  "user-agent",
  "accept-encoding",
  "connection",
  "host",
  "content-length",
  "priority",
]);

function headersForSidecar(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (SIDECAR_OWNED_HEADERS.has(lower) || lower.startsWith("sec-ch-ua")) continue;
    result[name] = value;
  }
  return result;
}

function headersForNode(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === "connection") continue;
    result[name] = value;
  }
  if (!Object.keys(result).some((name) => name.toLowerCase() === "user-agent")) {
    result["User-Agent"] = FALLBACK_USER_AGENT;
  }
  return result;
}

// Fetches a URL with a browser-like transport. The returned Response has the same shape as
// Node's fetch Response (ok, status, headers, text(), json()), so call sites and
// sourceHealth.noteResponse() work unchanged.
export async function httpFetch(
  url: string,
  init: HttpFetchInit = {},
  cancelSignal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<Response> {
  const effectiveTimeout = init.timeoutMs ?? timeoutMs;

  if (isSidecarEnabled()) {
    const res = await sidecarFetch(url, {
      method: init.method,
      headers: headersForSidecar(init.headers),
      body: init.body,
      impersonate: init.impersonate,
      timeoutMs: effectiveTimeout,
      proxyProfile: init.proxyProfile,
    }, cancelSignal, effectiveTimeout);

    if (res.error) throw new Error(`sidecar fetch failed: ${res.error}`);
    if (!res.status) throw new Error("sidecar fetch returned no HTTP status");
    const headers = new Headers(res.headers);
    // curl_cffi has already decompressed the body; keeping the upstream encoding/length headers
    // would describe bytes that are no longer there.
    for (const name of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(name);
    return new Response(res.status === 204 || res.status === 304 ? null : res.body, {
      status: res.status,
      headers,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetch(url, {
      method: init.method ?? "GET",
      headers: headersForNode(init.headers),
      body: init.body,
      signal: withCancel(controller.signal, cancelSignal),
    });
  } finally {
    clearTimeout(timer);
  }
}
