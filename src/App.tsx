import React, { useState, useEffect, useMemo } from "react";
import { AuctionListing, AuctionCluster, SearchReference, WatchlistItem } from "./types";
import { clusterListings } from "./utils/distance";
import AuctionMap from "./components/AuctionMap";
import AuctionList from "./components/AuctionList";
import { useAuth } from "./context/AuthContext";
import AuthModal from "./components/AuthModal";
import UserProfileModal from "./components/UserProfileModal";
import WatchlistModal from "./components/WatchlistModal";
import SearchAlertsModal from "./components/SearchAlertsModal";
import AdminPanelModal from "./components/AdminPanelModal";
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
  AlertTriangle,
  Bell,
  Star,
  Crown,
  ShieldCheck,
  User,
  LogIn,
  LogOut,
  Compass,
  Megaphone,
  X
} from "lucide-react";

export default function App() {
  // Authentication and Membership state
  const { 
    currentUser, 
    userProfile, 
    role, 
    isPro, 
    isAdmin, 
    watchlist, 
    searchAlerts, 
    announcements, 
    signOutUser 
  } = useAuth();

  // Modal dialog states
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "signup" | "demo">("signin");
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>([]);

  // Cluster radius (Standard is locked to 50; Pro/Admin can select 50, 100, 150, 250 miles)
  const [customRadius, setCustomRadius] = useState<number>(50);
  const effectiveRadius = isPro ? customRadius : 50;

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
  const [searchBreakdown, setSearchBreakdown] = useState<{ easyLiveAuction?: number; bpiAuctions?: number; atgNetwork?: number } | null>(null);
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
    let isMounted = true;
    const loadInitialAuctions = async (retryCount = 0) => {
      try {
        const res = await fetch("/api/auctions");
        const cType = res.headers.get("content-type") || "";
        if (!res.ok || !cType.includes("application/json")) {
          if (retryCount < 2) {
            setTimeout(() => {
              if (isMounted) loadInitialAuctions(retryCount + 1);
            }, 2500);
          }
          return;
        }
        const payload = await res.json();
        if (isMounted && payload.status === "success" && Array.isArray(payload.data)) {
          setListings(payload.data);
        }
      } catch (err) {
        if (retryCount < 2) {
          setTimeout(() => {
            if (isMounted) loadInitialAuctions(retryCount + 1);
          }, 2500);
        }
      }
    };

    loadInitialAuctions();
    return () => {
      isMounted = false;
    };
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
      } else if (selectedSource === "ATG") {
        matchesSource = itemId.startsWith("atg-") || itemAuctioneer.includes("bidspotter") || itemAuctioneer.includes("saleroom") || itemAuctioneer.includes("i-bidder");
      }

      return matchesKeyword && matchesCategory && matchesDate && matchesCountry && matchesSource;
    });
  }, [listings, activeSearchTerm, selectedCategory, selectedCountry, selectedSource, queryTime, biddingDeadline]);

  // Compute regional clusters dynamically from filtered listings based on membership radius
  const computedClusters = useMemo(() => {
    return clusterListings(filteredListings, effectiveRadius);
  }, [filteredListings, effectiveRadius]);

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

  // Filter listings further to the selected regional map cluster if clicked
  const finalDisplayListings = useMemo(() => {
    if (!selectedCluster) return filteredListings;
    
    // Find all listings within this cluster's representative radius
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
      "Executing ATG Media Network crawler (BidSpotter, The Saleroom, i-bidder)...",
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
      let response: Response;
      try {
        response = await fetch("/api/auctions/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: searchKw.trim() })
        });
      } catch {
        // Network connection hiccup, wait 2s and retry once
        await new Promise((r) => setTimeout(r, 2000));
        response = await fetch("/api/auctions/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: searchKw.trim() })
        });
      }

      // Check if response is HTML (e.g. 502/503/504 warmup page)
      let contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) {
        // Server may be initializing; wait 2.5s and retry once
        await new Promise((r) => setTimeout(r, 2500));
        response = await fetch("/api/auctions/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: searchKw.trim() })
        });
        contentType = response.headers.get("content-type") || "";
      }

      if (!response.ok || !contentType.includes("application/json")) {
        const text = await response.text();
        if (text.includes("warmup") || text.startsWith("<!doctype") || [502, 503, 504].includes(response.status)) {
          throw new Error("The search service is currently initializing. Please try your search again in a moment.");
        }
        throw new Error(`The search service returned status ${response.status}. Please try again.`);
      }

      const payload = await response.json();

      if (payload.status === "success") {
        if (payload.breakdown) {
          setSearchBreakdown(payload.breakdown);
        }
        // Fetch all in-memory auctions which now include the freshly scraped ones!
        try {
          const allRes = await fetch("/api/auctions");
          const allCtype = allRes.headers.get("content-type") || "";
          if (allRes.ok && allCtype.includes("application/json")) {
            const allPayload = await allRes.json();
            if (allPayload.status === "success" && Array.isArray(allPayload.data)) {
              setListings(allPayload.data);
            } else if (Array.isArray(payload.data)) {
              setListings(payload.data);
            }
          } else if (Array.isArray(payload.data)) {
            setListings(payload.data);
          }
        } catch {
          if (Array.isArray(payload.data)) {
            setListings(payload.data);
          }
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

  // Locate listing on map by selecting its containing cluster
  const handleViewOnMap = (listing: AuctionListing) => {
    // Find the cluster that contains this listing
    const cluster = computedClusters.find((c) => 
      c.listings.some((item) => item.id === listing.id)
    );
    if (cluster) {
      setSelectedCluster(cluster);
    }
  };

  // Focus and locate an item saved in Watchlist on the live map
  const handleLocateWatchlistItem = (item: WatchlistItem) => {
    const cluster = computedClusters.find((c) => 
      c.listings.some((l) => l.id === item.lotId)
    );
    if (cluster) {
      setSelectedCluster(cluster);
    } else {
      // Clear filters so the lot is visible
      setSelectedCountry("All");
      setSelectedCategory("All");
      setActiveSearchTerm("");
      const target = listings.find((l) => l.id === item.lotId);
      if (target) {
        setTimeout(() => {
          const cl = clusterListings([target], effectiveRadius)[0];
          if (cl) setSelectedCluster(cl);
        }, 50);
      }
    }
  };

  // Fast trigger automated scrape from Search Alert
  const handleExecuteSearchAlert = (term: string, cat: string) => {
    setKeyword(term);
    setActiveSearchTerm(term);
    if (cat && cat !== "All") {
      setSelectedCategory(cat);
    }
    handleScrape(term);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      {/* Brand Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 sticky top-0 shadow-xs gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="bg-blue-600 p-2 rounded-lg shadow-xs">
            <Hammer className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 leading-none">
              HAMMER<span className="text-blue-600">POINT</span>
            </h1>
            <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase font-semibold hidden md:inline">
              Auction Intelligence
            </span>
          </div>
        </div>

        {/* Search Bar / Trigger Web Scraper */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleScrape(keyword);
          }} 
          className="flex-1 max-w-xl mx-2 sm:mx-6 flex gap-2"
        >
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Search machinery, fleet, restaurant, tech lots..." 
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full bg-slate-100 border border-slate-300 rounded-xl py-2 pl-9 pr-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          </div>
          <button 
            type="submit"
            disabled={isLoading || !keyword.trim()}
            className="bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shrink-0 cursor-pointer shadow-xs"
          >
            Scrape Web
          </button>
        </form>

        {/* Right Actions & Role-Based Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Search Alerts Button */}
          <button
            onClick={() => setIsAlertsOpen(true)}
            className="relative p-2 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Manage Search Alerts & Monitoring"
          >
            <Bell className="w-4 h-4" />
            {searchAlerts.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {searchAlerts.length}
              </span>
            )}
          </button>

          {/* Watchlist Button */}
          <button
            onClick={() => setIsWatchlistOpen(true)}
            className="relative p-2 sm:px-3 sm:py-1.5 rounded-xl text-slate-700 hover:text-amber-700 hover:bg-amber-50/60 border border-transparent hover:border-amber-200 transition-all cursor-pointer flex items-center gap-1.5"
            title="Saved Lots Watchlist"
          >
            <Star className={`w-4 h-4 ${watchlist.length > 0 ? "fill-amber-400 text-amber-500" : "text-slate-500"}`} />
            <span className="hidden md:inline text-xs font-bold">Watchlist</span>
            {watchlist.length > 0 && (
              <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {watchlist.length}
              </span>
            )}
          </button>

          {/* Admin Console Shortcut Button (visible to Admin role) */}
          {isAdmin && (
            <button
              onClick={() => setIsAdminPanelOpen(true)}
              className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-bold transition-colors cursor-pointer"
              title="Open Admin Dashboard & User Management"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin Console</span>
            </button>
          )}

          {/* User Account / Membership Badge */}
          {currentUser || userProfile ? (
            <button
              onClick={() => setIsProfileModalOpen(true)}
              className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200/80 transition-colors cursor-pointer border border-slate-200 shadow-2xs"
              title="Click to manage profile, membership tier, or sign out"
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-2xs ${
                isAdmin 
                  ? "bg-indigo-600" 
                  : isPro 
                    ? "bg-purple-600" 
                    : "bg-blue-600"
              }`}>
                {isAdmin ? "👑" : isPro ? "⭐" : "HP"}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[100px]">
                  {userProfile?.displayName || "Member"}
                </div>
                <div className={`text-[9px] font-bold uppercase tracking-wider leading-none mt-0.5 ${
                  isAdmin 
                    ? "text-indigo-600" 
                    : isPro 
                      ? "text-purple-600" 
                      : "text-slate-500"
                }`}>
                  {isAdmin ? "Admin" : isPro ? "Pro Buyer" : "Standard"}
                </div>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setAuthModalTab("signin");
                  setIsAuthModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </button>

              <button
                onClick={() => {
                  setAuthModalTab("demo");
                  setIsAuthModalOpen(true);
                }}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 text-xs font-bold transition-colors cursor-pointer"
                title="Explore instantly with 1-click Demo Personas"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" /> Demo
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Live Platform Announcement Banner */}
      {announcements.filter(a => a.active && !dismissedAnnouncements.includes(a.id)).map((ann) => (
        <div
          key={ann.id}
          className={`px-6 py-2 flex items-center justify-between text-xs font-medium border-b shrink-0 ${
            ann.type === "warning"
              ? "bg-amber-500 text-slate-950 border-amber-600 font-semibold"
              : ann.type === "success"
                ? "bg-emerald-700 text-white border-emerald-800"
                : "bg-indigo-900 text-white border-indigo-950"
          }`}
        >
          <div className="flex items-center gap-2 max-w-5xl truncate">
            <Megaphone className="w-4 h-4 shrink-0 text-white animate-pulse" />
            <span className="font-bold uppercase tracking-wider text-[9px] bg-black/25 px-1.5 py-0.5 rounded text-white">
              {ann.type}
            </span>
            <span className="font-bold">{ann.title}:</span>
            <span className="opacity-95 truncate">{ann.content}</span>
          </div>
          <button
            onClick={() => setDismissedAnnouncements(prev => [...prev, ann.id])}
            className="ml-4 opacity-75 hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/10 cursor-pointer"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

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
                  { id: "ATG", label: "ATG Network", icon: "🟣" }
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

            {/* Regional Clustering Radius (Role-Based Scope) */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                  <Compass className="w-3.5 h-3.5 text-blue-600" /> Regional Cluster Radius
                </span>
                {!isPro && (
                  <button
                    onClick={() => {
                      setAuthModalTab("demo");
                      setIsAuthModalOpen(true);
                    }}
                    className="text-[10px] text-purple-600 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <Crown className="w-3 h-3 text-amber-500" /> Unlock 100-250 mi
                  </button>
                )}
                {isPro && (
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                    ⭐ Pro Unlocked ({effectiveRadius} mi)
                  </span>
                )}
              </div>
              <div className="flex gap-2 pt-0.5 font-sans">
                {[50, 100, 150, 250].map((rad) => {
                  const isAvailable = isPro || rad === 50;
                  const isSelected = effectiveRadius === rad;
                  return (
                    <button
                      key={rad}
                      onClick={() => {
                        if (!isAvailable) {
                          setAuthModalTab("demo");
                          setIsAuthModalOpen(true);
                          return;
                        }
                        setCustomRadius(rad);
                        setSelectedCluster(null);
                      }}
                      className={`flex-1 py-1.5 px-2 rounded text-xs font-bold transition-all text-center ${
                        isSelected
                          ? "bg-slate-900 text-white shadow-xs"
                          : isAvailable
                            ? "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 cursor-pointer"
                            : "bg-slate-50 text-slate-400 cursor-pointer border border-dashed border-slate-200 hover:bg-purple-50 hover:text-purple-600"
                      }`}
                      title={!isAvailable ? "Click to unlock Pro Membership" : `${rad} miles radius clustering`}
                    >
                      {rad} mi {!isAvailable && "🔒"}
                    </button>
                  );
                })}
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
                    ATG Network: {searchBreakdown.atgNetwork ?? 0} lots
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

      {/* Role-Based Membership & Authentication Modals */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultTab={authModalTab}
      />

      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onOpenAdminPanel={() => setIsAdminPanelOpen(true)}
      />

      <WatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onLocateListing={handleLocateWatchlistItem}
        onOpenUpgrade={() => {
          setAuthModalTab("signup");
          setIsAuthModalOpen(true);
        }}
      />

      <SearchAlertsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        onExecuteSearch={handleExecuteSearchAlert}
      />

      <AdminPanelModal
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
      />
    </div>
  );
}
