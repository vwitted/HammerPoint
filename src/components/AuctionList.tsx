import React, { useState } from "react";
import { AuctionListing, AuctionCluster } from "../types";
import { useAuth } from "../context/AuthContext";
import { 
  Calendar, 
  MapPin, 
  ExternalLink, 
  Tag, 
  Building2, 
  Clock, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MapIcon,
  Star
} from "lucide-react";

interface AuctionListProps {
  listings: AuctionListing[];
  selectedCluster: AuctionCluster | null;
  onClusterSelect: (cluster: AuctionCluster | null) => void;
  onListingSelect: (listing: AuctionListing) => void;
  onViewOnMap: (listing: AuctionListing) => void;
  activeSearchTerm: string;
  selectedCategory: string;
}

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

// Category tag styling helper matching the Professional Polish palette
function getCategoryBadgeClass(category: any) {
  const cat = getCategoryString(category).toLowerCase();
  if (cat.includes("rest") || cat.includes("cater")) {
    return "bg-amber-50 text-amber-700 border-amber-200/60";
  } else if (cat.includes("ind") || cat.includes("mfg") || cat.includes("machin")) {
    return "bg-blue-50 text-blue-700 border-blue-200/60";
  } else if (cat.includes("tech") || cat.includes("off") || cat.includes("electr")) {
    return "bg-purple-50 text-purple-700 border-purple-200/60";
  } else if (cat.includes("med") || cat.includes("lab")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200/60";
  } else if (cat.includes("veh") || cat.includes("fleet") || cat.includes("car") || cat.includes("van") || cat.includes("truck")) {
    return "bg-rose-50 text-rose-700 border-rose-200/60";
  } else if (cat.includes("estate") || cat.includes("land") || cat.includes("furnit")) {
    return "bg-teal-50 text-teal-700 border-teal-200/60";
  } else {
    return "bg-slate-50 text-slate-700 border-slate-200/60";
  }
}

