import crypto from "crypto";
import { withCancel } from "../lib/cancel";
import { categorizeByTitle } from "../lib/categories";
import { getCoordinatesForLocation } from "../lib/geo";

// Dedicated LiveAuctioneers search via direct JSON API
export async function fetchLiveAuctioneersLots(keyword: string, cancelSignal?: AbortSignal): Promise<any[]> {
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
      signal: withCancel(controller.signal, cancelSignal)
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

      // The low estimate is not a bid; with no published start price the price is unknown.
      const effectiveStart = startPrice;
      const currentPrice = leadingBid != null ? leadingBid : effectiveStart;

      const endingDate = (typeof item.lotEndTimeEstimatedTs === "number" && item.lotEndTimeEstimatedTs > 0)
        ? new Date(item.lotEndTimeEstimatedTs * 1000).toISOString()
        : (item.saleStartTs ? new Date(item.saleStartTs * 1000).toISOString() : "");

      const locParts = [item.lotLocationCity, item.lotLocationRegion, item.lotLocationCountryCode].filter(Boolean);
      const address = locParts.join(", ") || item.sellerName || "Online";
      const country = item.lotLocationCountryCode === "GB" ? "UK" : (item.lotLocationCountryCode || "US");
      const coords = getCoordinatesForLocation(address, country);

      const category = categorizeByTitle(item.title || "", "Industrial");

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
