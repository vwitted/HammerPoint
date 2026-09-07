import { AuctionListing, AuctionCluster } from "../types";

/**
 * Calculates the Haversine distance in miles between two geographical coordinates.
 */
export function getDistanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Clusters a list of auction listings.
 * Any listing within the specified radius (50 miles by default) of an existing
 * cluster's representative point will be added to that cluster.
 * If radiusInMiles is 0, null, or Infinity (Unlimited distance), listings are clustered
 * at tight local facility level (~5 miles) so assets at the same auction warehouse are grouped
 * together, while preserving all geographic locations worldwide without artificial distance cutoffs.
 */
export function clusterListings(listings: AuctionListing[], radiusInMiles: number | null = 50): AuctionCluster[] {
  const clusters: AuctionCluster[] = [];

  // 0, null, or Infinity represents Unlimited Distance
  const isUnlimited = radiusInMiles === null || radiusInMiles <= 0 || !isFinite(radiusInMiles);
  const effectiveRadius = isUnlimited ? 5 : radiusInMiles;

  for (const listing of listings) {
    if (
      listing.latitude === undefined || 
      listing.longitude === undefined || 
      isNaN(listing.latitude) || 
      isNaN(listing.longitude)
    ) {
      continue;
    }

    let joinedCluster = false;

    for (const cluster of clusters) {
      // Calculate distance to the cluster's representative point
      const dist = getDistanceInMiles(
        listing.latitude,
        listing.longitude,
        cluster.latitude,
        cluster.longitude
      );

      if (dist <= effectiveRadius) {
        cluster.listings.push(listing);
        joinedCluster = true;
        break;
      }
    }

    if (!joinedCluster) {
      // Create a new cluster represented by this listing's location
      clusters.push({
        id: `cluster-${listing.id}`,
        latitude: listing.latitude,
        longitude: listing.longitude,
        centerAddress: listing.address,
        listings: [listing]
      });
    }
  }

  return clusters;
}
