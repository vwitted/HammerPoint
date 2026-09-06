import React, { useState, useEffect, useMemo } from "react";
import { AuctionListing, AuctionCluster, SearchReference } from "./types";
import { clusterListings } from "./utils/distance";
import AuctionMap from "./components/AuctionMap";
import AuctionList from "./components/AuctionList";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  Sparkles, 
  Calendar, 
  Filter, 
  RefreshCw, 
  SlidersHorizontal,
  Layers, 
  MapPin, 
  Info,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Hammer,
  AlertTriangle
} from "lucide-react";

export default function App() {
  // Query state
  const [keyword, setKeyword] = useState("");
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  
  // Date range state (Query Time -> Bidding Deadline)
  // Dynamically initialize query time to current time
  const [queryTime, setQueryTime] = useState(() => {
    return new Date().toISOString().slice(0, 16);
  });
  // Default bidding deadline to 45 days in the future to capture all upcoming lots
  const [biddingDeadline, setBiddingDeadline] = useState(() => {
    return new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 16);
  });

  // Selected Category filter
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Selected Country filter
  const [selectedCountry, setSelectedCountry] = useState<string>("UK"); // "All", "US", "UK"

  // Selected Platform / Source filter
  const [selectedSource, setSelectedSource] = useState<string>("All"); // "All", "EasyLive", "BPI", "BidSpotter"

  // Loaded listings state
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [searchBreakdown, setSearchBreakdown] = useState<{ easyLiveAuction?: number; bpiAuctions?: number; bidspotterUk?: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [scrapeStep, setScrapeStep] = useState("");
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  
  // Selected map region cluster
  const [selectedCluster, setSelectedCluster] = useState<AuctionCluster | null>(null);

  // Scraper source references
  const [sourceReferences, setSourceReferences] = useState<SearchReference[]>([]);

  // Categories list
  const categories = ["All", "Industrial", "Restaurant", "Tech & Office", "Medical", "Vehicles", "Real Estate", "Retail", "Machinery", "Furniture", "Catering", "Electronics"];

  // Load initial listings on mount
  useEffect(() => {
    fetch("/api/auctions")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.status === "success") {
          setListings(payload.data);
        }
      })
      .catch((err) => console.error("Error loading base auctions:", err));
  }, []);

  // Helper to extract safe string representation from any field
  const safeStr = (val: any): string => {
    if (typeof val === "string") return val;
    if (!val) return "";
    if (typeof val === "object") {
      if (typeof val.en === "string") return val.en;
      if (typeof val.name === "string") return val.name;
      if (val.name && typeof val.name.en === "string") return val.name.en;
      if (typeof val.title === "string") return val.title;
    }
    return String(val);
  };

  // Filter listings based on (1) active search term/keyword, (2) category, (3) source platform, and (4) date bounds
  const filteredListings = useMemo(() => {
    const queryDate = new Date(queryTime).getTime();
    const deadlineDate = new Date(biddingDeadline).getTime();

    return listings.filter((item) => {
      const itemTitle = safeStr(item.title).toLowerCase();
      const itemDetails = safeStr(item.details).toLowerCase();
      const itemAddress = safeStr(item.address).toLowerCase();
      const itemAuctioneer = safeStr(item.auctioneer).toLowerCase();
      const itemCategory = safeStr(item.category);
      const itemCategoryLower = itemCategory.toLowerCase();

      // 1. Keyword search (title, details, address, auctioneer, or category)
      const matchesKeyword = activeSearchTerm
        ? activeSearchTerm.toLowerCase().split(/\s+/).filter(Boolean).every(term => 
            itemTitle.includes(term) ||
            itemDetails.includes(term) ||
            itemAddress.includes(term) ||
            itemAuctioneer.includes(term) ||
            itemCategoryLower.includes(term)
          )
        : true;

      // 2. Category filter
      const matchesCategory = selectedCategory === "All" || itemCategory.toLowerCase().includes(selectedCategory.toLowerCase()) || selectedCategory.toLowerCase().includes(itemCategoryLower);

      // 3. Ending date bounds (Ending between Query Time and Bidding Deadline)
      const itemEnd = new Date(item.endingDate).getTime();
      const matchesDate = isNaN(itemEnd) ? true : (itemEnd >= queryDate && itemEnd <= deadlineDate);

      // 4. Country filter
      const matchesCountry = selectedCountry === "All" || item.country === selectedCountry;

      // 5. Source Platform filter
      let matchesSource = true;
      const itemId = safeStr(item.id);
      if (selectedSource === "EasyLive") {
        matchesSource = itemId.startsWith("easylive") || itemAuctioneer.includes("easy live");
      } else if (selectedSource === "BPI") {
        matchesSource = itemId.startsWith("bpilot") || itemAuctioneer.includes("bpi");
      } else if (selectedSource === "BidSpotter") {
        matchesSource = itemId.startsWith("bs-") || itemAuctioneer.includes("bidspotter");
      }

      return matchesKeyword && matchesCategory && matchesDate && matchesCountry && matchesSource;
    });
  }, [listings, activeSearchTerm, selectedCategory, selectedCountry, selectedSource, queryTime, biddingDeadline]);

  // Compute 50-mile clusters dynamically from the filtered listings
  const computedClusters = useMemo(() => {
    return clusterListings(filteredListings, 50);
  }, [filteredListings]);

  // Sync selected cluster if filtered listings change
  useEffect(() => {
    if (selectedCluster) {
      // Find the corresponding updated cluster in the new list, or clear if empty
      const updated = computedClusters.find((c) => c.id === selectedCluster.id);
      if (updated) {
        setSelectedCluster(updated);
      } else {
        setSelectedCluster(null);
      }
    }
  }, [computedClusters]);

  // Filter listings further to the selected 50-mile map cluster if clicked
  const finalDisplayListings = useMemo(() => {
    if (!selectedCluster) return filteredListings;
    
    // Find all listings within 50 miles of this cluster's representative coordinate
    return filteredListings.filter((item) => {
      return selectedCluster.listings.some((cItem) => cItem.id === item.id);
    });
  }, [filteredListings, selectedCluster]);

  // Handle live scraping via Gemini Google Search grounding
  const handleScrape = async (overrideKeyword: string) => {
    const searchKw = typeof overrideKeyword === 'string' ? overrideKeyword : keyword;
    if (!searchKw.trim()) return;
 
    setIsLoading(true);
    setScrapeStep("Initializing scrape...");
    setScrapeError(null);
    
    // Set active search term on client so lists filter immediately
    setActiveSearchTerm(searchKw.trim());
    setSelectedCluster(null); // Clear selected region to show everything matching new search
 
    // Visual sequence of comforting loading steps
    const steps = [
      "Connecting to Easy Live Auction Algolia Search API (130k+ lots)...",
      "Querying BPI Auctions via Artisio REST API with compliant headers...",
      "Executing BidSpotter UK live lot crawler...",
      "Extracting physical asset locations and geocoding coordinates across UK regions...",
      "Aggregating real lots and calculating bidding deadlines..."
    ];
 
    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < steps.length) {
        setScrapeStep(steps[stepIndex]);
        stepIndex++;
      }
    }, 1200);
 
    try {
      const response = await fetch("/api/auctions/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: searchKw.trim() })
      });
      const payload = await response.json();
 
      if (payload.status === "success") {
        if (payload.breakdown) {
          setSearchBreakdown(payload.breakdown);
        }
        // Fetch all in-memory auctions which now include the freshly scraped ones!
        const allRes = await fetch("/api/auctions");
        const allPayload = await allRes.json();
        if (allPayload.status === "success") {
          setListings(allPayload.data);
        }
 
        if (payload.references) {
          setSourceReferences(payload.references);
        }
      } else {
        setScrapeError(payload.error || "A web-scraping error occurred.");
        if (payload.references) {
          setSourceReferences(payload.references);
        }
      }
    } catch (err: any) {
      console.error("Scrape error:", err);
      setScrapeError(err?.message || "A network or server error occurred during web search.");
    } finally {
      clearInterval(interval);
      setIsLoading(false);
      setScrapeStep("");
    }
  };

  // Locate listing on map by selecting its containing 50-mile cluster
  const handleViewOnMap = (listing: AuctionListing) => {
    // Find the cluster that contains this listing
    const cluster = computedClusters.find((c) => 
      c.listings.some((item) => item.id === listing.id)
    );
    if (cluster) {
      setSelectedCluster(cluster);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      {/* Brand Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-20 sticky top-0 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-md">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">HAMMER<span className="text-blue-600">POINT</span></h1>
        </div>

        {/* Search Bar / Trigger Web Scraper */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleScrape(keyword);
          }} 
          className="flex-1 max-w-2xl mx-12 flex gap-2"
        >
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Search machinery, fleet, restaurant, tech lots..." 
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full bg-slate-100 border border-slate-300 rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          </div>
          <button 
            type="submit"
            disabled={isLoading || !keyword.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shrink-0 cursor-pointer"
          >
            Scrape Web
          </button>
        </form>

        {/* Global Reference Info */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-slate-500 font-medium">Active Monitors</p>
            <p className="text-sm font-bold text-slate-800">{listings.length} Listings</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center font-bold text-xs">HP</div>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        
        {/* Left Column (Filters & Listing Grid) */}
        <div className="lg:col-span-5 flex flex-col gap-6 overflow-hidden">
          
          {/* Advanced Filter Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-semibold text-slate-800 text-xs flex items-center gap-1.5 uppercase tracking-wider font-mono">
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600" /> Filtering Parameters
              </h3>
              {(activeSearchTerm || selectedCategory !== "All" || selectedCountry !== "All") && (
                <button
                  onClick={() => {
                    setKeyword("");
                    setActiveSearchTerm("");
                    setSelectedCategory("All");
                    setSelectedCountry("All");
                    setSelectedCluster(null);
                  }}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-bold"
                >
                  Reset filters
                </button>
              )}
            </div>

            {/* Country Quick Filter Pills */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Country Focus
              </span>
              <div className="flex gap-2 pt-0.5 font-sans">
                {["All", "US", "UK"].map((countryCode) => (
                  <button
                    key={countryCode}
                    onClick={() => {
                      setSelectedCountry(countryCode);
                      setSelectedCluster(null); // Clear selected region cluster
                    }}
                    className={`flex-1 py-1.5 px-3 rounded text-xs font-bold transition-all cursor-pointer text-center ${
                      selectedCountry === countryCode
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    {countryCode === "All" ? "🌍 All Countries" : countryCode === "US" ? "🇺🇸 US" : "🇬🇧 UK"}
                  </button>
                ))}
              </div>
            </div>

            {/* Auction Source / Connected API Selector */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Layers className="w-3.5 h-3.5 text-slate-400" /> Live UK Source / Engine
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-0.5 font-sans">
                {[
                  { id: "All", label: "All APIs", icon: "⚡" },
                  { id: "EasyLive", label: "Easy Live", icon: "🟢" },
                  { id: "BPI", label: "BPI / Artisio", icon: "🔵" },
                  { id: "BidSpotter", label: "BidSpotter", icon: "🟣" }
                ].map((src) => (
                  <button
                    key={src.id}
                    onClick={() => setSelectedSource(src.id)}
                    className={`py-1.5 px-2 rounded text-[11px] font-bold transition-all cursor-pointer text-center truncate ${
                      selectedSource === src.id
                        ? "bg-slate-900 text-white shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    <span className="mr-1">{src.icon}</span>
                    {src.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date-Time Range Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 font-mono">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Query Time (Start)
                </label>
                <input
                  type="datetime-local"
                  value={queryTime}
                  onChange={(e) => setQueryTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:bg-white focus:border-blue-500 transition-colors outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 font-mono">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Bidding Deadline (End)
                </label>
                <input
                  type="datetime-local"
                  value={biddingDeadline}
                  onChange={(e) => setBiddingDeadline(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:bg-white focus:border-blue-500 transition-colors outline-none"
                />
              </div>
            </div>

            {/* Category Quick Filter Pills */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 font-mono">
                <Filter className="w-3.5 h-3.5 text-slate-400" /> Category Filter
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-0.5 font-sans">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scrape / Status Banner */}
          <AnimatePresence mode="wait">
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-lg flex items-center gap-3"
              >
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold font-mono text-blue-400 uppercase tracking-wider animate-pulse">
                    Web Scraping Engine Active
                  </p>
                  <p className="text-[11px] text-slate-300 mt-1 truncate">
                    {scrapeStep}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrape Error Message */}
          <AnimatePresence>
            {scrapeError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 text-red-800 p-4 rounded-xl border border-red-200/80 shadow-xs flex flex-col gap-1.5 overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-2 items-center font-bold text-red-700">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>Search / Scrape Alert</span>
                  </div>
                  <button
                    onClick={() => setScrapeError(null)}
                    className="text-slate-400 hover:text-slate-600 font-bold text-lg leading-none"
                    aria-label="Dismiss alert"
                  >
                    &times;
                  </button>
                </div>
                <p className="text-slate-600 leading-relaxed font-medium">{scrapeError}</p>
                <div className="text-[10px] text-red-600/95 font-mono flex flex-col gap-1 pt-1.5 border-t border-red-100">
                  <span className="font-bold">Real Data Policy Enabled:</span>
                  <span>All simulated/mock fallback listings have been disabled. Use the scraper verification links below to query real auction engines manually!</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active Search Term Indicator */}
          {activeSearchTerm && (
            <div className="bg-slate-900 text-white rounded-xl p-3 flex flex-col gap-2 text-xs border border-slate-800 shadow-xs">
              <div className="flex items-center justify-between">
                <span>
                  Active query: <strong className="text-blue-400 font-bold">"{activeSearchTerm}"</strong> ({filteredListings.length} matching)
                </span>
                <button
                  onClick={() => {
                    setKeyword("");
                    setActiveSearchTerm("");
                    setSearchBreakdown(null);
                  }}
                  className="font-bold text-slate-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
              {searchBreakdown && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800 text-[10px]">
                  <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded">
                    EasyLive: {searchBreakdown.easyLiveAuction ?? 0} lots
                  </span>
                  <span className="bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded">
                    BPI / Artisio: {searchBreakdown.bpiAuctions ?? 0} lots
                  </span>
                  <span className="bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                    BidSpotter: {searchBreakdown.bidspotterUk ?? 0} lots
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Listings List Display */}
          <div className="flex-1 overflow-hidden min-h-[350px]">
            <AuctionList
              listings={finalDisplayListings}
              selectedCluster={selectedCluster}
              onClusterSelect={setSelectedCluster}
              onListingSelect={(listing) => handleViewOnMap(listing)}
              onViewOnMap={(listing) => handleViewOnMap(listing)}
              activeSearchTerm={activeSearchTerm}
              selectedCategory={selectedCategory}
            />
          </div>
        </div>

        {/* Right Column (Map Representation & Sources Panel) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Map Viewer Component */}
          <div className="flex-1 min-h-[400px] lg:min-h-[500px]">
            <AuctionMap
              clusters={computedClusters}
              selectedCluster={selectedCluster}
              onClusterSelect={setSelectedCluster}
              onListingSelect={handleViewOnMap}
            />
          </div>

          {/* Grounding Source Web Links Panel */}
          <AnimatePresence>
            {sourceReferences.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs"
              >
                <h4 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                  <Info className="w-3.5 h-3.5 text-emerald-500" /> Scraper Verification References
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {sourceReferences.slice(0, 4).map((ref, idx) => (
                    <a
                      key={idx}
                      href={ref.url}
                      target="_blank"
                      rel="noreferrer"
                      referrerPolicy="no-referrer"
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-emerald-200 text-slate-700 hover:text-emerald-950 hover:bg-emerald-50/20 transition-all flex items-center justify-between group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[11px] truncate group-hover:text-emerald-900 transition-colors">
                          {ref.title}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {ref.url}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-all transform group-hover:translate-x-0.5 shrink-0 ml-2" />
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
