import React, { useState } from "react";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { WatchlistItem } from "../types";
import { getTimeRemaining } from "../utils/lotDisplay";
import { 
  X, 
  Star, 
  Trash2, 
  ExternalLink, 
  MapPin, 
  Download, 
  Clock, 
  Crown, 
  Coins, 
  Check,
  Building2
} from "lucide-react";

interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLocateListing: (item: WatchlistItem) => void;
  onOpenUpgrade?: () => void;
}

export default function WatchlistModal({ 
  isOpen, 
  onClose, 
  onLocateListing,
  onOpenUpgrade 
}: WatchlistModalProps) {
  const { 
    watchlist, 
    removeFromWatchlist, 
    updateWatchlistItem,
    isPro,
  } = useAuth();

  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [tempNotes, setTempNotes] = useState("");
  const [tempMaxBid, setTempMaxBid] = useState<number | undefined>(undefined);

  if (!isOpen) return null;

  const startEditNotes = (item: WatchlistItem) => {
    setEditingNotesId(item.lotId);
    setTempNotes(item.notes || "");
    setTempMaxBid(item.myMaxBid);
  };

  const saveNotes = async (lotId: string) => {
    await updateWatchlistItem(lotId, tempNotes, tempMaxBid);
    setEditingNotesId(null);
  };

  const exportToCsv = () => {
    if (!isPro) {
      if (onOpenUpgrade) onOpenUpgrade();
      return;
    }

    const headers = ["Title", "Auctioneer", "Location", "Price", "Ending Date", "My Max Bid", "Notes", "URL"];
    const rows = watchlist.map((item) => [
      `"${(item.title || "").replace(/"/g, '""')}"`,
      `"${(item.auctioneer || "").replace(/"/g, '""')}"`,
      `"${(item.location || "").replace(/"/g, '""')}"`,
      item.price || 0,
      `"${item.endingDate || ""}"`,
      item.myMaxBid || "",
      `"${(item.notes || "").replace(/"/g, '""')}"`,
      `"${item.url || ""}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HammerPoint-Watchlist-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="bg-amber-500 p-2 rounded-xl text-white shadow-xs">
              <Star className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">My Saved Watchlist</h3>
                <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {watchlist.length} {watchlist.length === 1 ? "Lot" : "Lots"}
                </span>
              </div>
              <p className="text-xs text-slate-500">Live synchronized bidding monitor</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {watchlist.length > 0 && (
              <button
                onClick={exportToCsv}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-colors ${
                  isPro 
                    ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer" 
                    : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 cursor-pointer"
                }`}
                title={isPro ? "Export to CSV" : "Pro Membership Feature"}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
                {!isPro && <Crown className="w-3 h-3 text-amber-500 ml-0.5" />}
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {watchlist.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Star className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">No saved lots yet</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
                Click the star icon on any commercial auction card to save it here for tracking, private notes, and deadline monitoring.
              </p>
            </div>
          ) : (
            watchlist.map((item) => {
              const timeInfo = getTimeRemaining(item.endingDate);
              const isEditing = editingNotesId === item.lotId;

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all space-y-3 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {item.country && (
                          <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                            {item.country === "UK" ? "UK" : item.country === "US" ? "US" : item.country}
                          </span>
                        )}
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {item.auctioneer}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Saved {new Date(item.savedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <h4 className="font-bold text-slate-900 text-sm leading-snug">
                        {item.title}
                      </h4>

                      <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[280px] sm:max-w-md">{item.location}</span>
                      </div>
                    </div>

                    {/* Price & Countdown */}
                    <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                      {item.price !== undefined && item.price > 0 && (
                        <div className="font-bold text-emerald-700 text-xs sm:text-sm bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md">
                          {item.country === "UK" ? "£" : "$"}{item.price.toLocaleString()}
                        </div>
                      )}
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        timeInfo.isExpired
                          ? "bg-slate-100 text-slate-500"
                          : timeInfo.isUrgent
                            ? "bg-red-50 text-red-600 border border-red-200/50"
                            : "bg-blue-50 text-blue-600 border border-blue-200/50"
                      }`}>
                        <Clock className="w-3 h-3" />
                        {timeInfo.text}
                      </div>
                    </div>
                  </div>

                  {/* Pro Member Notes & Max Bid Planner */}
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200/80 text-xs">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                              Max Bid Budget ({item.country === "UK" ? "£" : "$"})
                            </label>
                            <input
                              type="number"
                              value={tempMaxBid !== undefined ? tempMaxBid : ""}
                              onChange={(e) => setTempMaxBid(e.target.value ? Number(e.target.value) : undefined)}
                              placeholder="e.g. 4500"
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Private Research & Inspection Notes
                          </label>
                          <textarea
                            rows={2}
                            value={tempNotes}
                            onChange={(e) => setTempNotes(e.target.value)}
                            placeholder="e.g. Inspected 3-phase spindle; buyer premium is 15% + VAT..."
                            className="w-full bg-white border border-slate-200 rounded p-2 text-xs"
                          />
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingNotesId(null)}
                            className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveNotes(item.lotId)}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Save Note
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          {item.myMaxBid !== undefined && (
                            <div className="font-bold text-purple-900 text-xs mb-1 flex items-center gap-1">
                              <Coins className="w-3.5 h-3.5 text-amber-500" />
                              My Target Max Bid: {item.country === "UK" ? "£" : "$"}{item.myMaxBid.toLocaleString()}
                            </div>
                          )}
                          <p className="text-slate-600 italic">
                            {item.notes ? `"${item.notes}"` : "No private inspection notes added yet."}
                          </p>
                        </div>
                        <button
                          onClick={() => startEditNotes(item)}
                          className="text-[11px] text-blue-600 hover:text-blue-800 font-bold shrink-0"
                        >
                          {item.notes || item.myMaxBid !== undefined ? "Edit Note" : "+ Add Note"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <button
                      onClick={() => removeFromWatchlist(item.lotId)}
                      className="text-red-500 hover:text-red-700 font-medium flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          onLocateListing(item);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                      >
                        Locate on Map
                      </button>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        referrerPolicy="no-referrer"
                        className="px-3 py-1 rounded text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center gap-1"
                      >
                        Official Lot <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
