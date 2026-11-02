import { getCoordinatesForLocation } from "../lib/geo";
import { withCancel } from "../lib/cancel";
import { categorizeByTitle } from "../lib/categories";
import { cleanHtmlText } from "../lib/text";
import { parseUkLocalDateTime } from "../lib/dates";
import { http2Client } from "../lib/http2";

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
  
  // The search index doesn't carry the opening bid, and it is often well below the low estimate
  // (e.g. estimate £200 - £300, starting bid £100). The real figure comes from the lot's bid box,
  // read in enrichEasyLiveTimedBidding. Until then the price is unknown; never use the estimate.
  const openingBid = typeof hit.start_price === "number" && hit.start_price > 0 ? hit.start_price : null;
  const latestBid = typeof hit.current_bid === "number" && hit.current_bid > 0 ? hit.current_bid : null;
  const currentBid = latestBid ?? openingBid;
  const bidLabel = currentBid == null
    ? undefined
    : (latestBid != null && latestBid !== openingBid ? "Current Bid" : "Starting Bid");
  
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

const EASYLIVE_ORIGIN = "https://www.easyliveauction.com";
const BID_REFRESH_URL = `${EASYLIVE_ORIGIN}/components/catalogue_components.cfc?method=doRefreshTimedBidding`;
const BID_REFRESH_TIMEOUT_MS = 15000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

// Cloudflare's "Just a moment..." page. Easy Live sends it to HTTP/1.1 clients such as Node's
// fetch, but serves the same request over HTTP/2.
function isCloudflareChallenge(res: Response): boolean {
  return res.headers.get("cf-mitigated") === "challenge";
}

// Asks Easy Live for a lot's bid box. Returns the parsed data, null when there is none (the site
// answers "{}" for live-sale lots without one), or "blocked" for a Cloudflare challenge.
async function requestBidInfo(send: FetchLike, lotHash: string, cancelSignal?: AbortSignal): Promise<any | null | "blocked"> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BID_REFRESH_TIMEOUT_MS);
  try {
    const res = await send(BID_REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
      },
      body: "data=" + encodeURIComponent(JSON.stringify({ lot: lotHash, l: "0" })),
      signal: withCancel(controller.signal, cancelSignal),
    });
    if (isCloudflareChallenge(res)) return "blocked";
    if (!res.ok) return null;
    const clean = (await res.text()).replace(/^\/\//, "").trim();
    if (!clean || clean === "{}") return null;
    try {
      return JSON.parse(clean);
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// Copies a lot's bid box data onto the lot.
function applyBidInfo(lot: any, info: any): void {
  // The lot page shows these two fields verbatim in its bid box, e.g. "Starting Bid:" / "100 GBP"
  // before anyone bids and "Current Bid:" / "48 GBP" after.
  if (info.bid != null) {
    const numMatch = String(info.bid).match(/[\d,.]+/);
    if (numMatch) {
      const val = parseFloat(numMatch[0].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) {
        const siteLabel = typeof info.bidLabel === "string" ? info.bidLabel.replace(/:\s*$/, "").trim() : "";
        const isStarting = siteLabel
          ? siteLabel.toLowerCase().includes("starting")
          : (info.history === 0 && !info.beenOutbid);
        if (isStarting) lot.startPrice = val;
        lot.currentPrice = val;
        lot.bidLabel = siteLabel || (isStarting ? "Starting Bid" : "Current Bid");
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

  // Full end (or, for live sales, start) time in UK local time, e.g. "September, 09 2026 16:00:00".
  if (info.dateEnd && typeof info.dateEnd === "string") {
    const parsed = parseUkLocalDateTime(info.dateEnd);
    if (parsed) {
      lot.endingDate = parsed.toISOString();
      if (info.endLabel?.toLowerCase().includes("starts")) {
        lot.startDate = parsed.toISOString();
      }
    }
  }
}

// Enrich Easy Live Auction lots with the live bid and exact times from each lot's bid box.
// Tries fetch on one lot first; if Cloudflare challenges it, every lookup goes over HTTP/2
// instead, on one shared connection, so a blocked search costs one wasted request, not 35.
export async function enrichEasyLiveTimedBidding(lots: any[], cancelSignal?: AbortSignal): Promise<any[]> {
  const lookups: { lot: any; lotHash: string }[] = [];
  for (const lot of lots) {
    if (lookups.length >= 35) break;
    const match = typeof lot.url === "string" ? lot.url.match(/\/lot\/([a-f0-9]{32})/i) : null;
    if (!match) continue;
    const cached = easyLiveBidCache.get(match[1]);
    if (cached && Date.now() - cached.timestamp < 60000) applyBidInfo(lot, cached.data);
    else lookups.push({ lot, lotHash: match[1] });
  }
  if (lookups.length === 0) return lots;

  const lookUp = async (send: FetchLike, { lot, lotHash }: { lot: any; lotHash: string }) => {
    const info = await requestBidInfo(send, lotHash, cancelSignal);
    if (info === "blocked") return "blocked";
    if (info) {
      easyLiveBidCache.set(lotHash, { timestamp: Date.now(), data: info });
      applyBidInfo(lot, info);
    }
    return "done";
  };
  // A failed lookup leaves that lot without a bid; it never fails the search.
  const settle = (p: Promise<unknown>) => p.catch(() => "failed");

  const [first, ...rest] = lookups;
  if (await settle(lookUp(fetch, first)) !== "blocked") {
    await Promise.all(rest.map((l) => settle(lookUp(fetch, l))));
    return lots;
  }

  if (cancelSignal?.aborted) return lots;
  const session = http2Client.openSession(EASYLIVE_ORIGIN, { connectTimeoutMs: 10000, signal: cancelSignal });
  try {
    await Promise.all(lookups.map((l) => settle(lookUp(session.fetch, l))));
  } finally {
    session.close();
  }
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
