import express from "express";
import path from "path";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { fetchPublicUrl, readBodyWithLimit, UnsafeUrlError } from "./server/safeFetch";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Behind a reverse proxy (most hosts), set TRUST_PROXY to the number of proxy hops so
// rate limits apply per client instead of to the proxy's IP.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

// Each live search starts several scrapers, up to three of them headless Chrome instances.
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE) || 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many searches. Please wait a minute and try again." }
});

const imageProxyLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.IMAGE_PROXY_RATE_LIMIT_PER_MINUTE) || 300,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

// In-Memory cache of real scraped auctions
let activeAuctions: any[] = [];

// GET: Retrieve all active auctions (real scraped data only)
app.get("/api/auctions", async (req, res) => {
  try {
    // If activeAuctions is empty, seed with immediate real US upcoming auctions and active lots
    if (activeAuctions.length === 0) {
      console.log("[Auctions API] Initializing live auction cache with US & UK lots...");
      const [svdAuctions, hibidLots] = await Promise.allSettled([
        scrapeSvdUpcomingAuctions(),
        scrapeHibidLotsWithTimeout("")
      ]);

      const initialSvd = svdAuctions.status === "fulfilled" ? svdAuctions.value : [];
      const initialHibid = hibidLots.status === "fulfilled" ? hibidLots.value : [];
      
      for (const item of [...initialHibid, ...initialSvd]) {
        if (!activeAuctions.some(existing => existing.id === item.id || existing.title.toLowerCase() === item.title.toLowerCase())) {
          activeAuctions.push(item);
        }
      }
    }

    res.json({
      status: "success",
      count: activeAuctions.length,
      data: activeAuctions
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch live auctions" });
  }
});

// High-performance search for The Saleroom via Algolia InstantSearch API with Puppeteer fallback
export async function scrapeTheSaleroomLots(keyword: string): Promise<any[]> {
  const appId = '2125HT9M59';
  const apiKey = 'b1f48e75f522cc67ff7751f1abd75458';
  const url = `https://${appId}-dsn.algolia.net/1/indexes/lots_sr_en/query`;
  const now = Date.now();

  const doAlgoliaQuery = async (numericFilters?: string[]) => {
    const body: any = {
      params: new URLSearchParams({
        query: keyword,
        hitsPerPage: '40',
        page: '0',
        facetFilters: JSON.stringify(['privatePlatformCodes:-SR']),
        ...(numericFilters ? { numericFilters: JSON.stringify(numericFilters) } : {})
      }).toString()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
        'Connection': 'close',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Algolia query status: ${res.status}`);
    return await res.json();
  };

  try {
    // 1. Try querying active/live lots first
    let data = await doAlgoliaQuery([`auctionEndDateTimeUtc>=${now}`]);
    let hits = data.hits || [];

    // If 0 live hits, search without numeric date restriction
    if (hits.length === 0) {
      data = await doAlgoliaQuery();
      hits = data.hits || [];
    }

    if (hits.length > 0) {
      return hits.map((h: any, i: number) => {
        const sym = h.currency === 'USD' ? '$' : (h.currency === 'EUR' ? '€' : '£');
        const startPrice = (h.nextBid && h.nextBid > 0) ? h.nextBid : (h.lowEstimate && h.lowEstimate > 0 ? h.lowEstimate : null);
        const currentPrice = (h.lastBid && h.lastBid > 0) ? h.lastBid : startPrice;
        let estimateStr: string | undefined = undefined;
        if (h.lowEstimate && h.highEstimate) {
          estimateStr = `${sym}${h.lowEstimate} - ${sym}${h.highEstimate}`;
        } else if (h.lowEstimate) {
          estimateStr = `${sym}${h.lowEstimate}`;
        }

        const auctioneer = h.auctioneerName || 'The Saleroom';
        const lotUrl = `https://www.the-saleroom.com/en-gb/auction-catalogues/${h.auctioneerRef || 'auctioneer'}/catalogue-id-${h.auctionRef || 'auction'}/lot-${h.objectID}`;

        return {
          id: `saleroom-${h.objectID || `${Date.now()}-${i}`}`,
          title: h.title || `Lot #${h.lotNumber || i + 1}`,
          url: lotUrl,
          details: h.description ? h.description.replace(/<[^>]*>/g, '').trim().slice(0, 300) : `Lot #${h.lotNumber || ''} from ${auctioneer}`,
          endingDate: h.auctionEndDateTimeUtc ? new Date(h.auctionEndDateTimeUtc).toISOString() : new Date(Date.now() + 4 * 86400000).toISOString(),
          startDate: h.auctionStartDateTimeUtc ? new Date(h.auctionStartDateTimeUtc).toISOString() : new Date().toISOString(),
          address: h.countryName || 'United Kingdom',
          latitude: h._geoloc?.lat || 51.5074,
          longitude: h._geoloc?.lng || -0.1278,
          auctioneer,
          category: h.masterCategoryName || 'Art & Antiques',
          country: h.countryCode || 'UK',
          currency: sym,
          currentPrice: currentPrice != null ? currentPrice : null,
          startPrice: startPrice != null ? startPrice : null,
          estimateStr,
          imageUrl: h.imageUrl || 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80',
          status: 'active',
          sourcePlatform: 'The Saleroom'
        };
      });
    }
  } catch (err: any) {
    console.warn('[The Saleroom] Algolia failed, falling back to Puppeteer:', err.message);
  }

  // Fallback to Puppeteer for The Saleroom if Algolia query yields 0 or fails
  return await scrapeAtgPlatformLots('https://www.the-saleroom.com', 'The Saleroom', 'saleroom', keyword);
}

