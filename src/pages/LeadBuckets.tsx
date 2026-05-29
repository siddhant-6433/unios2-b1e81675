import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { School, GraduationCap, Search, Loader2, UserPlus, CheckCircle, AlertTriangle, ListPlus } from "lucide-react";
import { jdCategoryHint } from "@/lib/jdCategoryHint";
import { CahetPendingBadge } from "@/components/leads/CahetPendingBadge";
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
  jd_category: string | null;
  last_ai_summary: string | null;
  last_ai_disposition: string | null;
  last_ai_conversion_pct: number | null;
}

interface Counsellor {
  id: string;
  display_name: string;
}

const SOURCE_LABELS: Record<string, string> = {
  website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads",
  web_chat: "Web Chat", website_chat: "Web Chat",
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

interface SourceChipsProps {
  breakdown: { meta_ads: number; google_ads: number; website: number; web_chat: number };
  onPick: (source: string) => void;
}

function SourceChips({ breakdown, onPick }: SourceChipsProps) {
  const chips: Array<{ key: string; label: string; count: number; cls: string }> = [
    { key: "meta_ads", label: "Meta", count: breakdown.meta_ads, cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900" },
    { key: "google_ads", label: "Google", count: breakdown.google_ads, cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900" },
    { key: "website", label: "Website", count: breakdown.website, cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900" },
    { key: "web_chat", label: "Web Chat", count: breakdown.web_chat, cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={(e) => { e.stopPropagation(); onPick(c.key); }}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-opacity ${c.cls} ${c.count === 0 ? "opacity-50" : "hover:opacity-80"}`}
          title={`${c.label}: ${c.count}`}
        >
          <span>{c.label}</span>
          <span className="font-bold">{c.count}</span>
        </button>
      ))}
    </div>
  );
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
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bucket counts
  const [miraiSchoolCount, setMiraiSchoolCount] = useState(0);
  const [nimtSchoolCount, setNimtSchoolCount] = useState(0);
  const [collegeCount, setCollegeCount] = useState(0);

  // Per-bucket source breakdown for Meta Ads, Google Ads, Website, Web Chat
  type SourceBreakdown = { meta_ads: number; google_ads: number; website: number; web_chat: number };
  const emptyBreakdown: SourceBreakdown = { meta_ads: 0, google_ads: 0, website: 0, web_chat: 0 };
  const [collegeSources, setCollegeSources] = useState<SourceBreakdown>(emptyBreakdown);
  const [nimtSources, setNimtSources] = useState<SourceBreakdown>(emptyBreakdown);
  const [miraiSources, setMiraiSources] = useState<SourceBreakdown>(emptyBreakdown);

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

  // Save-as-list dialog
  const [showSaveList, setShowSaveList] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [listScope, setListScope] = useState<"selected" | "filtered">("selected");

  const fetchCounts = async () => {
    // Use `school_brand` from the view (added 20260613100000) instead of a
    // client-side `.or(campus_id.neq.MIRAI, campus_id.is.null)`. PostgREST
    // was dropping the `is.null` branch on that OR group, which silently
    // excluded every Meta lead-form lead (campus_id IS NULL) from the
    // CBSE card — bucket showed 13 while the underlying query had 88.
    const [mRes, nRes, cRes] = await Promise.all([
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("school_brand", "mirai"),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("school_brand", "nimt"),
      supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true }).eq("bucket", "college"),
    ]);
    setMiraiSchoolCount(mRes.count ?? 0);
    setNimtSchoolCount(nRes.count ?? 0);
    setCollegeCount(cRes.count ?? 0);

    // Source breakdown per bucket. We can't aggregate client-side from a
    // SELECT because PostgREST caps rows at 1000 — with 2k+ college leads
    // the aggregation silently undercounted (chip showed Meta 3 while the
    // source-filter dropdown showed 11). Use count-only queries instead.
    // `web_chat` and `website_chat` are both emitted by the chat widget
    // (legacy vs current) — coalesce via `.in()`.
    const bucketScopes = [
      { key: "college" as const, apply: (q: any) => q.eq("bucket", "college") },
      { key: "nimt" as const, apply: (q: any) => q.eq("school_brand", "nimt") },
      { key: "mirai" as const, apply: (q: any) => q.eq("school_brand", "mirai") },
    ];
    const sourceFilters = [
      { key: "meta_ads" as const, apply: (q: any) => q.eq("source", "meta_ads") },
      { key: "google_ads" as const, apply: (q: any) => q.eq("source", "google_ads") },
      { key: "website" as const, apply: (q: any) => q.eq("source", "website") },
      { key: "web_chat" as const, apply: (q: any) => q.in("source", ["web_chat", "website_chat"]) },
    ];
    const jobs = bucketScopes.flatMap((b) =>
      sourceFilters.map((s) => {
        const q = supabase.from("unassigned_leads_bucket" as any).select("id", { count: "exact", head: true });
        return s.apply(b.apply(q)).then((res: any) => ({ bucket: b.key, source: s.key, count: res.count ?? 0 }));
      })
    );
    const results = await Promise.all(jobs);
    const next: Record<string, SourceBreakdown> = {
      college: { ...emptyBreakdown },
      nimt: { ...emptyBreakdown },
      mirai: { ...emptyBreakdown },
    };
    for (const r of results) {
      next[r.bucket][r.source] = r.count;
    }
    setCollegeSources(next.college);
    setNimtSources(next.nimt);
    setMiraiSources(next.mirai);
  };

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from("unassigned_leads_bucket" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (activeBucket === "college") {
      query = query.eq("bucket", "college");
    } else if (schoolFilter === "mirai") {
      query = query.eq("school_brand", "mirai");
    } else {
      // CBSE (schoolFilter === "nimt"); also the safe default if the user
      // lands on the school bucket with the initial schoolFilter === "all".
      query = query.eq("school_brand", "nimt");
    }

    const { data, error } = await query;
    if (error) console.error("Lead buckets fetch error:", error);
    setLeads((data || []) as any);
    setSelectedIds(new Set());
    setLoading(false);
  };

  useEffect(() => { fetchCounts(); }, [selectedCampusId]);
  useEffect(() => { fetchLeads(); }, [activeBucket, schoolFilter, selectedCampusId]);

  // Reset course filter when the bucket / school sub-filter changes — a
  // course relevant in the college bucket is rarely relevant in the school
  // bucket and vice versa, so an unintended carry-over would silently
  // produce an empty list.
  useEffect(() => { setCourseFilter("all"); setSourceFilter("all"); }, [activeBucket, schoolFilter]);

  // Course options derived from the currently loaded leads so the dropdown
  // only ever shows courses that actually have unassigned leads in the
  // active bucket. Sorted by descending count so the busiest courses
  // appear first.
  const courseOptions = (() => {
    const counts = new Map<string, number>();
    for (const l of leads) {
      const name = (l.course_name || "").trim();
      if (!name || name === "—") continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  })();

  // Source options mirror the course filter — derived from the loaded
  // leads so the dropdown only ever lists sources that actually have
  // unassigned leads in the active bucket. Ordered by descending count.
  const sourceOptions = (() => {
    const counts = new Map<string, number>();
    for (const l of leads) {
      const src = (l.source || "").trim();
      if (!src) continue;
      counts.set(src, (counts.get(src) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([source, count]) => ({ source, count }));
  })();

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
        .in("user_id", userIds)
        .eq("login_disabled", false);
      setCounsellors(
        (profiles || []).map((p: any) => ({
          id: p.id, // profiles.id — matches leads.counsellor_id FK
          display_name: p.display_name || "Unknown",
        }))
      );
    })();
  }, [isAdminRole]);

  const filtered = leads.filter((l) => {
    if (courseFilter !== "all" && (l.course_name || "") !== courseFilter) return false;
    if (sourceFilter !== "all") {
      const src = l.source || "";
      // web_chat chip in the bucket header coalesces both legacy `web_chat`
      // and current `website_chat` source values, so the filter must too.
      const matches = sourceFilter === "web_chat"
        ? (src === "web_chat" || src === "website_chat")
        : src === sourceFilter;
      if (!matches) return false;
    }
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

  const handleSaveList = async () => {
    // Snapshot lead IDs at click time so the list count matches the preview.
    const ids = listScope === "selected"
      ? Array.from(selectedIds)
      : filtered.map((l) => l.id);
    if (!ids.length) return;

    const name = newListName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give the list a name first.", variant: "destructive" });
      return;
    }

    setSavingList(true);
    const filtersSnapshot = {
      bucket: activeBucket,
      school_filter: schoolFilter,
      source: sourceFilter,
      course: courseFilter,
      search: search || null,
    };

    const { data: list, error: listErr } = await supabase
      .from("lead_lists" as any)
      .insert({
        name,
        source: listScope === "selected" ? "manual" : "filter",
        filters_snapshot: filtersSnapshot,
        description: listScope === "selected"
          ? `Saved from Lead Buckets — ${ids.length} selected leads`
          : `Saved filter snapshot — ${activeBucket}${schoolFilter !== "all" ? "/" + schoolFilter : ""}`,
      })
      .select("id")
      .single();

    if (listErr || !list) {
      toast({ title: "Could not create list", description: listErr?.message || "Unknown error", variant: "destructive" });
      setSavingList(false);
      return;
    }

    const listId = (list as any).id;
    const members = ids.map((lead_id) => ({ list_id: listId, lead_id }));
    let memberErrors = 0;
    for (let i = 0; i < members.length; i += 500) {
      const chunk = members.slice(i, i + 500);
      const { error: memErr } = await supabase.from("lead_list_members" as any).insert(chunk);
      if (memErr) { memberErrors++; console.error("List member insert failed:", memErr); }
    }

    setSavingList(false);
    setShowSaveList(false);
    setNewListName("");
    toast({
      title: "List saved",
      description: memberErrors > 0
        ? `"${name}" — some members failed to insert. Check console.`
        : `"${name}" — ${ids.length} leads. Send from the Lists page.`,
    });
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
          <CardContent className="p-4">
            <SourceChips breakdown={collegeSources} onPick={(src) => { setActiveBucket("college"); setSchoolFilter("all"); setSourceFilter(src); }} />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-blue shrink-0">
                <GraduationCap className="h-5 w-5 text-foreground/70" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">College Leads</p>
                <p className="text-xs text-muted-foreground">Unassigned college leads</p>
              </div>
              <span className="text-xl font-bold text-foreground">{collegeCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === "school" && schoolFilter !== "mirai" ? "ring-2 ring-primary/40 bg-primary/5" : "border-border/60"}`}
          onClick={() => { setActiveBucket("school"); setSchoolFilter("nimt"); }}
        >
          <CardContent className="p-4">
            <SourceChips breakdown={nimtSources} onPick={(src) => { setActiveBucket("school"); setSchoolFilter("nimt"); setSourceFilter(src); }} />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-yellow shrink-0">
                <School className="h-5 w-5 text-foreground/70" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">CBSE School Leads</p>
                <p className="text-xs text-muted-foreground">NIMT Arthala &amp; Avantika II</p>
              </div>
              <span className="text-xl font-bold text-foreground">{nimtSchoolCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`flex-1 cursor-pointer transition-all hover:shadow-sm ${activeBucket === "school" && schoolFilter === "mirai" ? "ring-2 ring-violet-400/60 bg-violet-50/50 dark:bg-violet-950/10" : "border-border/60"}`}
          onClick={() => { setActiveBucket("school"); setSchoolFilter("mirai"); }}
        >
          <CardContent className="p-4">
            <SourceChips breakdown={miraiSources} onPick={(src) => { setActiveBucket("school"); setSchoolFilter("mirai"); setSourceFilter(src); }} />
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30 shrink-0">
                <School className="h-5 w-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">Mirai IB Leads</p>
                <p className="text-xs text-muted-foreground">Mirai Experiential School</p>
              </div>
              <span className="text-xl font-bold text-violet-600">{miraiSchoolCount}</span>
            </div>
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
            <Button size="sm" variant="outline" className="gap-2" onClick={() => { setListScope("selected"); setShowSaveList(true); }}>
              <ListPlus className="h-4 w-4" />
              Save as List
            </Button>
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

      {/* Search + course filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or course..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-xl border border-input bg-card py-2.5 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 max-w-xs"
          title="Filter by course"
        >
          <option value="all">All courses ({leads.length})</option>
          {courseOptions.map(c => (
            <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
          ))}
        </select>
        {courseFilter !== "all" && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setCourseFilter("all")}>
            Clear course
          </Button>
        )}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-xl border border-input bg-card py-2.5 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 max-w-xs"
          title="Filter by source"
        >
          <option value="all">All sources ({leads.length})</option>
          {sourceOptions.map((s) => (
            <option key={s.source} value={s.source}>
              {SOURCE_LABELS[s.source] || s.source} ({s.count})
            </option>
          ))}
        </select>
        {sourceFilter !== "all" && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setSourceFilter("all")}>
            Clear source
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 text-xs gap-1.5 ml-auto"
          disabled={filtered.length === 0}
          onClick={() => { setListScope("filtered"); setShowSaveList(true); }}
          title="Save the current filtered view as a reusable list for bulk WhatsApp/email"
        >
          <ListPlus className="h-3.5 w-3.5" />
          Save filter as list ({filtered.length})
        </Button>
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
                    <p className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                      {lead.name}
                      <CahetPendingBadge
                        leadId={lead.id}
                        leadName={lead.name}
                        phone={lead.phone}
                        courseName={lead.course_name}
                      />
                    </p>
                    {lead.jd_category && (() => {
                      const hint = jdCategoryHint(lead.jd_category);
                      return (
                        <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate max-w-[260px]">
                          <span className="font-semibold text-orange-700 dark:text-orange-400">JD:</span>{" "}
                          {lead.jd_category}
                          {hint && <span className="text-muted-foreground"> · {hint}</span>}
                        </p>
                      );
                    })()}
                    {lead.last_ai_summary && (
                      <p
                        className="text-[10px] text-muted-foreground/80 mt-0.5 truncate max-w-[260px]"
                        title={lead.last_ai_summary}
                      >
                        <span className="font-semibold text-sky-700 dark:text-sky-400">AI:</span>{" "}
                        {lead.last_ai_summary}
                        {typeof lead.last_ai_conversion_pct === "number" && (
                          <span className="text-muted-foreground"> · {lead.last_ai_conversion_pct}%</span>
                        )}
                      </p>
                    )}
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

      {/* Save as List dialog */}
      <Dialog open={showSaveList} onOpenChange={setShowSaveList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as List</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {listScope === "selected"
                ? `${selectedIds.size} selected lead${selectedIds.size === 1 ? "" : "s"} will be saved.`
                : `${filtered.length} lead${filtered.length === 1 ? "" : "s"} matching the current filters will be saved.`}
              {" "}List is static — the snapshot won't change as new leads come in.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground">List name</label>
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder={listScope === "filtered"
                  ? `${activeBucket} leads${sourceFilter !== "all" ? " · " + (SOURCE_LABELS[sourceFilter] || sourceFilter) : ""}`
                  : "e.g. Hot college leads — May"}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveList(false)}>Cancel</Button>
            <Button
              onClick={handleSaveList}
              disabled={savingList || !newListName.trim()}
              className="gap-2"
            >
              {savingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
              Save List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
