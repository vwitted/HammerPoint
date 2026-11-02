import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyPriceFallbacks } from "../server/lib/prices.ts";

const lot = (overrides: Record<string, unknown>) => ({
  id: "lot-1",
  title: "Lathe",
  currentPrice: null,
  startPrice: null,
  ...overrides,
});

describe("applyPriceFallbacks", () => {
  it("never uses the low estimate as a bid (Easy Live lot 9009: est £12 - £20, current bid £7)", () => {
    const [out] = applyPriceFallbacks([lot({ estimateStr: "£12 - £20" })]);
    assert.equal(out.startPrice, null);
    assert.equal(out.currentPrice, null);
    assert.equal(out.bidLabel, undefined);
  });

  it("uses the starting price as the current bid when there are no bids", () => {
    const [out] = applyPriceFallbacks([lot({ startPrice: 40 })]);
    assert.equal(out.currentPrice, 40);
    assert.equal(out.bidLabel, "Starting Bid");
  });

  it("keeps an existing bid label", () => {
    const [out] = applyPriceFallbacks([lot({ startPrice: 40, bidLabel: "Opening Bid" })]);
    assert.equal(out.bidLabel, "Opening Bid");
  });

  it("does not invent a starting price from the current bid", () => {
    const [out] = applyPriceFallbacks([lot({ currentPrice: 75, bidLabel: "Current Bid" })]);
    assert.equal(out.startPrice, null);
    assert.equal(out.currentPrice, 75);
  });

  it("turns 0 prices into null", () => {
    const [out] = applyPriceFallbacks([lot({ currentPrice: 0, startPrice: 0 })]);
    assert.equal(out.currentPrice, null);
    assert.equal(out.startPrice, null);
  });

  it("leaves genuinely unpriced lots unpriced", () => {
    const [out] = applyPriceFallbacks([lot({})]);
    assert.equal(out.currentPrice, null);
    assert.equal(out.startPrice, null);
  });

  it("does not overwrite a real current bid", () => {
    const [out] = applyPriceFallbacks([lot({ currentPrice: 300, startPrice: 100, estimateStr: "£50 - £80" })]);
    assert.equal(out.currentPrice, 300);
    assert.equal(out.startPrice, 100);
  });
});

describe("applyPriceFallbacks: input handling", () => {
  it("returns every lot it was given and ignores non-arrays", () => {
    assert.equal(applyPriceFallbacks([lot({ id: "a" }), lot({ id: "b", title: "Lathe" })]).length, 2);
    assert.deepEqual(applyPriceFallbacks(null as any), []);
  });
});
