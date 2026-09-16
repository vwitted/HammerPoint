import React, { useEffect, useState } from "react";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { AuctionCluster } from "../types";
import { MapPin, Layers, Crosshair, AlertTriangle } from "lucide-react";

const API_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY || "";

const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

interface AuctionMapProps {
  clusters: AuctionCluster[];
  selectedCluster: AuctionCluster | null;
  onClusterSelect: (cluster: AuctionCluster | null) => void;
}

// Controller component to smoothly center/zoom the map on prop changes
function MapController({ selectedCluster, clusters }: { selectedCluster: AuctionCluster | null; clusters: AuctionCluster[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    if (selectedCluster) {
      map.panTo({ lat: selectedCluster.latitude, lng: selectedCluster.longitude });
      // If it's a tight cluster, zoom in closer
      if (selectedCluster.listings.length > 1) {
        map.setZoom(11);
      } else {
        map.setZoom(13);
      }
    } else if (clusters.length > 0 && typeof (window as any).google !== "undefined" && (window as any).google.maps?.LatLngBounds) {
      try {
        const bounds = new (window as any).google.maps.LatLngBounds();
        clusters.forEach((c) => bounds.extend({ lat: c.latitude, lng: c.longitude }));
        map.fitBounds(bounds, 45);
      } catch (e) {
        // Silent fallback to default center
      }
    }
  }, [map, selectedCluster, clusters]);

  return null;
}