// Dedicated BidSpotter UK scraper via Puppeteer
export async function scrapeBidspotterLots(keyword: string): Promise<any[]> {
  return await scrapeAtgPlatformLots('https://www.bidspotter.co.uk', 'BidSpotter', 'bidspotter', keyword);
}

// Robust ATG Network browser scraper (used for BidSpotter and as fallback for The Saleroom)
async function scrapeAtgPlatformLots(baseUrl: string, siteName: string, idPrefix: string, keyword: string): Promise<any[]> {
  let browser: any = null;
  const timeoutPromise = new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 22000));

  const scrapeTask = (async () => {
    try {
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--single-process',
          '--disable-gpu',
          '--no-zygote'
        ],
        headless: true
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'accept-language': 'en-GB,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      });

      const searchUrl = `${baseUrl}/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}`;
      try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      } catch {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 6000 }).catch(() => {});
      }

      // Retry evaluate in case AWS WAF challenge completes a post-navigation step
      let rawLots: any[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.waitForSelector('article.panel.item, .lot-single, [class*="lot-single"]', { timeout: 8000 }).catch(() => {});
          
          const cardCount = await page.evaluate(() => document.querySelectorAll('article.panel.item, .lot-single, [class*="lot-single"]').length);
          if (cardCount > 0) {
            // Wait for asynchronous BidSpotter pricing scripts (bindBiddingLiveLotData) to populate bids
            await new Promise(r => setTimeout(r, 3000));
          }

          rawLots = await page.evaluate(`(() => {
            const cards = Array.from(document.querySelectorAll('article.panel.item, .lot-single, [class*="lot-single"]'));
            const seen = new Set();
            const results = [];

            for (const card of cards) {
              const linkEl = card.querySelector('a[href*="/lot-"]') || card.querySelector('a[href*="/auction-catalogues/"]');
              const href = linkEl ? linkEl.href : '';
              if (!href || href.startsWith('#') || seen.has(href)) continue;
              seen.add(href);

              const titleEl = card.querySelector('.lot-title, h3 a, h3, h2');
              let title = titleEl ? titleEl.textContent.replace(/\\s+/g, ' ').trim() : '';
              if (!title || title.toLowerCase() === 'no image' || title.toLowerCase() === 'view' || title.toLowerCase().includes('top search')) {
                const img = card.querySelector('img[alt]:not([alt="No Image"]):not([alt="Loading..."])');
                if (img) title = img.getAttribute('alt') || '';
              }
              title = title.replace(/setTimeout\\([^)]*\\);?/gi, '').replace(/<[^>]*>/g, '').trim();
              if (!title || title.length < 2) continue;

              const numEl = card.querySelector('.lot-number, .number');
              const lotNumber = numEl ? numEl.textContent.replace(/lot/i, '').trim() : '';

              const sellerEl = card.querySelector('.byline a, [data-click-type="client"], .client-url a');
              const auctioneer = sellerEl ? sellerEl.textContent.replace(/\\s+/g, ' ').trim() : '';

              const descEl = card.querySelector('.description');
              const description = descEl ? descEl.textContent.replace(/\\s+/g, ' ').trim() : '';

              // Image extraction
              let imageUrl = '';
              const imgEl = card.querySelector('img[src*="globalauctionplatform.com"], img[src*="azureedge.net"], .thumb img:not([src*="blank-image"]):not([src*="ajax-loader"]), img[id^="i"]');
              if (imgEl) {
                imageUrl = imgEl.src || imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
              }
              if (!imageUrl) {
                const noscript = card.querySelector('noscript');
                if (noscript) {
                  const m = noscript.innerHTML.match(/src="([^"]+)"/);
                  if (m) imageUrl = m[1];
                }
              }
              if (imageUrl && imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

              // Pricing
              const openingEl = card.querySelector('.opening-price, [id^="openingPrice-"]');
              const currentEl = card.querySelector('.current-price, [id^="price-"]');
              const estEl = card.querySelector('.estimate');

              let openingBid = null;
              if (openingEl) {
                const m = (openingEl.textContent || '').match(/[\\d,.]+/);
                if (m) openingBid = parseFloat(m[0].replace(/,/g, ''));
              }

              let currentBid = null;
              if (currentEl) {
                const m = (currentEl.textContent || '').match(/[\\d,.]+/);
                if (m) currentBid = parseFloat(m[0].replace(/,/g, ''));
              }

              let lowEst = null;
              let highEst = null;
              let estimateStr = null;

              if (estEl) {
                const nums = (estEl.textContent || '').match(/[\\d,.]+/g);
                if (nums && nums.length >= 2) {
                  lowEst = parseFloat(nums[0].replace(/,/g, ''));
                  highEst = parseFloat(nums[1].replace(/,/g, ''));
                  estimateStr = '£' + lowEst + ' - £' + highEst;
                } else if (nums && nums.length === 1) {
                  lowEst = parseFloat(nums[0].replace(/,/g, ''));
                  estimateStr = '£' + lowEst;
                }
              }

              const rawCurrency = card.getAttribute('data-currency') || '';
              const currency = rawCurrency === 'USD' ? '$' : (rawCurrency === 'EUR' ? '€' : '£');

              results.push({
                lotNumber: lotNumber,
                title: title,
                description: description,
                url: href,
                imageUrl: imageUrl,
                auctioneer: auctioneer,
                openingBid: openingBid,
                currentBid: currentBid,
                estimateStr: estimateStr,
                currency: currency
              });

              if (results.length >= 35) break;
            }
            return results;
          })()`);

          if (rawLots && rawLots.length > 0) break;
        } catch (evalErr: any) {
          if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          break;
        }
      }

      return (rawLots || []).map((item: any, i: number) => {
        const exactCoords = getCoordinatesForLocation('United Kingdom');
        const effectiveStart = item.openingBid != null ? item.openingBid : null;
        const effectiveBid = item.currentBid != null ? item.currentBid : effectiveStart;

        let category = 'General';
        const lowerTitle = item.title.toLowerCase();
        if (lowerTitle.includes('lathe') || lowerTitle.includes('milling') || lowerTitle.includes('cnc') || lowerTitle.includes('machinery') || lowerTitle.includes('generator') || lowerTitle.includes('press') || lowerTitle.includes('welder')) {
          category = 'Machinery';
        } else if (lowerTitle.includes('catering') || lowerTitle.includes('oven') || lowerTitle.includes('freezer') || lowerTitle.includes('fryer') || lowerTitle.includes('restaurant')) {
          category = 'Catering';
        } else if (lowerTitle.includes('car') || lowerTitle.includes('van') || lowerTitle.includes('truck') || lowerTitle.includes('trailer') || lowerTitle.includes('vehicle') || lowerTitle.includes('tractor')) {
          category = 'Vehicles';
        } else if (lowerTitle.includes('furniture') || lowerTitle.includes('table') || lowerTitle.includes('chair') || lowerTitle.includes('desk') || lowerTitle.includes('cabinet') || lowerTitle.includes('sofa')) {
          category = 'Furniture';
        } else if (lowerTitle.includes('laptop') || lowerTitle.includes('computer') || lowerTitle.includes('screen') || lowerTitle.includes('tech') || lowerTitle.includes('electronics') || lowerTitle.includes('phone')) {
          category = 'Electronics';
        } else {
          category = 'Industrial';
        }

        const auctioneer = item.auctioneer || siteName;

        return {
          id: `${idPrefix}-${Date.now()}-${i}`,
          title: item.title,
          url: item.url,
          details: item.description || `Lot ${item.lotNumber ? '#' + item.lotNumber : ''} from ${auctioneer}.${item.estimateStr ? ` Estimate: ${item.estimateStr}.` : ''}${effectiveStart ? ` Starting bid: ${item.currency}${effectiveStart}.` : ''}`,
          endingDate: new Date(Date.now() + 4 * 86400000).toISOString(),
          startDate: new Date().toISOString(),
          address: 'United Kingdom',
          latitude: exactCoords.latitude,
          longitude: exactCoords.longitude,
          auctioneer,
          category,
          country: 'UK',
          currency: item.currency || '£',
          currentPrice: effectiveBid,
          startPrice: effectiveStart,
          estimateStr: item.estimateStr,
          imageUrl: item.imageUrl || 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80',
          status: 'active',
          sourcePlatform: siteName
        };
      });
    } catch (err: any) {
      console.warn(`[${siteName}] Scraper warning:`, err.message);
      return [];
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  return await Promise.race([scrapeTask, timeoutPromise]);
}

