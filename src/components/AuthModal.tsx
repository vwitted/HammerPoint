import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../types";
import { 
  X, 
  Mail, 
  Lock, 
  User, 
  Building2, 
  ShieldCheck, 
  Zap, 
  Crown, 
  Check, 
  AlertCircle,
  Sparkles,
  ArrowRight
} from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "signin" | "signup" | "demo";
}

export default function AuthModal({ isOpen, onClose, defaultTab = "signin" }: AuthModalProps) {
  const { 
    signInWithEmail, 
    signUpWithEmail, 
    signInWithGoogle, 
    loginAsDemoPersona,
    authError, 
    clearAuthError 
  } = useAuth();

  const [tab, setTab] = useState<"signin" | "signup" | "demo">(defaultTab);
  const [loading, setLoading] = useState(false);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [company, setCompany] = useState("");
  const [selectedRole, setSelectedRole] = useState<UserRole>("standard");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLoading(true);
    try {
      await signInWithEmail(email, password);
      onClose();
    } catch (err: any) {
      // Handled by context
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setLocalError("Please enter your full name or company representative name.");
      return;
    }
    if (password.length < 6) {
      setLocalError("Password must be at least 6 characters.");
      return;
    }
    setLocalError(null);
    setLoading(true);
    try {
      await signUpWithEmail(email, password, displayName, company, selectedRole);
      onClose();
    } catch (err: any) {
      // Handled by context
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLocalError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err: any) {
      // Handled by context
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (role: UserRole) => {
    setLoading(true);
    try {
      await loginAsDemoPersona(role);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-lg text-white shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">HammerPoint Account</h3>
              <p className="text-xs text-slate-500">Commercial Auction & Liquidation Access</p>
            </div>
          </div>
          <button
            onClick={() => {
              clearAuthError();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-3 p-1.5 bg-slate-100 mx-5 mt-4 rounded-xl text-xs font-semibold text-slate-600">
          <button
            onClick={() => {
              clearAuthError();
              setLocalError(null);
              setTab("signin");
            }}
            className={`py-2 rounded-lg transition-all ${
              tab === "signin" 
                ? "bg-white text-slate-900 shadow-xs font-bold" 
                : "hover:text-slate-900"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              clearAuthError();
              setLocalError(null);
              setTab("signup");
            }}
            className={`py-2 rounded-lg transition-all ${
              tab === "signup" 
                ? "bg-white text-slate-900 shadow-xs font-bold" 
                : "hover:text-slate-900"
            }`}
          >
            Register
          </button>
          <button
            onClick={() => {
              clearAuthError();
              setLocalError(null);
              setTab("demo");
            }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1 ${
              tab === "demo" 
                ? "bg-amber-500 text-white shadow-xs font-bold" 
                : "text-amber-700 hover:text-amber-900"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Fast Demo
          </button>
        </div>

        {/* Error Alert */}
        {displayError && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="capitalize">{displayError}</span>
          </div>
        )}

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto max-h-[75vh]">
          {tab === "signin" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" /> Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="buyer@engineering-firm.co.uk"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" /> Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {loading ? "Authenticating..." : "Sign In to HammerPoint"}
              </button>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-xs font-medium uppercase tracking-wider">or</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <button
                type="button"
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-sm transition-colors shadow-2xs flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Continue with Google
              </button>
            </form>
          )}

          {tab === "signup" && (
            <form onSubmit={handleSignUp} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" /> Full Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Philip Hall"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" /> Company / Organization (Optional)
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Yorkshire CNC Ltd"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" /> Business Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="p.hall@yorkshiremachinery.co.uk"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" /> Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Membership Tier Picker */}
              <div className="pt-2">
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Select Initial Membership Tier:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => setSelectedRole("standard")}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedRole === "standard"
                        ? "border-blue-600 bg-blue-50/50 shadow-2xs"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Standard</span>
                      {selectedRole === "standard" && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Free permanent access, 50-mile radius, 5 saved lots.</p>
                  </div>

                  <div
                    onClick={() => setSelectedRole("pro")}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedRole === "pro"
                        ? "border-purple-600 bg-purple-50/50 shadow-2xs"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purple-900 flex items-center gap-1">
                        <Crown className="w-3 h-3 text-amber-500" /> Pro Buyer
                      </span>
                      {selectedRole === "pro" && <Check className="w-3.5 h-3.5 text-purple-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Unlimited watchlists, 150+ mi radius, bid tracker & notes.</p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {loading ? "Creating Account..." : "Complete Registration"}
              </button>
            </form>
          )}

          {tab === "demo" && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
                <strong className="block font-bold mb-0.5 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-600" /> Instant Persona Testing
                </strong>
                Switch immediately into any membership role to test permissions, admin panels, and Pro buyer tools without needing to create new credentials.
              </div>

              {/* Persona 1: Admin */}
              <div
                onClick={() => handleDemoLogin("admin")}
                className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                      👑
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-indigo-950">Platform Administrator</h4>
                      <p className="text-[11px] text-indigo-700">philiphall9019@gmail.com</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                    Enter <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-indigo-800/80 bg-white/60 px-2.5 py-1 rounded-md">
                  Full access: User management, role elevation, live announcements, and scraper diagnostics.
                </div>
              </div>

              {/* Persona 2: Pro Buyer */}
              <div
                onClick={() => handleDemoLogin("pro")}
                className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/60 hover:bg-purple-100/70 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-xs">
                      ⭐
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-purple-950">Commercial Pro Buyer</h4>
                      <p className="text-[11px] text-purple-700">Northern Fleet Liquidations</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-purple-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                    Enter <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-purple-800/80 bg-white/60 px-2.5 py-1 rounded-md">
                  Pro access: 150+ mile nationwide radius, private bid notes, unlimited watchlist & CSV export.
                </div>
              </div>

              {/* Persona 3: Standard Member */}
              <div
                onClick={() => handleDemoLogin("standard")}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-700 text-white flex items-center justify-center font-bold text-xs">
                      🔰
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Standard Buyer</h4>
                      <p className="text-[11px] text-slate-500">Apex Machinery Repairs</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-700 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                    Enter <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-600 bg-white/80 px-2.5 py-1 rounded-md">
                  Standard access: 50-mile radius map, up to 5 saved watchlist lots.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-400 font-mono">
          HammerPoint Role & Auth Engine • Secured by Firebase
        </div>
      </motion.div>
    </div>
  );
}
