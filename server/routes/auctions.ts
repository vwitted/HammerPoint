import type { Express, RequestHandler } from "express";
import { applyPriceFallbacks } from "../lib/prices";
import { SearchCache } from "../searchCache";
import { fetchLiveAuctioneersLots } from "../providers/liveAuctioneers";
import { fetchEasyLiveAuctionLots } from "../providers/easyLive";
import { scrapeBpiLots } from "../providers/bpi";
import { scrapeHibidLotsWithTimeout, scrapeSvdUpcomingAuctions } from "../providers/hibid";
import { scrapeBidspotterLots } from "../providers/atg";
import { scrapeTheSaleroomLots } from "../providers/theSaleroom";

// Search results per source + query. Shared by all visitors; see server/searchCache.ts.
const searchCache = new SearchCache<any>({
  ttlMs: 10 * 60_000,
  emptyTtlMs: 60_000,
  maxEntries: 200,
});

// Aborts when the client disconnects before the response has finished (e.g. pressed Stop).
function abortOnDisconnect(res: { on(event: "close", cb: () => void): unknown; writableFinished: boolean }): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

// Lots listed by id once, keeping the first occurrence.
function uniqueById(lots: any[]): any[] {
  const seen = new Set<string>();
  return lots.filter((lot) => !seen.has(lot.id) && seen.add(lot.id));
}

export function registerAuctionRoutes(app: Express, searchLimiter: RequestHandler) {
  // GET: Starter set of lots for the first page load (HiBid + Silicon Valley Disposition), cached.
  app.get("/api/auctions", async (req, res) => {
    try {
      const signal = abortOnDisconnect(res);
      const lots = await searchCache.get("featured", async (loadSignal) => {
        console.log("[Auctions API] Loading featured US lots...");
        const [svdAuctions, hibidLots] = await Promise.allSettled([
          scrapeSvdUpcomingAuctions(undefined, loadSignal),
          scrapeHibidLotsWithTimeout("", "", loadSignal)
        ]);
        const initialSvd = svdAuctions.status === "fulfilled" ? svdAuctions.value : [];
        const initialHibid = hibidLots.status === "fulfilled" ? hibidLots.value : [];
        return uniqueById([...initialHibid, ...initialSvd]);
      }, signal);
      if (signal.aborted) return;

      res.json({
        status: "success",
        count: lots.length,
        data: lots
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch live auctions" });
    }
  });

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

    const cancelSignal = abortOnDisconnect(res);
    let isConnected = true;
    cancelSignal.addEventListener("abort", () => {
      isConnected = false;
      console.log(`[Search] "${keyword}" cancelled: client disconnected`);
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

    const runProvider = async (id: string, name: string, task: (signal: AbortSignal) => Promise<any[]>, cacheKeyExtra = "") => {
      if (!isConnected) return;
      sendEvent("provider_status", { provider: id, name, status: "searching" });
      try {
        const cacheKey = `${id}:${keyword.toLowerCase()}${cacheKeyExtra}`;
        const lots = await searchCache.get(cacheKey, async (signal) => applyPriceFallbacks(await task(signal)), cancelSignal);
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
      runProvider("liveAuctioneers", "LiveAuctioneers", (signal) => fetchLiveAuctioneersLots(keyword, signal)),
      runProvider("easyLiveAuction", "Easy Live Auction", (signal) => fetchEasyLiveAuctionLots(keyword, 35, 0, signal)),
      runProvider("bpiAuctions", "BPI Auctions", (signal) => scrapeBpiLots(keyword, 2, signal)),
      runProvider("hibidSvd", "HiBid / SVD", async (signal) => {
        const [hLots, sLots] = await Promise.all([
          scrapeHibidLotsWithTimeout(keyword, closingDate, signal),
          scrapeSvdUpcomingAuctions(keyword, signal)
        ]);
        return [...hLots, ...sLots];
      }, `:${closingDate}`),
      runProvider("bidspotter", "BidSpotter", (signal) => scrapeBidspotterLots(keyword, signal)),
      runProvider("theSaleroom", "The Saleroom", (signal) => scrapeTheSaleroomLots(keyword, signal))
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
}
