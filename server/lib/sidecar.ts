// Client for the Python sidecar (sidecar/main.py). The sidecar is optional: when it is not
// configured the providers keep using Node's own fetch/Chrome, so local development and the
// offline fixture tests work without Python installed.
import { withCancel } from "./cancel";

export const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8877";
const HEALTH_TIMEOUT_MS = 1_000;

export interface ScrapeOptions {
  url: string;
  gotoTimeoutMs?: number;
  waitSelector?: string;
  waitSelectorTimeoutMs?: number;
  settleMs?: number;
  evaluateScript?: string;
  attempts?: number;
  // Named proxy profile in the sidecar's PROXIES map (SIDECAR_PROXIES or proxyList.txt).
  proxyProfile?: string;
  // Skip image/binary downloads in the browser; the extraction scripts read src attributes.
  blockImages?: boolean;
}

export interface ScrapeResult {
  result: unknown;
  title: string;
  url: string;
  status: number;
  error: string | null;
}

export interface SidecarFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  final_url: string;
  error: string | null;
}

// The URL of a sidecar this process should talk to, or null when none is configured.
// SIDECAR_URL points at an already-running process; SIDECAR_AUTOSTART=1 makes server.ts start
// one on the default local port (what the Docker image does).
export function sidecarUrl(): string | null {
  const configured = process.env.SIDECAR_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.SIDECAR_AUTOSTART === "1") return DEFAULT_SIDECAR_URL;
  return null;
}

export function isSidecarEnabled(): boolean {
  return sidecarUrl() !== null;
}

export class SidecarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarUnavailableError";
  }
}

async function postSidecar<T>(path: string, body: unknown, cancelSignal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  const base = sidecarUrl();
  if (!base) throw new SidecarUnavailableError("sidecar is not configured");
  if (cancelSignal?.aborted) throw new DOMException("This operation was aborted", "AbortError");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = withCancel(controller.signal, cancelSignal);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw new Error(`sidecar ${path} returned HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (cancelSignal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    if (controller.signal.aborted) {
      throw new Error(`sidecar ${path} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    if (err instanceof SidecarUnavailableError) throw err;
    const cause = err?.cause?.message ? `: ${err.cause.message}` : "";
    throw new SidecarUnavailableError(`sidecar ${path} unreachable${cause}`);
  } finally {
    clearTimeout(timer);
  }
}

// Runs a page in Camoufox and returns whatever the extraction script produced.
export async function scrapePage(options: ScrapeOptions, cancelSignal?: AbortSignal, timeoutMs = 60_000): Promise<ScrapeResult> {
  const res = await postSidecar<ScrapeResult>("/scrape", {
    url: options.url,
    goto_timeout_ms: options.gotoTimeoutMs ?? 20_000,
    wait_selector: options.waitSelector ?? null,
    wait_selector_timeout_ms: options.waitSelectorTimeoutMs ?? 8_000,
    settle_ms: options.settleMs ?? 0,
    evaluate_script: options.evaluateScript ?? null,
    attempts: options.attempts ?? 1,
    proxy_profile: options.proxyProfile ?? null,
    block_images: options.blockImages ?? true,
  }, cancelSignal, timeoutMs);
  return {
    result: res.result ?? null,
    title: typeof res.title === "string" ? res.title : "",
    url: typeof res.url === "string" ? res.url : options.url,
    status: typeof res.status === "number" ? res.status : 0,
    error: typeof res.error === "string" && res.error ? res.error : null,
  };
}

// A plain request with curl_cffi's browser TLS/HTTP2 fingerprint.
export async function sidecarFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; impersonate?: string; timeoutMs?: number; proxyProfile?: string },
  cancelSignal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<SidecarFetchResult> {
  const effectiveTimeout = init.timeoutMs ?? timeoutMs;
  const res = await postSidecar<SidecarFetchResult>("/fetch", {
    url,
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    body: init.body ?? null,
    impersonate: init.impersonate ?? "chrome",
    timeout_ms: effectiveTimeout,
    proxy_profile: init.proxyProfile ?? null,
  }, cancelSignal, effectiveTimeout + 2_000);
  return {
    status: typeof res.status === "number" ? res.status : 0,
    headers: res.headers && typeof res.headers === "object" ? res.headers : {},
    body: typeof res.body === "string" ? res.body : "",
    final_url: typeof res.final_url === "string" ? res.final_url : url,
    error: typeof res.error === "string" && res.error ? res.error : null,
  };
}

// Waits until the sidecar answers /health. Used by server.ts after spawning it.
export async function waitForSidecar(timeoutMs = 30_000): Promise<boolean> {
  const base = sidecarUrl();
  if (!base) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
