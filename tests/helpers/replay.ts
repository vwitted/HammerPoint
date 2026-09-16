// Replays recorded HTTP responses so provider tests run offline and deterministically.
// Fixtures live in tests/fixtures/providers/*.json and were recorded from the real sites.
import { readFileSync } from "node:fs";

// Tests must never reach a real browser or the network. Point Puppeteer at a missing
// binary so any fallback that tries to launch Chrome fails immediately.
process.env.PUPPETEER_EXECUTABLE_PATH = "/nonexistent-chrome-for-tests";

// The time the fixtures were recorded. Code under test sees this as "now".
export const FIXTURE_NOW = Date.parse("2026-09-16T23:24:00Z");

interface RecordedRequest {
  key: string;
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
export function startReplay(requests: RecordedRequest[]) {
  const table = new Map(requests.map((r) => [normalizeKey(r.key), r]));
  const unmatched: string[] = [];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = requestKey(url, init);
    const hit = table.get(key);
    if (!hit) {
      unmatched.push(key);
      throw new TypeError(`fetch failed: no recorded response for ${key}`);
    }
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
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
    stop() {
      globalThis.fetch = realFetch;
      globalThis.Date = RealDate;
    },
  };
}
