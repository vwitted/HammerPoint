export interface AuctionListing {
  id: string;
  title: string;
  url: string;
  details: string;
  endingDate: string; // ISO 8601 string
  address: string;
  latitude: number;
  longitude: number;
  auctioneer: string;
  category: string;
  status: string;
  country: string; // 'US' or 'UK'
  currentPrice?: number | null;
  startPrice?: number | null;
  reserve?: number | null;
  estimateStr?: string;
  currency?: string;
  startDate?: string | null;
  auctionType?: string;
  imageUrl?: string;
  sourcePlatform?: string;
  isUnpriced?: boolean;
  bidLabel?: string;
  minNextBid?: string;
  reserveStatus?: string;
}

export interface AuctionCluster {
  id: string;
  latitude: number;
  longitude: number;
  centerAddress: string;
  listings: AuctionListing[];
}

export interface SearchReference {
  title: string;
  url: string;
}

export type UserRole = "admin" | "pro" | "standard";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  company?: string;
  phone?: string;
  preferredRadius?: number; // In miles (e.g. 50, 100, 200, 500)
  createdAt: string;
  updatedAt?: string;
}

export interface WatchlistItem {
  id: string; // Document ID (usually lotId)
  lotId: string;
  title: string;
  auctioneer: string;
  location: string;
  price?: number;
  endingDate: string;
  url: string;
  category: string;
  country: string;
  notes?: string;
  myMaxBid?: number;
  savedAt: string;
}

export interface SearchAlert {
  id: string;
  keyword: string;
  category: string;
  radius: number;
  country: string;
  createdAt: string;
  active: boolean;
}

export interface PlatformAnnouncement {
  id: string;
  title: string;
  content: string;
  type: "info" | "warning" | "success";
  createdAt: string;
  createdBy: string;
  active: boolean;
}
