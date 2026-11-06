import puppeteer from "puppeteer";
import { categorizeByTitle } from "../lib/categories";
import { getCoordinatesForLocation } from "../lib/geo";
import { isSidecarEnabled, scrapePage } from "../lib/sidecar";
import { noteChallengePage, noteChallengeTitle, noteFailure, reportSourceIssue } from "../lib/sourceHealth";

// Dedicated BidSpotter UK scraper via Puppeteer
export async function scrapeBidspotterLots(keyword: string, cancelSignal?: AbortSignal): Promise<any[]> {
  return await scrapeAtgPlatformLots('https://www.bidspotter.co.uk', 'BidSpotter', 'bidspotter', keyword, cancelSignal);
}

// Runs inside the search results page (via page.evaluate) and extracts one raw record per lot card.
// Kept as a string so it can also be run against saved HTML in tests.
export const ATG_EXTRACT_LOTS_SCRIPT = `(() => {
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
})()`;

// Stable id from the lot URL (".../lot-<uuid>"), so the same lot gets the same id on every search.
function atgLotId(url: string, idPrefix: string, index: number): string {
  const match = (url || "").match(/\/lot-([a-z0-9-]+)/i);
  return match ? `${idPrefix}-${match[1].toLowerCase()}` : `${idPrefix}-${Date.now()}-${index}`;
}

