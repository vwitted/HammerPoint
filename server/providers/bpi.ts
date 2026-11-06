import puppeteer from "puppeteer";
import { closeBrowserOnCancel } from "../lib/cancel";
import { httpFetch } from "../lib/http";
import { noteFailure, noteResponse } from "../lib/sourceHealth";
import { getCoordinatesForLocation } from "../lib/geo";
import { cleanHtmlText } from "../lib/text";
import { extractCategoryName } from "../lib/categories";

export interface ArtisioRequestOptions {
  q?: string;
  clientId?: string;
  lotStatus?: string;
  auctionType?: string;
  page?: number;
  originUrl?: string;
  refererUrl?: string;
}

// Request-header-compliant fetch wrapper for Artisio / BPI Auctions
export async function fetchArtisioHeadersCompliant(options: ArtisioRequestOptions, cancelSignal?: AbortSignal): Promise<any> {
  const q = options.q || "";
  const clientId = options.clientId || "77829366";
  const lotStatus = options.lotStatus || "published";
  const auctionType = options.auctionType || "all";
  const page = options.page || 1;
  const originUrl = options.originUrl || "https://www.bpiauctions.com";
  const refererUrl = options.refererUrl || "https://www.bpiauctions.com/";

  const url = `https://webapp.artisio.co/website/lots?q=${encodeURIComponent(q)}&lot_status=${encodeURIComponent(lotStatus)}&auction_type=${encodeURIComponent(auctionType)}&page=${page}`;

  const compliantHeaders: Record<string, string> = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "artisio-client-id": clientId,
    "artisio-language": "en",
    "dnt": "1",
    "origin": originUrl,
    "referer": refererUrl,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site"
  };

  // Reported only if the Chrome fallback fails too.
  let directProblem: () => void = () => {};
  try {
    const res = await httpFetch(url, {
      method: "GET",
      headers: compliantHeaders
    }, cancelSignal, 12000);

    if (res.ok) {
      const json = await res.json();
      return json;
    }

    console.warn(`Artisio direct fetch returned status ${res.status}. Attempting Puppeteer fallback.`);
    directProblem = () => noteResponse(res, "search");
  } catch (fetchErr: any) {
    console.warn(`Artisio direct fetch failed (${fetchErr.message}). Attempting Puppeteer fallback.`);
    directProblem = () => noteFailure(fetchErr, "search", cancelSignal);
  }

  // Fallback: Puppeteer browser fetch if direct fetch is blocked (not if the search was cancelled)
  if (cancelSignal?.aborted) return { lots: { count: 0, results: [] } };
  try {
    return await fetchArtisioViaPuppeteer(url, clientId, originUrl, refererUrl, cancelSignal, directProblem);
  } catch {
    directProblem();
    return { lots: { count: 0, results: [] } };
  }
}

