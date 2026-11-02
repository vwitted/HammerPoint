// Replays recorded HTTP responses so provider tests run offline and deterministically.
// Fixtures live in tests/fixtures/providers/*.json and were recorded from the real sites.
import { readFileSync } from "node:fs";
import { http2Client } from "../../server/lib/http2.ts";

// Tests must never reach a real browser or the network. Point Puppeteer at a missing
// binary so any fallback that tries to launch Chrome fails immediately.
process.env.PUPPETEER_EXECUTABLE_PATH = "/nonexistent-chrome-for-tests";

// The time the fixtures were recorded. Code under test sees this as "now".
export const FIXTURE_NOW = Date.parse("2026-09-16T23:24:00Z");

interface RecordedRequest {
  key: string;
  // "http2" for responses recorded over HTTP/2 (server/lib/http2.ts); otherwise served to fetch.
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
// Unrecorded requests are collected in `unmatched` and fail with a network-style error.
// HTTP/2 requests are recorded and reported with this prefix on their key.
export const HTTP2_PREFIX = "HTTP/2 ";

export function startReplay(requests: RecordedRequest[]) {
  const table = new Map(requests.map((r) => [(r.transport === "http2" ? HTTP2_PREFIX : "") + normalizeKey(r.key), r]));
  const unmatched: string[] = [];
  // Every request attempted, including ones refused because their signal was already aborted.
  const attempted: string[] = [];

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

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return replay(requestKey(url, init), init?.signal);
  }) as typeof fetch;

  const realOpenSession = http2Client.openSession;
  http2Client.openSession = (origin) => ({
    async fetch(url, init) {
      if (new URL(url).origin !== new URL(origin).origin) throw new Error(`HTTP/2 session for ${origin} can't fetch ${url}`);
      return replay(HTTP2_PREFIX + requestKey(url, init as RequestInit), init.signal);
    },
    close() {},
  });

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
      http2Client.openSession = realOpenSession;
      globalThis.Date = RealDate;
    },
  };
}