export default function AuctionMap({
  clusters,
  selectedCluster,
  onClusterSelect
}: AuctionMapProps) {
  const [mapCenter, setMapCenter] = useState({ lat: 39.8283, lng: -98.5795 }); // Center of US
  const [mapZoom, setMapZoom] = useState(4);
  const [authErrorDetected, setAuthErrorDetected] = useState(false);

  // Set up global Google Maps authentication error listener to capture restrictions/API issues
  useEffect(() => {
    const originalFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      setAuthErrorDetected(true);
      if (originalFailure) {
        try {
          originalFailure();
        } catch (e) {}
      }
    };
    return () => {
      (window as any).gm_authFailure = originalFailure;
    };
  }, []);

  // Centering & framing when clusters list updates
  useEffect(() => {
    if (clusters.length > 0) {
      const sumLat = clusters.reduce((acc, c) => acc + c.latitude, 0);
      const sumLng = clusters.reduce((acc, c) => acc + c.longitude, 0);
      setMapCenter({
        lat: sumLat / clusters.length,
        lng: sumLng / clusters.length
      });
      
      // Determine how spread out the markers are to set an appropriate zoom level
      const latitudes = clusters.map(c => c.latitude);
      const minLat = Math.min(...latitudes);
      const maxLat = Math.max(...latitudes);
      const latsRange = maxLat - minLat;

      if (latsRange > 15) {
        setMapZoom(4); // Mixed or whole US
      } else if (latsRange > 3) {
        setMapZoom(6); // UK focus or a single state
      } else {
        setMapZoom(8); // High density local region
      }
    } else {
      // Default nationwide fallback
      setMapCenter({ lat: 39.8283, lng: -98.5795 });
      setMapZoom(4);
    }
  }, [clusters]);

  if (!hasValidKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-100 shadow-inner">
        <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mb-4 border border-blue-500/20">
          <MapPin className="w-8 h-8 animate-pulse" />
        </div>
        
        <h3 className="text-xl font-semibold mb-2 font-sans tracking-tight">Interactive Map Key Required</h3>
        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          The map relies on Google Maps Platform. You can view, filter, and scrape auctions, but to display them on the interactive map:
        </p>

        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-left max-w-md w-full text-xs space-y-3 mb-6 font-mono text-slate-300">
          <p>
            <span className="text-blue-400 font-bold">1.</span> <a href="https://console.cloud.google.com/google/maps-apis/start" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">Create a Google Maps API Key</a>
          </p>
          <p>
            <span className="text-blue-400 font-bold">2.</span> Add it to your <code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-300">.env</code> file as <code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-300">VITE_GOOGLE_MAPS_PLATFORM_KEY</code>
          </p>
          <p>
            <span className="text-blue-400 font-bold">3.</span> Restart the dev server (or rebuild for production)
          </p>
        </div>

        {/* Beautiful fallback mock map representation to keep app functional */}
        <div className="mt-6 w-full max-w-md border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2 mb-3 font-mono">
            <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> 50-Mile Clusters (Demo Mode)</span>
            <span>{clusters.length} Regions Detected</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-left max-h-40 overflow-y-auto">
            {clusters.map((cluster) => (
              <button
                key={cluster.id}
                onClick={() => onClusterSelect(selectedCluster?.id === cluster.id ? null : cluster)}
                className={`p-2 rounded text-xs text-left transition-all flex flex-col justify-between border ${
                  selectedCluster?.id === cluster.id
                    ? "bg-blue-500/20 border-blue-500 text-blue-300"
                    : "bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/40"
                }`}
              >
                <span className="font-semibold truncate max-w-[150px]">{cluster.listings[0].address.split(",").slice(-2).join(",").trim()}</span>
                <span className="text-[10px] text-slate-500 mt-1">{cluster.listings.length} auction{cluster.listings.length > 1 ? "s" : ""}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (authErrorDetected) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-100 shadow-inner">
        <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
          <AlertTriangle className="w-8 h-8 animate-pulse" />
        </div>
        
        <h3 className="text-lg font-semibold mb-2 font-sans tracking-tight text-red-400">Map Key Restriction Error</h3>
        <p className="text-xs text-slate-400 max-w-md mb-4 leading-relaxed">
          Your Google Maps API Key has <strong className="text-white">API Restrictions</strong> configured that prevent loading the <strong className="text-white">Maps JavaScript API</strong>.
        </p>

        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-left max-w-md w-full text-[11px] space-y-2 mb-4 font-mono text-slate-300">
          <p className="text-amber-400 font-bold uppercase tracking-wider text-[9px]">How to fix ApiTargetBlockedMapError:</p>
          <p>
            <span className="text-blue-400 font-bold">1.</span> Open the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">Google Cloud Console Credentials Page</a>
          </p>
          <p>
            <span className="text-blue-400 font-bold">2.</span> Click your API key name (the one in <code className="bg-slate-800 px-1 py-0.5 rounded text-blue-300">VITE_GOOGLE_MAPS_PLATFORM_KEY</code>)
          </p>
          <p>
            <span className="text-blue-400 font-bold">3.</span> Scroll to the <strong className="text-white">API restrictions</strong> section at the bottom
          </p>
          <p>
            <span className="text-blue-400 font-bold">4.</span> Either set it to <strong className="text-white">"Don't restrict key"</strong> (simplest for dev), OR under <strong className="text-white">"Restrict key"</strong>, ensure <strong className="text-yellow-400">"Maps JavaScript API"</strong> is checked in the dropdown list.
          </p>
          <p>
            <span className="text-blue-400 font-bold">5.</span> Click <strong className="text-white">Save</strong>. Wait 2-3 minutes for the settings to take effect.
          </p>
        </div>

        {/* Fallback layout to let user keep using the application */}
        <div className="w-full max-w-md border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40 p-3 text-left">
          <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2 mb-2 font-mono">
            <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-blue-500" /> Regional Clusters (Fallback Mode)</span>
            <span>{clusters.length} Regions</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
            {clusters.map((cluster) => (
              <button
                key={cluster.id}
                onClick={() => onClusterSelect(selectedCluster?.id === cluster.id ? null : cluster)}
                className={`p-1.5 rounded text-[11px] text-left transition-all flex flex-col justify-between border ${
                  selectedCluster?.id === cluster.id
                    ? "bg-blue-500/20 border-blue-500 text-blue-300 font-bold"
                    : "bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-800/40"
                }`}
              >
                <span className="font-semibold truncate max-w-[150px]">{cluster.listings[0].address.split(",").slice(-2).join(",").trim()}</span>
                <span className="text-[9px] text-slate-500 mt-0.5">{cluster.listings.length} item{cluster.listings.length > 1 ? "s" : ""}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
      <APIProvider apiKey={API_KEY} version="weekly">
        <Map
          defaultCenter={mapCenter}
          defaultZoom={mapZoom}
          style={{ width: "100%", height: "100%" }}
          disableDefaultUI={false}
          gestureHandling="cooperative"
        >
          {clusters.map((cluster) => {
            const isSelected = selectedCluster?.id === cluster.id;
            const count = cluster.listings.length;

            return (
              <Marker
                key={cluster.id}
                position={{ lat: cluster.latitude, lng: cluster.longitude }}
                title={`${count} lot${count > 1 ? "s" : ""} in this region`}
                onClick={() => onClusterSelect(isSelected ? null : cluster)}
                label={count > 1 ? {
                  text: String(count),
                  color: "#ffffff",
                  fontWeight: "bold",
                  fontSize: "12px"
                } : undefined}
              />
            );
          })}

          <MapController selectedCluster={selectedCluster} clusters={clusters} />
        </Map>
      </APIProvider>

      {/* Floating Map Reset / Info HUD with Professional Polish styling */}
      {selectedCluster && (
        <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-3 shadow-md max-w-sm text-xs z-10 transition-all duration-300">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1">
                <Crosshair className="w-3 h-3 text-blue-600" /> Filtered location active
              </p>
              <p className="font-bold text-slate-800 mt-1 truncate">
                {selectedCluster.centerAddress}
              </p>
              <p className="text-slate-500 mt-0.5">
                Showing {selectedCluster.listings.length} commercial lot{selectedCluster.listings.length > 1 ? "s" : ""} at this facility.
              </p>
            </div>
            <button
              onClick={() => onClusterSelect(null)}
              className="text-blue-600 hover:text-blue-800 font-bold px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap"
            >
              Show All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
