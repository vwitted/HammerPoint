import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

// Regression Test Suite for Commercial Auction Aggregator
// Verifies core price extraction, advance pre-bidding, unpriced autobid detection,
// date countdowns, and multi-source normalization.

describe("1. Auction Pricing & Advance Online Bidding", () => {
  it("uses low estimate as starting bid when no explicit start_price or current_bid is published (e.g. Lot 61 Honda mower)", () => {
    const rawHit = {
      objectID: "cru01_1139290134",
      description: "Honda petrol lawnmower",
      auction_type: "Live",
      start_price: undefined,
      current_bid: undefined,
      low_est: 3,
      high_est: 8,
      start_date: "11 Sep",
      end_date: "11 Sep",
      lot_url: "2b8de02416a310b42c5d6939907168c5/0af8d24542e81eb9357e7ef448a6646f/lot-61/"
    };

    const lowEst = typeof rawHit.low_est === "number" && rawHit.low_est > 0 ? rawHit.low_est : 0;
    const highEst = typeof rawHit.high_est === "number" && rawHit.high_est > 0 ? rawHit.high_est : 0;
    const estimateStr = (lowEst > 0 && highEst > 0) ? `£${lowEst} - £${highEst}` : (lowEst > 0 ? `£${lowEst}` : "");

    const rawStartPrice = typeof rawHit.start_price === "number" && rawHit.start_price > 0 ? rawHit.start_price : null;
    const openingBid = rawStartPrice != null ? rawStartPrice : (lowEst > 0 ? lowEst : null);
    const currentBid = typeof rawHit.current_bid === "number" && rawHit.current_bid > 0 ? rawHit.current_bid : openingBid;
    const bidLabel = currentBid != null
      ? (typeof rawHit.current_bid === "number" && rawHit.current_bid > 0 && rawHit.current_bid !== openingBid ? "Current Bid" : "Starting Bid")
      : undefined;

    assert.equal(openingBid, 3, "Opening bid must be £3 derived from low estimate");
    assert.equal(currentBid, 3, "Current bid must be £3 for advance bidding");
    assert.equal(bidLabel, "Starting Bid");
    assert.equal(estimateStr, "£3 - £8");
  });

  it("identifies truly blind autobid lots with no estimate and no starting price (e.g. Lot 426 SWAN jacket)", () => {
    const blindAutobidHit = {
      objectID: "nor06_1139320347",
      description: "Honda-licensed SWAN jacket",
      auction_type: "Live",
      start_price: undefined,
      current_bid: undefined,
      low_est: 0,
      high_est: 0,
      start_date: "10 Sep",
      end_date: "10 Sep"
    };

    const lowEst = typeof blindAutobidHit.low_est === "number" && blindAutobidHit.low_est > 0 ? blindAutobidHit.low_est : 0;
    const rawStartPrice = typeof blindAutobidHit.start_price === "number" && blindAutobidHit.start_price > 0 ? blindAutobidHit.start_price : null;
    const openingBid = rawStartPrice != null ? rawStartPrice : (lowEst > 0 ? lowEst : null);
    const currentBid = typeof blindAutobidHit.current_bid === "number" && blindAutobidHit.current_bid > 0 ? blindAutobidHit.current_bid : openingBid;

    const isUnpriced = (!currentBid || currentBid === 0) && (!openingBid || openingBid === 0);

    assert.equal(openingBid, null, "Opening bid must be null");
    assert.equal(currentBid, null, "Current bid must be null");
    assert.equal(isUnpriced, true, "Must be flagged as unpriced / blind autobid only");
  });

  it("handles active bidding where current bid exceeds starting price", () => {
    const activeLot = {
      start_price: 20,
      current_bid: 45,
      low_est: 20,
      high_est: 40
    };

    const rawStartPrice = typeof activeLot.start_price === "number" && activeLot.start_price > 0 ? activeLot.start_price : null;
    const openingBid = rawStartPrice != null ? rawStartPrice : (activeLot.low_est > 0 ? activeLot.low_est : null);
    const currentBid = typeof activeLot.current_bid === "number" && activeLot.current_bid > 0 ? activeLot.current_bid : openingBid;
    const bidLabel = currentBid != null
      ? (typeof activeLot.current_bid === "number" && activeLot.current_bid > 0 && activeLot.current_bid !== openingBid ? "Current Bid" : "Starting Bid")
      : undefined;

    assert.equal(openingBid, 20);
    assert.equal(currentBid, 45);
    assert.equal(bidLabel, "Current Bid");
  });
});

