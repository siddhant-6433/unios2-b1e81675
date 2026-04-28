import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, Save, Loader2, Building2, Navigation, Radius,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CampusGeofence {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number | null;
}

export default function CampusGeofencePanel() {
  const { toast } = useToast();
  const [campuses, setCampuses] = useState<CampusGeofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<CampusGeofence>>>({});

  useEffect(() => { fetchCampuses(); }, []);

  const fetchCampuses = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("campuses")
      .select("id, name, code, address, city, latitude, longitude, geofence_radius_meters")
      .order("name");
    if (data) setCampuses(data as CampusGeofence[]);
    setLoading(false);
  };

  const updateField = (campusId: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [campusId]: {
        ...prev[campusId],
        [field]: field === "geofence_radius_meters" ? parseInt(value) || null : parseFloat(value) || null,
      },
    }));
  };

  const saveCampus = async (campus: CampusGeofence) => {
    const changes = edits[campus.id];
    if (!changes) return;

    setSaving(campus.id);
    const { error } = await supabase
      .from("campuses")
      .update({
        latitude: changes.latitude ?? campus.latitude,
        longitude: changes.longitude ?? campus.longitude,
        geofence_radius_meters: changes.geofence_radius_meters ?? campus.geofence_radius_meters,
      })
      .eq("id", campus.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `Geofence updated for ${campus.name}` });
      setEdits((prev) => { const next = { ...prev }; delete next[campus.id]; return next; });
      await fetchCampuses();
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set GPS coordinates and radius for each campus. Employees can only punch in when inside the geofence. Tip: right-click on Google Maps to copy coordinates.
      </p>

      {campuses.map((campus) => {
        const edit = edits[campus.id] || {};
        const lat = edit.latitude ?? campus.latitude;
        const lng = edit.longitude ?? campus.longitude;
        const rad = edit.geofence_radius_meters ?? campus.geofence_radius_meters ?? 500;
        const hasChanges = !!edits[campus.id];
        const isConfigured = campus.latitude !== null && campus.longitude !== null;

        return (
          <Card key={campus.id} className="border-border/60 shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">{campus.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{campus.address || campus.city || campus.code}</p>
                  </div>
                </div>
                <Badge className={`text-[10px] border-0 ${isConfigured ? "bg-pastel-green text-foreground/80" : "bg-pastel-yellow text-foreground/80"}`}>
                  {isConfigured ? "Configured" : "Not Set"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    <Navigation className="inline h-3 w-3 mr-1" />Latitude
                  </label>
                  <input
                    type="number" step="0.000001" placeholder="e.g. 26.8285"
                    value={lat ?? ""} onChange={(e) => updateField(campus.id, "latitude", e.target.value)}
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    <Navigation className="inline h-3 w-3 mr-1" />Longitude
                  </label>
                  <input
                    type="number" step="0.000001" placeholder="e.g. 75.7846"
                    value={lng ?? ""} onChange={(e) => updateField(campus.id, "longitude", e.target.value)}
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    <Radius className="inline h-3 w-3 mr-1" />Radius (meters)
                  </label>
                  <input
                    type="number" step="50" min="50" max="5000" placeholder="500"
                    value={rad ?? ""} onChange={(e) => updateField(campus.id, "geofence_radius_meters", e.target.value)}
                    className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>

              {lat && lng && (
                <div className="rounded-lg overflow-hidden border border-border/60 h-48">
                  <iframe
                    src={`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`}
                    width="100%" height="100%" style={{ border: 0 }}
                    allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                    title={`Map of ${campus.name}`}
                  />
                </div>
              )}

              {hasChanges && (
                <div className="flex justify-end">
                  <Button onClick={() => saveCampus(campus)} disabled={saving === campus.id} className="gap-2">
                    {saving === campus.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Geofence
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
