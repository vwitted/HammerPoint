// Tidies the price fields every provider returns, without inventing figures.
// A known starting price with no current bid is shown as the starting bid. Nothing else is
// filled in: the low estimate is not a bid (opening bids are often well below it), and a
// current bid says nothing about where bidding started. Unknown prices stay null and the UI
// shows a dash. Mutates and returns the given lots.
export function applyPriceFallbacks(rawItems: any[]): any[] {
  if (!Array.isArray(rawItems)) return [];
  rawItems.forEach((item: any) => {
    if (item.startPrice === 0) item.startPrice = null;
    if (item.currentPrice === 0) item.currentPrice = null;

    if (item.currentPrice == null && typeof item.startPrice === "number" && item.startPrice > 0) {
      item.currentPrice = item.startPrice;
      if (!item.bidLabel) item.bidLabel = "Starting Bid";
    }
  });
  return rawItems;
}
