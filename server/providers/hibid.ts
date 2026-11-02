import puppeteer from "puppeteer";
import { closeBrowserOnCancel, withCancel } from "../lib/cancel";
import { noteChallengePage, noteFailure, noteResponse, reportSourceIssue } from "../lib/sourceHealth";
import { getCoordinatesForLocation } from "../lib/geo";
import { inferCategoryFromTitle } from "../lib/categories";

// In-memory cache for single lot details (search results are cached by the search cache)
export const hibidDetailCache = new Map<string, { timestamp: number; detail: any }>();

// Fast scrape of upcoming auctions & featured lots from svdisposition.com
export async function scrapeSvdUpcomingAuctions(keyword?: string, cancelSignal?: AbortSignal): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://svdisposition.com/upcoming-auctions", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Connection": "close"
      },
      signal: withCancel(controller.signal, cancelSignal)
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      noteResponse(res, "SVD auctions");
      return [];
    }

    const html = await res.text();
    const regex = /href="(https:\/\/svdisposition\.com\/auction-detail\/(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const listings: any[] = [];
    const seenIds = new Set<string>();

    const kwLower = (keyword || "").toLowerCase().trim();

    while ((match = regex.exec(html)) !== null) {
      const auctionUrl = match[1];
      const auctionId = match[2];
      if (seenIds.has(auctionId)) continue;
      seenIds.add(auctionId);

      const rawText = match[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      
      // Filter if keyword requested
      if (kwLower && !rawText.toLowerCase().includes(kwLower)) {
        continue;
      }

      // Parse date: e.g. "Sep 8–10, 2026" or "Sep 15–17, 2026"
      const dateMatch = rawText.match(/([A-Za-z]{3,9}\s+\d+(?:–\d+)?,\s*\d{4})/);
      const dateStr = dateMatch ? dateMatch[1] : "";
      
      // Parse location: e.g. "| Multiple Locations" or "| Santa Clara, CA"
      const locMatch = rawText.match(/\|\s*([^F]+?)(?:Featuring|View)/i);
      let location = locMatch ? locMatch[1].trim() : "Silicon Valley, CA, USA";
      if (!location.toLowerCase().includes("usa") && !location.toLowerCase().includes("ca")) {
        location = `${location}, USA`;
      }

      // Parse title
      const titleMatch = rawText.match(/^([^S\d]+(?:\S+\s+){0,5}#?\d*)/i);
      const title = titleMatch ? titleMatch[1].trim() : `Silicon Valley Disposition Auction #${auctionId}`;

      // Featured snippet
      const featMatch = rawText.match(/Featuring\s+([^V]+?)(?:View|$)/i);
      const featured = featMatch ? featMatch[1].trim() : "Commercial technology, lab, & industrial surplus";

      const coords = getCoordinatesForLocation(location, "US");
      const category = inferCategoryFromTitle(title, featured);

      // Estimate date bounds
      let endingDate = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
      if (dateStr) {
        const cleanedDate = dateStr.replace(/–\d+/, "");
        const parsed = new Date(cleanedDate);
        if (!isNaN(parsed.getTime())) {
          endingDate = parsed.toISOString();
        }
      }

      listings.push({
        id: `svd-event-${auctionId}`,
        title: `${title}: ${featured.slice(0, 75)}...`,
        url: auctionUrl,
        imageUrl: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80",
        details: `Silicon Valley Disposition Live Auction Event. Dates: ${dateStr}. Location: ${location}. Featured Assets: ${featured}. Direct bidding on HiBid.`,
        endingDate,
        startDate: new Date().toISOString(),
        address: location,
        latitude: coords.latitude,
        longitude: coords.longitude,
        auctioneer: "Silicon Valley Disposition",
        category,
        status: "Active",
        country: "US",
        currency: "$",
        sourcePlatform: "HiBid / SVD"
      });
    }

    return listings;
  } catch (err: any) {
    console.warn("scrapeSvdUpcomingAuctions error:", err.message);
    noteFailure(err, "SVD auctions", cancelSignal);
    return [];
  }
}

// Fetch comprehensive single lot information from hibid.com/lot/:lotId
export async function fetchHibidLotDetail(lotId: string, cancelSignal?: AbortSignal): Promise<any | null> {
  if (!lotId) return null;
  const cleanId = lotId.replace(/^hibid-/, "");
  const cached = hibidDetailCache.get(cleanId);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return cached.detail;
  }

  try {
    const targetUrl = `https://hibid.com/lot/${cleanId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout for single lot
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: withCancel(controller.signal, cancelSignal)
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      noteResponse(res, "HiBid lot details");
      return null;
    }

    const html = await res.text();

    const companyMatch = html.match(/class="lot-company-page-link"[^>]*>([^<]+)<\/a>/i) ||
                         html.match(/class="[^"]*company-name[^"]*"[^>]*>([^<]+)<\//i);
    const company = companyMatch ? companyMatch[1].replace(/&amp;/g, "&").trim() : null;

    const datesMatch = html.match(/class="lot-auction-date-range[^"]*"[^>]*>([^<]+)<\/div>/i);
    const dateRange = datesMatch ? datesMatch[1].trim() : null;

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").trim() : "";
    title = title.replace(/\s*\|\s*Live and Online Auctions on HiBid\.com/i, "").trim();

    const imgMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*)"/i);
    const imageUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, "&") : null;

    const locMatch = html.match(/class="[^"]*location[^"]*"[^>]*>([^<]+)<\//i) ||
                     html.match(/([A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}\s*\d{5})/);
    const address = locMatch ? locMatch[1].trim() : null;

    const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"/i);
    const description = descMatch ? descMatch[1].replace(/&amp;/g, "&").trim() : "";

    const detail = {
      lotId: cleanId,
      title: title || `HiBid Lot ${cleanId}`,
      company: company || "HiBid Auctions",
      dateRange,
      address,
      imageUrl,
      url: targetUrl,
      description
    };

    hibidDetailCache.set(cleanId, { timestamp: Date.now(), detail });
    return detail;
  } catch (err) {
    noteFailure(err, "HiBid lot details", cancelSignal);
    return null;
  }
}

// Scrape active lots directly across HiBid using global search url:
// https://hibid.com/lots?q={query_term}&miles=-1&status=ALL&closingDate={YYYY-MM-DD}
export async function scrapeHibidLots(keyword: string = "", closingDate: string = "", cancelSignal?: AbortSignal): Promise<any[]> {
  const queryTerm = (keyword || "").trim();
  const cleanClosing = (closingDate || "").trim();
  const logKey = `${queryTerm.toLowerCase()}::${cleanClosing}`;

  // Exact URL requested by the user with unlimited distance (miles=-1) and closingDate filter
  let targetUrl = `https://hibid.com/lots?q=${encodeURIComponent(queryTerm)}&miles=-1&status=ALL`;
  if (cleanClosing) {
    targetUrl += `&closingDate=${encodeURIComponent(cleanClosing)}`;
  }

  console.log(`[HiBid Global Scraper] Querying HiBid: ${targetUrl}`);

  let lotsRaw: any[] = [];
  // Reported only if the Chrome fallback comes back empty too.
  let directProblem: () => void = () => {};

  // 1. First attempt: High-speed direct HTTP fetch with browser headers
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for large multi-lot HTML
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: withCancel(controller.signal, cancelSignal)
    });
    clearTimeout(timeoutId);
    if (!res.ok) directProblem = () => noteResponse(res, "HiBid search");

    if (res.ok) {
      const html = await res.text();
      const tiles = html.split("<app-lot-tile");
      if (tiles.length > 1) {
        for (let i = 1; i < tiles.length; i++) {
          const t = tiles[i];
          const idMatch = t.match(/id="lot-(\d+)"/) || t.match(/href="\/lot\/(\d+)/);
          if (!idMatch) continue;
          const lotId = idMatch[1];

          const lotNumMatch = t.match(/<span[^>]*class="[^"]*text-primary[^"]*"[^>]*>Lot\s*([^<]+)<\/span>/i) ||
                              t.match(/Lot\s+(\d+[A-Za-z0-9-]*)/i);
          const lotNumber = lotNumMatch ? lotNumMatch[1].trim() : "";

          const titleMatch = t.match(/<h2[^>]*class="[^"]*lot-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ||
                             t.match(/aria-label="([^"]+)"/);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : `Lot ${lotNumber || lotId}`;

          const imgMatch = t.match(/src="([^"]+cdn\.hibid\.com\/img\.axd[^"]+)"/i) ||
                           t.match(/<img[^>]*class="[^"]*lot-thumbnail[^"]*"[^>]*src="([^"]+)"/i);
          const imageUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, "&") : "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";

          const locMatch = t.match(/class="[^"]*search-radius-lot[^"]*"[^>]*aria-label="([^"]+)"/i) ||
                           t.match(/aria-label="([A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}[^"]*)"/i);
          let location = locMatch ? locMatch[1].trim() : "United States";
          if (location && !location.toLowerCase().includes("usa") && !location.toLowerCase().includes("united states")) {
            location += ", USA";
          }

          const bidMatch = t.match(/(?:Current Bid|Opening Bid|High Bid|Bid):?\s*(?:£|GBP|€|\$)?\s*([0-9,]+(?:\.\d{2})?)/i) ||
                           t.match(/(?:£|GBP|€|\$)\s*([0-9,]+(?:\.\d{2})?)/);
          // "High Bid: 0.00" means nobody has bid yet: treat as no price rather than 0.
          const parsedPrice = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : NaN;
          const price = parsedPrice > 0 ? parsedPrice : null;

          lotsRaw.push({
            lotId,
            lotNumber,
            title,
            imageUrl,
            location,
            price
          });
        }
      }
    }
  } catch (directErr: any) {
    console.warn("[HiBid Global Scraper] Direct fetch failed or timed out:", directErr.message);
    directProblem = () => noteFailure(directErr, "HiBid search", cancelSignal);
  }

  // 2. Fallback to Puppeteer if direct fetch didn't capture lots (not if the search was cancelled)
  if (lotsRaw.length === 0 && !cancelSignal?.aborted) {
    let browser = null;
    let stopClosingOnCancel = () => {};
    try {
      console.log(`[HiBid Global Scraper] Launching Puppeteer fallback for ${targetUrl}`);
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      stopClosingOnCancel = closeBrowserOnCancel(browser, cancelSignal);
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 25000 });
      if (await noteChallengePage(page, "HiBid search page (Chrome)")) throw new Error("bot check page");
      await page.waitForSelector("a[href*=\"/lot/\"]", { timeout: 8000 }).catch(() => {});

      lotsRaw = await page.evaluate(() => {
        const lotLinks = Array.from(document.querySelectorAll("a[href*=\"/lot/\"]"));
        const seen = new Set<string>();
        const results: any[] = [];

        for (const a of lotLinks) {
          const href = (a as HTMLAnchorElement).href;
          if (!href || seen.has(href)) continue;
          seen.add(href);

          const tile = a.closest("app-lot-tile") || a.closest(".lot-view") || a.parentElement?.parentElement;
          const text = tile ? tile.textContent?.replace(/\s+/g, " ").trim() || "" : a.textContent?.trim() || "";
          const img = tile ? tile.querySelector("img") : null;
          const imgSrc = img ? (img.getAttribute("src") || img.getAttribute("data-src") || "") : "";

          const title = a.getAttribute("aria-label") || a.textContent?.trim() || "";
          if (!title || title.includes("T/CS, PAYMENT") || title.includes("TRY SAM, OUR")) continue;

          const lotMatch = text.match(/Lot\s+([A-Za-z0-9]+)/i);
          const lotNumber = lotMatch ? lotMatch[1] : "";

          const bidMatch = text.match(/(?:Current Bid|Opening Bid|High Bid|Bid):?\s*(?:£|GBP|€|\$)?\s*([0-9,]+(?:\.\d{2})?)/i) || text.match(/(?:£|GBP|€|\$)\s*([0-9,]+(?:\.\d{2})?)/);
          // "High Bid: 0.00" means nobody has bid yet: treat as no price rather than 0.
          const parsedPrice = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : NaN;
          const price = parsedPrice > 0 ? parsedPrice : null;

          const idMatch = href.match(/\/lot\/(\d+)/);
          const lotId = idMatch ? idMatch[1] : (lotNumber || Math.random().toString(36).substring(2, 8));

          results.push({
            lotId,
            lotNumber,
            title,
            imageUrl: imgSrc,
            location: "United States",
            price
          });
        }
        return results;
      });
    } catch (pupErr: any) {
      console.warn("[HiBid Global Scraper] Puppeteer fallback error:", pupErr.message);
      if (pupErr.message !== "bot check page") noteFailure(pupErr, "HiBid search page (Chrome)", cancelSignal);
    } finally {
      stopClosingOnCancel();
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  if (lotsRaw.length === 0) directProblem();

  // Map into normalized AuctionListing items
  const parsedListings = lotsRaw.map((l: any) => {
    const coords = getCoordinatesForLocation(l.location, "US");
    const category = inferCategoryFromTitle(l.title, l.title);
    
    // Compute default ending date: if closingDate passed use that, otherwise 14 days out
    let endingDate = new Date(Date.now() + 14 * 86400000).toISOString();
    if (cleanClosing) {
      const parsedClosing = new Date(`${cleanClosing}T20:00:00Z`);
      if (!isNaN(parsedClosing.getTime())) {
        endingDate = parsedClosing.toISOString();
      }
    }

    return {
      id: `hibid-${l.lotId}`,
      lotId: l.lotId,
      lotNumber: l.lotNumber,
      title: l.lotNumber ? `Lot ${l.lotNumber}: ${l.title}` : l.title,
      url: `https://hibid.com/lot/${l.lotId}`,
      imageUrl: l.imageUrl || "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80",
      details: `${l.title}. Auction lot ${l.lotNumber ? `#${l.lotNumber}` : ""} on HiBid. Location: ${l.location}. View complete bidding, buyer terms & details at https://hibid.com/lot/${l.lotId}.`,
      endingDate,
      startDate: new Date().toISOString(),
      address: l.location,
      latitude: coords.latitude,
      longitude: coords.longitude,
      auctioneer: "HiBid Auctions",
      category,
      status: "Active",
      country: "US",
      currency: "$",
      currentPrice: l.price,
      startPrice: l.price,
      sourcePlatform: "HiBid"
    };
  });

  // Enrich top 12 lots with exact auctioneer company & date ranges from hibid.com/lot/:id
  if (parsedListings.length > 0) {
    const enrichBatch = parsedListings.slice(0, 12).map(async (item) => {
      try {
        const detail = await fetchHibidLotDetail(item.lotId, cancelSignal);
        if (detail) {
          if (detail.company) {
            item.auctioneer = detail.company;
            item.details = `${item.title}. Hosted by ${detail.company} on HiBid. Location: ${detail.address || item.address}. View complete bidding, catalog terms & inspection details at https://hibid.com/lot/${item.lotId}.`;
          }
          if (detail.address) {
            item.address = detail.address;
            const updatedCoords = getCoordinatesForLocation(detail.address, "US");
            item.latitude = updatedCoords.latitude;
            item.longitude = updatedCoords.longitude;
          }
          if (detail.dateRange) {
            const rangeParts = detail.dateRange.split("-");
            if (rangeParts.length > 1) {
              const d = new Date(rangeParts[1].trim());
              if (!isNaN(d.getTime())) {
                item.endingDate = d.toISOString();
              }
            }
          }
        }
      } catch {}
    });

    // Allow up to 2500ms for detail enrichment so it never blocks or causes search timeouts
    const enrichTimeout = new Promise((resolve) => setTimeout(resolve, 2500));
    await Promise.race([Promise.allSettled(enrichBatch), enrichTimeout]);
  }

  console.log(`[HiBid Global Scraper] Extracted ${parsedListings.length} lots for query "${logKey}"`);
  return parsedListings;
}

const HIBID_SEARCH_TIMEOUT_MS = 30000;

// Timeout wrapper ensuring HiBid search never blocks for more than 30 seconds. On timeout the
// search is also cancelled, so its requests and any Chrome fallback stop instead of running on.
export async function scrapeHibidLotsWithTimeout(keyword: string = "", closingDate: string = "", cancelSignal?: AbortSignal): Promise<any[]> {
  const timeout = new AbortController();
  const signal = withCancel(timeout.signal, cancelSignal);
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<any[]>((resolve) => {
    timeoutId = setTimeout(() => {
      timeout.abort();
      reportSourceIssue("timeout", "HiBid search", `gave up after ${HIBID_SEARCH_TIMEOUT_MS / 1000}s`);
      resolve([]);
    }, HIBID_SEARCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([scrapeHibidLots(keyword, closingDate, signal), timeoutPromise]);
  } catch (err: any) {
    console.warn("HiBid scraper timeout/error:", err.message);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