// Dedicated LiveAuctioneers search via direct JSON API
export async function fetchLiveAuctioneersLots(keyword: string): Promise<any[]> {
  try {
    const searchParameters = {
      searchTerm: keyword,
      page: 1,
      pageSize: 36,
      sort: "-relevance",
      options: {
        status: ["upcoming", "live", "online"]
      },
      skipAggs: true
    };
    const deviceId = crypto.randomUUID();
    const url = `https://search-party-prod.liveauctioneers.com/search/v4/web?parameters=${encodeURIComponent(JSON.stringify(searchParameters))}&deviceId=${deviceId}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Connection": "close"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`LiveAuctioneers search returned status: ${res.status}`);
      return [];
    }

    const data: any = await res.json();
    const items = data?.payload?.items || [];

    return items.map((item: any) => {
      const directUrl = item.slug
        ? `https://www.liveauctioneers.com/item/${item.itemId}_${item.slug}`
        : `https://www.liveauctioneers.com/item/${item.itemId}`;

      const imgUrl = (item.sellerId && item.catalogId && item.itemId)
        ? `https://p1.liveauctioneers.com/${item.sellerId}/${item.catalogId}/${item.itemId}_1_m.jpg`
        : "";

      const startPriceNum = Number(item.startPrice);
      const startPrice = (!isNaN(startPriceNum) && startPriceNum > 0) ? startPriceNum : null;
      
      const leadingBidNum = Number(item.leadingBid);
      const leadingBid = (!isNaN(leadingBidNum) && leadingBidNum > 0) ? leadingBidNum : null;
      
      const lowEstNum = Number(item.lowBidEstimate);
      const lowEst = (!isNaN(lowEstNum) && lowEstNum > 0) ? lowEstNum : null;
      
      const highEstNum = Number(item.highBidEstimate);
      const highEst = (!isNaN(highEstNum) && highEstNum > 0) ? highEstNum : null;
      const sym = item.currency === "GBP" ? "£" : (item.currency === "EUR" ? "€" : "$");
      const estimateStr = (lowEst && highEst) ? `${sym}${lowEst} - ${sym}${highEst}` : (lowEst ? `${sym}${lowEst}` : undefined);

      const effectiveStart = startPrice != null ? startPrice : (lowEst != null ? lowEst : null);
      const currentPrice = leadingBid != null ? leadingBid : effectiveStart;

      const endingDate = (typeof item.lotEndTimeEstimatedTs === "number" && item.lotEndTimeEstimatedTs > 0)
        ? new Date(item.lotEndTimeEstimatedTs * 1000).toISOString()
        : (item.saleStartTs ? new Date(item.saleStartTs * 1000).toISOString() : "");

      const locParts = [item.lotLocationCity, item.lotLocationRegion, item.lotLocationCountryCode].filter(Boolean);
      const address = locParts.join(", ") || item.sellerName || "Online";
      const country = item.lotLocationCountryCode === "GB" ? "UK" : (item.lotLocationCountryCode || "US");
      const coords = getCoordinatesForLocation(address, country);

      let category = "General";
      const lowerTitle = (item.title || "").toLowerCase();
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
      } else {
        category = "Industrial";
      }

      return {
        id: `la-${item.itemId}`,
        title: item.title || "Auction Lot",
        url: directUrl,
        details: item.shortDescription || `Lot #${item.lotNumber || ""} by ${item.sellerName || "LiveAuctioneers"}.${estimateStr ? ` Estimate: ${estimateStr}.` : ""}`,
        endingDate: endingDate || new Date(Date.now() + 5 * 86400000).toISOString(),
        startDate: item.saleStartTs ? new Date(item.saleStartTs * 1000).toISOString() : new Date().toISOString(),
        address: address,
        latitude: coords.latitude,
        longitude: coords.longitude,
        auctioneer: item.sellerName || "LiveAuctioneers",
        category: category,
        country: country,
        currency: sym,
        currentPrice: currentPrice,
        startPrice: effectiveStart,
        bidLabel: leadingBid ? "Current Bid" : (effectiveStart ? "Starting Bid" : undefined),
        estimateStr: estimateStr,
        imageUrl: imgUrl || "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80",
        status: "active",
        sourcePlatform: "LiveAuctioneers"
      };
    });
  } catch (err: any) {
    console.warn("Error in LiveAuctioneers fetch:", err.message);
    return [];
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

// Precise coordinates mapper for common US states & cities (focus on SVD / Silicon Valley Disposition locations)
const usCoordinateLookup: Record<string, { latitude: number; longitude: number }> = {
  "burlingame": { latitude: 37.5841, longitude: -122.3661 },
  "san francisco": { latitude: 37.7749, longitude: -122.4194 },
  "south san francisco": { latitude: 37.6547, longitude: -122.4077 },
  "san jose": { latitude: 37.3382, longitude: -121.8863 },
  "santa clara": { latitude: 37.3541, longitude: -121.9552 },
  "mountain view": { latitude: 37.3861, longitude: -122.0839 },
  "palo alto": { latitude: 37.4419, longitude: -122.1430 },
  "fremont": { latitude: 37.5485, longitude: -121.9886 },
  "modesto": { latitude: 37.6391, longitude: -120.9969 },
  "oakland": { latitude: 37.8044, longitude: -122.2712 },
  "sparks": { latitude: 39.5349, longitude: -119.7527 },
  "reno": { latitude: 39.5296, longitude: -119.8138 },
  "nevada": { latitude: 39.5349, longitude: -119.7527 },
  "nv": { latitude: 39.5349, longitude: -119.7527 },
  "boston": { latitude: 42.3601, longitude: -71.0589 },
  "massachusetts": { latitude: 42.3601, longitude: -71.0589 },
  "ma": { latitude: 42.3601, longitude: -71.0589 },
  "utah": { latitude: 40.7608, longitude: -111.8910 },
  "ut": { latitude: 40.7608, longitude: -111.8910 },
  "salt lake": { latitude: 40.7608, longitude: -111.8910 },
  "orem": { latitude: 40.2969, longitude: -111.6946 },
  "austin": { latitude: 30.2672, longitude: -97.7431 },
  "texas": { latitude: 30.2672, longitude: -97.7431 },
  "tx": { latitude: 30.2672, longitude: -97.7431 },
  "chicago": { latitude: 41.8781, longitude: -87.6298 },
  "new york": { latitude: 40.7128, longitude: -74.0060 },
  "ny": { latitude: 40.7128, longitude: -74.0060 },
  "seattle": { latitude: 47.6062, longitude: -122.3321 },
  "wa": { latitude: 47.6062, longitude: -122.3321 },
  "california": { latitude: 37.5841, longitude: -122.3661 },
  "ca": { latitude: 37.5841, longitude: -122.3661 }
};

// Helper to determine coordinates from address and country
function getCoordinatesForLocation(address: string, country: string = "UK"): { latitude: number; longitude: number } {
  const lowerAddress = (address || "").toLowerCase();
  
  // If explicitly US or contains US indicators
  if (country === "US" || lowerAddress.includes("usa") || lowerAddress.includes(", ca") || lowerAddress.includes(", nv") || lowerAddress.includes(", ma") || lowerAddress.includes(", tx") || lowerAddress.includes(", ut")) {
    for (const [city, coords] of Object.entries(usCoordinateLookup)) {
      if (lowerAddress.includes(city)) {
        return coords;
      }
    }
    // Default US Silicon Valley Disposition headquarters
    return { latitude: 37.5841, longitude: -122.3661 };
  }

  // UK lookup
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

// Infer category based on lot title and details for US & UK auctions
function inferCategoryFromTitle(title: string, details?: string): string {
  const text = `${title} ${details || ""}`.toLowerCase();
  if (/biotech|genetic|dna|pcr|massarray|hplc|chromatograph|spectrom|analyzer|lab|medical|centrifuge|incubator|biometra/i.test(text)) {
    return "Laboratory & Biotech";
  }
  if (/robot|robotic|automation|arm|vision system|actuator|motion control/i.test(text)) {
    return "Robotics & Automation";
  }
  if (/server|switch|cisco|dell|optiplex|workstation|laptop|computer|networking|sfp|transceiver|nvme|ssd/i.test(text)) {
    return "IT & Telecom Equipment";
  }
  if (/test|measurement|oscilloscope|keysight|agilent|tektronix|multimeter|analyzer|fluke/i.test(text)) {
    return "Electronics & Test Equipment";
  }
  if (/semiconductor|wafer|laser|optical|slide|lens|vacuum|chamber|plasma|mfa-cc/i.test(text)) {
    return "Semiconductor & Photonics";
  }
  if (/agriculture|crop|tractor|irrigation|climate|hvac|water treatment/i.test(text)) {
    return "Agricultural & Environmental";
  }
  if (/car|auto|vehicle|truck|buick|classic car|fleet/i.test(text)) {
    return "Vehicles & Fleet";
  }
  if (/machin|cnc|lathe|mill|press|tool|drill|saw|warehouse|forklift/i.test(text)) {
    return "Industrial & Machinery";
  }
  return "Surplus Tech & Equipment";
}

// In-memory cache for HiBid scrape results and single lot details
const hibidLotsCache = new Map<string, { timestamp: number; lots: any[] }>();
const hibidDetailCache = new Map<string, { timestamp: number; detail: any }>();

// Fast scrape of upcoming auctions & featured lots from svdisposition.com
async function scrapeSvdUpcomingAuctions(keyword?: string): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://svdisposition.com/upcoming-auctions", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Connection": "close"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];

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
    return [];
  }
}

