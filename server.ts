import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import puppeteer from "puppeteer";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Shared Gemini SDK Client setup
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("GEMINI_API_KEY is not set. Real-time scraping will fallback to simulated scraping.");
}

// In-Memory cache of real scraped auctions
let activeAuctions: any[] = [];
let lastScrapedTime = 0;

// GET: Retrieve all active auctions (real scraped data only)
app.get("/api/auctions", async (req, res) => {
  try {
    res.json({
      status: "success",
      count: activeAuctions.length,
      data: activeAuctions
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch live auctions" });
  }
});

interface BpiAuctionEvent {
  title: string;
  link: string;
  imageUrl: string;
  ends: string;
  location: string;
}

// Scrape live auction events from BPI homepage carousel
async function scrapeBpiHomepageEvents(): Promise<BpiAuctionEvent[]> {
  const url = "https://bpiauctions.com/";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 seconds timeout
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      console.warn(`BPI Homepage fetch returned status ${res.status}`);
      return [];
    }
    
    const text = await res.text();
    const parts = text.split('<div class="carousel-card">');
    const events: BpiAuctionEvent[] = [];
    
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      const linkMatch = part.match(/data-link="([^"]+)"/i) || part.match(/href="([^"]+)"/i);
      const link = linkMatch ? linkMatch[1] : "";
      
      const slidesMatch = part.match(/data-slides="([^"]+)"/i);
      let imageUrl = "";
      if (slidesMatch) {
        imageUrl = slidesMatch[1].split(";")[0];
      }
      
      const h3Match = part.match(/<h3>([^<]+)<\/h3>/i);
      const title = h3Match ? h3Match[1].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "";
      
      const endsMatch = part.match(/<li>Ends:\s*([^<]+)<\/li>/i);
      const ends = endsMatch ? endsMatch[1].trim() : "";
      
      const locationMatch = part.match(/<li\s+class="location">([^<]+)<\/li>/i);
      const location = locationMatch ? locationMatch[1].trim() : "";
      
      if (title && link) {
        events.push({
          title,
          link: link.startsWith("/") ? `https://bpiauctions.com${link}` : link,
          imageUrl: imageUrl.startsWith("/") ? `https://bpiauctions.com${imageUrl}` : (imageUrl || "https://images.unsplash.com/photo-1581092162384-8987c1796715?w=600&auto=format&fit=crop&q=80"),
          ends,
          location
        });
      }
    }
    
    console.log(`Successfully scraped ${events.length} live BPI homepage auctions.`);
    return events;
  } catch (err: any) {
    console.error("Error scraping BPI homepage events:", err.message || err);
    return [];
  }
}