// Puppeteer fallback execution for Artisio requests in environments where Chrome is available
// onFailure runs if this fallback fails too (to report why the direct request didn't work).
export async function fetchArtisioViaPuppeteer(targetUrl: string, clientId: string, originUrl: string, refererUrl: string, cancelSignal?: AbortSignal, onFailure: () => void = () => {}): Promise<any> {
  let browser: any = null;
  let stopClosingOnCancel = () => {};
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu"
      ]
    });
    stopClosingOnCancel = closeBrowserOnCancel(browser, cancelSignal);

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "artisio-client-id": clientId,
      "artisio-language": "en",
      "origin": originUrl,
      "referer": refererUrl
    });

    // Navigate to BPI to establish origin / session cookies, then evaluate fetch
    await page.goto("https://bpiauctions.com/", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});

    const result = await page.evaluate(async (url: string, cId: string) => {
      const response = await fetch(url, {
        headers: {
          "accept": "application/json, text/plain, */*",
          "artisio-client-id": cId,
          "artisio-language": "en"
        }
      });
      return await response.json();
    }, targetUrl, clientId);

    return result;
  } catch (puppeteerErr: any) {
    console.warn("Puppeteer Artisio fallback notice:", puppeteerErr.message);
    if (!cancelSignal?.aborted) {
      onFailure();
      noteFailure(puppeteerErr, "search (Chrome)", cancelSignal);
    }
    return { lots: { count: 0, results: [] } };
  } finally {
    stopClosingOnCancel();
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Normalizes raw Artisio lot into clean, standardized JSON
export function normalizeArtisioLot(lot: any, keyword: string = ""): any {
  const rawTitle = lot.title?.en || (typeof lot.title === "string" ? lot.title : "") || lot.short_description?.en || (typeof lot.short_description === "string" ? lot.short_description : "") || "Lot Item";
  const title = cleanHtmlText(rawTitle) || "Lot Item";

  const rawDesc = lot.description?.en || (typeof lot.description === "string" ? lot.description : "") || lot.short_description?.en || "";
  const description = cleanHtmlText(rawDesc);

  const locRaw = lot.auction?.auction_location?.en || (typeof lot.auction?.auction_location === "string" ? lot.auction.auction_location : "") || lot.auction?.auction_location_info?.en || lot.auction?.important_information?.en || "United Kingdom";
  const location = cleanHtmlText(locRaw) || "United Kingdom";

  const exactCoords = getCoordinatesForLocation(location);

  // Parse images
  const imageUrls: string[] = [];
  if (Array.isArray(lot.image_urls) && lot.image_urls.length > 0) {
    imageUrls.push(...lot.image_urls);
  } else if (Array.isArray(lot.images) && lot.images.length > 0) {
    lot.images.forEach((imgObj: any) => {
      if (imgObj?.lg?.url) imageUrls.push(imgObj.lg.url);
      else if (imgObj?.original?.url) imageUrls.push(imgObj.original.url);
      else if (imgObj?.sm?.url) imageUrls.push(imgObj.sm.url);
    });
  }

  const primaryImage = imageUrls.length > 0
    ? imageUrls[0]
    : "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";

  const auctionUuid = lot.auction?.uuid || lot.auction_uuid || "";
  const lotUuid = lot.uuid || "";
  const lotNo = lot.lot_no || "";

  // Link directly to the specific lot in BPI's Artisio SPA router (/lots/:lotno)
  const directUrl = lotUuid
    ? `https://www.bpiauctions.com/auctions/#/lots/${lotUuid}${auctionUuid ? `?auction_uuid=${auctionUuid}` : ""}`
    : `https://www.bpiauctions.com/auctions/#/search?query=${encodeURIComponent(keyword || title)}`;

  // BPI / Artisio pricing:
  // start_price is the opening bid.
  // last_bid_amount is the current bid. If no bid placed yet, starting price serves as the opening bid under "Bid".
  const startPriceNum = Number(lot.start_price);
  const startPrice = (!isNaN(startPriceNum) && startPriceNum > 0) ? startPriceNum : null;
  
  const lastBidNum = Number(lot.last_bid_amount);
  const lastBid = (!isNaN(lastBidNum) && lastBidNum > 0) ? lastBidNum : null;
  const currentPrice = lastBid != null ? lastBid : startPrice;
  
  // Reserve: only treat as a reserve if strictly greater than the opening bid
  const rawReserveNum = Number(lot.reserve);
  const rawReserve = !isNaN(rawReserveNum) ? rawReserveNum : null;
  const openingForReserve = startPrice || 0;
  const reserve = (rawReserve != null && rawReserve > openingForReserve) ? rawReserve : null;
  
  // Standardize ending date into valid ISO format
  let endingDate = "";
  const rawEndDate = lot.end_date || lot.auction?.end_date || lot.auction?.auction_dates?.[0]?.end_date;
  if (rawEndDate) {
    const parsed = new Date(rawEndDate);
    if (!isNaN(parsed.getTime())) {
      endingDate = parsed.toISOString();
    }
  }
  if (!endingDate) {
    endingDate = new Date(Date.now() + 5 * 86400000).toISOString();
  }

  // Standardize start date
  let startDate: string | null = null;
  const rawStartDate = lot.start_date || lot.auction?.start_date;
  if (rawStartDate) {
    const parsed = new Date(rawStartDate);
    if (!isNaN(parsed.getTime())) {
      startDate = parsed.toISOString();
    }
  }

  const categoryName = extractCategoryName(lot.category || lot.categories, title);

  const humanEndDate = new Date(endingDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  return {
    id: `bpilot-${lotUuid || Date.now()}-${lotNo}`,
    uuid: lotUuid,
    lotNo: lotNo,
    title: title,
    description: description,
    url: directUrl,
    details: description 
      ? `${description} (Closing: ${humanEndDate})`
      : `Lot ${lotNo}: ${title}. Location: ${location}. Auction ending: ${humanEndDate}.${startPrice > 0 ? ` Opening bid: £${startPrice}.` : ""}`,
    endingDate: endingDate,
    startDate: startDate,
    address: location,
    latitude: exactCoords.latitude,
    longitude: exactCoords.longitude,
    auctioneer: "BPI Auctions",
    category: categoryName,
    country: "UK",
    currentPrice: currentPrice,
    startPrice: startPrice,
    reserve: reserve,
    currency: typeof lot.currency === "string" ? lot.currency : "GBP",
    imageUrl: primaryImage,
    imageUrls: imageUrls,
    auction: {
      uuid: auctionUuid,
      auctionNo: lot.auction?.auction_no || lot.auction_no || "",
      title: cleanHtmlText(lot.auction?.description?.en || (typeof lot.auction?.description === "string" ? lot.auction.description : "") || lot.auction_title || "")
    },
    status: typeof lot.status === "string" ? lot.status : "active"
  };
}

// Scrape multiple pages from Artisio for full result coverage
export async function scrapeBpiLots(keyword: string, maxPages: number = 3, cancelSignal?: AbortSignal): Promise<any[]> {
  try {
    const allLots: any[] = [];
    const seenUuids = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      if (cancelSignal?.aborted) break;
      const data = await fetchArtisioHeadersCompliant({
        q: keyword,
        clientId: "77829366",
        lotStatus: "published",
        auctionType: "all",
        page: page
      }, cancelSignal);

      const rawResults = data?.lots?.results || [];
      if (rawResults.length === 0) break;

      for (const lot of rawResults) {
        if (lot.uuid && !seenUuids.has(lot.uuid)) {
          seenUuids.add(lot.uuid);
          allLots.push(normalizeArtisioLot(lot, keyword));
        }
      }

      // If page has fewer than full results, we've reached the end
      if (rawResults.length < 15) break;
    }

    return allLots;
  } catch (e: any) {
    console.error("Error scraping BPI lots via compliant wrapper:", e.message);
    noteFailure(e, "search", cancelSignal);
    return [];
  }
}