export default function AuctionList({
  listings,
  selectedCluster,
  onClusterSelect,
  onViewOnMap,
  activeSearchTerm,
  selectedCategory
}: AuctionListProps) {
  const { isLotWatchlisted, addToWatchlist, removeFromWatchlist } = useAuth();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const formatDate = (isoString?: string | null) => {
    try {
      if (!isoString) return "Upcoming";
      const date = parseValidDate(isoString);
      if (!date) return isoString;
      
      return date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return isoString || "Upcoming";
    }
  };

  const isLotUnpriced = (item: AuctionListing) => {
    if (item.isUnpriced === true) return true;
    const hasPrice = (typeof item.currentPrice === "number" && item.currentPrice > 0) ||
                     (typeof item.startPrice === "number" && item.startPrice > 0) ||
                     (Boolean(item.estimateStr) && item.estimateStr !== "£0 - £0");
    return !hasPrice;
  };

  const pricedListings = listings.filter(item => !isLotUnpriced(item));
  const unpricedListings = listings.filter(item => isLotUnpriced(item));

  const renderLotItem = (item: AuctionListing, isUnpricedLot: boolean) => {
    const isExpanded = expandedId === item.id;
    const timeInfo = getTimeRemaining(item.endingDate, item.startDate, item.auctionType === "Live");

    return (
      <div 
        key={item.id} 
        className={`p-4 transition-colors duration-150 border-l-4 hover:bg-blue-50/30 ${
          timeInfo.isUrgent 
            ? "border-l-red-500 bg-red-50/10" 
            : isExpanded
              ? "border-l-blue-600 bg-blue-50/10"
              : "border-l-transparent"
        }`}
      >
        <div className="flex gap-4">
          {/* Default photo embed */}
          {item.imageUrl && (
            <div 
              onClick={() => toggleExpand(item.id)}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shrink-0 self-start shadow-xs cursor-pointer group relative"
            >
              <img 
                src={item.imageUrl} 
                alt={item.title} 
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  const target = e.currentTarget;
                  const originalUrl = item.imageUrl;
                  if (originalUrl && originalUrl.startsWith("http") && !target.src.includes("/api/proxy/image")) {
                    target.src = `/api/proxy/image?url=${encodeURIComponent(originalUrl)}`;
                  } else {
                    target.src = "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80";
                  }
                }}
              />
              <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Header Summary */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 items-center mb-1">
                  {/* Country Flag Badge */}
                  <span className="inline-flex items-center text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                    {item.country === "UK" ? "🇬🇧 UK" : "🇺🇸 US"}
                  </span>
                  {/* Platform Badge */}
                  {item.id.startsWith("easylive") ? (
                    <span className="inline-flex items-center text-[10px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">
                      Easy Live
                    </span>
                  ) : item.id.startsWith("bpilot") ? (
                    <span className="inline-flex items-center text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
                      BPI / Artisio
                    </span>
                  ) : item.id.startsWith("atg-") ? (
                    <span className="inline-flex items-center text-[10px] font-bold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200">
                      {item.auctioneer || "ATG Media"}
                    </span>
                  ) : item.id.startsWith("hibid") ? (
                    <span className="inline-flex items-center text-[10px] font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">
                      HiBid
                    </span>
                  ) : item.id.startsWith("svd") ? (
                    <span className="inline-flex items-center text-[10px] font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">
                      SVD
                    </span>
                  ) : null}
                  {/* Category Badge */}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tracking-wider uppercase ${getCategoryBadgeClass(item.category)}`}>
                    {getCategoryString(item.category)}
                  </span>
                  {/* Auctioneer Badge */}
                  <span className="inline-flex items-center text-[11px] text-slate-500 font-bold uppercase tracking-tight">
                    {item.auctioneer}
                  </span>
                </div>

                <h4 
                  className="font-bold text-slate-900 text-sm md:text-base tracking-tight leading-snug hover:text-blue-600 transition-colors cursor-pointer" 
                  onClick={() => toggleExpand(item.id)}
                >
                  {item.title}
                </h4>
              </div>

              {/* Time / Countdown & Current Price Block */}
              <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {/* Watchlist Star Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLotWatchlisted(item.id)) {
                        removeFromWatchlist(item.id);
                      } else {
                        addToWatchlist(item);
                      }
                    }}
                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                      isLotWatchlisted(item.id)
                        ? "bg-amber-50 text-amber-500 hover:bg-amber-100"
                        : "text-slate-300 hover:text-amber-500 hover:bg-slate-100"
                    }`}
                    title={isLotWatchlisted(item.id) ? "Saved in Watchlist (Click to remove)" : "Save to Watchlist"}
                  >
                    <Star className={`w-4 h-4 ${isLotWatchlisted(item.id) ? "fill-amber-400 text-amber-500" : ""}`} />
                  </button>

                  {/* Estimate badge */}
                  {item.estimateStr && (
                    <div className="font-sans font-bold text-slate-700 text-xs sm:text-sm bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                      <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Est:</span>
                      <span>{item.estimateStr}</span>
                    </div>
                  )}

                  {/* Bid badge: show opening bid or current bid. Never show £0 */}
                  {(() => {
                    const effectiveBid = (item.currentPrice != null && item.currentPrice > 0)
                      ? item.currentPrice
                      : (item.startPrice != null && item.startPrice > 0 ? item.startPrice : null);

                    if (effectiveBid != null) {
                      const label = item.bidLabel ? item.bidLabel.replace(/:$/, "") : "Bid";
                      return (
                        <div className="font-sans font-bold text-emerald-700 text-xs sm:text-sm bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                          <span className="text-[9px] uppercase font-bold text-emerald-600/80 tracking-wider">{label}:</span>
                          <span>{item.country === "UK" ? "£" : "$"}{effectiveBid.toLocaleString()}</span>
                        </div>
                      );
                    }

                    // If neither price nor estimate is present, render unpriced badge
                    if (!item.estimateStr) {
                      return (
                        <span className="font-sans text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-md">
                          Unpriced / Autobid only
                        </span>
                      );
                    }

                    return null;
                  })()}
                  
                  {/* Reserve: ONLY show if reserve is strictly in place above the opening bid */}
                  {(() => {
                    const opening = (item.currentPrice != null && item.currentPrice > 0)
                      ? item.currentPrice
                      : (item.startPrice != null && item.startPrice > 0 ? item.startPrice : 0);
                    if (item.reserve != null && item.reserve > opening) {
                      return (
                        <div className="font-sans font-bold text-purple-700 text-xs sm:text-sm bg-purple-50 border border-purple-200/60 px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                          <span className="text-[9px] uppercase font-bold text-purple-600/80 tracking-wider">Res:</span>
                          <span>{item.country === "UK" ? "£" : "$"}{item.reserve.toLocaleString()}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  timeInfo.isExpired
                    ? "bg-slate-100 text-slate-500"
                    : timeInfo.isUrgent
                      ? "bg-red-50 text-red-600 border border-red-200/50 animate-pulse"
                      : "bg-blue-50 text-blue-600 border border-blue-200/50"
                }`}>
                  <Clock className="w-3 h-3" />
                  {timeInfo.text}
                </div>
              </div>
            </div>

            {/* Subtitle / Address Summary */}
            <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1 truncate max-w-[150px] sm:max-w-[240px] md:max-w-[300px]">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {item.address}
              </span>
              {!isExpanded && (
                <button 
                  onClick={() => toggleExpand(item.id)}
                  className="text-[11px] text-blue-600 hover:text-blue-700 font-bold"
                >
                  Details
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Details Section */}
        {isExpanded ? (
          <div className="mt-3 pt-3 border-t border-slate-150 text-xs text-slate-600 space-y-3">
            <p className="leading-relaxed bg-slate-50 p-3 rounded border border-slate-200/60 text-slate-700">
              {item.details}
            </p>
            
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11px] text-slate-500">
                <span className="font-bold text-slate-700">{item.auctionType === "Live" ? "Auction Date:" : "Deadline:"}</span>{" "}
                {formatDate(item.auctionType === "Live" && item.startDate ? item.startDate : item.endingDate)}
                {isUnpricedLot && (
                  <span className="ml-2 inline-flex items-center text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 px-1.5 py-0.5 rounded font-medium">
                    No published estimate/starting bid (Open for public viewing & autobid)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Map focus button */}
                <button
                  onClick={() => onViewOnMap(item)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100/80 transition-colors"
                >
                  <MapIcon className="w-3.5 h-3.5" /> Locate
                </button>
                
                {/* External original link */}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  referrerPolicy="no-referrer"
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold text-white transition-colors shadow-xs ${
                    item.id.startsWith("hibid")
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {item.id.startsWith("hibid") ? "View Lot on HiBid" : "Official Bidding"} <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {/* Quick Toggle Handler */}
        <button 
          onClick={() => toggleExpand(item.id)}
          className="mt-2 w-full flex items-center justify-center text-slate-400 hover:text-slate-600 py-0.5 rounded transition-colors"
          aria-label={isExpanded ? "Collapse item" : "Expand item"}
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4 opacity-50" />
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Cluster Active Filter Indicator with Blue styling */}
      {selectedCluster && (
        <div className="bg-blue-50 border-b border-blue-100 p-3 flex items-center justify-between text-xs text-blue-900 font-medium">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
            Filtering by region around: <strong className="text-blue-950 font-bold max-w-[200px] truncate block md:inline">{selectedCluster.centerAddress}</strong>
          </span>
          <button
            onClick={() => onClusterSelect(null)}
            className="text-[11px] font-bold text-blue-700 hover:text-blue-900 bg-blue-100/80 hover:bg-blue-200/80 px-2.5 py-1 rounded transition-colors"
          >
            Clear region
          </button>
        </div>
      )}

      {/* Header Info */}
      <div className="p-4 border-b border-slate-150 bg-slate-50/80 flex items-center justify-between">
        <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
          <span>
            {activeSearchTerm 
              ? `Results for "${activeSearchTerm}"` 
              : selectedCategory !== "All" 
                ? `${selectedCategory} Lots` 
                : "All Curated Lots"}
          </span>
          <span className="bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-md text-xs font-mono font-bold">
            {listings.length}
          </span>
        </h3>
        <span className="text-xs text-slate-400 font-medium">
          Ends in local times
        </span>
      </div>

      {/* Listing Content Scroll Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {listings.length === 0 ? (
          <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full min-h-[260px]">
            <AlertTriangle className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-700">No auctions match current filters</p>
            <p className="text-xs text-slate-500 mt-2 max-w-[280px] leading-relaxed">
              If you have set strict bidding deadlines or category constraints, try expanding them. You can also clear any active region filters, or enter a new keyword above to launch a real-time web search.
            </p>
          </div>
        ) : (
          <>
            {/* Primary Priced Lots */}
            {pricedListings.map(item => renderLotItem(item, false))}

            {/* Subheading for Upcoming Lots without Price Information */}
            {unpricedListings.length > 0 && (
              <div className="bg-slate-50/95 border-y border-slate-200 px-4 py-3 sticky top-0 z-10 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-xs tracking-wider uppercase">
                      Upcoming — without price information
                    </span>
                    <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                      {unpricedListings.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
                    Scheduled for viewing / blind autobid
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                  These upcoming lots have scheduled viewing dates or blind autobid forms, but no starting price or estimate published yet (open for viewing or blind autobid only).
                </p>
              </div>
            )}

            {/* Deprioritised Unpriced Lots */}
            {unpricedListings.map(item => renderLotItem(item, true))}
          </>
        )}
      </div>
    </div>
  );
}
