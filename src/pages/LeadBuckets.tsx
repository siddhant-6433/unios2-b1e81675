import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { School, GraduationCap, Search, Loader2, UserPlus, CheckCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── Lead Freshness / Urgency Indicator ──────────────────────
function getUrgency(createdAt: string) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const mins = ageMs / 60000;
  const hours = mins / 60;
  const days = hours / 24;

  if (mins < 30) return { level: "fresh", label: `${Math.floor(mins)}m`, color: "text-emerald-600", bg: "bg-emerald-500", barWidth: "100%", pulse: false };
  if (hours < 2) return { level: "warm", label: `${Math.floor(mins)}m`, color: "text-amber-600", bg: "bg-amber-400", barWidth: "75%", pulse: false };
  if (hours < 6) return { level: "cooling", label: `${Math.round(hours)}h`, color: "text-orange-600", bg: "bg-orange-500", barWidth: "50%", pulse: false };
  if (hours < 24) return { level: "urgent", label: `${Math.round(hours)}h`, color: "text-red-600", bg: "bg-red-500", barWidth: "25%", pulse: true };
  return { level: "critical", label: `${Math.round(days)}d`, color: "text-red-700", bg: "bg-red-700", barWidth: "10%", pulse: true };
}

function UrgencyBadge({ createdAt }: { createdAt: string }) {
  const u = getUrgency(createdAt);
  const labels: Record<string, string> = {
    fresh: "Fresh", warm: "Warm", cooling: "Cooling", urgent: "Urgent", critical: "Critical",
  };

  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      {/* Bar indicator */}
      <div className="relative w-10 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${u.bg} ${u.pulse ? "animate-pulse" : ""}`}
          style={{ width: u.barWidth }}
        />
      </div>
      {/* Label */}
      <div className="flex items-center gap-1">
        {(u.level === "urgent" || u.level === "critical") && (
          <AlertTriangle className={`h-3 w-3 ${u.color} ${u.pulse ? "animate-pulse" : ""}`} />
        )}
        <span className={`text-[10px] font-bold ${u.color}`}>
          {labels[u.level]} · {u.label}
        </span>
      </div>
    </div>
  );
}

interface BucketLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_name: string | null;
  campus_name: string | null;
  created_at: string;
  lead_score: number;
  lead_temperature: string;
  bucket: "school" | "college";
}

interface Counsellor {
  id: string;
  display_name: string;
}

const SOURCE_LABELS: Record<string, string> = {
  website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads",
  justdial: "JustDial", shiksha: "Shiksha", collegehai: "CollegeHai",
  collegedunia: "CollegeDunia", walk_in: "Walk-in", referral: "Referral",
  education_fair: "Education Fair", consultant: "Consultant", other: "Other",
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted",
};

function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return "****";
  return "••••••" + phone.slice(-4);
}

