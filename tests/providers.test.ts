// Provider tests: each auction source is run against responses recorded from the real site
// (tests/fixtures/providers), with the clock frozen at the recording time.
//
// Two kinds of check:
// - invariants every listing must satisfy, whatever the source;
// - a snapshot of the full normalized output, so any change in parsing shows up as a diff.
//   If a change is intended, review the diff and run `npm run test:update-snapshots`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_NOW, loadFixture, startReplay } from "./helpers/replay.ts";
import { assertMatchesSnapshot } from "./helpers/snapshot.ts";
import { fetchLiveAuctioneersLots } from "../server/providers/liveAuctioneers.ts";
import { scrapeTheSaleroomLots } from "../server/providers/theSaleroom.ts";
import { fetchEasyLiveAuctionLots } from "../server/providers/easyLive.ts";
import { scrapeBpiLots } from "../server/providers/bpi.ts";
import { scrapeHibidLots, scrapeSvdUpcomingAuctions } from "../server/providers/hibid.ts";

async function runWithFixture(fixture: string, task: () => Promise<any[]>) {
  const replay = startReplay(loadFixture(fixture));
  try {
    const lots = await task();
    return { lots, unmatched: replay.unmatched };
  } finally {
    replay.stop();
  }
}

const isIsoDate = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.endsWith("Z");
// Prices may be missing, but are never 0, negative or NaN.
const isValidPriceOrNull = (v: unknown) => v === null || v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);

function assertValidListings(lots: any[], expectedCount: number) {
  assert.equal(lots.length, expectedCount, "number of lots parsed");
  assert.equal(new Set(lots.map((l) => l.id)).size, lots.length, "ids are unique");

  for (const lot of lots) {
    const where = `lot ${lot.id}`;
    assert.ok(typeof lot.id === "string" && lot.id.length > 0, `${where}: id`);
    assert.ok(typeof lot.title === "string" && lot.title.trim().length > 0, `${where}: title`);
    assert.match(lot.url, /^https:\/\//, `${where}: url is absolute https`);
    assert.ok(isIsoDate(lot.endingDate), `${where}: endingDate is an ISO date`);
    assert.ok(Number.isFinite(lot.latitude) && Math.abs(lot.latitude) <= 90, `${where}: latitude`);
    assert.ok(Number.isFinite(lot.longitude) && Math.abs(lot.longitude) <= 180, `${where}: longitude`);
    assert.ok(typeof lot.category === "string" && lot.category.length > 0, `${where}: category`);
    assert.ok(isValidPriceOrNull(lot.currentPrice), `${where}: currentPrice is a valid price or missing`);
    assert.ok(isValidPriceOrNull(lot.startPrice), `${where}: startPrice is a valid price or missing`);
    assert.doesNotMatch(lot.title, /<[a-z/][^>]*>/i, `${where}: title has no HTML tags`);
  }
}

describe("LiveAuctioneers", () => {
  it("parses search results", async () => {
    const { lots, unmatched } = await runWithFixture("liveAuctioneers", () => fetchLiveAuctioneersLots("lathe"));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 8);
    assert.ok(lots.every((l) => l.id.startsWith("la-") && l.url.startsWith("https://www.liveauctioneers.com/item/")));
    assertMatchesSnapshot("liveAuctioneers", lots);
  });
});

describe("The Saleroom", () => {
  it("parses Algolia hits", async () => {
    const { lots, unmatched } = await runWithFixture("theSaleroom", () => scrapeTheSaleroomLots("lathe"));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 8);
    assert.ok(lots.every((l) => l.sourcePlatform === "The Saleroom"));
    assertMatchesSnapshot("theSaleroom", lots);
  });
});

describe("Easy Live Auction", () => {
  it("parses Algolia hits and applies live bidding data", async () => {
    const { lots, unmatched } = await runWithFixture("easyLive", () => fetchEasyLiveAuctionLots("lathe", 35, 0));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 8);
    assert.ok(lots.every((l) => l.imageUrl.startsWith("https://")));
    assertMatchesSnapshot("easyLive", lots);
  });

  it("returns no lots rather than throwing when the search API is unreachable", async () => {
    const { lots } = await runWithFixture("liveAuctioneers", () => fetchEasyLiveAuctionLots("lathe", 35, 0));
    assert.deepEqual(lots, []);
  });
});

describe("BPI Auctions (Artisio)", () => {
  it("parses a page of lots and stops paginating on a short page", async () => {
    const { lots, unmatched } = await runWithFixture("bpi", () => scrapeBpiLots("", 2));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 6);
    assert.ok(lots.every((l) => l.url.startsWith("https://www.bpiauctions.com/auctions/#/lots/")));
    for (const lot of lots) {
      if (lot.reserve != null) assert.ok(lot.reserve > (lot.startPrice || 0), `${lot.id}: reserve only shown above opening bid`);
    }
    assertMatchesSnapshot("bpi", lots);
  });
});

describe("HiBid", () => {
  it("parses lot tiles and enriches them from lot pages", async () => {
    const { lots, unmatched } = await runWithFixture("hibid", () => scrapeHibidLots("lathe", ""));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 12);
    assert.ok(lots.every((l) => l.url === `https://hibid.com/lot/${l.lotId}`));
    // Every lot page in the fixture names its auction company, so enrichment must replace the default.
    assert.ok(lots.every((l) => l.auctioneer !== "HiBid Auctions"), "auctioneer taken from lot page");
    assertMatchesSnapshot("hibid", lots);
  });

  it("stores lots with no bids as unpriced rather than 0", async () => {
    const { lots } = await runWithFixture("hibid", () => scrapeHibidLots("lathe", ""));
    assert.ok(lots.every((l) => l.currentPrice !== 0 && l.startPrice !== 0));
  });
});

describe("Silicon Valley Disposition", () => {
  it("parses upcoming auction events", async () => {
    const { lots, unmatched } = await runWithFixture("svd", () => scrapeSvdUpcomingAuctions(""));
    assert.deepEqual(unmatched, []);
    assertValidListings(lots, 9);
    assert.ok(lots.every((l) => l.id.startsWith("svd-event-") && l.country === "US"));
    assertMatchesSnapshot("svd", lots);
  });

  it("filters events by keyword", async () => {
    const { lots: all } = await runWithFixture("svd", () => scrapeSvdUpcomingAuctions(""));
    const { lots } = await runWithFixture("svd", () => scrapeSvdUpcomingAuctions("zzz-no-such-lot"));
    assert.ok(all.length > 0);
    assert.equal(lots.length, 0);
  });
});

describe("replay helper", () => {
  it("freezes the clock at the fixture recording time", () => {
    const replay = startReplay([]);
    try {
      assert.equal(Date.now(), FIXTURE_NOW);
      assert.equal(new Date().getTime(), FIXTURE_NOW);
      assert.equal(new Date("2020-01-01T00:00:00Z").getTime(), Date.parse("2020-01-01T00:00:00Z"));
    } finally {
      replay.stop();
    }
  });
});
