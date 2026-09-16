import { AuctionListing } from "../types";

// Display helpers for auction lots. Kept free of React so they can be unit tested.

// Robust date parser ensuring no obsolete defaults (such as 2001) or ambiguous dates occur
export function parseValidDate(dateStr?: string | null, defaultHour: number = 10): Date | null {
  if (!dateStr) return null;
  let clean = dateStr.trim();
  const currentYear = new Date().getFullYear();

  // Strip leading weekday names (e.g. "Sun, ", "Wed, ")
  clean = clean.replace(/^[a-z]+,\s*/i, "");

  // Replace any legacy 2001 string with currentYear
  if (clean.includes("2001")) {
    clean = clean.replace("2001", String(currentYear));
  }

  // If no 4-digit year exists (e.g. "09 Sep" or "15 Oct"), append currentYear
  if (!/\b20\d\d\b/.test(clean)) {
    clean = `${clean} ${currentYear}`;
  }

  let d = new Date(clean);
  if (isNaN(d.getTime())) {
    d = new Date(`${clean} ${defaultHour}:00:00 GMT`);
  }
  if (isNaN(d.getTime())) return null;

  // Never allow legacy dates in the early 2000s
  if (d.getFullYear() < 2020) {
    d.setFullYear(currentYear);
  }
  return d;
}

// Helper to determine remaining time relative to real current time
export function getTimeRemaining(endingDateStr: string, startDateStr?: string | null, isLive?: boolean) {
  const nowTime = Date.now();

  // If live auction, show countdown to start if in future
  if (isLive && startDateStr) {
    const startDate = parseValidDate(startDateStr, 10);
    if (startDate) {
      const diffStart = startDate.getTime() - nowTime;
      if (diffStart > 0) {
        const days = Math.floor(diffStart / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        if (days > 1) return { text: `Live in ${days} days`, isUrgent: false, isExpired: false };
        if (days === 1) return { text: `Live Tomorrow`, isUrgent: false, isExpired: false };
        if (hours > 0) return { text: `Live in ${hours}h`, isUrgent: true, isExpired: false };
        return { text: `Live Today`, isUrgent: true, isExpired: false };
      }
    }
  }

  const endDate = parseValidDate(endingDateStr, 20);
  if (!endDate) {
    return { text: endingDateStr || "Upcoming", isUrgent: false, isExpired: false };
  }
  
  const diff = endDate.getTime() - nowTime;

  if (diff <= 0) {
    return { text: "Bidding Closed", isUrgent: false, isExpired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 2) {
    return { text: `${days} days left`, isUrgent: false, isExpired: false };
  } else if (days > 0) {
    return { text: `${days}d ${hours}h left`, isUrgent: false, isExpired: false };
  } else if (hours > 0) {
    return { text: `${hours}h ${minutes}m left`, isUrgent: true, isExpired: false };
  } else {
    return { text: `${Math.max(1, minutes)}m left`, isUrgent: true, isExpired: false };
  }
}

// Safe category string extractor helper
export function getCategoryString(category: any): string {
  if (!category) return "General";
  if (typeof category === "string") return category;
  if (typeof category === "object") {
    if (typeof category.name === "string") return category.name;
    if (category.name && typeof category.name.en === "string") return category.name.en;
    if (typeof category.title === "string") return category.title;
    if (category.title && typeof category.title.en === "string") return category.title.en;
    if (typeof category.en === "string") return category.en;
  }
  return String(category || "General");
}

// A lot is unpriced only if it has no confirmed current price, no starting price,
// and no guide estimate (truly blind autobid only, e.g. "Estimate: No Estimate")
export function isLotUnpriced(item: AuctionListing): boolean {
  const hasPrice = (typeof item.currentPrice === "number" && item.currentPrice > 0) ||
                   (typeof item.startPrice === "number" && item.startPrice > 0) ||
                   (Boolean(item.estimateStr) && item.estimateStr !== "£0 - £0" && item.estimateStr !== "$0 - $0");
  return !hasPrice;
}

// The price to show on a lot: current bid, else starting price, else the low estimate. Never 0.
export function getEffectiveBid(item: AuctionListing): number | null {
  let lowEstFromStr: number | null = null;
  if (item.estimateStr) {
    const match = item.estimateStr.match(/[\d,.]+/);
    if (match) {
      const parsed = parseFloat(match[0].replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0) lowEstFromStr = parsed;
    }
  }

  return (item.currentPrice != null && item.currentPrice > 0)
    ? item.currentPrice
    : (item.startPrice != null && item.startPrice > 0
        ? item.startPrice
        : lowEstFromStr);
}