describe("2. Client Badge & Unpriced Partitioning Logic", () => {
  const isLotUnpriced = (item: any) => {
    const hasPrice = (typeof item.currentPrice === "number" && item.currentPrice > 0) ||
                     (typeof item.startPrice === "number" && item.startPrice > 0) ||
                     (Boolean(item.estimateStr) && item.estimateStr !== "£0 - £0" && item.estimateStr !== "$0 - $0");
    return !hasPrice;
  };

  it("keeps future-dated live auctions with low estimates in priced list", () => {
    const lot61 = {
      id: "easylive-cru01_1139290134",
      title: "Honda petrol lawnmower",
      currentPrice: 3,
      startPrice: 3,
      estimateStr: "£3 - £8",
      startDate: new Date(Date.now() + 86400000).toISOString(),
      auctionType: "Live"
    };

    assert.equal(isLotUnpriced(lot61), false, "Lot 61 must NOT be marked unpriced");
  });

  it("classifies lots with no prices and no estimates into unpriced autobid list", () => {
    const blindLot = {
      id: "easylive-nor06_1139320347",
      title: "SWAN Honda jacket",
      currentPrice: null,
      startPrice: null,
      estimateStr: undefined,
      startDate: new Date(Date.now() + 86400000).toISOString(),
      auctionType: "Live"
    };

    assert.equal(isLotUnpriced(blindLot), true, "Blind autobid lot must be classified as unpriced");
  });

  it("resolves effective bid with fallback to low estimate if prices were not initialized", () => {
    const item = {
      currentPrice: null,
      startPrice: null,
      estimateStr: "£15 - £25",
      country: "UK"
    };

    let lowEstFromStr: number | null = null;
    if (item.estimateStr) {
      const match = item.estimateStr.match(/[\d,.]+/);
      if (match) {
        const parsed = parseFloat(match[0].replace(/,/g, ""));
        if (!isNaN(parsed) && parsed > 0) lowEstFromStr = parsed;
      }
    }

    const effectiveBid = (item.currentPrice != null && item.currentPrice > 0)
      ? item.currentPrice
      : (item.startPrice != null && item.startPrice > 0 ? item.startPrice : lowEstFromStr);

    assert.equal(effectiveBid, 15, "Effective bid must fall back to low estimate £15");
  });
});

