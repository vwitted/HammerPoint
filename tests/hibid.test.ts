// HiBid's search HTML parser, against the current recorded page. The component was renamed from
// <app-lot-tile> to <app-auction-lot-card>, and a looser split also matches sibling elements such
// as <app-auction-lot-badge>, so keep the exact-count check.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFixture } from "./helpers/replay.ts";
import { parseHibidSearchHtml } from "../server/providers/hibid.ts";

function recordedSearch(): string {
  const request = loadFixture("hibid").find((r) => r.key.startsWith("GET https://hibid.com/lots?"));
  assert.ok(request, "the fixture contains a HiBid search response");
  return request.body;
}

describe("parseHibidSearchHtml", () => {
  it("parses one record per current <app-auction-lot-card>", () => {
    const lots = parseHibidSearchHtml(recordedSearch());
    assert.equal(lots.length, 12);
    assert.equal(new Set(lots.map((l) => l.lotId)).size, lots.length);

    const first = lots.find((l) => l.lotId === "329097265")!;
    assert.equal(first.lotNumber, "104");
    assert.equal(first.title, "Lathe");
    assert.equal(first.price, 13);
    assert.equal(first.location, "Boswell, PA, USA");
    assert.equal(first.auctioneer, "Fitzgerald Auction Services");
    assert.match(first.imageUrl, /^https:\/\/cdn\.hibid\.com\/img\.axd\?/);
  });

  it("leaves the lot number empty when the card does not publish one", () => {
    const lots = parseHibidSearchHtml(recordedSearch());
    const noNumber = lots.find((l) => l.lotId === "329708766")!;
    assert.equal(noNumber.lotNumber, "");
    assert.equal(noNumber.title, "Wood Lathe");
  });

  it("treats an unbid lot as unpriced rather than 0", () => {
    const lots = parseHibidSearchHtml(recordedSearch());
    assert.ok(lots.every((l) => l.price === null || l.price > 0));
    assert.ok(lots.some((l) => l.price === null), "the recording includes at least one lot with no bids");
  });
});
