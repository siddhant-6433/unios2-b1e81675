import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, Save, Loader2, Building2, Navigation, Radius, CalendarDays, Info, KeyRound, ShieldCheck, Trash2,
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
  maps_cid: string | null;
}

interface PasskeySummary {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
}

type DeadlineKey = "fee_submission_deadline" | "full_course_payment_deadline";

const DEADLINE_LABELS: Record<DeadlineKey, { title: string; help: string }> = {
  fee_submission_deadline: {
    title: "Pending Fee + Scholarship Deadline",
    help: "Last date for first-year pending fee submission AND availing the 1-year fee conversion (additional scholarship). Shown to applicants on the offer view. Extending this date applies to every active offer in one shot.",
  },
  full_course_payment_deadline: {
    title: "Full-Course Lump-Sum Deadline",
    help: 'Last date the "Pay all course fees at one go" option is offered on the applicant portal. After this date the BEST VALUE card hides; only the year-1 lump-sum stays.',
  },
};

const Settings = () => {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = requestedTab === "geofence" || requestedTab === "deadlines" ? requestedTab : "account";
  const [tab, setTab] = useState<"account" | "geofence" | "deadlines">(initialTab);

  // ── Deadlines state ────────────────────────────────────────────
  const [deadlines, setDeadlines] = useState<Record<DeadlineKey, string>>({
    fee_submission_deadline: "",
    full_course_payment_deadline: "",
  });
  const [deadlineEdits, setDeadlineEdits] = useState<Partial<Record<DeadlineKey, string>>>({});
  const [deadlinesLoading, setDeadlinesLoading] = useState(true);
  const [savingDeadline, setSavingDeadline] = useState<DeadlineKey | null>(null);
  const [campuses, setCampuses] = useState<CampusGeofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<CampusGeofence>>>({});
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);

  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    const nextTab = requestedTab === "geofence" || requestedTab === "deadlines" ? requestedTab : "account";
    setTab(nextTab);
  }, [requestedTab]);

  useEffect(() => {
    fetchPasskeys();
  }, [user?.id]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setLoading(false);
      setDeadlinesLoading(false);
      return;
    }

    fetchCampuses();
    fetchDeadlines();
  }, [isSuperAdmin]);

  const selectTab = (nextTab: "account" | "geofence" | "deadlines") => {
    setTab(nextTab);
    setSearchParams(nextTab === "account" ? {} : { tab: nextTab });
  };

  const fetchPasskeys = async () => {
    if (!user) {
      setPasskeys([]);
      setPasskeysLoading(false);
      return;
    }

    setPasskeysLoading(true);
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      toast({ title: "Could not load passkeys", description: error.message, variant: "destructive" });
    } else {
      setPasskeys(data || []);
    }
    setPasskeysLoading(false);
  };

  const registerPasskey = async () => {
    if (!("PublicKeyCredential" in window)) {
      toast({
        title: "Passkeys unavailable",
        description: "This browser or device does not support passkeys.",
        variant: "destructive",
      });
      return;
    }

    setPasskeySaving(true);
    const { error } = await supabase.auth.registerPasskey();
    if (error) {
      toast({ title: "Could not add passkey", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Passkey added", description: "You can now use this passkey from the UniOs login page." });
      await fetchPasskeys();
    }
    setPasskeySaving(false);
  };

  const deletePasskey = async (passkeyId: string) => {
    setDeletingPasskeyId(passkeyId);
    const { error } = await supabase.auth.passkey.delete({ passkeyId });
    if (error) {
      toast({ title: "Could not remove passkey", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Passkey removed" });
      setPasskeys((prev) => prev.filter((passkey) => passkey.id !== passkeyId));
    }
    setDeletingPasskeyId(null);
  };

  const fetchDeadlines = async () => {
    setDeadlinesLoading(true);
    const { data } = await (supabase as any).rpc("get_applicant_deadlines");
    if (data) {
      setDeadlines({
        fee_submission_deadline:      (data.fee_submission_deadline      as string) || "",
        full_course_payment_deadline: (data.full_course_payment_deadline as string) || "",
      });
    }
    setDeadlinesLoading(false);
  };

  const saveDeadline = async (key: DeadlineKey) => {
    const value = deadlineEdits[key];
    if (!value) return;
    setSavingDeadline(key);
    const { error } = await (supabase as any).rpc("set_applicant_deadline", { _key: key, _value: value });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `${DEADLINE_LABELS[key].title} updated.` });
      setDeadlines((prev) => ({ ...prev, [key]: value }));
      setDeadlineEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setSavingDeadline(null);
  };

  const fetchCampuses = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("campuses")
      .select("id, name, code, address, city, latitude, longitude, geofence_radius_meters, maps_cid")
      .order("name");
    if (data) setCampuses(data as CampusGeofence[]);
    setLoading(false);
  };

  const updateField = (campusId: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [campusId]: {
        ...prev[campusId],
        [field]:
          field === "maps_cid"
            ? (value.trim().length > 0 ? value.trim() : null)
            : field === "geofence_radius_meters"
            ? parseInt(value) || null
            : parseFloat(value) || null,
      },
    }));
  };

  const saveCampus = async (campus: CampusGeofence) => {
    const changes = edits[campus.id];
    if (!changes) return;

    setSaving(campus.id);
    const { error } = await (supabase as any)
      .from("campuses")
      .update({
        latitude: changes.latitude ?? campus.latitude,
        longitude: changes.longitude ?? campus.longitude,
        geofence_radius_meters: changes.geofence_radius_meters ?? campus.geofence_radius_meters,
        maps_cid: "maps_cid" in changes ? (changes.maps_cid ?? null) : campus.maps_cid,
      })
      .eq("id", campus.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `Geofence updated for ${campus.name}` });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[campus.id];
        return next;
      });
      await fetchCampuses();
    }
    setSaving(null);
  };

  const getMapUrl = (lat: number, lng: number, radiusM: number) =>
    `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Account security, system configuration, and campus settings</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1 w-fit">
        <button
          onClick={() => selectTab("account")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "account" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <KeyRound className="h-4 w-4" /> Account
        </button>
        <button
          onClick={() => selectTab("geofence")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "geofence" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MapPin className="h-4 w-4" /> Campus Geofence
        </button>
        <button
          onClick={() => selectTab("deadlines")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "deadlines" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Applicant Deadlines
        </button>
      </div>

      {tab === "account" && (
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Passkeys</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Use Face ID, fingerprint, device PIN, or a security key to sign in.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/60 bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Add this device as a passkey</p>
                <p className="text-xs text-muted-foreground mt-1">
                  After adding a passkey, choose "Sign in with passkey" on the login page.
                </p>
              </div>
              <Button onClick={registerPasskey} disabled={passkeySaving} className="gap-2 shrink-0">
                {passkeySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Add passkey
              </Button>
            </div>

            {passkeysLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : passkeys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium text-foreground">No passkeys added yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add one above to enable passkey login for your account.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {passkeys.map((passkey) => (
                  <div key={passkey.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {passkey.friendly_name || "Passkey"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(passkey.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {passkey.last_used_at
                          ? ` · Last used ${new Date(passkey.last_used_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deletePasskey(passkey.id)}
                      disabled={deletingPasskeyId === passkey.id}
                      className="gap-2 shrink-0 text-destructive hover:text-destructive"
                    >
                      {deletingPasskeyId === passkey.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "deadlines" && (
        <>
          {!isSuperAdmin ? (
            <Card className="border-border/60 shadow-none">
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Only super admins can manage applicant deadlines.</p>
              </CardContent>
            </Card>
          ) : deadlinesLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex gap-2 items-start">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-900 leading-relaxed">
                  These dates apply to <strong>every active offer</strong>. Extend them here in one shot — applicant portals refresh automatically on next load.
                </p>
              </div>

              {(Object.keys(DEADLINE_LABELS) as DeadlineKey[]).map((key) => {
                const meta    = DEADLINE_LABELS[key];
                const current = deadlines[key];
                const edited  = deadlineEdits[key];
                const value   = edited ?? current;
                const hasChange = edited !== undefined && edited !== current;

                return (
                  <Card key={key} className="border-border/60 shadow-none">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                          <CalendarDays className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base font-semibold">{meta.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Current: <strong>{current ? new Date(current).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}</strong>
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground leading-relaxed">{meta.help}</p>
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">New date</label>
                          <input
                            type="date"
                            value={value}
                            onChange={(e) => setDeadlineEdits((p) => ({ ...p, [key]: e.target.value }))}
                            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <Button
                          onClick={() => saveDeadline(key)}
                          disabled={!hasChange || savingDeadline === key}
                          className="gap-2 shrink-0"
                        >
                          {savingDeadline === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Save
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "geofence" && (
        <>
          {!isSuperAdmin ? (
            <Card className="border-border/60 shadow-none">
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Only super admins can manage geofence settings.</p>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Set the GPS coordinates and radius for each campus. Employees can only punch in when inside the geofence.
              </p>

              {campuses.map((campus) => {
                const edit = edits[campus.id] || {};
                const lat = edit.latitude ?? campus.latitude;
                const lng = edit.longitude ?? campus.longitude;
                const rad = edit.geofence_radius_meters ?? campus.geofence_radius_meters ?? 500;
                const mapsCid =
                  "maps_cid" in edit ? (edit.maps_cid ?? "") : (campus.maps_cid ?? "");
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
                            <p className="text-xs text-muted-foreground">
                              {campus.address || campus.city || campus.code}
                            </p>
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
                            type="number"
                            step="0.000001"
                            placeholder="26.8285"
                            value={lat ?? ""}
                            onChange={(e) => updateField(campus.id, "latitude", e.target.value)}
                            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            <Navigation className="inline h-3 w-3 mr-1" />Longitude
                          </label>
                          <input
                            type="number"
                            step="0.000001"
                            placeholder="75.7846"
                            value={lng ?? ""}
                            onChange={(e) => updateField(campus.id, "longitude", e.target.value)}
                            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            <Radius className="inline h-3 w-3 mr-1" />Radius (meters)
                          </label>
                          <input
                            type="number"
                            step="50"
                            min="50"
                            max="5000"
                            placeholder="500"
                            value={rad ?? ""}
                            onChange={(e) => updateField(campus.id, "geofence_radius_meters", e.target.value)}
                            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                      </div>

                      {/* Map preview */}
                      {lat && lng && (
                        <div className="rounded-lg overflow-hidden border border-border/60 h-48">
                          <iframe
                            src={getMapUrl(lat, lng, rad)}
                            width="100%"
                            height="100%"
                            style={{ border: 0 }}
                            allowFullScreen
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            title={`Map of ${campus.name}`}
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                          <MapPin className="inline h-3 w-3 mr-1" />Google Maps Place CID
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 1820424915210710582"
                          value={mapsCid}
                          onChange={(e) => updateField(campus.id, "maps_cid", e.target.value)}
                          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Used as the dynamic URL-button suffix for the <code>visit_confirmation</code> WhatsApp template.
                          Find it on Google Maps: open the campus listing, copy the share URL, extract the value after <code>?cid=</code>.
                        </p>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Tip: Find coordinates on Google Maps — right-click a location and copy the latitude, longitude values.
                      </p>

                      {hasChanges && (
                        <div className="flex justify-end">
                          <Button
                            onClick={() => saveCampus(campus)}
                            disabled={saving === campus.id}
                            className="gap-2"
                          >
                            {saving === campus.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            Save Geofence
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Settings;