export default function LeadBuckets() {
  const { user, role, profile } = useAuth();
  const { selectedCampusId } = useCampus();
  const { toast } = useToast();

  const [activeBucket, setActiveBucket] = useState<"school" | "college">("college");
  const [schoolFilter, setSchoolFilter] = useState<"all" | "mirai" | "nimt">("all");
  const [leads, setLeads] = useState<BucketLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bucket counts
  const [schoolCount, setSchoolCount] = useState(0);
  const [miraiSchoolCount, setMiraiSchoolCount] = useState(0);
  const [nimtSchoolCount, setNimtSchoolCount] = useState(0);
  const [collegeCount, setCollegeCount] = useState(0);

  // Detect if user is Mirai counsellor
  const MIRAI_CAMPUS_ID = "c0000002-0000-0000-0000-000000000001";
  const isMiraiUser = profile?.campus?.toLowerCase().includes("mirai") || selectedCampusId === MIRAI_CAMPUS_ID;

  // Self-assign dialog
  const [showAssign, setShowAssign] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Admin: assign to specific counsellor
  const isSuperAdmin = role === "super_admin";
  const isAdminRole = role === "super_admin" || role === "admission_head" || role === "campus_admin" || role === "principal";
  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [selectedCounsellor, setSelectedCounsellor] = useState<string>("");

  const fetchCounts = async () => {
    const [sRes, mRes, nRes, cRes] = await Promise.all([
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "school"),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "school").eq("campus_id", MIRAI_CAMPUS_ID),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "school").neq("campus_id", MIRAI_CAMPUS_ID),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "college"),
    ]);
    setSchoolCount(sRes.count ?? 0);
    setMiraiSchoolCount(mRes.count ?? 0);
    setNimtSchoolCount(nRes.count ?? 0);
    setCollegeCount(cRes.count ?? 0);
  };

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from("unassigned_leads_bucket" as any)
      .select("*")
      .eq("bucket", activeBucket)
      .order("created_at", { ascending: false });

    // Apply school sub-filter
    if (activeBucket === "school" && schoolFilter === "mirai") {
      query = query.eq("campus_id", MIRAI_CAMPUS_ID);
    } else if (activeBucket === "school" && schoolFilter === "nimt") {
      query = query.or(`campus_id.neq.${MIRAI_CAMPUS_ID},campus_id.is.null`);
    }

    const { data, error } = await query;
    if (error) console.error("Lead buckets fetch error:", error);
    setLeads((data || []) as any);
    setSelectedIds(new Set());
    setLoading(false);
  };

  useEffect(() => { fetchCounts(); }, [selectedCampusId]);
  useEffect(() => { fetchLeads(); }, [activeBucket, schoolFilter, selectedCampusId]);

  useEffect(() => {
    if (!isAdminRole) return;
    (async () => {
      // Get counsellor user_ids, then fetch their profiles
      // leads.counsellor_id FK → profiles.id, so dropdown values must be profiles.id
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["counsellor", "admission_head"]);
      if (!roles || roles.length === 0) { setCounsellors([]); return; }
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("user_id", userIds);
      setCounsellors(
        (profiles || []).map((p: any) => ({
          id: p.id, // profiles.id — matches leads.counsellor_id FK
          display_name: p.display_name || "Unknown",
        }))
      );
    })();
  }, [isAdminRole]);

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.name.toLowerCase().includes(q) || (l.course_name || "").toLowerCase().includes(q);
  }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // Most urgent (oldest) first

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l) => l.id)));
    }
  };

  const handleAssign = async () => {
    // counsellor_id FK references profiles.id, NOT auth.users.id
    // For self-assign: use profile.id. For admin-assign: selectedCounsellor is already profile.id
    const assignTo = isAdminRole ? selectedCounsellor : profile?.id;
    if (!assignTo) return;

    setAssigning(true);
    const ids = Array.from(selectedIds);

    // Use claim_leads RPC — counsellors can't UPDATE via direct query due to RLS
    // (can_view_lead returns false for unassigned leads). RPC uses SECURITY DEFINER.
    const { data, error } = await supabase.rpc("claim_leads" as any, {
      _lead_ids: ids,
      _assign_to: assignTo,
    });

    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
    } else {
      const result = Array.isArray(data) ? data[0] : data;
      const assignedCount = result?.assigned_count ?? ids.length;
      const failedCount = result?.failed_count ?? 0;
      if (assignedCount === 0) {
        toast({
          title: "No leads assigned",
          description: "These leads may already be assigned to another counsellor.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Leads assigned",
          description: failedCount > 0
            ? `${assignedCount} assigned, ${failedCount} already claimed.`
            : `${assignedCount} lead${assignedCount > 1 ? "s" : ""} assigned successfully.`,
        });
      }
    }
    setAssigning(false);
    setShowAssign(false);
    setSelectedCounsellor("");
    await fetchLeads();
    await fetchCounts();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lead Buckets</h1>
        <p className="text-sm text-muted-foreground mt-1">Pick up unassigned leads from school or college buckets</p>
      </div>

      {/* Bucket toggle — three buckets: College, CBSE Schools, Mirai */}
      <div className="flex gap-3">
        <Card
          className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === "college" ? "ring-2 ring-primary/40 bg-primary/5" : "border-border/60"}`}
          onClick={() => { setActiveBucket("college"); setSchoolFilter("all"); }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-blue shrink-0">
              <GraduationCap className="h-5 w-5 text-foreground/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">College Leads</p>
              <p className="text-xs text-muted-foreground">Unassigned college leads</p>
            </div>
            <span className="text-xl font-bold text-foreground">{collegeCount}</span>
          </CardContent>
        </Card>

        <Card
          className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === "school" && schoolFilter !== "mirai" ? "ring-2 ring-primary/40 bg-primary/5" : "border-border/60"}`}
          onClick={() => { setActiveBucket("school"); setSchoolFilter("nimt"); }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-yellow shrink-0">
              <School className="h-5 w-5 text-foreground/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">CBSE School Leads</p>
              <p className="text-xs text-muted-foreground">NIMT Arthala &amp; Avantika II</p>
            </div>
            <span className="text-xl font-bold text-foreground">{nimtSchoolCount}</span>
          </CardContent>
        </Card>

        <Card
          className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === "school" && schoolFilter === "mirai" ? "ring-2 ring-violet-400/60 bg-violet-50/50 dark:bg-violet-950/10" : "border-border/60"}`}
          onClick={() => { setActiveBucket("school"); setSchoolFilter("mirai"); }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30 shrink-0">
              <School className="h-5 w-5 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">Mirai IB Leads</p>
              <p className="text-xs text-muted-foreground">Mirai Experiential School</p>
            </div>
            <span className="text-xl font-bold text-violet-600">{miraiSchoolCount}</span>
          </CardContent>
        </Card>
      </div>

      {/* Quick pick batches */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground mr-1">Quick pick:</span>
          {[5, 10, 15, 20, 30, 50].map((n) => (
            <Button
              key={n}
              variant={selectedIds.size === n ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={filtered.length < n}
              onClick={() => {
                const ids = new Set(filtered.slice(0, n).map((l) => l.id));
                setSelectedIds(ids);
              }}
            >
              {n} leads
            </Button>
          ))}
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" className="gap-2" onClick={() => {
              if (isAdminRole) { setShowAssign(true); } else { handleAssign(); }
            }}>
              <UserPlus className="h-4 w-4" />
              {isAdminRole ? "Assign to Counsellor" : "Assign to Me"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or course..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <CheckCircle className="h-5 w-5 mr-2" />
          No unassigned {activeBucket} leads
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left w-10">
                  <Checkbox
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Urgency</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lead</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Campus</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Stage</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const urgency = getUrgency(lead.created_at);
                const rowBg = selectedIds.has(lead.id) ? "bg-primary/5"
                  : urgency.level === "critical" ? "bg-red-50/60 dark:bg-red-950/10"
                  : urgency.level === "urgent" ? "bg-red-50/30 dark:bg-red-950/5"
                  : "";
                return (
                <tr
                  key={lead.id}
                  className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowBg}`}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedIds.has(lead.id)}
                      onCheckedChange={() => toggleSelect(lead.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <UrgencyBadge createdAt={lead.created_at} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{lead.name}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {maskPhone(lead.phone)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-[10px]">
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.course_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {lead.campus_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">
                      {STAGE_LABELS[lead.stage] || lead.stage}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(lead.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign dialog */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Leads to Counsellor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} will be assigned to the selected counsellor.
            </p>
            <select
              value={selectedCounsellor}
              onChange={(e) => setSelectedCounsellor(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">Select a counsellor...</option>
              {counsellors.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || !selectedCounsellor}
              className="gap-2"
            >
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
