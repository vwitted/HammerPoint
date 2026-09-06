import React, { useState } from "react";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../types";
import { 
  X, 
  User, 
  Building2, 
  Phone, 
  Compass, 
  Crown, 
  ShieldCheck, 
  Check, 
  LogOut, 
  Sparkles,
  Zap
} from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAdminPanel?: () => void;
}

export default function UserProfileModal({ isOpen, onClose, onOpenAdminPanel }: UserProfileModalProps) {
  const { 
    userProfile, 
    role, 
    isPro, 
    isAdmin, 
    updateProfileData, 
    switchUserRole, 
    signOutUser 
  } = useAuth();

  const [displayName, setDisplayName] = useState(userProfile?.displayName || "");
  const [company, setCompany] = useState(userProfile?.company || "");
  const [phone, setPhone] = useState(userProfile?.phone || "");
  const [preferredRadius, setPreferredRadius] = useState(userProfile?.preferredRadius || 50);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfileData({
        displayName,
        company,
        phone,
        preferredRadius: Number(preferredRadius)
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleTierSwitch = async (newRole: UserRole) => {
    await switchUserRole(newRole);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-xs ${
              isAdmin 
                ? "bg-indigo-600" 
                : isPro 
                  ? "bg-purple-600" 
                  : "bg-blue-600"
            }`}>
              {isAdmin ? "👑" : isPro ? "⭐" : "HP"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">{userProfile?.displayName || "Member Profile"}</h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                  isAdmin 
                    ? "bg-indigo-100 text-indigo-800 border border-indigo-200" 
                    : isPro 
                      ? "bg-purple-100 text-purple-800 border border-purple-200" 
                      : "bg-slate-100 text-slate-700 border border-slate-200"
                }`}>
                  {isAdmin ? "Admin" : isPro ? "Pro Buyer" : "Standard"}
                </span>
              </div>
              <p className="text-xs text-slate-500">{userProfile?.email || "Member"}</p>
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
        <div className="p-5 overflow-y-auto max-h-[75vh] space-y-5">
          {/* Membership Tier Cards */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                Membership Tier & Capabilities
              </span>
              {isAdmin && onOpenAdminPanel && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAdminPanel();
                  }}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Launch Admin Console
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Standard */}
              <div
                onClick={() => handleTierSwitch("standard")}
                className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
                  role === "standard"
                    ? "border-blue-600 bg-blue-50/60 shadow-2xs"
                    : "border-slate-200 hover:border-slate-300 opacity-70"
                }`}
              >
                <div className="text-sm font-bold text-slate-800">Standard</div>
                <div className="text-[10px] text-slate-500 mt-1">50-mi Radius</div>
                <div className="text-[10px] text-slate-500">5 Saved Lots</div>
                {role === "standard" && (
                  <span className="mt-2 inline-block text-[9px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded">Active</span>
                )}
              </div>

              {/* Pro */}
              <div
                onClick={() => handleTierSwitch("pro")}
                className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
                  role === "pro"
                    ? "border-purple-600 bg-purple-50/60 shadow-2xs"
                    : "border-slate-200 hover:border-slate-300 opacity-70"
                }`}
              >
                <div className="text-sm font-bold text-purple-900 flex items-center justify-center gap-1">
                  <Crown className="w-3 h-3 text-amber-500" /> Pro Buyer
                </div>
                <div className="text-[10px] text-purple-700 mt-1">150+ mi Radius</div>
                <div className="text-[10px] text-purple-700">Unlimited + CSV</div>
                {role === "pro" && (
                  <span className="mt-2 inline-block text-[9px] font-bold bg-purple-600 text-white px-2 py-0.5 rounded">Active</span>
                )}
              </div>

              {/* Admin */}
              <div
                onClick={() => handleTierSwitch("admin")}
                className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
                  role === "admin"
                    ? "border-indigo-600 bg-indigo-50/60 shadow-2xs"
                    : "border-slate-200 hover:border-slate-300 opacity-70"
                }`}
              >
                <div className="text-sm font-bold text-indigo-950 flex items-center justify-center gap-1">
                  👑 Admin
                </div>
                <div className="text-[10px] text-indigo-700 mt-1">Full Controls</div>
                <div className="text-[10px] text-indigo-700">User Role Mgmt</div>
                {role === "admin" && (
                  <span className="mt-2 inline-block text-[9px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded">Active</span>
                )}
              </div>
            </div>
          </div>

          {/* Profile Form */}
          <form onSubmit={handleSave} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" /> Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" /> Company / Firm
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Acme Machinery"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+44 7..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-slate-400" /> Default Search Radius Limit
              </label>
              <select
                value={preferredRadius}
                onChange={(e) => setPreferredRadius(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value={50}>50 Miles (Standard Local Region)</option>
                <option value={100}>100 Miles (Regional Cluster)</option>
                <option value={150}>150 Miles (Extended Area - Pro)</option>
                <option value={300}>300+ Miles (Nationwide UK/US - Pro)</option>
              </select>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  signOutUser();
                  onClose();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors shadow-xs flex items-center gap-1.5"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Saved!
                  </>
                ) : saving ? (
                  "Updating..."
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