// Fetch comprehensive single lot information from hibid.com/lot/:lotId
async function fetchHibidLotDetail(lotId: string): Promise<any | null> {
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
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;

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
  } catch {
    return null;
  }
}

// Scrape active lots directly across HiBid using global search url:
// https://hibid.com/lots?q={query_term}&miles=-1&status=ALL&closingDate={YYYY-MM-DD}
async function scrapeHibidLots(keyword: string = "", closingDate: string = ""): Promise<any[]> {
  const queryTerm = (keyword || "").trim();
  const cleanClosing = (closingDate || "").trim();
  const cacheKey = `${queryTerm.toLowerCase()}::${cleanClosing}`;
  
  const cached = hibidLotsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.lots;
  }

  // Exact URL requested by the user with unlimited distance (miles=-1) and closingDate filter
  let targetUrl = `https://hibid.com/lots?q=${encodeURIComponent(queryTerm)}&miles=-1&status=ALL`;
  if (cleanClosing) {
    targetUrl += `&closingDate=${encodeURIComponent(cleanClosing)}`;
  }

  console.log(`[HiBid Global Scraper] Querying HiBid: ${targetUrl}`);

  let lotsRaw: any[] = [];

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
      signal: controller.signal
    });
    clearTimeout(timeoutId);

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
          const price = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : null;

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
  }

  // 2. Fallback to Puppeteer if direct fetch didn't capture lots
  if (lotsRaw.length === 0) {
    let browser = null;
    try {
      console.log(`[HiBid Global Scraper] Launching Puppeteer fallback for ${targetUrl}`);
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 25000 });
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
          const price = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, "")) : null;

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
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
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
        const detail = await fetchHibidLotDetail(item.lotId);
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

  hibidLotsCache.set(cacheKey, { timestamp: Date.now(), lots: parsedListings });
  console.log(`[HiBid Global Scraper] Extracted and cached ${parsedListings.length} lots for query "${cacheKey}"`);
  return parsedListings;
}

