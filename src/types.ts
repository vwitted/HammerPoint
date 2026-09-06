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
  currentPrice?: number;
  startPrice?: number;
  reserve?: number;
  imageUrl?: string;
  sourcePlatform?: string;
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
