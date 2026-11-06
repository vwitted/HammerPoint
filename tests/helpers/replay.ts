// Replays recorded HTTP responses so provider tests run offline and deterministically.
// Fixtures live in tests/fixtures/providers/*.json and were recorded from the real sites.
//
// In production the providers send requests through the Python sidecar (curl_cffi). Tests emulate
// that sidecar: a POST to /fetch is translated back into the recorded request it represents, so the
// real Node client, the real provider parsing and the real fixture all run unchanged.
import { readFileSync } from "node:fs";

// Tests must never reach a real browser or the network. Point Puppeteer at a missing
// binary so any fallback that tries to launch Chrome fails immediately.
process.env.PUPPETEER_EXECUTABLE_PATH = "/nonexistent-chrome-for-tests";

// The time the fixtures were recorded. Code under test sees this as "now".
export const FIXTURE_NOW = Date.parse("2026-09-16T23:24:00Z");

const SIDECAR_URL = "http://sidecar.test";
const SIDECAR_FETCH_PATH = "/fetch";

interface RecordedRequest {
  key: string;
  // Kept for fixtures recorded before the sidecar existed (the Easy Live bid lookups were
  // recorded over HTTP/2). The transport no longer matters: curl_cffi returns the same response.
  transport?: "http2";
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Request identity: method, URL and body, ignoring values that change on every call.
export function requestKey(url: string, init?: RequestInit): string {
  const u = new URL(url);
  u.searchParams.delete("deviceId");
  const body = typeof init?.body === "string" ? init.body : "";
  return normalizeKey(`${init?.method || "GET"} ${u.toString()} ${body}`);
}

// The Saleroom query filters on "auctions ending after now", which differs per run.
function normalizeKey(key: string): string {
  return key.replace(/auctionEndDateTimeUtc(%3E%3D|>=)\d{12,}/g, "auctionEndDateTimeUtc$1NOW");
}

export function loadFixture(name: string): RecordedRequest[] {
  const path = new URL(`../fixtures/providers/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")).requests;
}

// Swaps global fetch for recorded responses and freezes Date at FIXTURE_NOW.
// Unrecorded requests are collected in `unmatched` and fail with a network-style error. When a
// fixture contains the same request more than once (the old HTTP/1.1 challenge plus its HTTP/2
// retry), the last recording wins, which is the response the site eventually served.
export function startReplay(requests: RecordedRequest[]) {
  const table = new Map(requests.map((r) => [normalizeKey(r.key), r]));
  const unmatched: string[] = [];
  // Every request attempted, including ones refused because their signal was already aborted.
  const attempted: string[] = [];
  const previousSidecarUrl = process.env.SIDECAR_URL;
  process.env.SIDECAR_URL = SIDECAR_URL;

  const replay = (key: string, signal?: AbortSignal | null) => {
    attempted.push(key);
    if (signal?.aborted) {
      throw new DOMException("This operation was aborted", "AbortError");
    }
    const hit = table.get(key);
    if (!hit) {
      unmatched.push(key);
      throw new TypeError(`fetch failed: no recorded response for ${key}`);
    }
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
  };

  const replaySidecarFetch = async (body: any, signal?: AbortSignal | null) => {
    const key = requestKey(String(body.url), {
      method: String(body.method ?? "GET"),
      body: typeof body.body === "string" ? body.body : undefined,
    });
    const response = replay(key, signal);
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    return new Response(JSON.stringify({
      status: response.status,
      headers,
      body: text,
      final_url: String(body.url),
      error: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === `${SIDECAR_URL}${SIDECAR_FETCH_PATH}`) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return replaySidecarFetch(body, init?.signal);
    }
    if (url.startsWith(`${SIDECAR_URL}/`)) {
      const key = `SIDECAR ${url} ${String(init?.body ?? "")}`;
      unmatched.push(key);
      throw new TypeError(`fetch failed: no recorded response for ${key}`);
    }
    return replay(requestKey(url, init), init?.signal);
  }) as typeof fetch;

  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FIXTURE_NOW);
      else super(...(args as [string]));
    }
    static now() {
      return FIXTURE_NOW;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;

  return {
    unmatched,
    attempted,
    stop() {
      globalThis.fetch = realFetch;
      globalThis.Date = RealDate;
      if (previousSidecarUrl === undefined) delete process.env.SIDECAR_URL;
      else process.env.SIDECAR_URL = previousSidecarUrl;
    },
  };
}
