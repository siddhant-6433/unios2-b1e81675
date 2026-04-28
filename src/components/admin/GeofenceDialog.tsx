import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, Save, Loader2, Search, Navigation, Radius,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface GeofenceDialogProps {
  open: boolean;
  onClose: () => void;
  campus: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    geofence_radius_meters: number | null;
  };
  onSaved: () => void;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

export default function GeofenceDialog({ open, onClose, campus, onSaved }: GeofenceDialogProps) {
  const { toast } = useToast();
  const [lat, setLat] = useState<number | null>(campus.latitude);
  const [lng, setLng] = useState<number | null>(campus.longitude);
  const [radiusM, setRadiusM] = useState(campus.geofence_radius_meters || 500);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [pasteCoords, setPasteCoords] = useState("");

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    setLat(campus.latitude);
    setLng(campus.longitude);
    setRadiusM(campus.geofence_radius_meters || 500);
    setResults([]);
    setShowResults(false);
    setSearchQuery("");
    setPasteCoords("");
  }, [campus]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!open || !mapContainerRef.current) return;
    // Small delay to let the DOM render the container
    const timer = setTimeout(() => {
      if (mapRef.current || !mapContainerRef.current) return;

      const defaultCenter: [number, number] = lat && lng ? [lat, lng] : [28.47, 77.50];
      const defaultZoom = lat && lng ? 16 : 12;

      const map = L.map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: defaultZoom,
        scrollWheelZoom: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Click handler
      map.on("click", (e: L.LeafletMouseEvent) => {
        const clickLat = Math.round(e.latlng.lat * 1000000) / 1000000;
        const clickLng = Math.round(e.latlng.lng * 1000000) / 1000000;
        setLat(clickLat);
        setLng(clickLng);
      });

      mapRef.current = map;

      // Place initial marker if coords exist
      if (lat && lng) {
        updateMapMarker(map, lat, lng, radiusM);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
  }, [open]); // only on open/close

  // Update marker and circle when lat/lng/radius change
  useEffect(() => {
    if (!mapRef.current) return;
    if (lat && lng) {
      updateMapMarker(mapRef.current, lat, lng, radiusM);
      mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
    }
  }, [lat, lng, radiusM]);

  const updateMapMarker = (map: L.Map, lat: number, lng: number, radius: number) => {
    // Remove old
    if (markerRef.current) map.removeLayer(markerRef.current);
    if (circleRef.current) map.removeLayer(circleRef.current);

    // Add marker
    const icon = L.icon({
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
    markerRef.current = L.marker([lat, lng], { icon }).addTo(map);

    // Add circle
    circleRef.current = L.circle([lat, lng], {
      radius,
      color: "#0035C5",
      fillColor: "#0035C5",
      fillOpacity: 0.12,
      weight: 2,
      dashArray: "6 4",
    }).addTo(map);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setResults([]);

    const queries = [searchQuery, searchQuery + ", India"];
    for (const q of queries) {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
          { headers: { "User-Agent": "UniOs/1.0" } }
        );
        const data: SearchResult[] = await res.json();
        if (data.length > 0) {
          setResults(data);
          setShowResults(true);
          if (data.length === 1) selectResult(data[0]);
          setSearching(false);
          return;
        }
      } catch {}
    }
    toast({ title: "No results", description: "Click on the map to place the pin, or paste coordinates from Google Maps." });
    setSearching(false);
  };

  const selectResult = (result: SearchResult) => {
    setLat(parseFloat(result.lat));
    setLng(parseFloat(result.lon));
    setShowResults(false);
    setSearchQuery(result.display_name.split(",").slice(0, 3).join(","));
  };

  const handlePasteCoords = (value: string) => {
    setPasteCoords(value);
    const match = value.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (match) {
      setLat(parseFloat(match[1]));
      setLng(parseFloat(match[2]));
    }
  };

  const handleSave = async () => {
    if (lat === null || lng === null) {
      toast({ title: "Error", description: "Set coordinates first.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("campuses").update({
      latitude: lat,
      longitude: lng,
      geofence_radius_meters: radiusM,
    }).eq("id", campus.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Geofence saved", description: `${campus.name} geofence updated (${radiusM}m radius)` });
      onSaved();
      onClose();
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Set Geofence — {campus.name}</h2>
              <p className="text-xs text-muted-foreground">Click on the map to place the pin, then adjust the radius</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Search Location</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search address or place name..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowResults(false); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full rounded-lg border border-input bg-card pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <Button onClick={handleSearch} disabled={searching} variant="outline" className="gap-1.5">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>

            {showResults && results.length > 1 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-card rounded-lg border border-border shadow-lg max-h-48 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => selectResult(r)}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0 flex items-start gap-2"
                  >
                    <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <span className="text-foreground leading-snug">{r.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Interactive Leaflet Map */}
          <div className="rounded-xl overflow-hidden border border-border/60 relative" style={{ height: 300 }}>
            <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />
            <div className="absolute top-3 right-3 z-[1000]">
              <Badge className="bg-card/90 text-foreground border border-border shadow-sm text-xs gap-1">
                <Radius className="h-3 w-3" />
                {radiusM}m radius
              </Badge>
            </div>
            {!lat && !lng && (
              <div className="absolute inset-0 z-[999] pointer-events-none flex items-center justify-center">
                <div className="bg-card/80 backdrop-blur-sm rounded-lg px-4 py-2 shadow-sm">
                  <p className="text-sm text-muted-foreground font-medium">Click on the map to place the campus pin</p>
                </div>
              </div>
            )}
          </div>

          {/* Paste coordinates */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Or paste coordinates from Google Maps
            </label>
            <input
              type="text"
              placeholder="e.g. 28.4672459, 77.5083759"
              value={pasteCoords}
              onChange={(e) => handlePasteCoords(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Coordinates + Radius */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                <Navigation className="inline h-3 w-3 mr-1" />Latitude
              </label>
              <input
                type="number" step="0.000001" placeholder="28.4672"
                value={lat ?? ""} onChange={(e) => setLat(parseFloat(e.target.value) || null)}
                className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                <Navigation className="inline h-3 w-3 mr-1" />Longitude
              </label>
              <input
                type="number" step="0.000001" placeholder="77.5084"
                value={lng ?? ""} onChange={(e) => setLng(parseFloat(e.target.value) || null)}
                className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                <Radius className="inline h-3 w-3 mr-1" />Radius
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min="50" max="2000" step="50"
                  value={radiusM}
                  onChange={(e) => setRadiusM(parseInt(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-mono text-foreground w-14 text-right">{radiusM}m</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || lat === null || lng === null} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Geofence
          </Button>
        </div>
      </div>
    </div>
  );
}
