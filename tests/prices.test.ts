import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeAuctions, normalizeAndStoreLots } from "../server/listingStore.ts";

const lot = (overrides: Record<string, unknown>) => ({
  id: "lot-1",
  title: "Lathe",
  currentPrice: null,
  startPrice: null,
  ...overrides,
});

describe("normalizeAndStoreLots: price fallbacks", () => {
  beforeEach(() => {
    activeAuctions.length = 0;
  });

  it("uses the low estimate as the starting bid when no price is published", () => {
    const [out] = normalizeAndStoreLots([lot({ estimateStr: "£1,250 - £2,000" })]);
    assert.equal(out.startPrice, 1250);
    assert.equal(out.currentPrice, 1250);
    assert.equal(out.bidLabel, "Starting Bid");
  });

  it("uses the starting price as the current bid when there are no bids", () => {
    const [out] = normalizeAndStoreLots([lot({ startPrice: 40 })]);
    assert.equal(out.currentPrice, 40);
    assert.equal(out.bidLabel, "Starting Bid");
  });

  it("keeps an existing bid label", () => {
    const [out] = normalizeAndStoreLots([lot({ startPrice: 40, bidLabel: "Opening Bid" })]);
    assert.equal(out.bidLabel, "Opening Bid");
  });

  it("copies the current bid into a missing starting price", () => {
    const [out] = normalizeAndStoreLots([lot({ currentPrice: 75 })]);
    assert.equal(out.startPrice, 75);
  });

  it("leaves genuinely unpriced lots unpriced", () => {
    const [out] = normalizeAndStoreLots([lot({})]);
    assert.equal(out.currentPrice, null);
    assert.equal(out.startPrice, null);
  });

  it("does not overwrite a real current bid", () => {
    const [out] = normalizeAndStoreLots([lot({ currentPrice: 300, startPrice: 100, estimateStr: "£50 - £80" })]);
    assert.equal(out.currentPrice, 300);
    assert.equal(out.startPrice, 100);
  });
});

describe("normalizeAndStoreLots: cache", () => {
  beforeEach(() => {
    activeAuctions.length = 0;
  });

  it("returns every lot it was given and ignores non-arrays", () => {
    assert.equal(normalizeAndStoreLots([lot({ id: "a" }), lot({ id: "b", title: "Mill" })]).length, 2);
    assert.deepEqual(normalizeAndStoreLots(null as any), []);
  });

  it("does not store the same lot twice", () => {
    normalizeAndStoreLots([lot({ id: "a" })]);
    normalizeAndStoreLots([lot({ id: "a" })]);
    assert.equal(activeAuctions.length, 1);
  });

  it("keeps different lots that share a title", () => {
    normalizeAndStoreLots([lot({ id: "a", title: "Lathe" }), lot({ id: "b", title: "Lathe" })]);
    assert.equal(activeAuctions.length, 2);
  });
});