async function scrapeBidspotterLots(keyword: string) {
  let browser: any = null;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process'],
      headless: true
    });
    
    const atgSites = [
      { baseUrl: 'https://www.bidspotter.co.uk', name: 'BidSpotter UK', suffix: '/en-gb/search-results?searchTerm=' },
      { baseUrl: 'https://www.i-bidder.com', name: 'i-bidder', suffix: '/en-gb/search-results?searchTerm=' },
      { baseUrl: 'https://www.the-saleroom.com', name: 'The Saleroom', suffix: '/en-gb/search-results?searchTerm=' }
    ];

    let allItemsRaw: any[] = [];

    for (const site of atgSites) {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
      const searchUrl = `${site.baseUrl}${site.suffix}${encodeURIComponent(keyword)}`;
      
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('.lot-title', { timeout: 10000 }).catch(() => {});
        
        const items = await page.evaluate((kw, siteBaseUrl, siteName) => {
          const lotTitles = Array.from(document.querySelectorAll('.lot-title'));
          return lotTitles.map(el => {
            const container = el.closest('div[class*="search-result"]') || el.closest('div[class*="lot-card"]') || el.closest('article') || el.parentElement?.parentElement?.parentElement;
            if (!container) return null;
            
            // Extract accurate image, handling data-src / lazy-load
            const img = container.querySelector('img');
            let imgUrl = "";
            if (img) {
              imgUrl = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.src || "";
              if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
            }

            const location = container.querySelector('[class*="location"]');
            const containerText = container.textContent || "";
            
            // Date regex
            const dateStrMatch = containerText.match(/(?:Bidding ends|Ends in|Closing|Bidding opens|Sale date):?\s*([^\n\r<]+)/i);

            // Pricing regexes for ATG / BidSpotter
            // Opening bid e.g. "(opening bid 50 GBP)" or "Starting bid: £50"
            const openingBidMatch = containerText.match(/(?:opening bid|starts? at|starting bid|starting price):?\s*(?:£|GBP)?\s*([\d,]+)/i) 
              || containerText.match(/\(opening bid\s+([\d,]+)\s*(?:GBP|£)?\)/i);
            
            // Current bid e.g. "Current bid: £120"
            const currentBidMatch = containerText.match(/(?:current bid|last bid):?\s*(?:£|GBP)?\s*([\d,]+)/i);

            // Estimate e.g. "Estimate: £30 - £60"
            const estMatch = containerText.match(/(?:estimate|est\.?):?\s*(?:£|GBP)?\s*([\d,]+)(?:\s*-\s*(?:£|GBP)?\s*([\d,]+))?/i);

            // Reserve e.g. "Reserve: £100"
            const reserveMatch = containerText.match(/reserve(?:\s+price)?:?\s*(?:£|GBP)?\s*([\d,]+)/i);

            const parseNum = (m: any) => m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
            const openingBid = parseNum(openingBidMatch);
            const currentBid = parseNum(currentBidMatch);
            const lowEst = estMatch ? parseInt(estMatch[1].replace(/,/g, ""), 10) : null;
            const highEst = (estMatch && estMatch[2]) ? parseInt(estMatch[2].replace(/,/g, ""), 10) : null;
            const reservePrice = parseNum(reserveMatch);

            return {
              title: el.textContent?.trim() || "",
              url: el.parentElement?.getAttribute('href') || el.closest('a')?.href || "",
              imageUrl: imgUrl,
              location: location ? location.textContent?.trim() : "",
              dateStr: dateStrMatch ? dateStrMatch[1] : "",
              openingBid: openingBid,
              currentBid: currentBid,
              lowEst: lowEst,
              highEst: highEst,
              reservePrice: reservePrice,
              sourceName: siteName,
              sourceBaseUrl: siteBaseUrl
            };
          }).filter((item: any) => {
            if (!item) return false;
            const lowerTitle = item.title.toLowerCase();
            const words = kw.toLowerCase().split(" ").filter((w: string) => w.trim() !== "");
            return words.every((term: string) => lowerTitle.includes(term));
          }).slice(0, 10);
        }, keyword, site.baseUrl, site.name);
        
        allItemsRaw.push(...items);
      } catch (e) {
        console.log(`${site.name} timeout or error`, e);
      } finally {
        await page.close().catch(() => {});
      }
    }
    
    // Deduplicate by title to avoid showing the same lot from multiple platforms
    const titleSet = new Set();
    const allItems = allItemsRaw.filter(item => {
      const isDuplicate = titleSet.has(item.title);
      titleSet.add(item.title);
      return !isDuplicate;
    });
    
    // Process items into the expected format
    return allItems.map((item: any, i: number) => {
      const exactCoords = getCoordinatesForLocation(item.location || "London");
      // Format URL to absolute if needed
      let absoluteUrl = item.url;
      if (absoluteUrl && absoluteUrl.startsWith('/')) {
        absoluteUrl = item.sourceBaseUrl + absoluteUrl;
      } else if (!absoluteUrl) {
        absoluteUrl = `${item.sourceBaseUrl}/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}`;
      }
      
      // Attempt to clean the extracted location string
      let cleanedLoc = item.location || "United Kingdom";
      if (cleanedLoc.includes("United Kingdom")) {
        const parts = cleanedLoc.split('\n');
        cleanedLoc = parts[0]?.trim() || "United Kingdom";
      }

      // Robust date parsing for ATG
      let parsedDate = "";
      if (item.dateStr) {
        const rawDate = item.dateStr.split('\n')[0].replace(/^from\s+/i, "").replace(/BST|GMT/gi, "").trim();
        const relDayMatch = rawDate.match(/(\d+)\s*d(?:ays?)?/i);
        const relHourMatch = rawDate.match(/(\d+)\s*h(?:ours?)?/i);
        if (relDayMatch || relHourMatch) {
          const days = relDayMatch ? parseInt(relDayMatch[1], 10) : 0;
          const hours = relHourMatch ? parseInt(relHourMatch[1], 10) : 0;
          parsedDate = new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
        } else {
          const cleanDate = rawDate.replace(/^on\s+/i, "").trim();
          const withYear = /\b20\d\d\b/.test(cleanDate) ? cleanDate : `${cleanDate} ${new Date().getFullYear()}`;
          const d = new Date(withYear);
          if (!isNaN(d.getTime())) {
            parsedDate = d.toISOString();
          }
        }
      }
      if (!parsedDate) {
        parsedDate = new Date(Date.now() + 4 * 86400000).toISOString();
      }

      // Pricing logic specifically for ATG/Bidspotter:
      // "Bid" captures opening bid if no active bid placed yet.
      const openingBid = item.openingBid || (item.lowEst ? item.lowEst : null);
      const effectiveBid = item.currentBid || openingBid;
      const reserve = (item.reservePrice && openingBid && item.reservePrice > openingBid) ? item.reservePrice : null;
      let estimateStr = undefined;
      if (item.lowEst && item.highEst) {
        estimateStr = `£${item.lowEst} - £${item.highEst}`;
      } else if (item.lowEst) {
        estimateStr = `£${item.lowEst}`;
      }

      // Attempt to infer category
      let category = "General";
      const lowerTitle = item.title.toLowerCase();
      if (lowerTitle.includes("lathe") || lowerTitle.includes("milling") || lowerTitle.includes("cnc") || lowerTitle.includes("machinery") || lowerTitle.includes("generator") || lowerTitle.includes("press") || lowerTitle.includes("welder")) {
        category = "Machinery";
      } else if (lowerTitle.includes("catering") || lowerTitle.includes("oven") || lowerTitle.includes("freezer") || lowerTitle.includes("fryer") || lowerTitle.includes("restaurant")) {
        category = "Catering";
      } else if (lowerTitle.includes("car") || lowerTitle.includes("van") || lowerTitle.includes("truck") || lowerTitle.includes("trailer") || lowerTitle.includes("vehicle") || lowerTitle.includes("tractor")) {
        category = "Vehicles";
      } else if (lowerTitle.includes("furniture") || lowerTitle.includes("table") || lowerTitle.includes("chair") || lowerTitle.includes("desk") || lowerTitle.includes("cabinet") || lowerTitle.includes("sofa")) {
        category = "Furniture";
      } else if (lowerTitle.includes("laptop") || lowerTitle.includes("computer") || lowerTitle.includes("screen") || lowerTitle.includes("tech") || lowerTitle.includes("electronics") || lowerTitle.includes("phone")) {
        category = "Electronics";
      } else if (item.sourceName === "The Saleroom") {
        category = "General";
      } else {
        category = "Industrial";
      }

      return {
        id: `atg-${Date.now()}-${i}`,
        title: item.title,
        url: absoluteUrl,
        details: `Specific matching item lot found live on ${item.sourceName}.${estimateStr ? ` Estimate: ${estimateStr}.` : ""}${openingBid ? ` Opening bid: £${openingBid}.` : ""}`,
        endingDate: parsedDate,
        address: cleanedLoc,
        latitude: exactCoords.latitude,
        longitude: exactCoords.longitude,
        auctioneer: item.sourceName,
        category: category,
        country: "UK",
        currentPrice: effectiveBid,
        startPrice: openingBid,
        estimateStr: estimateStr,
        reserve: reserve,
        imageUrl: item.imageUrl || "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80",
        status: "active"
      };
    });
  } catch (err: any) {
    console.error("Error in Puppeteer scrapeBidspotterLots:", err.message);
    return [];
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
  }
}

