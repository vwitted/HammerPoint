// In-Memory cache of real scraped auctions
export const activeAuctions: any[] = [];

// Helper to normalize and save newly scraped lots to the live active database
export function normalizeAndStoreLots(rawItems: any[]): any[] {
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
