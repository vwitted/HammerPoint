import { getCoordinatesForLocation } from "../lib/geo";
import { withCancel } from "../lib/cancel";
import { categorizeByTitle } from "../lib/categories";
import { cleanHtmlText } from "../lib/text";

export interface EasyLiveHit {
  auction_type?: string;
  currency_symbol?: string;
  ukEndDate?: boolean;
  low_est?: number;
  high_est?: number;
  start_price?: number;
  current_bid?: number;
  end_date?: string;
  start_date?: string;
  imgPath?: string;
  ukStartDate?: boolean;
  description?: string;
  lot_url?: string;
  objectID?: string;
  [key: string]: any;
}

// Only text that names a month or has a numeric date (e.g. 09/10, 2026-10-09) is treated as a date.
// Without this, "TBC" becomes "TBC 2026", which JavaScript reads as 1 January.
const LOOKS_LIKE_DATE = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b|\d{1,4}[\/.-]\d{1,2}/i;

export function normalizeEasyLiveLot(hit: EasyLiveHit, keyword: string = ""): any {
  const rawTitle = hit.description || "Auction Lot";
  const title = cleanHtmlText(rawTitle);

  // Extract catalog slug to infer auction name or location
  const lotUrl = hit.lot_url || "";
  const slugParts = lotUrl.split("/").filter(Boolean);
  const catalogSlug = slugParts[slugParts.length - 1] || "";
  const cleanAuctionSlug = catalogSlug.replace(/-lot-\d+$/i, "").replace(/-/g, " ");

  // Infer location from description and auction title
  const fullText = `${title} ${cleanAuctionSlug}`;
  const exactCoords = getCoordinatesForLocation(fullText);

  // Build image URL
  const imageUrl = hit.imgPath
    ? `https://content.easyliveauction.com/auctions/images_lots/${hit.imgPath}_PREVIEW.JPG`
    : "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";

  const directUrl = lotUrl
    ? (lotUrl.startsWith("http") ? lotUrl : `https://www.easyliveauction.com/catalogue/lot/${lotUrl.replace(/^\/+/, "")}`)
    : `https://www.easyliveauction.com/catalogue/?searchTerm=${encodeURIComponent(keyword || title)}&searchOption=3`;

  // Estimate / price
  const lowEst = typeof hit.low_est === "number" && hit.low_est > 0 ? hit.low_est : 0;
  const highEst = typeof hit.high_est === "number" && hit.high_est > 0 ? hit.high_est : 0;
  let estimateStr = "";
  if (lowEst > 0 && highEst > 0) {
    estimateStr = `£${lowEst} - £${highEst}`;
  } else if (lowEst > 0) {
    estimateStr = `£${lowEst}`;
  }
  
  // Easy Live Pricing Logic:
  // In UK live webcast & catalogue auctions, online bidding starts at the opening bid.
  // When a lot has a published estimate (e.g. £3 - £8 for Lot 61 "Honda petrol lawnmower"),
  // advance pre-bidding begins at the low estimate (£3) if no separate start_price is specified.
  // If start_price is explicitly given in the hit, use that; otherwise if lowEst > 0, opening bid is lowEst.
  const rawStartPrice = typeof hit.start_price === "number" && hit.start_price > 0 ? hit.start_price : null;
  const openingBid = rawStartPrice != null ? rawStartPrice : (lowEst > 0 ? lowEst : null);
  // If no bids placed yet (or current_bid equals opening bid), current bid price is opening bid (the available entry price)
  const currentBid = typeof hit.current_bid === "number" && hit.current_bid > 0 ? hit.current_bid : openingBid;
  const bidLabel = currentBid != null
    ? (typeof hit.current_bid === "number" && hit.current_bid > 0 && hit.current_bid !== openingBid ? "Current Bid" : "Starting Bid")
    : undefined;
  
  // High estimate is strictly an estimate, NOT a reserve price! EasyLive does not reveal reserves.
  const reserve = null;

  // Robust date parser for EasyLive strings
  const currentYear = new Date().getFullYear();
  const parseEasyLiveDateStr = (raw: string, defaultHour: number = 10): Date | null => {
    if (!raw) return null;
    let clean = raw.trim();
    // Strip leading day names (e.g. "Sun, ", "Wed, ")
    clean = clean.replace(/^[a-z]+,\s*/i, "");
    if (!LOOKS_LIKE_DATE.test(clean)) return null;
    // Replace obsolete 2001 defaults with currentYear
    if (clean.includes("2001")) {
      clean = clean.replace("2001", String(currentYear));
    }
    // If no 4-digit year exists (e.g. "09 Sep"), append currentYear
    if (!/\b20\d\d\b/.test(clean)) {
      clean = `${clean} ${currentYear}`;
    }
    const d = new Date(`${clean} ${defaultHour}:00:00 GMT`);
    if (isNaN(d.getTime())) {
      const alt = new Date(clean);
      if (!isNaN(alt.getTime())) {
        if (alt.getFullYear() < 2020) alt.setFullYear(currentYear);
        return alt;
      }
      return null;
    }
    if (d.getFullYear() < 2020) {
      d.setFullYear(currentYear);
    }
    return d;
  };

  // Determine dates
  const isLive = hit.auction_type === "Live";
  const startDateStr = hit.start_date || "Upcoming";
  const endDateStr = hit.end_date || "Upcoming";
  
  let endingDate = "";
  let startDate: string | null = null;

  if (isLive) {
    // For live sales, start_date is the auction date (e.g. "07 Sep" or "09 Sep")
    const rawSaleDate = (hit.start_date || hit.end_date || "").trim();
    if (rawSaleDate) {
      const parsedStart = parseEasyLiveDateStr(rawSaleDate, 10);
      const parsedEnd = parseEasyLiveDateStr(rawSaleDate, 18);
      if (parsedStart) startDate = parsedStart.toISOString();
      if (parsedEnd) endingDate = parsedEnd.toISOString();
    }
  } else {
    // For timed sales, end_date is the closing date (e.g. "06 Sep")
    const rawEnd = (hit.end_date || "").trim();
    if (rawEnd) {
      const parsed = parseEasyLiveDateStr(rawEnd, 21);
      if (parsed) endingDate = parsed.toISOString();
    }
    const rawStart = (hit.start_date || "").trim();
    if (rawStart) {
      const parsed = parseEasyLiveDateStr(rawStart, 9);
      if (parsed) startDate = parsed.toISOString();
    }
  }

  if (!endingDate) {
    endingDate = new Date(Date.now() + 3 * 86400000).toISOString();
  }
  if (!startDate) {
    startDate = endingDate;
  }

  // Extract category hints
  const category = categorizeByTitle(title, "General");

  // Derive auctioneer name from object ID or catalog
  const auctionHouseCode = (hit.objectID || "").split("_")[0] || "UK House";
  const auctioneerName = `Easy Live Auction (${auctionHouseCode.toUpperCase()})`;

  const formattedStartStr = startDateStr.includes(String(currentYear)) ? startDateStr : `${startDateStr} ${currentYear}`;
  const formattedEndStr = endDateStr.includes(String(currentYear)) ? endDateStr : `${endDateStr} ${currentYear}`;

  return {
    id: `easylive-${hit.objectID || Date.now()}`,
    title: title,
    description: title,
    url: directUrl,
    details: `Lot: ${title}. ${hit.auction_type || "Live"} auction (${formattedStartStr} - ${formattedEndStr}). Estimate: ${hit.currency_symbol || "£"}${lowEst} - ${hit.currency_symbol || "£"}${highEst}. Auction: ${cleanAuctionSlug}`,
    endingDate: endingDate,
    startDate: startDate,
    address: "United Kingdom",
    latitude: exactCoords.latitude,
    longitude: exactCoords.longitude,
    auctioneer: auctioneerName,
    category: category,
    country: "UK",
    currentPrice: currentBid,
    startPrice: openingBid,
    bidLabel: bidLabel,
    estimateStr: estimateStr || undefined,
    reserve: reserve,
    currency: hit.currency_symbol === "€" ? "EUR" : "GBP",
    auctionType: hit.auction_type || (isLive ? "Live" : "Timed"),
    imageUrl: imageUrl,
    status: "active",
    sourcePlatform: "Easy Live Auction"
  };
}