// Precise coordinates mapper for common UK postcodes & locations
const ukCoordinateLookup: Record<string, { latitude: number; longitude: number }> = {
  "wakefield": { latitude: 53.6829, longitude: -1.4912 },
  "waltham abbey": { latitude: 51.6874, longitude: -0.0035 },
  "malvern": { latitude: 52.1121, longitude: -2.3243 },
  "chester": { latitude: 53.1934, longitude: -2.8931 },
  "barnsley": { latitude: 53.5526, longitude: -1.4797 },
  "gravesend": { latitude: 51.4419, longitude: 0.3688 },
  "doncaster": { latitude: 53.5228, longitude: -1.1311 },
  "ripley": { latitude: 53.0478, longitude: -1.4111 },
  "sheffield": { latitude: 53.3811, longitude: -1.4701 },
  "leeds": { latitude: 53.8008, longitude: -1.5491 },
  "birmingham": { latitude: 52.4862, longitude: -1.8904 },
  "london": { latitude: 51.5074, longitude: -0.1278 },
  "stoke-on-trent": { latitude: 53.0027, longitude: -2.1794 },
  "stoke": { latitude: 53.0027, longitude: -2.1794 },
  "st4": { latitude: 53.0027, longitude: -2.1794 },
  "nottingham": { latitude: 52.9548, longitude: -1.1581 },
  "derby": { latitude: 52.9225, longitude: -1.4746 },
  "manchester": { latitude: 53.4808, longitude: -2.2426 },
  "liverpool": { latitude: 53.4084, longitude: -2.9916 },
  "bristol": { latitude: 51.4545, longitude: -2.5879 },
  "newcastle": { latitude: 54.9783, longitude: -1.6178 },
  "hull": { latitude: 53.7676, longitude: -0.3274 },
  "cardiff": { latitude: 51.4816, longitude: -3.1791 },
  "glasgow": { latitude: 55.8642, longitude: -4.2518 },
  "edinburgh": { latitude: 55.9533, longitude: -3.1883 },
  "leicester": { latitude: 52.6369, longitude: -1.1398 },
  "coventry": { latitude: 52.4068, longitude: -1.5197 },
  "southampton": { latitude: 50.9097, longitude: -1.4044 },
  "plymouth": { latitude: 50.3755, longitude: -4.1427 },
  "norwich": { latitude: 52.6309, longitude: 1.2974 },
  "oxford": { latitude: 51.7520, longitude: -1.2577 },
  "cambridge": { latitude: 52.2053, longitude: 0.1218 },
  "york": { latitude: 53.9599, longitude: -1.0873 },
  "peterborough": { latitude: 52.5695, longitude: -0.2405 },
  "northampton": { latitude: 52.2405, longitude: -0.9027 },
  "milton keynes": { latitude: 52.0406, longitude: -0.7594 }
};

