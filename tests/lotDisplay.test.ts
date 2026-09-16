// Client display helpers (src/utils/lotDisplay.ts). Includes the cases from the old
// regression suite, now run against the real functions instead of copies of them.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCategoryString, getEffectiveBid, getTimeRemaining, isLotUnpriced, parseValidDate } from "../src/utils/lotDisplay.ts";
import { FIXTURE_NOW, startReplay } from "./helpers/replay.ts";
import type { AuctionListing } from "../src/types.ts";

const HOUR = 3_600_000;
const listing = (overrides: Partial<AuctionListing>): AuctionListing => ({
  id: "x", title: "Lot", url: "https://example.com", details: "", endingDate: "", address: "",
  latitude: 0, longitude: 0, auctioneer: "", category: "", status: "active", country: "UK",
  ...overrides,
});

describe("isLotUnpriced", () => {
  it("treats a lot with only an estimate as priced (e.g. Easy Live lot 61, £3 - £8)", () => {
    assert.equal(isLotUnpriced(listing({ estimateStr: "£3 - £8" })), false);
  });

  it("treats a lot with a starting or current price as priced", () => {
    assert.equal(isLotUnpriced(listing({ startPrice: 20 })), false);
    assert.equal(isLotUnpriced(listing({ currentPrice: 45 })), false);
  });

  it("flags blind-autobid lots with no price and no estimate", () => {
    assert.equal(isLotUnpriced(listing({ currentPrice: null, startPrice: null })), true);
    assert.equal(isLotUnpriced(listing({ currentPrice: 0, startPrice: 0, estimateStr: "£0 - £0" })), true);
  });
});

describe("getEffectiveBid", () => {
  it("prefers the current bid, then the starting price, then the low estimate", () => {
    assert.equal(getEffectiveBid(listing({ currentPrice: 45, startPrice: 20, estimateStr: "£10 - £30" })), 45);
    assert.equal(getEffectiveBid(listing({ currentPrice: null, startPrice: 20, estimateStr: "£10 - £30" })), 20);
    assert.equal(getEffectiveBid(listing({ estimateStr: "£1,500 - £2,000" })), 1500);
  });

  it("never returns 0", () => {
    assert.equal(getEffectiveBid(listing({ currentPrice: 0, startPrice: 0 })), null);
  });
});

describe("parseValidDate", () => {
  let replay: ReturnType<typeof startReplay>;
  beforeEach(() => { replay = startReplay([]); });
  afterEach(() => replay.stop());

  it("parses ISO dates unchanged", () => {
    assert.equal(parseValidDate("2026-10-01T12:00:00.000Z")?.toISOString(), "2026-10-01T12:00:00.000Z");
  });

  it("fills in the current year when a date has none", () => {
    assert.equal(parseValidDate("09 Oct")?.getFullYear(), new Date(FIXTURE_NOW).getFullYear());
  });

  it("returns null for missing dates", () => {
    assert.equal(parseValidDate(""), null);
    assert.equal(parseValidDate(null), null);
  });

  it("returns null for text that isn't a date", { todo: 'appends the year, so "TBC" becomes "TBC 2026", which JavaScript reads as 1 January' }, () => {
    assert.equal(parseValidDate("TBC"), null);
    assert.equal(parseValidDate("Upcoming"), null);
  });
});

describe("getTimeRemaining", () => {
  let replay: ReturnType<typeof startReplay>;
  beforeEach(() => { replay = startReplay([]); });
  afterEach(() => replay.stop());
  const inHours = (h: number) => new Date(FIXTURE_NOW + h * HOUR).toISOString();

  it("marks past auctions as closed", () => {
    assert.deepEqual(getTimeRemaining(inHours(-1)), { text: "Bidding Closed", isUrgent: false, isExpired: true });
  });

  it("counts down to the start of an upcoming live sale without expiring it", () => {
    const info = getTimeRemaining(inHours(36), inHours(28), true);
    assert.equal(info.text, "Live Tomorrow");
    assert.equal(info.isExpired, false);
  });

  it("formats time left at each scale and flags the last day as urgent", () => {
    assert.equal(getTimeRemaining(inHours(24 * 5)).text, "5 days left");
    assert.equal(getTimeRemaining(inHours(30)).text, "1d 6h left");
    assert.deepEqual(getTimeRemaining(inHours(3.5)), { text: "3h 30m left", isUrgent: true, isExpired: false });
    assert.equal(getTimeRemaining(inHours(0.25)).text, "15m left");
  });

  it("shows the raw text when the end date can't be read", { todo: 'unreadable dates like "TBC" parse as 1 January and show "Bidding Closed"' }, () => {
    assert.equal(getTimeRemaining("TBC").text, "TBC");
  });
});

describe("getCategoryString", () => {
  it("reads strings and nested name/title objects", () => {
    assert.equal(getCategoryString("Plant"), "Plant");
    assert.equal(getCategoryString({ name: { en: "Catering" } }), "Catering");
    assert.equal(getCategoryString(null), "General");
  });
});
