import type { Express, RequestHandler } from "express";
import { activeAuctions, normalizeAndStoreLots } from "../listingStore";
import { fetchLiveAuctioneersLots } from "../providers/liveAuctioneers";
import { fetchEasyLiveAuctionLots } from "../providers/easyLive";
import { scrapeBpiLots } from "../providers/bpi";
import { scrapeHibidLotsWithTimeout, scrapeSvdUpcomingAuctions } from "../providers/hibid";
import { scrapeBidspotterLots } from "../providers/atg";
import { scrapeTheSaleroomLots } from "../providers/theSaleroom";

export function registerAuctionRoutes(app: Express, searchLimiter: RequestHandler) {
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
          if (!activeAuctions.some(existing => existing.id === item.id)) {
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
}