// Helper to determine coordinates from address
function getCoordinatesForLocation(address: string): { latitude: number; longitude: number } {
  const lowerAddress = (address || "").toLowerCase();
  for (const [city, coords] of Object.entries(ukCoordinateLookup)) {
    if (lowerAddress.includes(city)) {
      return coords;
    }
  }
  return { latitude: 51.5074, longitude: -0.1278 };
}

// Strip HTML tags and clean up whitespace
function cleanHtmlText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface ArtisioRequestOptions {
  q?: string;
  clientId?: string;
  lotStatus?: string;
  auctionType?: string;
  page?: number;
  originUrl?: string;
  refererUrl?: string;
}

// Request-header-compliant fetch wrapper for Artisio / BPI Auctions
async function fetchArtisioHeadersCompliant(options: ArtisioRequestOptions): Promise<any> {
  const q = options.q || "";
  const clientId = options.clientId || "77829366";
  const lotStatus = options.lotStatus || "published";
  const auctionType = options.auctionType || "all";
  const page = options.page || 1;
  const originUrl = options.originUrl || "https://www.bpiauctions.com";
  const refererUrl = options.refererUrl || "https://www.bpiauctions.com/";

  const url = `https://webapp.artisio.co/website/lots?q=${encodeURIComponent(q)}&lot_status=${encodeURIComponent(lotStatus)}&auction_type=${encodeURIComponent(auctionType)}&page=${page}`;

  const compliantHeaders: Record<string, string> = {
    "authority": "webapp.artisio.co",
    "method": "GET",
    "path": `/website/lots?q=${encodeURIComponent(q)}&lot_status=${encodeURIComponent(lotStatus)}&auction_type=${encodeURIComponent(auctionType)}&page=${page}`,
    "scheme": "https",
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "artisio-client-id": clientId,
    "artisio-language": "en",
    "dnt": "1",
    "origin": originUrl,
    "priority": "u=1, i",
    "referer": refererUrl,
    "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: "GET",
      headers: compliantHeaders,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      return json;
    }

    console.warn(`Artisio direct fetch returned status ${res.status}. Falling back to Puppeteer context.`);
  } catch (fetchErr: any) {
    console.warn(`Artisio direct fetch failed (${fetchErr.message}). Attempting Puppeteer browser fallback.`);
  }

  // Fallback: Puppeteer header-compliant browser fetch if standard fetch is blocked or fails
  return await fetchArtisioViaPuppeteer(url, clientId, originUrl, refererUrl);
}

