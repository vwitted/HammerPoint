import puppeteer from "puppeteer";
import { closeBrowserOnCancel, withCancel } from "../lib/cancel";
import { httpFetch } from "../lib/http";
import { isSidecarEnabled, scrapePage } from "../lib/sidecar";
import { noteChallengePage, noteChallengeTitle, noteFailure, noteResponse, reportSourceIssue } from "../lib/sourceHealth";
import { getCoordinatesForLocation } from "../lib/geo";
import { inferCategoryFromTitle } from "../lib/categories";
import { cleanHtmlText } from "../lib/text";

// In-memory cache for single lot details (search results are cached by the search cache)
export const hibidDetailCache = new Map<string, { timestamp: number; detail: any }>();

// HiBid encodes query separators in image URLs as &amp;. Decode just the entities we use.
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// HiBid renamed its Angular component from <app-lot-tile> to <app-auction-lot-card>. The boundary
// [\s>] is essential: several other tags start with "app-auction-lot-" (e.g. the badge) and a
// looser split would shred the HTML into fragments.
const HIBID_CARD_OPEN = /<app-(?:auction-)?lot-(?:card|tile)[\s>]/;
const HIBID_CARD_CLOSE = /<\/app-(?:auction-)?lot-(?:card|tile)>/;

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

// Turns one server-rendered HiBid search page into raw lot records. Kept pure so the current
// markup can be tested against a recorded page without a browser or the network.
export function parseHibidSearchHtml(html: string): any[] {
  const parts = String(html ?? "").split(HIBID_CARD_OPEN);
  const lots: any[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < parts.length; i++) {
    const card = parts[i].split(HIBID_CARD_CLOSE)[0];
    const idMatch = firstMatch(card, [
      /href="(?:https?:\/\/hibid\.com)?\/lot\/(\d+)(?:[/?#"])/i,
      /id="lot-(\d+)"/i,
      /data-lot-id="(\d+)"/i,
    ]);
    if (!idMatch) continue;
    const lotId = idMatch[1];
    if (seen.has(lotId)) continue;
    seen.add(lotId);

    const titleMatch = firstMatch(card, [
      /class="[^"]*app-auction-lot-card__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<h2[^>]*class="[^"]*lot-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i,
      /class="[^"]*app-auction-lot-card__image-link[^"]*"[^>]*aria-label="([^"]+)"/i,
      /aria-label="([^"]+)"[^>]*class="[^"]*app-auction-lot-card__image-link[^"]*"/i,
      /<img[^>]*alt="([^"]+)"/i,
    ]);
    const title = titleMatch ? cleanHtmlText(decodeHtmlEntities(titleMatch[1])) : "";
    if (!title || title.length < 2) continue;

    const numberMatch = firstMatch(card, [
      /class="[^"]*app-auction-lot-card__lot-number[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<span[^>]*class="[^"]*text-primary[^"]*"[^>]*>Lot\s*([^<]+)<\/span>/i,
    ]);
    const lotNumber = numberMatch
      ? cleanHtmlText(decodeHtmlEntities(numberMatch[1])).replace(/^Lot\s*/i, "").trim()
      : "";

    const imgMatch = firstMatch(card, [
      /<img[^>]*src="([^"]*cdn\.hibid\.com\/img\.axd[^"]*)"/i,
      /<img[^>]*data-src="([^"]+)"/i,
    ]);
    let imageUrl = imgMatch ? decodeHtmlEntities(imgMatch[1]) : "";
    if (imageUrl.startsWith("//")) imageUrl = `https:${imageUrl}`;

    const locationMatch = firstMatch(card, [
      /class="[^"]*search-radius-lot[^"]*"[^>]*aria-label="([^"]+)"/i,
      /<app-search-radius[^>]*aria-label="([^"]+)"/i,
      /aria-label="([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)"/,
    ]);
    let location = locationMatch ? cleanHtmlText(decodeHtmlEntities(locationMatch[1])) : "United States";
    if (location && !/usa|united states/i.test(location)) location += ", USA";

    // The current markup has a dedicated amount element containing e.g. "$13.00"; the previous
    // markup printed "High Bid: 0.00 USD". The amount contains a nested currency-symbol <span>,
    // so take a slice of the element rather than stopping at the first closing tag.
    const amountMatch = card.match(/class="[^"]*app-auction-lot-card__amount[^"]*"[^>]*>([\s\S]{0,400})/i);
    const priceSource = amountMatch ? cleanHtmlText(decodeHtmlEntities(amountMatch[1])) : card;
    const bidMatch = firstMatch(priceSource, [
      /(?:Current Bid|Opening Bid|High Bid|Bid):?\s*(?:£|GBP|€|\$)?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
      /(?:£|GBP|€|\$)\s*([0-9][0-9,]*(?:\.\d{2})?)/,
      ...(amountMatch ? [/([0-9][0-9,]*(?:\.\d{2})?)/] : []),
    ]);
    const parsedPrice = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : NaN;
    // "High Bid: 0.00" means nobody has bid yet: treat as no price rather than 0.
    const price = parsedPrice > 0 ? parsedPrice : null;

    const auctioneerMatch = card.match(/class="[^"]*app-auction-lot-card__auctioneer[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const auctioneer = auctioneerMatch ? cleanHtmlText(decodeHtmlEntities(auctioneerMatch[1])) : "";

    lots.push({ lotId, lotNumber, title, imageUrl, location, price, auctioneer });
  }

  return lots;
}