// Timeout wrapper ensuring HiBid search never blocks for more than 30 seconds
async function scrapeHibidLotsWithTimeout(keyword: string = "", closingDate: string = ""): Promise<any[]> {
  const timeoutPromise = new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 30000));
  try {
    return await Promise.race([scrapeHibidLots(keyword, closingDate), timeoutPromise]);
  } catch (err: any) {
    console.warn("HiBid scraper timeout/error:", err.message);
    return [];
  }
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
    "Connection": "close",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

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

    console.warn(`Artisio direct fetch returned status ${res.status}. Attempting Puppeteer fallback.`);
  } catch (fetchErr: any) {
    console.warn(`Artisio direct fetch failed (${fetchErr.message}). Attempting Puppeteer fallback.`);
  }

  // Fallback: Puppeteer browser fetch if direct fetch is blocked
  try {
    return await fetchArtisioViaPuppeteer(url, clientId, originUrl, refererUrl);
  } catch {
    return { lots: { count: 0, results: [] } };
  }
}

// Puppeteer fallback execution for Artisio requests in environments where Chrome is available
async function fetchArtisioViaPuppeteer(targetUrl: string, clientId: string, originUrl: string, refererUrl: string): Promise<any> {
  let browser: any = null;
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
const easyLiveBidCache = new Map<string, { timestamp: number; data: any }>();

// Enrich Easy Live Auction lots with live starting bid and real-time dates from doRefreshTimedBidding
async function enrichEasyLiveTimedBidding(lots: any[]): Promise<any[]> {
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
          signal: controller.signal
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
export async function fetchEasyLiveAuctionLots(keyword: string, hitsPerPage: number = 20, page: number = 0): Promise<any[]> {
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
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`EasyLive Algolia fetch returned status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const hits: EasyLiveHit[] = data.results?.[0]?.hits || [];
    const lots = hits.map(hit => normalizeEasyLiveLot(hit, keyword));
    return await enrichEasyLiveTimedBidding(lots);
  } catch (err: any) {
    console.error("Easy Live Auction fetch error:", err.message);
    return [];
  }
}

// GET: /api/proxy/image - Resilient proxy to stream auction images (ATG, Bidspotter, EasyLive) avoiding CDN 403 or referrer blocks
const FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";
const MAX_PROXIED_IMAGE_BYTES = 10 * 1024 * 1024;
// Raster formats only: SVG can carry script and would run on this app's origin.
const PROXYABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

app.get("/api/proxy/image", imageProxyLimiter, async (req, res) => {
  const imageUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!imageUrl) {
    return res.status(400).send("Invalid image URL");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      // Parse host for custom referer
      const origin = new URL(imageUrl).origin;
      const upstreamRes = await fetchPublicUrl(imageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/*;q=0.8",
          "Referer": `${origin}/`
        },
        signal: controller.signal
      });

      const contentType = (upstreamRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!upstreamRes.ok || !PROXYABLE_IMAGE_TYPES.has(contentType)) {
        return res.redirect(302, FALLBACK_IMAGE_URL);
      }

      const body = await readBodyWithLimit(upstreamRes, MAX_PROXIED_IMAGE_BYTES);
      res.setHeader("Content-Type", contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.send(body);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return res.status(400).send("Image URL not allowed");
    }
    res.redirect(302, FALLBACK_IMAGE_URL);
  }
});

// Helper to normalize and save newly scraped lots to the live active database
function normalizeAndStoreLots(rawItems: any[]): any[] {
  if (!Array.isArray(rawItems)) return [];
  rawItems.forEach((item: any) => {
    // If estimate is present and starting/current prices are missing,
    // pre-bidding opens at the low estimate on UK/US auction portals
    if ((item.startPrice == null || item.startPrice === 0) && item.estimateStr) {
      const match = item.estimateStr.match(/[\d,.]+/);
      if (match) {
        const val = parseFloat(match[0].replace(/,/g, ""));
        if (!isNaN(val) && val > 0) {
          item.startPrice = val;
          if (item.currentPrice == null || item.currentPrice === 0) {
            item.currentPrice = val;
            if (!item.bidLabel) item.bidLabel = "Starting Bid";
          }
        }
      }
    }

    if ((item.currentPrice == null || item.currentPrice === 0) && typeof item.startPrice === "number" && item.startPrice > 0) {
      item.currentPrice = item.startPrice;
      if (!item.bidLabel) item.bidLabel = "Starting Bid";
    } else if ((item.startPrice == null || item.startPrice === 0) && typeof item.currentPrice === "number" && item.currentPrice > 0) {
      item.startPrice = item.currentPrice;
    }

    if (!activeAuctions.some(existing => existing.id === item.id || existing.title.toLowerCase() === item.title.toLowerCase())) {
      activeAuctions.push(item);
    }
  });
  return rawItems;
}

// GET: Progressive Server-Sent Events (SSE) stream for live asynchronous auction search
// Allows the client to immediately render fast-returning APIs (LiveAuctioneers, EasyLive, BPI)
// while longer scrapers (BidSpotter, The Saleroom, HiBid) continue processing in the background.
app.get("/api/auctions/search-stream", searchLimiter, async (req, res) => {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  const closingDate = typeof req.query.closingDate === "string" ? req.query.closingDate.trim() : "";

  if (!keyword) {
    return res.status(400).json({ error: "A valid keyword query parameter is required." });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let isConnected = true;
  req.on("close", () => {
    isConnected = false;
  });

  const sendEvent = (event: string, data: any) => {
    if (!isConnected || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  };

  const searchReferences = [
    { title: `LiveAuctioneers Search for "${keyword}" (Direct Catalog Search)`, url: `https://www.liveauctioneers.com/search/?keyword=${encodeURIComponent(keyword)}&sort=-relevance&status=online` },
    { title: `BidSpotter UK Search for "${keyword}" (Live Puppeteer Scraper)`, url: `https://www.bidspotter.co.uk/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}` },
    { title: `The Saleroom Search for "${keyword}" (Live Puppeteer Scraper)`, url: `https://www.the-saleroom.com/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}` },
    { title: `HiBid Worldwide Search for "${keyword}" (miles=-1)`, url: `https://hibid.com/lots?q=${encodeURIComponent(keyword)}&miles=-1&status=ALL${closingDate ? `&closingDate=${encodeURIComponent(closingDate)}` : ''}` },
    { title: `Silicon Valley Disposition Upcoming US Auctions`, url: "https://svdisposition.com/upcoming-auctions" },
    { title: `Easy Live Auction Search for "${keyword}"`, url: `https://www.easyliveauction.com/catalogue/?searchTerm=${encodeURIComponent(keyword)}&searchOption=3` },
    { title: `BPI Auctions Search for "${keyword}"`, url: `https://bpiauctions.com/auctions/#/search?query=${encodeURIComponent(keyword)}` }
  ];

  sendEvent("init", {
    keyword,
    references: searchReferences
  });

  const runProvider = async (id: string, name: string, task: () => Promise<any[]>) => {
    if (!isConnected) return;
    sendEvent("provider_status", { provider: id, name, status: "searching" });
    try {
      const raw = await task();
      const lots = normalizeAndStoreLots(raw);
      if (!isConnected) return;
      sendEvent("provider_results", {
        provider: id,
        name,
        status: "completed",
        count: lots.length,
        lots
      });
    } catch (err: any) {
      console.error(`Streaming error for ${name}:`, err.message);
      if (!isConnected) return;
      sendEvent("provider_results", {
        provider: id,
        name,
        status: "error",
        error: err.message,
        count: 0,
        lots: []
      });
    }
  };

  const tasks = [
    runProvider("liveAuctioneers", "LiveAuctioneers", () => fetchLiveAuctioneersLots(keyword)),
    runProvider("easyLiveAuction", "Easy Live Auction", () => fetchEasyLiveAuctionLots(keyword, 35, 0)),
    runProvider("bpiAuctions", "BPI Auctions", () => scrapeBpiLots(keyword, 2)),
    runProvider("hibidSvd", "HiBid / SVD", async () => {
      const [hLots, sLots] = await Promise.all([
        scrapeHibidLotsWithTimeout(keyword, closingDate),
        scrapeSvdUpcomingAuctions(keyword)
      ]);
      return [...hLots, ...sLots];
    }),
    runProvider("bidspotter", "BidSpotter", () => scrapeBidspotterLots(keyword)),
    runProvider("theSaleroom", "The Saleroom", () => scrapeTheSaleroomLots(keyword))
  ];

  await Promise.allSettled(tasks);

  if (isConnected) {
    sendEvent("complete", {
      status: "success",
      references: searchReferences
    });
    res.end();
  }
});

// Vite integration for dev server or static serving for production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily so production doesn't need Vite installed.
    const { createServer: createViteServer } = await import("vite");
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

  if (process.env.NODE_ENV !== "test") app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