// Puppeteer fallback execution for Artisio requests in challenging environments
async function fetchArtisioViaPuppeteer(targetUrl: string, clientId: string, originUrl: string, refererUrl: string): Promise<any> {
  let browser = null;
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

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36");
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

    const result = await page.evaluate(async (url, cId) => {
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
    console.error("Puppeteer Artisio fallback error:", puppeteerErr.message);
    return { lots: { count: 0, results: [] } };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Helper to safely extract category string from diverse API payload structures
function extractCategoryName(categoryField: any, titleHint: string = ""): string {
  if (typeof categoryField === "string" && categoryField.trim()) {
    return categoryField.trim();
  }
  if (categoryField && typeof categoryField === "object") {
    if (typeof categoryField.name === "string" && categoryField.name.trim()) return categoryField.name.trim();
    if (categoryField.name && typeof categoryField.name.en === "string" && categoryField.name.en.trim()) return categoryField.name.en.trim();
    if (typeof categoryField.title === "string" && categoryField.title.trim()) return categoryField.title.trim();
    if (categoryField.title && typeof categoryField.title.en === "string" && categoryField.title.en.trim()) return categoryField.title.en.trim();
    if (typeof categoryField.en === "string" && categoryField.en.trim()) return categoryField.en.trim();
  }
  if (Array.isArray(categoryField) && categoryField.length > 0) {
    return extractCategoryName(categoryField[0], titleHint);
  }

  // Fallback to title keywords
  const lower = (titleHint || "").toLowerCase();
  if (lower.includes("lathe") || lower.includes("milling") || lower.includes("cnc") || lower.includes("machin") || lower.includes("press") || lower.includes("weld") || lower.includes("generator") || lower.includes("saw")) return "Machinery";
  if (lower.includes("catering") || lower.includes("oven") || lower.includes("fridge") || lower.includes("freezer") || lower.includes("fryer") || lower.includes("cooker")) return "Catering";
  if (lower.includes("car") || lower.includes("van") || lower.includes("truck") || lower.includes("trailer") || lower.includes("forklift") || lower.includes("vehicle")) return "Vehicles";
  if (lower.includes("desk") || lower.includes("chair") || lower.includes("table") || lower.includes("cabinet") || lower.includes("furniture")) return "Furniture";
  if (lower.includes("laptop") || lower.includes("computer") || lower.includes("screen") || lower.includes("server") || lower.includes("tech") || lower.includes("electronic")) return "Electronics";

  return "General";
}

// Normalizes raw Artisio lot into clean, standardized JSON
function normalizeArtisioLot(lot: any, keyword: string = ""): any {
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
  const startPrice = (typeof lot.start_price === "number" && lot.start_price > 0) ? lot.start_price : null;
  const lastBid = (typeof lot.last_bid_amount === "number" && lot.last_bid_amount > 0) ? lot.last_bid_amount : null;
  const currentPrice = lastBid != null ? lastBid : startPrice;
  
  // Reserve: only treat as a reserve if strictly greater than the opening bid
  const rawReserve = typeof lot.reserve === "number" ? lot.reserve : null;
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
async function scrapeBpiLots(keyword: string, maxPages: number = 3): Promise<any[]> {
  try {
    const allLots: any[] = [];
    const seenUuids = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      const data = await fetchArtisioHeadersCompliant({
        q: keyword,
        clientId: "77829366",
        lotStatus: "published",
        auctionType: "all",
        page: page
      });

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
    return [];
  }
}

// -------------------------------------------------------------
// EASY LIVE AUCTION (ALGOLIA SEARCH API) INTEGRATION
// Covers 130,000+ active UK auction lots across hundreds of UK auction houses
// -------------------------------------------------------------

interface EasyLiveHit {
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

function normalizeEasyLiveLot(hit: EasyLiveHit, keyword: string = ""): any {
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
  // If start_price is provided, that is the opening bid.
  // Otherwise, if low estimate is provided (e.g. £30 for £30-60 estimate), that is the opening bid.
  const rawStartPrice = typeof hit.start_price === "number" && hit.start_price > 0 ? hit.start_price : 0;
  const openingBid = rawStartPrice > 0 ? rawStartPrice : (lowEst > 0 ? lowEst : null);
  
  // Under "Bid", display the opening bid / starting bid (or active bid if any)
  const currentBid = typeof hit.current_bid === "number" && hit.current_bid > 0 ? hit.current_bid : openingBid;
  
  // High estimate is strictly an estimate, NOT a reserve price! EasyLive does not reveal reserves.
  const reserve = null;

  // Determine dates
  const isLive = hit.auction_type === "Live";
  const startDateStr = hit.start_date || "Upcoming";
  const endDateStr = hit.end_date || "Upcoming";
  const currentYear = new Date().getFullYear();
  
  let endingDate = "";
  let startDate: string | null = null;

  if (isLive) {
    // For live sales, start_date is the auction date (e.g. "07 Sep")
    const rawSaleDate = (hit.start_date || hit.end_date || "").trim();
    if (rawSaleDate) {
      const dateToParse = /\b20\d\d\b/.test(rawSaleDate) ? rawSaleDate : `${rawSaleDate} ${currentYear}`;
      const parsedStart = new Date(`${dateToParse} 10:00:00 GMT`);
      const parsedEnd = new Date(`${dateToParse} 18:00:00 GMT`);
      if (!isNaN(parsedStart.getTime())) startDate = parsedStart.toISOString();
      if (!isNaN(parsedEnd.getTime())) endingDate = parsedEnd.toISOString();
    }
  } else {
    // For timed sales, end_date is the closing date (e.g. "06 Sep")
    // Timed sales close in the evening: use 21:00 GMT (22:00 BST)
    const rawEnd = (hit.end_date || "").trim();
    if (rawEnd) {
      const dateToParse = /\b20\d\d\b/.test(rawEnd) ? rawEnd : `${rawEnd} ${currentYear} 21:00:00 GMT`;
      const parsed = new Date(dateToParse);
      if (!isNaN(parsed.getTime())) endingDate = parsed.toISOString();
    }
    const rawStart = (hit.start_date || "").trim();
    if (rawStart) {
      const dateToParse = /\b20\d\d\b/.test(rawStart) ? rawStart : `${rawStart} ${currentYear} 09:00:00 GMT`;
      const parsed = new Date(dateToParse);
      if (!isNaN(parsed.getTime())) startDate = parsed.toISOString();
    }
  }

  if (!endingDate) {
    endingDate = new Date(Date.now() + 3 * 86400000).toISOString();
  }

  // Extract category hints
  let category = "General";
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("lathe") || lowerTitle.includes("milling") || lowerTitle.includes("cnc") || lowerTitle.includes("machinery") || lowerTitle.includes("generator") || lowerTitle.includes("press") || lowerTitle.includes("welder")) {
    category = "Machinery";
  } else if (lowerTitle.includes("catering") || lowerTitle.includes("oven") || lowerTitle.includes("freezer") || lowerTitle.includes("fryer") || lowerTitle.includes("restaurant")) {
    category = "Catering";
  } else if (lowerTitle.includes("car") || lowerTitle.includes("van") || lowerTitle.includes("truck") || lowerTitle.includes("trailer") || lowerTitle.includes("vehicle")) {
    category = "Vehicles";
  } else if (lowerTitle.includes("furniture") || lowerTitle.includes("table") || lowerTitle.includes("chair") || lowerTitle.includes("desk") || lowerTitle.includes("cabinet")) {
    category = "Furniture";
  } else if (lowerTitle.includes("laptop") || lowerTitle.includes("computer") || lowerTitle.includes("screen") || lowerTitle.includes("tech") || lowerTitle.includes("electronics")) {
    category = "Electronics";
  }

  // Derive auctioneer name from object ID or catalog
  const auctionHouseCode = (hit.objectID || "").split("_")[0] || "UK House";
  const auctioneerName = `Easy Live Auction (${auctionHouseCode.toUpperCase()})`;

  return {
    id: `easylive-${hit.objectID || Date.now()}`,
    title: title,
    description: title,
    url: directUrl,
    details: `Lot: ${title}. ${hit.auction_type || "Live"} auction (${startDateStr} - ${endDateStr}). Estimate: ${hit.currency_symbol || "£"}${lowEst} - ${hit.currency_symbol || "£"}${highEst}. Auction: ${cleanAuctionSlug}`,
    endingDate: endingDate,
    startDate: startDateStr,
    address: "United Kingdom",
    latitude: exactCoords.latitude,
    longitude: exactCoords.longitude,
    auctioneer: auctioneerName,
    category: category,
    country: "UK",
    currentPrice: currentBid,
    startPrice: openingBid,
    estimateStr: estimateStr || undefined,
    reserve: reserve,
    currency: hit.currency_symbol === "€" ? "EUR" : "GBP",
    auctionType: hit.auction_type || (isLive ? "Live" : "Timed"),
    imageUrl: imageUrl,
    status: "active",
    sourcePlatform: "Easy Live Auction"
  };
}

// Fetch lots from Easy Live Auction via Algolia Search API
async function fetchEasyLiveAuctionLots(keyword: string, hitsPerPage: number = 20, page: number = 0): Promise<any[]> {
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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": "KBISTY43U6",
        "X-Algolia-API-Key": "917b17098c0702d97a62a6ca8fc1f410"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.warn(`EasyLive Algolia fetch returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const hits: EasyLiveHit[] = data.results?.[0]?.hits || [];
    return hits.map(hit => normalizeEasyLiveLot(hit, keyword));
  } catch (err: any) {
    console.error("Easy Live Auction fetch error:", err.message);
    return [];
  }
}

// -------------------------------------------------------------
// DEDICATED API PROXY & AGGREGATOR ROUTES
// -------------------------------------------------------------

// GET / POST: /api/proxy/easylive/lots - Clean, normalized lots from Easy Live Auction API
app.all(["/api/proxy/easylive/lots", "/api/proxy/easylive"], async (req, res) => {
  try {
    const q = (req.query.q || req.query.searchTerm || req.body?.q || req.body?.searchTerm || "") as string;
    const page = parseInt((req.query.page || req.body?.page || "0") as string, 10) || 0;
    const hitsPerPage = Math.min(Math.max(parseInt((req.query.hitsPerPage || req.body?.hitsPerPage || "20") as string, 10) || 20, 1), 50);

    const lots = await fetchEasyLiveAuctionLots(q, hitsPerPage, page);

    res.json({
      status: "success",
      source: "Easy Live Auction (Algolia API)",
      query: q,
      page: page,
      count: lots.length,
      data: lots
    });
  } catch (err: any) {
    console.error("Easy Live Proxy Error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// GET: /api/proxy/easylive/raw - Raw Algolia query endpoint
app.get("/api/proxy/easylive/raw", async (req, res) => {
  try {
    const q = (req.query.q || req.query.searchTerm || "") as string;
    const page = parseInt((req.query.page || "0") as string, 10) || 0;
    const hitsPerPage = parseInt((req.query.hitsPerPage || "20") as string, 10) || 20;

    const url = "https://KBISTY43U6-dsn.algolia.net/1/indexes/*/queries";
    const body = {
      requests: [
        {
          indexName: "Upcoming_Auctions",
          query: q,
          params: `hitsPerPage=${hitsPerPage}&page=${page}&facetFilters=["sold:X"]`
        }
      ]
    };

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": "KBISTY43U6",
        "X-Algolia-API-Key": "917b17098c0702d97a62a6ca8fc1f410"
      },
      body: JSON.stringify(body)
    });

    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET: /api/proxy/sources - Returns status, type, and coverage of all UK Auction APIs
app.get("/api/proxy/sources", async (req, res) => {
  res.json({
    status: "success",
    timestamp: new Date().toISOString(),
    sources: [
      {
        id: "artisio-bpi",
        name: "BPI Auctions (Artisio API)",
        type: "REST JSON API with Compliant Headers / Puppeteer Fallback",
        baseUrl: "https://webapp.artisio.co/website/lots",
        proxyEndpoint: "/api/proxy/artisio/lots",
        status: "active",
        coverage: "Commercial, industrial, manufacturing, and surplus lots across UK"
      },
      {
        id: "easylive-algolia",
        name: "Easy Live Auction (Algolia API)",
        type: "Direct Instant Search API (Algolia DSN)",
        baseUrl: "https://KBISTY43U6-dsn.algolia.net/1/indexes/Upcoming_Auctions",
        proxyEndpoint: "/api/proxy/easylive/lots",
        status: "active",
        coverage: "135,000+ active lots from hundreds of UK auction houses in England, Scotland, Wales & NI"
      },
      {
        id: "atg-network",
        name: "ATG Media Network (BidSpotter, i-bidder, The Saleroom)",
        type: "Headless Browser Live Lot Scraper",
        baseUrl: "https://www.bidspotter.co.uk/en-gb/search-results",
        status: "active",
        coverage: "Heavy plant, industrial machinery, fine art, antiques, fleet & liquidation auctions"
      }
    ]
  });
});

// GET: /api/proxy/image - Resilient proxy to stream auction images (ATG, Bidspotter, EasyLive) avoiding CDN 403 or referrer blocks
app.get("/api/proxy/image", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl || !imageUrl.startsWith("http")) {
    return res.status(400).send("Invalid image URL");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    // Parse host for custom referer
    const origin = new URL(imageUrl).origin;
    const upstreamRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": `${origin}/`
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      return res.redirect(302, "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80");
    }

    const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    const buffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.redirect(302, "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80");
  }
});

// GET / POST: /api/proxy/artisio/lots - Fetch clean, normalized lots with full header compliance
app.all(["/api/proxy/artisio/lots", "/api/proxy/artisio"], async (req, res) => {
  try {
    const q = (req.query.q || req.query.searchTerm || req.body?.q || req.body?.searchTerm || "") as string;
    const clientId = (req.query.client_id || req.query.clientId || req.body?.client_id || req.body?.clientId || "77829366") as string;
    const lotStatus = (req.query.lot_status || req.body?.lot_status || "published") as string;
    const auctionType = (req.query.auction_type || req.body?.auction_type || "all") as string;
    const pagesCount = Math.min(Math.max(parseInt((req.query.pages || req.body?.pages || "1") as string, 10) || 1, 1), 5);
    const returnRaw = req.query.raw === "true" || req.body?.raw === true;

    const allNormalized: any[] = [];
    const rawPages: any[] = [];
    let totalCount = 0;
    const seenUuids = new Set<string>();

    for (let p = 1; p <= pagesCount; p++) {
      const rawData = await fetchArtisioHeadersCompliant({
        q,
        clientId,
        lotStatus,
        auctionType,
        page: p
      });

      rawPages.push(rawData);
      totalCount = rawData?.lots?.count || totalCount;
      const rawResults = rawData?.lots?.results || [];

      if (rawResults.length === 0) break;

      for (const lot of rawResults) {
        if (lot.uuid && !seenUuids.has(lot.uuid)) {
          seenUuids.add(lot.uuid);
          allNormalized.push(normalizeArtisioLot(lot, q));
        }
      }

      if (rawResults.length < 15) break;
    }

    if (returnRaw) {
      return res.json({
        status: "success",
        totalCount,
        resultsCount: allNormalized.length,
        pages: rawPages
      });
    }

    res.json({
      status: "success",
      query: q,
      clientId: clientId,
      totalCount: totalCount,
      count: allNormalized.length,
      data: allNormalized
    });
  } catch (error: any) {
    console.error("Artisio Proxy Route Error:", error);
    res.status(500).json({
      status: "error",
      error: `Proxy failed: ${error.message || "Unknown error"}`
    });
  }
});

// GET: /api/proxy/artisio/raw - Proxies raw JSON dictionary directly from Artisio
app.get("/api/proxy/artisio/raw", async (req, res) => {
  try {
    const q = (req.query.q || req.query.searchTerm || "") as string;
    const clientId = (req.query.client_id || req.query.clientId || "77829366") as string;
    const lotStatus = (req.query.lot_status || "published") as string;
    const auctionType = (req.query.auction_type || "all") as string;
    const page = parseInt((req.query.page || "1") as string, 10) || 1;

    const rawData = await fetchArtisioHeadersCompliant({
      q,
      clientId,
      lotStatus,
      auctionType,
      page
    });

    res.json(rawData);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch raw Artisio data" });
  }
});

// GET: /api/proxy/artisio/lot/:uuid - Proxies individual lot lookup
app.get("/api/proxy/artisio/lot/:uuid", async (req, res) => {
  const { uuid } = req.params;
  const clientId = (req.query.client_id || "77829366") as string;
  try {
    const url = `https://webapp.artisio.co/website/lots/${encodeURIComponent(uuid)}`;
    const compliantHeaders = {
      "authority": "webapp.artisio.co",
      "accept": "application/json, text/plain, */*",
      "artisio-client-id": clientId,
      "artisio-language": "en",
      "origin": "https://bpiauctions.com",
      "referer": "https://bpiauctions.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
    };

    const upstream = await fetch(url, { headers: compliantHeaders });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream error ${upstream.status}` });
    }
    const lot = await upstream.json();
    res.json({
      status: "success",
      data: normalizeArtisioLot(lot)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Real-time Multi-Source Web Scrape and API Search of UK Auction Sites
app.post("/api/auctions/search", async (req, res) => {
  const { keyword } = req.body;

  if (!keyword || typeof keyword !== "string") {
    return res.status(400).json({ error: "A valid keyword string is required." });
  }

  console.log(`Starting real-time UK auction search for keyword: "${keyword}" across connected APIs & platforms`);

  // Direct reference links to live sources
  const searchReferences = [
    { title: `Easy Live Auction Search for "${keyword}"`, url: `https://www.easyliveauction.com/catalogue/?searchTerm=${encodeURIComponent(keyword)}&searchOption=3` },
    { title: `BPI Auctions Search for "${keyword}"`, url: `https://bpiauctions.com/auctions/#/search?query=${encodeURIComponent(keyword)}` },
    { title: `BidSpotter UK Search for "${keyword}"`, url: `https://www.bidspotter.co.uk/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}` },
    { title: `The Saleroom Search for "${keyword}"`, url: `https://www.the-saleroom.com/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}` }
  ];

  try {
    // Run all UK auction queries in parallel
    const [bpiResults, easyLiveResults, atgResults] = await Promise.allSettled([
      scrapeBpiLots(keyword, 2),
      fetchEasyLiveAuctionLots(keyword, 25, 0),
      scrapeBidspotterLots(keyword)
    ]);

    const scrapedBpiLots = bpiResults.status === "fulfilled" ? bpiResults.value : [];
    const scrapedEasyLiveLots = easyLiveResults.status === "fulfilled" ? easyLiveResults.value : [];
    const scrapedAtg = atgResults.status === "fulfilled" ? atgResults.value : [];

    console.log(`Results fetched: BPI (${scrapedBpiLots.length}), EasyLive (${scrapedEasyLiveLots.length}), ATG Network (${scrapedAtg.length})`);

    // Combine all listings
    let scrapedListings = [...scrapedEasyLiveLots, ...scrapedBpiLots, ...scrapedAtg];

    // Update global cache deduplicating by title/id
    scrapedListings.forEach((item: any) => {
      if (!activeAuctions.some(existing => existing.id === item.id || existing.title.toLowerCase() === item.title.toLowerCase())) {
        activeAuctions.push(item);
      }
    });

    res.json({
      status: "success",
      source: "multi-api-uk-aggregated",
      count: scrapedListings.length,
      breakdown: {
        easyLiveAuction: scrapedEasyLiveLots.length,
        bpiAuctions: scrapedBpiLots.length,
        atgNetwork: scrapedAtg.length
      },
      data: scrapedListings,
      references: searchReferences
    });

  } catch (error: any) {
    console.error("Scraper Error:", error);
    
    res.status(500).json({
      status: "error",
      source: "multi-api-uk-aggregated",
      error: `Search failed: ${error.message || "An error occurred"}. Please try again.`,
      references: searchReferences
    });
  }
});

// Vite integration for dev server or static serving for production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve SPA index.html for all non-API paths
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