// Converts one raw lot card record (from ATG_EXTRACT_LOTS_SCRIPT) into a listing.
export function mapAtgRawLot(item: any, i: number, siteName: string, idPrefix: string) {
  const exactCoords = getCoordinatesForLocation('United Kingdom');
  const effectiveStart = item.openingBid != null ? item.openingBid : null;
  const effectiveBid = item.currentBid != null ? item.currentBid : effectiveStart;

  const category = categorizeByTitle(item.title, "Industrial");

  const auctioneer = item.auctioneer || siteName;

  return {
    id: atgLotId(item.url, idPrefix, i),
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
}

export const ATG_SCRAPE_TIMEOUT_MS = 45000;

type AtgSidecarAttempt = {
  // null means "try Chrome"; [] means the sidecar answered but there is nothing to return (a
  // challenge or a timeout), so a second browser would only repeat the wait.
  lots: any[] | null;
  // Called only if the Chrome fallback also produces no lots, so a successful fallback does not
  // report a problem that the visitor never experienced.
  problem: (() => void) | null;
};

// Runs the extraction script in a real Camoufox session through the Python sidecar.
async function scrapeAtgViaSidecar(
  searchUrl: string,
  siteName: string,
  idPrefix: string,
  cancelSignal?: AbortSignal,
): Promise<AtgSidecarAttempt> {
  try {
    const { result, title, status, error } = await scrapePage({
      url: searchUrl,
      gotoTimeoutMs: 20000,
      waitSelector: 'article.panel.item, .lot-single, [class*="lot-single"]',
      waitSelectorTimeoutMs: 8000,
      // BidSpotter fills prices from bindBiddingLiveLotData after the cards appear.
      settleMs: 3000,
      evaluateScript: ATG_EXTRACT_LOTS_SCRIPT,
      attempts: 2,
    }, cancelSignal, ATG_SCRAPE_TIMEOUT_MS);

    if (cancelSignal?.aborted) return { lots: [], problem: null };
    if (noteChallengeTitle(title, "search page (Camoufox)")) return { lots: [], problem: null };
    if (error) throw new Error(error);

    const rawLots = Array.isArray(result) ? result : [];
    console.log(`[${siteName}] path=sidecar count=${rawLots.length}`);
    if (rawLots.length === 0) {
      // A clean-looking empty page is the failure mode that hid HiBid's broken fast path for
      // months; try Chrome before giving up. A genuinely empty search is not a site problem, so
      // there is nothing to report if Chrome is empty too.
      console.warn(`[${siteName}] sidecar returned no lots (HTTP ${status}); trying Chrome`);
      return { lots: null, problem: null };
    }
    return {
      lots: rawLots.map((item: any, i: number) => mapAtgRawLot(item, i, siteName, idPrefix)),
      problem: null,
    };
  } catch (err: any) {
    if (cancelSignal?.aborted) return { lots: [], problem: null };
    const problem = () => noteFailure(err, "search page (Camoufox)", cancelSignal);
    console.warn(`[${siteName}] sidecar scraper warning:`, err.message);
    // A sidecar timeout means the site is slow, not that Chrome will be faster; the caller's
    // 45s budget would be spent twice. Report it now rather than starting a second browser.
    if (/timed? ?out|timeout/i.test(String(err?.message ?? ""))) {
      problem();
      return { lots: [], problem: null };
    }
    return { lots: null, problem };
  }
}

// Last-resort Chrome path. Kept because it works in environments without the sidecar and gives
// Camoufox a second chance if a page changes shape.
async function scrapeAtgViaChrome(
  searchUrl: string,
  siteName: string,
  idPrefix: string,
  cancelSignal?: AbortSignal,
): Promise<any[]> {
  let browser: any = null;
  let stopped = false;
  let timeoutId: NodeJS.Timeout | undefined;
  let stop: (reason: string) => void = () => {};
  // The timeout must exceed the page steps below (navigation up to 26s, then card wait + pricing
  // settle), otherwise slow-but-successful pages return nothing. On timeout or cancellation,
  // close Chrome so it doesn't keep running in the background.
  const stopPromise = new Promise<any[]>((resolve) => {
    stop = (reason: string) => {
      if (stopped) return;
      stopped = true;
      console.warn(`[${siteName}] Scraper stopped: ${reason}`);
      if (reason !== "cancelled") reportSourceIssue("timeout", "search page (Chrome)", "timed out");
      if (browser) browser.close().catch(() => {});
      resolve([]);
    };
    timeoutId = setTimeout(() => stop(`timed out after ${ATG_SCRAPE_TIMEOUT_MS / 1000}s`), ATG_SCRAPE_TIMEOUT_MS);
  });
  const onCancel = () => stop("cancelled");
  cancelSignal?.addEventListener("abort", onCancel, { once: true });

  const scrapeTask = (async () => {
    try {
      browser = await puppeteer.launch({
        // No --single-process: current Chrome crashes on launch with it ("Target closed").
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        headless: true
      });
      // The timeout or cancellation may have happened while Chrome was still launching.
      if (stopped) {
        await browser.close().catch(() => {});
        return [];
      }

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'accept-language': 'en-GB,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      });

      try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      } catch {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 6000 }).catch(() => {});
      }
      if (stopped) return [];
      if (await noteChallengePage(page, "search page (Chrome)")) return [];

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

          rawLots = await page.evaluate(ATG_EXTRACT_LOTS_SCRIPT);

          if (rawLots && rawLots.length > 0) break;
        } catch (evalErr: any) {
          if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          break;
        }
      }

      const mapped = (rawLots || []).map((item: any, i: number) => mapAtgRawLot(item, i, siteName, idPrefix));
      console.log(`[${siteName}] path=chrome count=${mapped.length}`);
      return mapped;
    } catch (err: any) {
      console.warn(`[${siteName}] Scraper warning:`, err.message);
      if (!stopped) noteFailure(err, "search page (Chrome)", cancelSignal);
      return [];
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  try {
    return await Promise.race([scrapeTask, stopPromise]);
  } finally {
    clearTimeout(timeoutId);
    cancelSignal?.removeEventListener("abort", onCancel);
  }
}

// Robust ATG Network browser scraper (used for BidSpotter and as fallback for The Saleroom)
export async function scrapeAtgPlatformLots(baseUrl: string, siteName: string, idPrefix: string, keyword: string, cancelSignal?: AbortSignal): Promise<any[]> {
  if (cancelSignal?.aborted) return [];

  const searchUrl = `${baseUrl}/en-gb/search-results?searchTerm=${encodeURIComponent(keyword)}`;

  // Preferred path: Camoufox (patched Firefox, real fingerprint). Falls back to Chrome when the
  // sidecar is not configured or cannot launch, so local development and the fixture tests keep
  // working without Python.
  let sidecarProblem: (() => void) | null = null;
  if (isSidecarEnabled()) {
    const attempt = await scrapeAtgViaSidecar(searchUrl, siteName, idPrefix, cancelSignal);
    if (attempt.lots !== null) return attempt.lots;
    sidecarProblem = attempt.problem;
    if (cancelSignal?.aborted) return [];
  }

  const lots = await scrapeAtgViaChrome(searchUrl, siteName, idPrefix, cancelSignal);
  if (lots.length === 0) sidecarProblem?.();
  return lots;
}
