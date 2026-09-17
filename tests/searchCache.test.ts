import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchCache } from "../server/searchCache.ts";

const makeCache = (overrides: Partial<{ ttlMs: number; emptyTtlMs: number; maxEntries: number }> = {}) => {
  let time = 1_000;
  const cache = new SearchCache<string>({ ttlMs: 600_000, emptyTtlMs: 60_000, maxEntries: 3, now: () => time, ...overrides });
  return { cache, advance: (ms: number) => { time += ms; } };
};

// A load function whose result the test resolves by hand, recording the signal it was given.
function deferredLoad(value: string[] = ["lot"]) {
  const calls: AbortSignal[] = [];
  let finish: () => void = () => {};
  const load = (signal: AbortSignal) => {
    calls.push(signal);
    return new Promise<string[]>((resolve) => { finish = () => resolve(value); });
  };
  return { load, calls, finish: () => finish() };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("SearchCache", () => {
  it("returns cached results until they expire", async () => {
    const { cache, advance } = makeCache();
    let loads = 0;
    const load = async () => [`result-${++loads}`];

    assert.deepEqual(await cache.get("k", load), ["result-1"]);
    advance(599_000);
    assert.deepEqual(await cache.get("k", load), ["result-1"]);
    advance(2_000);
    assert.deepEqual(await cache.get("k", load), ["result-2"]);
  });

  it("expires empty results sooner", async () => {
    const { cache, advance } = makeCache();
    let loads = 0;
    const load = async () => { loads++; return []; };

    await cache.get("k", load);
    advance(59_000);
    await cache.get("k", load);
    assert.equal(loads, 1);
    advance(2_000);
    await cache.get("k", load);
    assert.equal(loads, 2);
  });

  it("drops the least recently used entry when full", async () => {
    const { cache } = makeCache({ maxEntries: 2 });
    let loads = 0;
    const load = async () => [`r${++loads}`];

    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("a", load); // "a" is now more recent than "b"
    await cache.get("c", load); // evicts "b"
    assert.equal(cache.size, 2);
    assert.equal(loads, 3);

    await cache.get("a", load);
    assert.equal(loads, 3, "a still cached");
    await cache.get("b", load);
    assert.equal(loads, 4, "b was evicted");
  });

  it("shares one load between overlapping identical searches", async () => {
    const { cache } = makeCache();
    const d = deferredLoad(["shared"]);

    const first = cache.get("k", d.load);
    const second = cache.get("k", d.load);
    await flush();
    d.finish();

    assert.deepEqual(await first, ["shared"]);
    assert.deepEqual(await second, ["shared"]);
    assert.equal(d.calls.length, 1);
  });

  it("does not cache failures", async () => {
    const { cache } = makeCache();
    let loads = 0;
    const load = async () => { loads++; if (loads === 1) throw new Error("blocked"); return ["ok"]; };

    await assert.rejects(cache.get("k", load), /blocked/);
    assert.deepEqual(await cache.get("k", load), ["ok"]);
  });

  it("gives an aborting caller [] straight away and cancels the load when nobody else waits", async () => {
    const { cache } = makeCache();
    const d = deferredLoad();
    const caller = new AbortController();

    const result = cache.get("k", d.load, caller.signal);
    await flush();
    caller.abort();

    assert.deepEqual(await result, []);
    assert.equal(d.calls[0].aborted, true, "shared load cancelled");
    d.finish();
    await flush();
    assert.equal(cache.size, 0, "cancelled result not cached");
  });

  it("keeps the load running while another caller still waits", async () => {
    const { cache } = makeCache();
    const d = deferredLoad(["lot"]);
    const leaver = new AbortController();

    const left = cache.get("k", d.load, leaver.signal);
    const stayed = cache.get("k", d.load);
    await flush();
    leaver.abort();

    assert.deepEqual(await left, []);
    assert.equal(d.calls[0].aborted, false);
    d.finish();
    assert.deepEqual(await stayed, ["lot"]);
    assert.equal(cache.size, 1);
  });

  it("starts a fresh load after a cancelled one", async () => {
    const { cache } = makeCache();
    const first = deferredLoad(["old"]);
    const caller = new AbortController();
    const cancelled = cache.get("k", first.load, caller.signal);
    await flush();
    caller.abort();
    await cancelled;

    assert.deepEqual(await cache.get("k", async () => ["new"]), ["new"]);
  });

  it("returns [] without loading if the caller is already aborted", async () => {
    const { cache } = makeCache();
    let loads = 0;
    assert.deepEqual(await cache.get("k", async () => { loads++; return ["x"]; }, AbortSignal.abort()), []);
    assert.equal(loads, 0);
  });
});