// Runs in the Camoufox page (via page.evaluate) and returns one raw record per lot card. Kept as
// a string so the sidecar and the Chrome fallback share exactly the same extraction code.
export const HIBID_EXTRACT_LOTS_SCRIPT = String.raw`(() => {
  const seen = new Set();
  const results = [];
  const cards = Array.from(document.querySelectorAll("app-auction-lot-card, app-lot-tile, .lot-view, .lot-tile"));

  for (const card of cards) {
    const link = card.querySelector('a[href*="/lot/"]');
    const href = link ? (link.href || link.getAttribute("href") || "") : "";
    const idMatch = href.match(/\/lot\/(\d+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);

    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    const titleEl = card.querySelector(".app-auction-lot-card__title, .lot-title, h2, h3");
    let title = titleEl ? (titleEl.textContent || "").replace(/\s+/g, " ").trim() : "";
    if (!title && link) title = (link.getAttribute("aria-label") || "").trim();
    if (!title) continue;

    const numberEl = card.querySelector(".app-auction-lot-card__lot-number, .text-primary");
    const numberText = numberEl ? (numberEl.textContent || "").replace(/\s+/g, " ").trim() : "";
    const numberMatch = numberText.match(/Lot\s*([A-Za-z0-9-]+)/i) || text.match(/Lot\s+([A-Za-z0-9-]+)/i);
    const lotNumber = numberMatch ? numberMatch[1] : numberText.replace(/^Lot\s*/i, "");

    const img = card.querySelector("img");
    const imageUrl = img ? (img.getAttribute("src") || img.getAttribute("data-src") || "") : "";

    const locationEl = card.querySelector(".search-radius-lot, app-search-radius [aria-label]");
    let location = locationEl ? (locationEl.getAttribute("aria-label") || "").trim() : "";
    if (!location) {
      const locationMatch = text.match(/([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/);
      if (locationMatch) location = locationMatch[1];
    }
    if (location && !/usa|united states/i.test(location)) location += ", USA";

    const amountEl = card.querySelector(".app-auction-lot-card__amount");
    const priceText = amountEl ? (amountEl.textContent || "") : text;
    const bidMatch = priceText.match(/(?:Current Bid|Opening Bid|High Bid|Bid):?\s*(?:£|GBP|€|\$)?\s*([0-9][0-9,]*(?:\.\d{2})?)/i)
      || priceText.match(/(?:£|GBP|€|\$)\s*([0-9][0-9,]*(?:\.\d{2})?)/)
      || (amountEl ? priceText.match(/([0-9][0-9,]*(?:\.\d{2})?)/) : null);
    const parsedPrice = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : NaN;
    const price = parsedPrice > 0 ? parsedPrice : null;

    const auctioneerEl = card.querySelector(".app-auction-lot-card__auctioneer");
    const auctioneer = auctioneerEl ? (auctioneerEl.textContent || "").replace(/\s+/g, " ").trim() : "";

    results.push({ lotId: idMatch[1], lotNumber, title, imageUrl, location, price, auctioneer });
  }
  return results;
})()`;

