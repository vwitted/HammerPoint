// Precise coordinates mapper for common UK postcodes & locations
export const ukCoordinateLookup: Record<string, { latitude: number; longitude: number }> = {
  "wakefield": { latitude: 53.6829, longitude: -1.4912 },
  "waltham abbey": { latitude: 51.6874, longitude: -0.0035 },
  "malvern": { latitude: 52.1121, longitude: -2.3243 },
  "chester": { latitude: 53.1934, longitude: -2.8931 },
  "barnsley": { latitude: 53.5526, longitude: -1.4797 },
  "gravesend": { latitude: 51.4419, longitude: 0.3688 },
  "doncaster": { latitude: 53.5228, longitude: -1.1311 },
  "ripley": { latitude: 53.0478, longitude: -1.4111 },
  "sheffield": { latitude: 53.3811, longitude: -1.4701 },
  "leeds": { latitude: 53.8008, longitude: -1.5491 },
  "birmingham": { latitude: 52.4862, longitude: -1.8904 },
  "london": { latitude: 51.5074, longitude: -0.1278 },
  "stoke-on-trent": { latitude: 53.0027, longitude: -2.1794 },
  "stoke": { latitude: 53.0027, longitude: -2.1794 },
  "st4": { latitude: 53.0027, longitude: -2.1794 },
  "nottingham": { latitude: 52.9548, longitude: -1.1581 },
  "derby": { latitude: 52.9225, longitude: -1.4746 },
  "manchester": { latitude: 53.4808, longitude: -2.2426 },
  "liverpool": { latitude: 53.4084, longitude: -2.9916 },
  "bristol": { latitude: 51.4545, longitude: -2.5879 },
  "newcastle": { latitude: 54.9783, longitude: -1.6178 },
  "hull": { latitude: 53.7676, longitude: -0.3274 },
  "cardiff": { latitude: 51.4816, longitude: -3.1791 },
  "glasgow": { latitude: 55.8642, longitude: -4.2518 },
  "edinburgh": { latitude: 55.9533, longitude: -3.1883 },
  "leicester": { latitude: 52.6369, longitude: -1.1398 },
  "coventry": { latitude: 52.4068, longitude: -1.5197 },
  "southampton": { latitude: 50.9097, longitude: -1.4044 },
  "plymouth": { latitude: 50.3755, longitude: -4.1427 },
  "norwich": { latitude: 52.6309, longitude: 1.2974 },
  "oxford": { latitude: 51.7520, longitude: -1.2577 },
  "cambridge": { latitude: 52.2053, longitude: 0.1218 },
  "york": { latitude: 53.9599, longitude: -1.0873 },
  "peterborough": { latitude: 52.5695, longitude: -0.2405 },
  "northampton": { latitude: 52.2405, longitude: -0.9027 },
  "milton keynes": { latitude: 52.0406, longitude: -0.7594 }
};

// Precise coordinates mapper for common US states & cities (focus on SVD / Silicon Valley Disposition locations)
export const usCoordinateLookup: Record<string, { latitude: number; longitude: number }> = {
  "burlingame": { latitude: 37.5841, longitude: -122.3661 },
  "san francisco": { latitude: 37.7749, longitude: -122.4194 },
  "south san francisco": { latitude: 37.6547, longitude: -122.4077 },
  "san jose": { latitude: 37.3382, longitude: -121.8863 },
  "santa clara": { latitude: 37.3541, longitude: -121.9552 },
  "mountain view": { latitude: 37.3861, longitude: -122.0839 },
  "palo alto": { latitude: 37.4419, longitude: -122.1430 },
  "fremont": { latitude: 37.5485, longitude: -121.9886 },
  "modesto": { latitude: 37.6391, longitude: -120.9969 },
  "oakland": { latitude: 37.8044, longitude: -122.2712 },
  "sparks": { latitude: 39.5349, longitude: -119.7527 },
  "reno": { latitude: 39.5296, longitude: -119.8138 },
  "nevada": { latitude: 39.5349, longitude: -119.7527 },
  "nv": { latitude: 39.5349, longitude: -119.7527 },
  "boston": { latitude: 42.3601, longitude: -71.0589 },
  "massachusetts": { latitude: 42.3601, longitude: -71.0589 },
  "ma": { latitude: 42.3601, longitude: -71.0589 },
  "utah": { latitude: 40.7608, longitude: -111.8910 },
  "ut": { latitude: 40.7608, longitude: -111.8910 },
  "salt lake": { latitude: 40.7608, longitude: -111.8910 },
  "orem": { latitude: 40.2969, longitude: -111.6946 },
  "austin": { latitude: 30.2672, longitude: -97.7431 },
  "texas": { latitude: 30.2672, longitude: -97.7431 },
  "tx": { latitude: 30.2672, longitude: -97.7431 },
  "chicago": { latitude: 41.8781, longitude: -87.6298 },
  "new york": { latitude: 40.7128, longitude: -74.0060 },
  "ny": { latitude: 40.7128, longitude: -74.0060 },
  "seattle": { latitude: 47.6062, longitude: -122.3321 },
  "wa": { latitude: 47.6062, longitude: -122.3321 },
  "california": { latitude: 37.5841, longitude: -122.3661 },
  "ca": { latitude: 37.5841, longitude: -122.3661 }
};

// Helper to determine coordinates from address and country
export function getCoordinatesForLocation(address: string, country: string = "UK"): { latitude: number; longitude: number } {
  const lowerAddress = (address || "").toLowerCase();
  
  // If explicitly US or contains US indicators
  if (country === "US" || lowerAddress.includes("usa") || lowerAddress.includes(", ca") || lowerAddress.includes(", nv") || lowerAddress.includes(", ma") || lowerAddress.includes(", tx") || lowerAddress.includes(", ut")) {
    for (const [city, coords] of Object.entries(usCoordinateLookup)) {
      if (lowerAddress.includes(city)) {
        return coords;
      }
    }
    // Default US Silicon Valley Disposition headquarters
    return { latitude: 37.5841, longitude: -122.3661 };
  }

  // UK lookup
  for (const [city, coords] of Object.entries(ukCoordinateLookup)) {
    if (lowerAddress.includes(city)) {
      return coords;
    }
  }
  return { latitude: 51.5074, longitude: -0.1278 };
}
