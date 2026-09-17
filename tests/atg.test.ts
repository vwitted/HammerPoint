// BidSpotter / The Saleroom (ATG network). In production the extraction script runs inside
// headless Chrome; here it runs in jsdom against a saved BidSpotter results page.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { ATG_EXTRACT_LOTS_SCRIPT, mapAtgRawLot } from "../server/providers/atg.ts";
import { startReplay } from "./helpers/replay.ts";
import { assertMatchesSnapshot } from "./helpers/snapshot.ts";

function extractFromSavedPage() {
  const html = readFileSync(new URL("./fixtures/bidspotter-search-lathe.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, {
    url: "https://www.bidspotter.co.uk/en-gb/search-results?searchTerm=lathe",
    runScripts: "outside-only", // the page's own scripts never run
    virtualConsole: new VirtualConsole(), // silence CSS parse warnings from the saved page
  });
  try {
    return dom.window.eval(ATG_EXTRACT_LOTS_SCRIPT) as any[];
  } finally {
    dom.window.close();
  }
}

describe("ATG lot card extraction (BidSpotter page)", () => {
  const raw = extractFromSavedPage();

  it("extracts one record per lot card", () => {
    assert.equal(raw.length, 29);
    assert.equal(new Set(raw.map((r) => r.url)).size, raw.length, "no duplicate lots");
  });

  it("reads the core fields from every card", () => {
    for (const r of raw) {
      assert.match(r.url, /^https:\/\/www\.bidspotter\.co\.uk\/en-gb\/auction-catalogues\/.+\/lot-/, r.url);
      assert.ok(r.title.length > 1, `title for ${r.url}`);
      assert.match(r.imageUrl, /^https:\/\//, `image for ${r.url}`);
      assert.ok(r.auctioneer, `auctioneer for ${r.url}`);
      assert.ok(r.lotNumber, `lot number for ${r.url}`);
      assert.equal(r.currency, "£");
    }
  });

  it("parses prices as numbers", () => {
    const priced = raw.filter((r) => r.openingBid != null || r.currentBid != null || r.estimateStr);
    assert.ok(priced.length >= 25, "most cards carry a price or estimate");
    for (const r of raw) {
      for (const field of ["openingBid", "currentBid"]) {
        if (r[field] != null) assert.ok(Number.isFinite(r[field]) && r[field] > 0, `${field} for ${r.url}`);
      }
      if (r.estimateStr) assert.match(r.estimateStr, /^£\d+(\.\d+)?( - £\d+(\.\d+)?)?$/);
    }
  });

  it("maps cards to listings", () => {
    const replay = startReplay([]); // freezes the clock so generated ids and dates are stable
    try {
      const lots = raw.map((item, i) => mapAtgRawLot(item, i, "BidSpotter", "bidspotter"));
      assert.ok(lots.every((l) => l.sourcePlatform === "BidSpotter" && l.country === "UK"));
      assert.ok(lots.every((l) => /^bidspotter-[0-9a-f-]{36}$/.test(l.id)), "ids come from the lot URL");
      const again = raw.map((item, i) => mapAtgRawLot(item, i + 100, "BidSpotter", "bidspotter"));
      assert.deepEqual(again.map((l) => l.id), lots.map((l) => l.id), "same lot, same id");
      assertMatchesSnapshot("bidspotter", { raw, lots });
    } finally {
      replay.stop();
    }
  });
});