// Fast scrape of upcoming auctions & featured lots from svdisposition.com
export async function scrapeSvdUpcomingAuctions(keyword?: string, cancelSignal?: AbortSignal): Promise<any[]> {
  try {
    const res = await httpFetch("https://svdisposition.com/upcoming-auctions", {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, cancelSignal, 15000);
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
    const res = await httpFetch(targetUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, cancelSignal, 4000); // 4s timeout for single lot
    if (!res.ok) {
      noteResponse(res, "HiBid lot details");
      return null;
    }

    const html = await res.text();

    const companyMatch = html.match(/class="lot-company-page-link"[^>]*>([^<]+)<\/a>/i) ||
                         html.match(/class="[^"]*company-name[^"]*"[^>]*>([^<]+)<\//i);
    const company = companyMatch ? decodeHtmlEntities(companyMatch[1]).trim() : null;

    const datesMatch = html.match(/class="lot-auction-date-range[^"]*"[^>]*>([^<]+)<\/div>/i);
    const dateRange = datesMatch ? datesMatch[1].trim() : null;

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : "";
    title = title.replace(/\s*\|\s*Live and Online Auctions on HiBid\.com/i, "").trim();

    const imgMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*)"/i);
    const imageUrl = imgMatch ? decodeHtmlEntities(imgMatch[1]) : null;

    // The detail page links its location to Google Maps, which is more reliable than scraping a
    // class name (the old regex could match unrelated "location" text).
    const mapsMatch = html.match(/https:\/\/maps\.google\.com\/maps\?q=([^"]+)/i);
    let address: string | null = null;
    if (mapsMatch) {
      try {
        address = cleanHtmlText(decodeHtmlEntities(decodeURIComponent(mapsMatch[1])));
      } catch {
        address = cleanHtmlText(decodeHtmlEntities(mapsMatch[1]));
      }
    }
    if (!address) {
      const cityMatch = html.match(/<app-city-state-zip-link[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      if (cityMatch) address = cleanHtmlText(cityMatch[1]);
    }
    if (!address) {
      const locMatch = html.match(/([A-Z][a-zA-Z\s.-]+,\s*[A-Z]{2}\s*\d{5})/);
      address = locMatch ? locMatch[1].trim() : null;
    }

    const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"/i);
    const description = descMatch ? decodeHtmlEntities(descMatch[1]).trim() : "";

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
  let path = "direct";
  let challenged = false;
  let sidecarTimedOut = false;
  // Reported only if the fallbacks come back empty too.
  let directProblem: () => void = () => {};
  let sidecarProblem: (() => void) | null = null;

  // 1. First attempt: curl_cffi-backed direct HTTP fetch (server-rendered HTML, no JS needed).
  try {
    const res = await httpFetch(targetUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, cancelSignal, 10000); // 10s timeout for large multi-lot HTML

    if (res.ok) {
      const html = await res.text();
      const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
      if (noteChallengeTitle(decodeHtmlEntities(pageTitle), "HiBid search")) {
        challenged = true;
      } else {
        lotsRaw = parseHibidSearchHtml(html);
        if (lotsRaw.length === 0) {
          // A 200 page with no cards is the same trap that hid this path for months. Make it loud.
          console.warn("[HiBid Global Scraper] Direct fetch returned no lot cards; falling back to a browser");
        }
      }
    } else {
      directProblem = () => noteResponse(res, "HiBid search");
    }
  } catch (directErr: any) {
    console.warn("[HiBid Global Scraper] Direct fetch failed or timed out:", directErr.message);
    directProblem = () => noteFailure(directErr, "HiBid search", cancelSignal);
  }

  // 2. Fallback: Camoufox sidecar when configured, then Chrome. Neither runs after cancellation.
  if (lotsRaw.length === 0 && !cancelSignal?.aborted && !challenged && isSidecarEnabled()) {
    try {
      console.log(`[HiBid Global Scraper] Camoufox fallback for ${targetUrl}`);
      const { result, title, error } = await scrapePage({
        url: targetUrl,
        gotoTimeoutMs: 25000,
        waitSelector: 'a[href*="/lot/"]',
        waitSelectorTimeoutMs: 8000,
        evaluateScript: HIBID_EXTRACT_LOTS_SCRIPT,
        attempts: 1,
      }, cancelSignal, 28000); // under the outer 30s HiBid budget

      if (!cancelSignal?.aborted) {
        if (noteChallengeTitle(title, "HiBid search page (Camoufox)")) {
          challenged = true;
        } else if (error) {
          throw new Error(error);
        } else if (Array.isArray(result)) {
          lotsRaw = result;
          path = "sidecar";
        }
      }
    } catch (sidecarErr: any) {
      console.warn("[HiBid Global Scraper] Sidecar fallback error:", sidecarErr.message);
      sidecarProblem = () => noteFailure(sidecarErr, "HiBid search page (Camoufox)", cancelSignal);
      // The outer search budget is 30s and the sidecar just used most of it; Chrome would only
      // repeat the wait.
      if (/timed? ?out|timeout/i.test(String(sidecarErr?.message ?? ""))) sidecarTimedOut = true;
    }
  }

  if (lotsRaw.length === 0 && !cancelSignal?.aborted && !challenged && !sidecarTimedOut) {
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

      const extracted = await page.evaluate(HIBID_EXTRACT_LOTS_SCRIPT);
      if (Array.isArray(extracted)) {
        lotsRaw = extracted;
        path = "puppeteer";
      }
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

  if (lotsRaw.length === 0) {
    sidecarProblem?.();
    directProblem();
  }

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
      auctioneer: l.auctioneer || "HiBid Auctions",
      category,
      status: "Active",
      country: "US",
      currency: "$",
      currentPrice: l.price,
      // The card publishes the current/high bid only; HiBid does not say what bidding opened at.
      startPrice: null,
      bidLabel: l.price != null ? "Current Bid" : undefined,
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

  // One line that says which branch actually produced the results. Two separate bugs (Cloudflare
  // block + stale selector) hid behind the old fallback because nothing reported this.
  console.log(`[HiBid Global Scraper] path=${path} count=${parsedListings.length} query="${logKey}"`);
  return parsedListings;
}

const HIBID_SEARCH_TIMEOUT_MS = 30000;

// Timeout wrapper ensuring HiBid search never blocks for more than 30 seconds. On timeout the
// search is also cancelled, so its requests and any browser fallback stop instead of running on.
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
