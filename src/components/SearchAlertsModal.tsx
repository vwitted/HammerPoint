import React, { useState } from "react";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { 
  X, 
  Bell, 
  Plus, 
  Trash2, 
  Search, 
  Check, 
  Sparkles,
  MapPin
} from "lucide-react";

interface SearchAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteSearch: (keyword: string, category: string) => void;
}

export default function SearchAlertsModal({ 
  isOpen, 
  onClose, 
  onExecuteSearch 
}: SearchAlertsModalProps) {
  const { 
    searchAlerts, 
    addSearchAlert, 
    removeSearchAlert, 
    toggleSearchAlert 
  } = useAuth();

  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("All");
  const [radius, setRadius] = useState(50);
  const [country, setCountry] = useState("UK");
  const [isAdding, setIsAdding] = useState(false);

  if (!isOpen) return null;

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    await addSearchAlert(keyword.trim(), category, radius, country);
    setKeyword("");
    setIsAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-xl text-white shadow-xs">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Commercial Search Alerts</h3>
              <p className="text-xs text-slate-500">Live monitoring for upcoming assets & liquidations</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Create Alert Toggle / Form */}
          {isAdding ? (
            <form onSubmit={handleCreateAlert} className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" /> New Automated Search Alert
                </span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Target Asset Keyword
                </label>
                <input
                  type="text"
                  required
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. CNC Lathe, Rational Combi, Mercedes Sprinter..."
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Category Focus
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="All">All Categories</option>
                    <option value="Industrial">Industrial & Plant</option>
                    <option value="Machinery">Machinery & Tools</option>
                    <option value="Vehicles">Commercial Vehicles</option>
                    <option value="Catering">Catering & Bakery</option>
                    <option value="Tech & Office">Office & IT</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Radius Filter
                  </label>
                  <select
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={50}>50 Miles (Local Region)</option>
                    <option value={100}>100 Miles</option>
                    <option value={200}>200 Miles</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" /> Save Active Alert
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full py-3 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 text-xs font-bold text-blue-700 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create New Search Alert
            </button>
          )}

          {/* List of alerts */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
              Configured Keyword Monitors ({searchAlerts.length})
            </span>

            {searchAlerts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No active search monitors configured yet.
              </div>
            ) : (
              searchAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 flex items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleSearchAlert(alert.id, !alert.active)}
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors ${
                        alert.active
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-200 text-slate-400"
                      }`}
                      title={alert.active ? "Alert is active" : "Alert is paused"}
                    >
                      ✓
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">"{alert.keyword}"</span>
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                          {alert.category}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {alert.radius} mi
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Created {new Date(alert.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onExecuteSearch(alert.keyword, alert.category);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs flex items-center gap-1 transition-colors"
                      title="Run search now"
                    >
                      <Search className="w-3.5 h-3.5" /> Scrape Now
                    </button>

                    <button
                      onClick={() => removeSearchAlert(alert.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                      title="Delete alert"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