describe("3. Countdown & Time Remaining Calculation", () => {
  function getTimeRemaining(endingDateStr: string, startDateStr?: string | null, isLive?: boolean) {
    const nowTime = Date.now();
    if (isLive && startDateStr) {
      const startDate = new Date(startDateStr);
      if (!isNaN(startDate.getTime())) {
        const diffStart = startDate.getTime() - nowTime;
        if (diffStart > 0) {
          const days = Math.floor(diffStart / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diffStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          if (days > 1) return { text: `Live in ${days} days`, isUrgent: false, isExpired: false };
          if (days === 1) return { text: `Live Tomorrow`, isUrgent: false, isExpired: false };
          if (hours > 0) return { text: `Live in ${hours}h`, isUrgent: true, isExpired: false };
          return { text: `Live Today`, isUrgent: true, isExpired: false };
        }
      }
    }

    const endDate = new Date(endingDateStr);
    if (isNaN(endDate.getTime())) return { text: endingDateStr || "Upcoming", isUrgent: false, isExpired: false };
    const diff = endDate.getTime() - nowTime;
    if (diff <= 0) return { text: "Bidding Closed", isUrgent: false, isExpired: true };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return { text: `${days} days left`, isUrgent: false, isExpired: false };
  }

  it("accurately reports upcoming live start countdown without expiring advance bidding", () => {
    const futureLive = new Date(Date.now() + 28 * 3600 * 1000).toISOString(); // 28 hours from now = tomorrow
    const endingLive = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

    const info = getTimeRemaining(endingLive, futureLive, true);
    assert.equal(info.isExpired, false);
    assert.match(info.text, /Live Tomorrow|Live in \d+ days/);
  });

  it("marks past auctions as bidding closed", () => {
    const pastEnd = new Date(Date.now() - 3600000).toISOString();
    const info = getTimeRemaining(pastEnd);
    assert.equal(info.isExpired, true);
    assert.equal(info.text, "Bidding Closed");
  });
});

describe("4. Reserve Price Integrity", () => {
  it("only displays reserve if strictly above the opening bid", () => {
    const checkReserve = (startPrice: number | null, reserve: number | null) => {
      const opening = startPrice || 0;
      return (reserve != null && reserve > opening) ? reserve : null;
    };

    assert.equal(checkReserve(100, 150), 150, "Reserve above opening bid should be retained");
    assert.equal(checkReserve(100, 100), null, "Reserve equal to opening bid must be hidden");
    assert.equal(checkReserve(100, 50), null, "Reserve below opening bid must be hidden");
    assert.equal(checkReserve(100, null), null, "Null reserve must remain null");
  });
});

describe("5. Multi-Provider Normalization Fallbacks", () => {
  it("LiveAuctioneers extracts lowBidEstimate as starting bid if startPrice is missing", () => {
    const laItem = {
      itemId: "9999",
      title: "Industrial Milling Machine",
      startPrice: null,
      leadingBid: null,
      lowBidEstimate: 250,
      highBidEstimate: 500,
      currency: "GBP"
    };

    const startPrice = (typeof laItem.startPrice === "number" && laItem.startPrice > 0) ? laItem.startPrice : null;
    const leadingBid = (typeof laItem.leadingBid === "number" && laItem.leadingBid > 0) ? laItem.leadingBid : null;
    const lowEst = typeof laItem.lowBidEstimate === "number" && laItem.lowBidEstimate > 0 ? laItem.lowBidEstimate : null;

    const effectiveStart = startPrice != null ? startPrice : (lowEst != null ? lowEst : null);
    const currentPrice = leadingBid != null ? leadingBid : effectiveStart;

    assert.equal(effectiveStart, 250);
    assert.equal(currentPrice, 250);
  });
});

describe("6. Price String Parsing", () => {
  it("extracts £1 bids and decimals correctly across varied labels", () => {
    const parseNum = (m: any) => m ? parseFloat(m[1].replace(/,/g, "")) : null;

    const testMatch = (txt: string, regex: RegExp) => {
      const match = txt.match(regex);
      return parseNum(match);
    };

    const openingRegex = /(?:opening bid|starting bid|starts? at|starting price):?\s*(?:£|GBP|€|\$)?\s*([\d,.]+)/i;
    const currentRegex = /(?:current bid|last bid|\bbid\b):?\s*(?:£|GBP|€|\$)?\s*([\d,.]+)/i;

    assert.equal(testMatch("Bid: £1", currentRegex), 1);
    assert.equal(testMatch("Current Bid: £1.50", currentRegex), 1.5);
    assert.equal(testMatch("Starts at £1", openingRegex), 1);
    assert.equal(testMatch("Starting Price 1.00", openingRegex), 1);
  });
});

describe("7. The Saleroom & BidSpotter Extraction Integrity", () => {
  it("normalizes The Saleroom Algolia hits with proper estimates and prices", () => {
    const algoliaHit = {
      objectID: "abc-123",
      title: "Creality CR-Scan Raptor Pro 3D scanner",
      description: "<p>Excellent condition 3D scanner</p>",
      auctioneerRef: "auctioneer-ref",
      auctionRef: "auction-ref",
      auctioneerName: "Highland Auctions",
      lastBid: 400,
      nextBid: 450,
      lowEstimate: 800,
      highEstimate: 1200,
      currency: "EUR",
      imageUrl: "https://cdn.example.com/img.jpg"
    };

    const sym = algoliaHit.currency === "USD" ? "$" : (algoliaHit.currency === "EUR" ? "€" : "£");
    const startPrice = (algoliaHit.nextBid && algoliaHit.nextBid > 0) ? algoliaHit.nextBid : (algoliaHit.lowEstimate && algoliaHit.lowEstimate > 0 ? algoliaHit.lowEstimate : null);
    const currentPrice = (algoliaHit.lastBid && algoliaHit.lastBid > 0) ? algoliaHit.lastBid : startPrice;
    const estimateStr = `${sym}${algoliaHit.lowEstimate} - ${sym}${algoliaHit.highEstimate}`;

    assert.equal(currentPrice, 400);
    assert.equal(startPrice, 450);
    assert.equal(estimateStr, "€800 - €1200");
    assert.equal(sym, "€");
  });

  it("normalizes BidSpotter card extraction into valid AuctionItem fields", () => {
    const bsItem = {
      title: "A WOOD LATHE + VAT",
      lotNumber: "105",
      auctioneer: "Ashley Waller",
      openingBid: 20,
      currentBid: 30,
      estimateStr: "£50 - £120",
      currency: "£"
    };

    const effectiveStart = bsItem.openingBid != null ? bsItem.openingBid : null;
    const effectiveBid = bsItem.currentBid != null ? bsItem.currentBid : effectiveStart;

    assert.equal(effectiveStart, 20);
    assert.equal(effectiveBid, 30);
    assert.equal(bsItem.estimateStr, "£50 - £120");
    assert.equal(bsItem.currency, "£");
  });
});

