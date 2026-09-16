import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile as updateAuthProfile
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  onSnapshot, 
  deleteDoc,
  addDoc
} from "firebase/firestore";
import { auth, googleProvider, db } from "../firebase";
import { UserProfile, UserRole, WatchlistItem, SearchAlert, PlatformAnnouncement, AuctionListing } from "../types";

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  role: UserRole;
  isPro: boolean;
  isAdmin: boolean;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, displayName: string, company?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  updateProfileData: (data: Partial<Omit<UserProfile, "role">>) => Promise<void>;

  // Watchlist
  watchlist: WatchlistItem[];
  isLotWatchlisted: (lotId: string) => boolean;
  addToWatchlist: (listing: AuctionListing, notes?: string, myMaxBid?: number) => Promise<void>;
  removeFromWatchlist: (lotId: string) => Promise<void>;
  updateWatchlistItem: (lotId: string, notes?: string, myMaxBid?: number) => Promise<void>;
  
  // Search Alerts
  searchAlerts: SearchAlert[];
  addSearchAlert: (keyword: string, category: string, radius: number, country: string) => Promise<void>;
  removeSearchAlert: (alertId: string) => Promise<void>;
  toggleSearchAlert: (alertId: string, active: boolean) => Promise<void>;

  // System Announcements
  announcements: PlatformAnnouncement[];
  postAnnouncement: (title: string, content: string, type?: "info" | "warning" | "success") => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Watchlist state
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    try {
      const saved = localStorage.getItem("hp_guest_watchlist");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Search alerts state
  const [searchAlerts, setSearchAlerts] = useState<SearchAlert[]>(() => {
    try {
      const saved = localStorage.getItem("hp_guest_alerts");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Announcements state
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, "users", user.uid);
          const snap = await getDoc(userDocRef);

          if (snap.exists()) {
            setUserProfile(snap.data() as UserProfile);
          } else {
            // Every new account starts as standard. Roles are granted by an admin
            // (Firestore rules reject any other initial role).
            const newProfile: UserProfile = {
              uid: user.uid,
              email: user.email || "",
              displayName: user.displayName || user.email?.split("@")[0] || "Commercial Buyer",
              role: "standard",
              company: "",
              phone: "",
              preferredRadius: 50,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            await setDoc(userDocRef, newProfile);
            setUserProfile(newProfile);
          }
        } catch (err: any) {
          console.error("Error reading or writing user profile:", err);
          // Fallback profile if Firestore read failed. Never grants elevated roles.
          setUserProfile({
            uid: user.uid,
            email: user.email || "user@example.com",
            displayName: user.displayName || "Buyer",
            role: "standard",
            preferredRadius: 50,
            createdAt: new Date().toISOString()
          });
        }
      } else {
        // Logged out
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // Real-time listener for current user's profile document
  useEffect(() => {
    if (!currentUser) return;

    const userDocRef = doc(db, "users", currentUser.uid);
    const unsubDoc = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data() as UserProfile);
      }
    }, (error) => {
      console.warn("User profile snapshot listener warning:", error.message);
    });

    return () => unsubDoc();
  }, [currentUser]);

  // Real-time listener for current user's Watchlist in Firestore
  useEffect(() => {
    if (!currentUser) {
      // In guest mode, keep local storage sync
      try {
        const saved = localStorage.getItem("hp_guest_watchlist");
        setWatchlist(saved ? JSON.parse(saved) : []);
      } catch {
        setWatchlist([]);
      }
      return;
    }

    const watchlistCol = collection(db, "users", currentUser.uid, "watchlist");
    const unsubWatchlist = onSnapshot(watchlistCol, (snapshot) => {
      const items: WatchlistItem[] = [];
      snapshot.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as Omit<WatchlistItem, "id">) });
      });
      setWatchlist(items);
    }, (err) => {
      console.warn("Watchlist snapshot warning:", err.message);
    });

    return () => unsubWatchlist();
  }, [currentUser]);

  // Real-time listener for Search Alerts
  useEffect(() => {
    if (!currentUser) {
      try {
        const saved = localStorage.getItem("hp_guest_alerts");
        setSearchAlerts(saved ? JSON.parse(saved) : []);
      } catch {
        setSearchAlerts([]);
      }
      return;
    }

    const alertsCol = collection(db, "users", currentUser.uid, "searchAlerts");
    const unsubAlerts = onSnapshot(alertsCol, (snapshot) => {
      const alerts: SearchAlert[] = [];
      snapshot.forEach((d) => {
        alerts.push({ id: d.id, ...(d.data() as Omit<SearchAlert, "id">) });
      });
      setSearchAlerts(alerts);
    }, (err) => {
      console.warn("Search alerts listener warning:", err.message);
    });

    return () => unsubAlerts();
  }, [currentUser]);

  // Real-time listener for platform announcements
  useEffect(() => {
    const annCol = collection(db, "announcements");
    const unsubAnn = onSnapshot(annCol, (snapshot) => {
      const anns: PlatformAnnouncement[] = [];
      snapshot.forEach((d) => {
        anns.push({ id: d.id, ...(d.data() as Omit<PlatformAnnouncement, "id">) });
      });
      setAnnouncements(anns);
    }, (err) => {
      console.warn("Announcements listener warning:", err.message);
    });

    return () => unsubAnn();
  }, []);

  const clearAuthError = () => setAuthError(null);

  // Email Sign In
  const signInWithEmail = async (email: string, pass: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (err: any) {
      const msg = err.code ? err.code.replace("auth/", "").replace(/-/g, " ") : err.message;
      setAuthError(msg || "Failed to sign in. Please verify your credentials.");
      throw err;
    }
  };

  // Email Sign Up
  const signUpWithEmail = async (
    email: string, 
    pass: string, 
    displayName: string,
    company?: string
  ) => {
    setAuthError(null);
    try {
      const res = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const user = res.user;

      await updateAuthProfile(user, { displayName });

      const newProfile: UserProfile = {
        uid: user.uid,
        email: user.email || email,
        displayName: displayName || email.split("@")[0],
        role: "standard",
        company: company || "",
        phone: "",
        preferredRadius: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, "users", user.uid), newProfile);
      setUserProfile(newProfile);
    } catch (err: any) {
      const msg = err.code ? err.code.replace("auth/", "").replace(/-/g, " ") : err.message;
      setAuthError(msg || "Registration failed. Please check your information.");
      throw err;
    }
  };

  // Google Sign In
  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === "auth/popup-closed-by-user") return;
      const msg = err.code ? err.code.replace("auth/", "").replace(/-/g, " ") : err.message;
      setAuthError(msg || "Google Sign-In failed.");
      throw err;
    }
  };

  // Sign Out
  const signOutUser = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setUserProfile(null);
    } catch (err: any) {
      console.error("Sign out error:", err);
    }
  };

  // Update profile details
  const updateProfileData = async (data: Partial<Omit<UserProfile, "role">>) => {
    if (!currentUser) return;
    try {
      const userDocRef = doc(db, "users", currentUser.uid);
      const updated = {
        ...data,
        updatedAt: new Date().toISOString()
      };
      await updateDoc(userDocRef, updated);
      setUserProfile((prev) => prev ? { ...prev, ...updated } : null);
    } catch (err: any) {
      console.error("Failed to update profile:", err);
      throw err;
    }
  };

  // Watchlist helpers
  const isLotWatchlisted = (lotId: string) => {
    return watchlist.some((item) => item.lotId === lotId);
  };

  const addToWatchlist = async (listing: AuctionListing, notes?: string, myMaxBid?: number) => {
    const watchItem: WatchlistItem = {
      id: listing.id,
      lotId: listing.id,
      title: listing.title,
      auctioneer: listing.auctioneer,
      location: listing.address,
      price: listing.currentPrice || listing.startPrice || 0,
      endingDate: listing.endingDate,
      url: listing.url,
      category: listing.category,
      country: listing.country,
      notes: notes || "",
      myMaxBid: myMaxBid || undefined,
      savedAt: new Date().toISOString()
    };

    if (currentUser) {
      try {
        const itemDoc = doc(db, "users", currentUser.uid, "watchlist", listing.id);
        await setDoc(itemDoc, watchItem);
      } catch (err) {
        console.error("Failed saving to Firestore watchlist:", err);
      }
    } else {
      // Local fallback
      const updated = [watchItem, ...watchlist.filter((w) => w.lotId !== listing.id)];
      setWatchlist(updated);
      localStorage.setItem("hp_guest_watchlist", JSON.stringify(updated));
    }
  };

  const removeFromWatchlist = async (lotId: string) => {
    if (currentUser) {
      try {
        const itemDoc = doc(db, "users", currentUser.uid, "watchlist", lotId);
        await deleteDoc(itemDoc);
      } catch (err) {
        console.error("Failed deleting from Firestore watchlist:", err);
      }
    } else {
      const updated = watchlist.filter((w) => w.lotId !== lotId);
      setWatchlist(updated);
      localStorage.setItem("hp_guest_watchlist", JSON.stringify(updated));
    }
  };

  const updateWatchlistItem = async (lotId: string, notes?: string, myMaxBid?: number) => {
    if (currentUser) {
      try {
        const itemDoc = doc(db, "users", currentUser.uid, "watchlist", lotId);
        await updateDoc(itemDoc, {
          ...(notes !== undefined && { notes }),
          ...(myMaxBid !== undefined && { myMaxBid })
        });
      } catch (err) {
        console.error("Failed updating watchlist item:", err);
      }
    } else {
      const updated = watchlist.map((w) => {
        if (w.lotId === lotId) {
          return {
            ...w,
            ...(notes !== undefined && { notes }),
            ...(myMaxBid !== undefined && { myMaxBid })
          };
        }
        return w;
      });
      setWatchlist(updated);
      localStorage.setItem("hp_guest_watchlist", JSON.stringify(updated));
    }
  };

  // Search Alerts
  const addSearchAlert = async (keyword: string, category: string, radius: number, country: string) => {
    const alert: Omit<SearchAlert, "id"> = {
      keyword,
      category,
      radius,
      country,
      createdAt: new Date().toISOString(),
      active: true
    };

    if (currentUser) {
      try {
        const alertCol = collection(db, "users", currentUser.uid, "searchAlerts");
        await addDoc(alertCol, alert);
      } catch (err) {
        console.error("Failed adding search alert to Firestore:", err);
      }
    } else {
      const newAlert: SearchAlert = { id: `alert-${Date.now()}`, ...alert };
      const updated = [newAlert, ...searchAlerts];
      setSearchAlerts(updated);
      localStorage.setItem("hp_guest_alerts", JSON.stringify(updated));
    }
  };

  const removeSearchAlert = async (alertId: string) => {
    if (currentUser) {
      try {
        const alertDoc = doc(db, "users", currentUser.uid, "searchAlerts", alertId);
        await deleteDoc(alertDoc);
      } catch (err) {
        console.error("Failed deleting search alert:", err);
      }
    } else {
      const updated = searchAlerts.filter((a) => a.id !== alertId);
      setSearchAlerts(updated);
      localStorage.setItem("hp_guest_alerts", JSON.stringify(updated));
    }
  };

  const toggleSearchAlert = async (alertId: string, active: boolean) => {
    if (currentUser) {
      try {
        const alertDoc = doc(db, "users", currentUser.uid, "searchAlerts", alertId);
        await updateDoc(alertDoc, { active });
      } catch (err) {
        console.error("Failed toggling alert:", err);
      }
    } else {
      const updated = searchAlerts.map((a) => a.id === alertId ? { ...a, active } : a);
      setSearchAlerts(updated);
      localStorage.setItem("hp_guest_alerts", JSON.stringify(updated));
    }
  };

  // Announcements
  const postAnnouncement = async (title: string, content: string, type: "info" | "warning" | "success" = "info") => {
    try {
      const annCol = collection(db, "announcements");
      await addDoc(annCol, {
        title,
        content,
        type,
        createdAt: new Date().toISOString(),
        createdBy: userProfile?.displayName || "System Admin",
        active: true
      });
    } catch (err) {
      console.error("Failed posting announcement:", err);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    try {
      const annDoc = doc(db, "announcements", id);
      await deleteDoc(annDoc);
    } catch (err) {
      console.error("Failed deleting announcement:", err);
    }
  };

  const role: UserRole = userProfile?.role || "standard";
  const isPro = role === "pro" || role === "admin";
  const isAdmin = role === "admin";

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        role,
        isPro,
        isAdmin,
        loading,
        authError,
        clearAuthError,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOutUser,
        updateProfileData,
        watchlist,
        isLotWatchlisted,
        addToWatchlist,
        removeFromWatchlist,
        updateWatchlistItem,
        searchAlerts,
        addSearchAlert,
        removeSearchAlert,
        toggleSearchAlert,
        announcements,
        postAnnouncement,
        deleteAnnouncement
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