// In-memory cache for Easy Live Auction real-time bidding data (60-second TTL)
export const easyLiveBidCache = new Map<string, { timestamp: number; data: any }>();

// Enrich Easy Live Auction lots with live starting bid and real-time dates from doRefreshTimedBidding
export async function enrichEasyLiveTimedBidding(lots: any[], cancelSignal?: AbortSignal): Promise<any[]> {
  // Target lots that have a valid EasyLive lot URL
  const targetLots = lots.filter(lot => 
    lot.url &&
    lot.url.includes("/lot/")
  );

  if (targetLots.length === 0) return lots;

  // Enrich up to 35 lots concurrently
  const enrichPromises = targetLots.slice(0, 35).map(async (lot) => {
    try {
      const match = lot.url.match(/\/lot\/([a-f0-9]{32})/i);
      if (!match) return;
      const lotHash = match[1];

      // Check cache (60s TTL)
      const cached = easyLiveBidCache.get(lotHash);
      let info: any = null;
      if (cached && Date.now() - cached.timestamp < 60000) {
        info = cached.data;
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch("https://www.easyliveauction.com/components/catalogue_components.cfc?method=doRefreshTimedBidding", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0",
            "Connection": "close"
          },
          body: "data=" + encodeURIComponent(JSON.stringify({ lot: lotHash, l: "0" })),
          signal: withCancel(controller.signal, cancelSignal)
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const text = await res.text();
          const clean = text.replace(/^\/\//, "").trim();
          if (clean && clean !== "{}") {
            try {
              info = JSON.parse(clean);
              easyLiveBidCache.set(lotHash, { timestamp: Date.now(), data: info });
            } catch {}
          }
        }
      }

      if (!info) return;

      // Parse bid amount if available (e.g. "25 GBP", "Starting bid: 3 GBP")
      // Parse bid amount if available
      if (info.bid != null) {
        const strBid = String(info.bid);
        const numMatch = strBid.match(/[\d,.]+/);
        if (numMatch) {
          const val = parseFloat(numMatch[0].replace(/,/g, ""));
          if (!isNaN(val) && val > 0) {
            const isStarting = (info.bidLabel || "").toLowerCase().includes("starting") ||
                               (info.history === 0 && !info.beenOutbid);
            if (isStarting) {
              lot.startPrice = val;
              lot.currentPrice = val;
              lot.bidLabel = "Starting Bid";
            } else {
              lot.currentPrice = val;
              lot.bidLabel = "Current Bid";
            }
          }
        }
      }

      if (info.maxNextBid && typeof info.maxNextBid === "string") {
        lot.minNextBid = info.maxNextBid;
      }

      if (info.reserve && typeof info.reserve === "string") {
        lot.reserveStatus = info.reserve;
        if (info.reserveMet === 1) {
          lot.reserveMet = true;
        }
      }

      // Update dateEnd / startDate if provided with full timestamp (e.g. "September, 09 2026 16:00:00")
      if (info.dateEnd && typeof info.dateEnd === "string") {
        const parsed = new Date(info.dateEnd + " GMT");
        if (!isNaN(parsed.getTime())) {
          lot.endingDate = parsed.toISOString();
          if (info.endLabel?.toLowerCase().includes("starts")) {
            lot.startDate = parsed.toISOString();
          }
        }
      }
    } catch {
      // Ignore network timeout on individual lot enrichment
    }
  });

  await Promise.allSettled(enrichPromises);
  return lots;
}

// Fetch lots from Easy Live Auction via Algolia Search API
export async function fetchEasyLiveAuctionLots(keyword: string, hitsPerPage: number = 20, page: number = 0, cancelSignal?: AbortSignal): Promise<any[]> {
  try {
    const url = "https://KBISTY43U6-dsn.algolia.net/1/indexes/*/queries";
    const body = {
      requests: [
        {
          indexName: "Upcoming_Auctions",
          query: keyword,
          params: `hitsPerPage=${hitsPerPage}&page=${page}&facetFilters=["sold:X"]`
        }
      ]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": "KBISTY43U6",
        "X-Algolia-API-Key": "917b17098c0702d97a62a6ca8fc1f410",
        "Connection": "close",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(body),
      signal: withCancel(controller.signal, cancelSignal)
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`EasyLive Algolia fetch returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const hits: EasyLiveHit[] = data.results?.[0]?.hits || [];
    const lots = hits.map(hit => normalizeEasyLiveLot(hit, keyword));
    return await enrichEasyLiveTimedBidding(lots, cancelSignal);
  } catch (err: any) {
    console.error("Easy Live Auction fetch error:", err.message);
    return [];
  }
}
