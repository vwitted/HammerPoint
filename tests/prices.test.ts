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
  it("uses the low estimate as the starting bid when no price is published", () => {
    const [out] = applyPriceFallbacks([lot({ estimateStr: "£1,250 - £2,000" })]);
    assert.equal(out.startPrice, 1250);
    assert.equal(out.currentPrice, 1250);
    assert.equal(out.bidLabel, "Starting Bid");
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

  it("copies the current bid into a missing starting price", () => {
    const [out] = applyPriceFallbacks([lot({ currentPrice: 75 })]);
    assert.equal(out.startPrice, 75);
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
