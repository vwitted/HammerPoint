import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { UserProfile, UserRole } from "../types";
import { collection, getDocs, doc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { 
  X, 
  ShieldCheck, 
  Users, 
  Activity, 
  Megaphone, 
  Check, 
  Trash2, 
  Crown, 
  RefreshCw, 
  Search,
  Server,
  Zap,
  Plus
} from "lucide-react";

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminPanelModal({ isOpen, onClose }: AdminPanelModalProps) {
  const { 
    isAdmin, 
    userProfile, 
    announcements, 
    postAnnouncement, 
    deleteAnnouncement 
  } = useAuth();

  const [activeTab, setActiveTab] = useState<"users" | "announcements" | "health">("users");
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);

  // Announcement form state
  const [annTitle, setAnnTitle] = useState("");
  const [annContent, setAnnContent] = useState("");
  const [annType, setAnnType] = useState<"info" | "warning" | "success">("info");
  const [postingAnn, setPostingAnn] = useState(false);

  // Load all users from Firestore
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const list: UserProfile[] = [];
      usersSnap.forEach((docSnap) => {
        list.push({ uid: docSnap.id, ...(docSnap.data() as Omit<UserProfile, "uid">) });
      });

      // If empty or initial, inject demo seeds for demonstration
      if (list.length === 0) {
        const seedUsers: UserProfile[] = [
          {
            uid: "user-seed-philip",
            email: "philiphall9019@gmail.com",
            displayName: "Philip Hall",
            role: "admin",
            company: "HammerPoint Platform Ops",
            phone: "+44 (0) 7700 900123",
            preferredRadius: 200,
            createdAt: new Date(Date.now() - 15 * 86400000).toISOString()
          },
          {
            uid: "user-seed-sarah",
            email: "sarah.jenkins@northernequipment.co.uk",
            displayName: "Sarah Jenkins",
            role: "pro",
            company: "Northern Fleet Liquidations",
            phone: "+44 (0) 113 496 0288",
            preferredRadius: 150,
            createdAt: new Date(Date.now() - 8 * 86400000).toISOString()
          },
          {
            uid: "user-seed-dave",
            email: "dave.m@midlandsmachinery.com",
            displayName: "Dave Miller",
            role: "standard",
            company: "Midlands Tool Hire",
            phone: "+44 (0) 121 496 0991",
            preferredRadius: 50,
            createdAt: new Date(Date.now() - 2 * 86400000).toISOString()
          }
        ];
        for (const u of seedUsers) {
          await setDoc(doc(db, "users", u.uid), u);
        }
        setUsersList(seedUsers);
      } else {
        setUsersList(list);
      }
    } catch (err) {
      console.error("Failed fetching users from Firestore:", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchUsers();
    }
  }, [isOpen, isAdmin]);

  if (!isOpen || !isAdmin) return null;

  const handleUpdateRole = async (targetUid: string, newRole: UserRole) => {
    setRoleUpdatingUid(targetUid);
    try {
      await updateDoc(doc(db, "users", targetUid), {
        role: newRole,
        updatedAt: new Date().toISOString()
      });
      setUsersList((prev) => 
        prev.map((u) => u.uid === targetUid ? { ...u, role: newRole } : u)
      );
    } catch (err) {
      console.error("Failed to update user role:", err);
    } finally {
      setRoleUpdatingUid(null);
    }
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;
    setPostingAnn(true);
    try {
      await postAnnouncement(annTitle.trim(), annContent.trim(), annType);
      setAnnTitle("");
      setAnnContent("");
    } finally {
      setPostingAnn(false);
    }
  };

  const filteredUsers = usersList.filter((u) => {
    const q = userSearch.toLowerCase();
    return (
      (u.displayName || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.company || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-indigo-900 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-700/80 p-2.5 rounded-xl border border-indigo-600 shadow-xs">
              <ShieldCheck className="w-6 h-6 text-indigo-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">HammerPoint Admin Console</h3>
                <span className="bg-indigo-700 text-indigo-200 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-indigo-500/50">
                  Root Admin
                </span>
              </div>
              <p className="text-xs text-indigo-300">
                User membership governance, live broadcasts, and scraper telemetry
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-indigo-300 hover:text-white hover:bg-indigo-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-5 gap-4 text-xs font-bold text-slate-600">
          <button
            onClick={() => setActiveTab("users")}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "users"
                ? "border-indigo-600 text-indigo-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <Users className="w-4 h-4" /> User Accounts & Roles ({usersList.length})
          </button>
          <button
            onClick={() => setActiveTab("announcements")}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "announcements"
                ? "border-indigo-600 text-indigo-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <Megaphone className="w-4 h-4" /> Platform Broadcasts ({announcements.length})
          </button>
          <button
            onClick={() => setActiveTab("health")}
            className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === "health"
                ? "border-indigo-600 text-indigo-600 font-bold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            <Activity className="w-4 h-4" /> Scraper Feeds & Telemetry
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: USERS */}
          {activeTab === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search users by name, email, company, or role..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <button
                  onClick={fetchUsers}
                  disabled={loadingUsers}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>

              {/* Users Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-mono text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="p-3">User & Organization</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Radius</th>
                      <th className="p-3">Current Role</th>
                      <th className="p-3 text-right">Role Management</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-400">
                          No users matched your query.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isUpdating = roleUpdatingUid === u.uid;
                        return (
                          <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3">
                              <div className="font-bold text-slate-900">{u.displayName || "Anonymous"}</div>
                              <div className="text-[11px] text-slate-500">{u.company || "Individual Buyer"}</div>
                            </td>
                            <td className="p-3 font-mono text-[11px] text-slate-600">
                              {u.email}
                            </td>
                            <td className="p-3 text-slate-600">
                              {u.preferredRadius || 50} mi
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                u.role === "admin"
                                  ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                  : u.role === "pro"
                                    ? "bg-purple-100 text-purple-800 border border-purple-200"
                                    : "bg-slate-100 text-slate-700 border border-slate-200"
                              }`}>
                                {u.role === "admin" && "👑"}
                                {u.role === "pro" && "⭐"}
                                {u.role}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <select
                                disabled={isUpdating}
                                value={u.role}
                                onChange={(e) => handleUpdateRole(u.uid, e.target.value as UserRole)}
                                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                              >
                                <option value="standard">Standard Member</option>
                                <option value="pro">⭐ Pro Buyer</option>
                                <option value="admin">👑 Administrator</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: ANNOUNCEMENTS */}
          {activeTab === "announcements" && (
            <div className="space-y-5">
              {/* Compose Announcement */}
              <form onSubmit={handlePostAnnouncement} className="p-4 border border-indigo-200 bg-indigo-50/40 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                    <Megaphone className="w-4 h-4 text-indigo-600" /> Broadcast Platform Announcement
                  </span>
                  <select
                    value={annType}
                    onChange={(e) => setAnnType(e.target.value as any)}
                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold"
                  >
                    <option value="info">🔵 Information</option>
                    <option value="warning">🟡 Urgent / Deadline Alert</option>
                    <option value="success">🟢 Platform Update</option>
                  </select>
                </div>

                <div>
                  <input
                    type="text"
                    required
                    placeholder="Announcement Title (e.g. Major CNC Liquidation in West Yorkshire This Friday)"
                    value={annTitle}
                    onChange={(e) => setAnnTitle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <textarea
                    rows={2}
                    required
                    placeholder="Broadcast details, specific auction house notice, or maintenance reminder for all users..."
                    value={annContent}
                    onChange={(e) => setAnnContent(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={postingAnn}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {postingAnn ? "Broadcasting..." : "Publish Announcement"}
                  </button>
                </div>
              </form>

              {/* Active Announcements List */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Live Platform Announcements ({announcements.length})
                </span>

                {announcements.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    No active platform announcements published.
                  </div>
                ) : (
                  announcements.map((ann) => (
                    <div
                      key={ann.id}
                      className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
                        ann.type === "warning"
                          ? "bg-amber-50/60 border-amber-200 text-amber-900"
                          : ann.type === "success"
                            ? "bg-emerald-50/60 border-emerald-200 text-emerald-900"
                            : "bg-blue-50/60 border-blue-200 text-blue-900"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{ann.title}</span>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/70 border border-slate-200 font-bold">
                            {ann.type}
                          </span>
                        </div>
                        <p className="text-xs mt-1 leading-relaxed">{ann.content}</p>
                        <p className="text-[10px] text-slate-500 mt-2 font-mono">
                          Posted by {ann.createdBy} on {new Date(ann.createdAt).toLocaleString()}
                        </p>
                      </div>

                      <button
                        onClick={() => deleteAnnouncement(ann.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                        title="Delete announcement"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: HEALTH & TELEMETRY */}
          {activeTab === "health" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Easy Live */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Easy Live Auction</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Active
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Direct Algolia queries: <strong className="text-slate-800">KBISTY43U6</strong>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">Latency: ~210ms • Hits/req: 25</div>
                </div>

                {/* BPI / Artisio */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">BPI / Artisio API</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Active
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Artisio Cloud Feed: <strong className="text-slate-800">Client ID 77829366</strong>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">Latency: ~340ms • Subdomain: www</div>
                </div>

                {/* ATG Media Network */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">ATG Network (BidSpotter, The Saleroom)</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Active
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Live Puppeteer Crawler Engine
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">Latency: ~3400ms • Dynamic Scraping</div>
                </div>
              </div>

              {/* Database Status */}
              <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 space-y-2">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-950">Firestore Clustered Storage Status</span>
                </div>
                <p className="text-xs text-indigo-900/80 leading-relaxed">
                  Database ID: <code className="bg-white/80 px-1.5 py-0.5 rounded text-indigo-700 font-mono">ai-studio-commercialauctio-6bf36965-dd91-453f-bc59-8b000e523eaf</code>. 
                  Rule version: 2 with RBAC validation for Administrator, Pro Buyer, and Standard accounts.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
