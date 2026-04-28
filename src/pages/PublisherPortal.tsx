import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Users, TrendingUp, CheckCircle, Clock,
  Search, ChevronRight, ArrowUpRight, Activity, Phone, PhoneOff,
  BookOpen, MapPin, BarChart3,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Publisher {
  id: string;
  display_name: string;
  source: string;
}

interface PublisherLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  course_name: string;
  campus_name: string;
  city: string | null;
  state: string | null;
  created_at: string;
  ai_called: boolean;
  ai_called_at: string | null;
}

interface LeadActivity {
  id: string;
  type: string;
  description: string;
  created_at: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid",
  application_submitted: "Submitted",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled",
  interview: "Interview",
  offer_sent: "Offer Sent",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  waitlisted: "Waitlisted",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  dnc: "Do Not Contact",
  deferred: "Deferred (Next Session)",
  rejected: "Rejected",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  application_in_progress: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400",
  application_fee_paid: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  application_submitted: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  counsellor_call: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  visit_scheduled: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  interview: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  offer_sent: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  token_paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  pre_admitted: "bg-lime-100 text-lime-700 dark:bg-lime-950/40 dark:text-lime-400",
  admitted: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  waitlisted: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  not_interested: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  ineligible: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  dnc: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  deferred: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const ACTIVITY_LABELS: Record<string, string> = {
  stage_change: "Stage Updated",
  application_submitted: "Application Submitted",
  application_started: "Application Started",
  payment: "Payment Recorded",
  call: "Call Logged",
  ai_call: "AI Call",
};

const ACTIVITY_COLORS: Record<string, string> = {
  stage_change: "bg-blue-500",
  call: "bg-orange-500",
  ai_call: "bg-violet-500",
  payment: "bg-green-500",
  application_submitted: "bg-teal-500",
  application_started: "bg-yellow-500",
};

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m`;
  return "< 1m";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PublisherPortal() {
  const { user, role, startImpersonating } = useAuth();
  const { toast } = useToast();

  const isSuperAdmin = role === "super_admin";

  const [publisher, setPublisher] = useState<Publisher | null>(null);
  const [allPublishers, setAllPublishers] = useState<(Publisher & { user_id: string | null })[]>([]);
  const [impersonatingId, setImpersonatingId] = useState<string>("");
  const [leads, setLeads] = useState<PublisherLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [impersonatingUser, setImpersonatingUser] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [aiFilter, setAiFilter] = useState("all"); // "all" | "called" | "not_called"

  const [avgAiCallMs, setAvgAiCallMs] = useState<number | null>(null);
  const [avgManualCallMs, setAvgManualCallMs] = useState<number | null>(null);

  const [selectedLead, setSelectedLead] = useState<PublisherLead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [courseSortBy, setCourseSortBy] = useState<"total"|"ratio">("total");

  // Super admin: load all publisher records for the picker
  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from("publishers").select("id, display_name, source, user_id").eq("is_active", true).order("source")
      .then(({ data }) => { if (data) setAllPublishers(data as any); });
  }, [isSuperAdmin]);

  // Fetch publisher record + leads
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);

      let pub: Publisher | null = null;

      if (isSuperAdmin && impersonatingId) {
        // Super admin viewing as a specific publisher
        const { data } = await supabase
          .from("publishers")
          .select("id, display_name, source")
          .eq("id", impersonatingId)
          .single();
        pub = data ?? null;
      } else if (!isSuperAdmin) {
        // Normal publisher login
        const { data, error: pubErr } = await supabase
          .from("publishers")
          .select("id, display_name, source")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .single();
        if (pubErr || !data) {
          toast({ title: "Access denied", description: "No publisher account linked to this login.", variant: "destructive" });
          setLoading(false);
          return;
        }
        pub = data;
      }

      if (!pub) {
        setPublisher(null);
        setLeads([]);
        setLoading(false);
        return;
      }
      setPublisher(pub);

      // Paginate to bypass Supabase server-side max-rows cap (default 1000)
      const PAGE = 1000;
      let allLeads: any[] = [];
      let page = 0;
      let fetchErr = null;
      while (true) {
        const { data: batch, error } = await supabase
          .from("leads")
          .select(`
            id, name, phone, email, stage, city, state, created_at,
            ai_called, ai_called_at,
            courses!left(name),
            campuses!left(name)
          `)
          .eq("source", pub.source)
          .order("created_at", { ascending: false })
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) { fetchErr = error; break; }
        allLeads = allLeads.concat(batch ?? []);
        if ((batch ?? []).length < PAGE) break; // last page
        page++;
      }

      if (fetchErr) {
        toast({ title: "Failed to load leads", variant: "destructive" });
      } else {
        const mapped = allLeads.map((l: any) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          stage: l.stage,
          created_at: l.created_at,
          ai_called: l.ai_called ?? false,
          ai_called_at: l.ai_called_at ?? null,
          course_name: l.courses?.name ?? "—",
          campus_name: l.campuses?.name ?? "—",
          city: l.city ?? null,
          state: l.state ?? null,
        }));
        setLeads(mapped);

        // Avg AI/manual call time — only leads received in last 3 days
        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        const recentLeads = mapped.filter((l: any) => new Date(l.created_at).getTime() >= threeDaysAgo);

        const median = (arr: number[]) => {
          if (arr.length === 0) return null;
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        };

        const aiDelays = mapped
          .filter((l: any) => l.ai_called && l.ai_called_at && new Date(l.ai_called_at).getTime() >= threeDaysAgo)
          .map((l: any) => new Date(l.ai_called_at).getTime() - new Date(l.created_at).getTime())
          .filter((ms: number) => ms >= 0 && ms <= 3600000); // cap at 1h to exclude manual retries
        setAvgAiCallMs(median(aiDelays));

        // Avg manual call time — fetch first 'call' activity placed in last 3 days, across all leads
        const allLeadIds = mapped.map((l: any) => l.id);
        const allLeadCreatedMap: Record<string, number> = {};
        mapped.forEach((l: any) => { allLeadCreatedMap[l.id] = new Date(l.created_at).getTime(); });

        const firstCallMap: Record<string, number> = {};
        const BATCH = 500;
        for (let i = 0; i < allLeadIds.length; i += BATCH) {
          const { data: callBatch } = await supabase
            .from("lead_activities")
            .select("lead_id, created_at")
            .in("lead_id", allLeadIds.slice(i, i + BATCH))
            .eq("type", "call")
            .gte("created_at", new Date(threeDaysAgo).toISOString())
            .order("created_at", { ascending: true });
          (callBatch ?? []).forEach((a: any) => {
            if (!firstCallMap[a.lead_id]) firstCallMap[a.lead_id] = new Date(a.created_at).getTime();
          });
        }
        const manualDelays = Object.entries(firstCallMap)
          .map(([lid, callTime]) => callTime - (allLeadCreatedMap[lid] ?? callTime))
          .filter(ms => ms >= 0);
        setAvgManualCallMs(median(manualDelays));
      }
      setLoading(false);
    })();
  }, [user?.id, impersonatingId]);

  // Fetch activities when a lead is selected
  useEffect(() => {
    if (!selectedLead) return;
    (async () => {
      setActivitiesLoading(true);
      const { data } = await supabase
        .from("lead_activities")
        .select("id, type, description, created_at")
        .eq("lead_id", selectedLead.id)
        .in("type", ["stage_change", "application_submitted", "application_started", "payment", "call", "ai_call"])
        .order("created_at", { ascending: false });
      setActivities(data ?? []);
      setActivitiesLoading(false);
    })();
  }, [selectedLead?.id]);

  // Derived stats
  const total = leads.length;
  const admitted = leads.filter(l => l.stage === "admitted").length;
  const inProgress = leads.filter(l =>
    ["application_in_progress", "application_fee_paid", "application_submitted",
     "counsellor_call", "visit_scheduled", "interview", "offer_sent",
     "token_paid", "pre_admitted"].includes(l.stage)
  ).length;
  const conversionRate = total > 0 ? Math.round((admitted / total) * 100) : 0;

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.name.toLowerCase().includes(q) ||
      l.phone.includes(q) || (l.email?.toLowerCase().includes(q) ?? false) ||
      l.course_name.toLowerCase().includes(q);
    const matchStage = stageFilter === "all" || l.stage === stageFilter;
    const matchAi = aiFilter === "all" || (aiFilter === "called" ? l.ai_called : !l.ai_called);
    return matchSearch && matchStage && matchAi;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!publisher) {
    if (isSuperAdmin) {
      return (
        <div className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Publisher Leads</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Select a publisher to view their lead reports.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {allPublishers.map(p => (
              <button
                key={p.id}
                onClick={() => setImpersonatingId(p.id)}
                className="rounded-xl border border-input bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
              >
                <span className="capitalize">{p.display_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">({p.source})</span>
              </button>
            ))}
            {allPublishers.length === 0 && (
              <p className="text-sm text-muted-foreground">No active publishers found.</p>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <Users className="h-10 w-10" />
        <p className="text-sm">No publisher account found for this login.</p>
        <p className="text-xs">Contact your NIMT account manager to get access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{publisher.display_name} — Lead Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Showing leads supplied via <span className="font-medium capitalize">{publisher.source}</span>
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={impersonatingId}
              onChange={e => { setImpersonatingId(e.target.value); setSearch(""); setStageFilter("all"); setAiFilter("all"); setAvgAiCallMs(null); setAvgManualCallMs(null); }}
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">— Switch Publisher —</option>
              {allPublishers.map(p => (
                <option key={p.id} value={p.id}>{p.display_name} ({p.source})</option>
              ))}
            </select>
            {impersonatingId && (() => {
              const pub = allPublishers.find(p => p.id === impersonatingId);
              return pub?.user_id ? (
                <button
                  disabled={impersonatingUser}
                  onClick={async () => {
                    setImpersonatingUser(true);
                    await startImpersonating(pub.user_id!);
                    setImpersonatingUser(false);
                  }}
                  className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {impersonatingUser ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  Login as {pub.display_name}
                </button>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400">⚠ No user account linked</span>
              );
            })()}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Leads</p>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">In Pipeline</p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">{inProgress}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Admitted</p>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-foreground">{admitted}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Conversion</p>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">{conversionRate}%</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg. Response — AI</p>
              <Phone className="h-4 w-4 text-violet-500" />
            </div>
            {avgAiCallMs === null ? (
              <p className="text-sm text-muted-foreground mt-1">No data</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-foreground">{formatDuration(avgAiCallMs)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">median · lead received → first AI call · last 3 days</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg. Response — Manual</p>
              <Phone className="h-4 w-4 text-orange-500" />
            </div>
            {avgManualCallMs === null ? (
              <p className="text-sm text-muted-foreground mt-1">No data</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-foreground">{formatDuration(avgManualCallMs)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">median · lead received → first call · last 3 days</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stage Breakdown */}
      {(() => {
        const stageCounts = Object.entries(STAGE_LABELS)
          .map(([key, label]) => ({ key, label, count: leads.filter(l => l.stage === key).length }))
          .filter(s => s.count > 0)
          .sort((a, b) => b.count - a.count);
        if (stageCounts.length === 0) return null;
        return (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Leads by Stage</p>
            <div className="flex flex-wrap gap-2">
              {stageFilter !== "all" && (
                <button
                  onClick={() => setStageFilter("all")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  ✕ Clear filter
                </button>
              )}
              {stageCounts.map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setStageFilter(stageFilter === key ? "all" : key)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                    stageFilter === key
                      ? "border-primary bg-primary text-primary-foreground"
                      : `border-transparent ${STAGE_COLORS[key] ?? "bg-muted text-muted-foreground"} hover:opacity-80`
                  }`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    stageFilter === key ? "bg-white/20 text-inherit" : "bg-black/10 dark:bg-white/10"
                  }`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Course-wise Stage Breakdown ────────────────────────────── */}
      {(() => {
        // Group leads by course, then by stage + called count
        const courseMap = new Map<string, Map<string, number>>();
        const courseTotals = new Map<string, number>();
        const courseCalled = new Map<string, number>();
        const courseInterested = new Map<string, number>();
        const interestStages = new Set(["counsellor_call","visit_scheduled","interview","offer_sent","token_paid","pre_admitted","admitted","application_in_progress","application_fee_paid","application_submitted"]);

        leads.forEach(l => {
          const c = l.course_name || "—";
          if (!courseMap.has(c)) courseMap.set(c, new Map());
          const stages = courseMap.get(c)!;
          stages.set(l.stage, (stages.get(l.stage) || 0) + 1);
          courseTotals.set(c, (courseTotals.get(c) || 0) + 1);
          if (l.ai_called) courseCalled.set(c, (courseCalled.get(c) || 0) + 1);
          if (interestStages.has(l.stage)) courseInterested.set(c, (courseInterested.get(c) || 0) + 1);
        });

        const activeStages = Array.from(new Set(leads.map(l => l.stage)));
        const pipelineStages = ["application_in_progress","application_fee_paid","application_submitted","counsellor_call","visit_scheduled","interview","offer_sent","token_paid","pre_admitted","admitted"];

        // Build rows with computed values
        const courseRows = Array.from(courseMap.entries()).map(([course, stages]) => {
          const total = courseTotals.get(course) || 0;
          const called = courseCalled.get(course) || 0;
          const interested = courseInterested.get(course) || 0;
          const dropped = (stages.get("not_interested") || 0) + (stages.get("ineligible") || 0) + (stages.get("dnc") || 0) + (stages.get("rejected") || 0);
          const ratio = called > 0 ? interested / called : 0;
          return { course, stages, total, called, interested, dropped, ratio };
        });

        // Sort
        if (courseSortBy === "ratio") {
          courseRows.sort((a, b) => b.ratio - a.ratio || b.total - a.total);
        } else {
          courseRows.sort((a, b) => b.total - a.total);
        }

        // Best performing
        const bestCourse = courseRows.filter(r => r.total >= 5 && r.called > 0).sort((a, b) => b.ratio - a.ratio)[0];

        if (courseRows.length <= 1) return null;
        return (
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  Course-wise Lead Stages
                </CardTitle>
                <div className="flex items-center gap-2">
                  {bestCourse && bestCourse.ratio > 0 && (
                    <span className="text-[11px] text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-950/30 px-2.5 py-1 rounded-full">
                      Best: {bestCourse.course} ({(bestCourse.ratio * 100).toFixed(0)}% int/called)
                    </span>
                  )}
                  <select
                    value={courseSortBy}
                    onChange={e => setCourseSortBy(e.target.value as "total"|"ratio")}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-[11px] font-medium text-foreground focus:outline-none"
                  >
                    <option value="total">Sort: Total Leads</option>
                    <option value="ratio">Sort: Interested/Called ↓</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-t border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide sticky left-0 bg-muted/50 z-10">Course</th>
                      <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground">Total</th>
                      <th className="px-3 py-2.5 text-center font-semibold text-violet-500 whitespace-nowrap">Called</th>
                      <th className="px-3 py-2.5 text-center font-semibold text-blue-500 whitespace-nowrap cursor-pointer hover:text-blue-700" onClick={() => setCourseSortBy(courseSortBy === "ratio" ? "total" : "ratio")}>
                        Int/Called{courseSortBy === "ratio" ? " ↓" : ""}
                      </th>
                      {pipelineStages.filter(s => activeStages.includes(s)).map(s => (
                        <th key={s} className="px-3 py-2.5 text-center font-semibold text-muted-foreground whitespace-nowrap">
                          {(STAGE_LABELS[s] || s).replace(/ /g, "\u00A0")}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center font-semibold text-red-400">Dropped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseRows.map(({ course, stages, total, called, interested, dropped, ratio }) => (
                      <tr key={course} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium text-foreground sticky left-0 bg-white dark:bg-background z-10 whitespace-nowrap">{course}</td>
                        <td className="px-3 py-2.5 text-center font-bold text-foreground">{total}</td>
                        <td className="px-3 py-2.5 text-center">
                          {called > 0 ? (
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                              {called}
                            </span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {called > 0 ? (
                            <span className={`inline-block min-w-[36px] px-1.5 py-0.5 rounded-md text-[11px] font-bold ${
                              ratio >= 0.5 ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                              : ratio >= 0.25 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                              : "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                            }`}>
                              {(ratio * 100).toFixed(0)}%
                            </span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        {pipelineStages.filter(s => activeStages.includes(s)).map(s => {
                          const count = stages.get(s) || 0;
                          return (
                            <td key={s} className="px-3 py-2.5 text-center">
                              {count > 0 ? (
                                <span className={`inline-block min-w-[24px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${STAGE_COLORS[s] || "bg-muted"}`}>
                                  {count}
                                </span>
                              ) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-center">
                          {dropped > 0 ? (
                            <span className="inline-block min-w-[24px] px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                              {dropped}
                            </span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── City/State Conversion Chart ──────────────────────────── */}
      {(() => {
        // Group leads by city and state
        type GeoData = { total: number; called: number; interested: number; admitted: number };
        const cityMap = new Map<string, GeoData>();
        const stateMap = new Map<string, GeoData>();
        const interestStages = new Set(["counsellor_call","visit_scheduled","interview","offer_sent","token_paid","pre_admitted","admitted","application_in_progress","application_fee_paid","application_submitted"]);

        leads.forEach(l => {
          const lead = l as any;
          const city = lead.city || null;
          const state = lead.state || null;

          const update = (map: Map<string, GeoData>, key: string | null) => {
            if (!key || key === "—") return;
            const k = key.trim();
            if (!k) return;
            if (!map.has(k)) map.set(k, { total: 0, called: 0, interested: 0, admitted: 0 });
            const d = map.get(k)!;
            d.total++;
            if (lead.ai_called) d.called++;
            if (interestStages.has(l.stage)) d.interested++;
            if (l.stage === "admitted") d.admitted++;
          };
          update(cityMap, city);
          update(stateMap, state);
        });

        // Only show if we have geo data
        const hasCityData = cityMap.size > 0;
        const hasStateData = stateMap.size > 0;
        if (!hasCityData && !hasStateData) return null;

        const renderGeoTable = (map: Map<string, GeoData>, label: string) => {
          const sorted = Array.from(map.entries())
            .filter(([, d]) => d.total >= 2)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 15);
          if (sorted.length === 0) return null;
          const maxTotal = Math.max(...sorted.map(([, d]) => d.total));
          return (
            <div className="flex-1 min-w-[300px]">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> By {label}
              </p>
              <div className="space-y-2">
                {sorted.map(([name, d]) => {
                  const intRate = d.total > 0 ? Math.round((d.interested / d.total) * 100) : 0;
                  const barWidth = (d.total / maxTotal) * 100;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs text-foreground font-medium w-28 truncate shrink-0" title={name}>{name}</span>
                      <div className="flex-1 h-6 bg-muted/50 rounded-md overflow-hidden relative">
                        <div className="h-full bg-blue-100 dark:bg-blue-950/40 rounded-md transition-all" style={{ width: `${barWidth}%` }} />
                        <div className="absolute inset-0 flex items-center px-2 justify-between">
                          <span className="text-[10px] font-semibold text-foreground">{d.total} leads</span>
                          <span className={`text-[10px] font-bold ${intRate >= 50 ? "text-green-600" : intRate >= 25 ? "text-amber-600" : "text-red-500"}`}>
                            {intRate}% interested
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground w-14 text-right shrink-0">{d.called}/{d.total} called</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Geographic Distribution & Conversion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col lg:flex-row gap-8">
                {hasCityData && renderGeoTable(cityMap, "City")}
                {hasStateData && renderGeoTable(stateMap, "State")}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, course…"
            className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option value="all">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={aiFilter}
          onChange={e => setAiFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option value="all">All AI Call Status</option>
          <option value="called">AI Called</option>
          <option value="not_called">Not Called</option>
        </select>
      </div>

      {/* Leads table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Campus</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Call</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {search || stageFilter !== "all" ? "No leads match your filters." : "No leads found for your source."}
                  </td>
                </tr>
              ) : filtered.map(lead => (
                <tr
                  key={lead.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setSelectedLead(lead)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{lead.name}</div>
                    <div className="text-xs text-muted-foreground">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{lead.course_name}</div>
                    <div className="text-xs text-muted-foreground">{lead.campus_name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[11px] font-medium border-0 ${STAGE_COLORS[lead.stage] ?? "bg-muted"}`}>
                      {STAGE_LABELS[lead.stage] ?? lead.stage}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {lead.ai_called ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                        <Phone className="h-3.5 w-3.5" />
                        Called
                        {lead.ai_called_at && (
                          <span className="text-muted-foreground font-normal">
                            · {new Date(lead.ai_called_at).toLocaleDateString("en-IN")}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <PhoneOff className="h-3.5 w-3.5" />
                        Not called
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(lead.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {total} leads
      </p>

      {/* Lead detail dialog */}
      <Dialog open={!!selectedLead} onOpenChange={open => { if (!open) setSelectedLead(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selectedLead.name}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Basic info */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-medium">{selectedLead.phone}</span>
                  </div>
                  {selectedLead.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-medium">{selectedLead.email}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Course</span>
                    <span className="font-medium text-right max-w-[60%]">{selectedLead.course_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Campus</span>
                    <span className="font-medium">{selectedLead.campus_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Lead Received</span>
                    <span className="font-medium">
                      {new Date(selectedLead.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      {" · "}
                      {new Date(selectedLead.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {/* Time to first call */}
                  {(() => {
                    const firstCall = [...activities]
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .find(a => a.type === "call" || a.type === "ai_call");
                    if (!firstCall) return (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">First Call</span>
                        <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">Not called yet</span>
                      </div>
                    );
                    const ms = new Date(firstCall.created_at).getTime() - new Date(selectedLead.created_at).getTime();
                    const isAi = firstCall.type === "ai_call";
                    return (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Time to First Call</span>
                        <span className={`font-medium text-xs flex items-center gap-1 ${ms <= 3600000 ? "text-green-600 dark:text-green-400" : ms <= 86400000 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                          {isAi && <span className="text-[9px] bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded-full font-semibold">AI</span>}
                          {formatDuration(ms)}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Current Stage</span>
                    <Badge className={`text-[11px] font-medium border-0 ${STAGE_COLORS[selectedLead.stage] ?? "bg-muted"}`}>
                      {STAGE_LABELS[selectedLead.stage] ?? selectedLead.stage}
                    </Badge>
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" /> Timeline
                  </h3>
                  {activitiesLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No timeline events yet.</p>
                  ) : (
                    <div className="relative space-y-0">
                      {/* Lead created marker */}
                      <div className="flex gap-3 pb-4">
                        <div className="flex flex-col items-center">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                          {activities.length > 0 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 min-w-0 pb-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">Lead Received</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {new Date(selectedLead.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                              {" "}
                              {new Date(selectedLead.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </div>
                      </div>
                      {activities.map((a, i) => {
                        const prev = i === 0 ? selectedLead.created_at : activities[i - 1].created_at;
                        const gap = new Date(a.created_at).getTime() - new Date(prev).getTime();
                        const dotColor = ACTIVITY_COLORS[a.type] ?? "bg-primary";
                        return (
                          <div key={a.id} className="flex gap-3 pb-4 last:pb-0">
                            <div className="flex flex-col items-center">
                              <div className={`h-2.5 w-2.5 rounded-full ${dotColor} mt-1 shrink-0`} />
                              {i < activities.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                            </div>
                            <div className="flex-1 min-w-0 pb-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground">
                                  {ACTIVITY_LABELS[a.type] ?? a.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                                </span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {new Date(a.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                  {" "}
                                  {new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              {a.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.description}</p>
                              )}
                              {gap > 60000 && (
                                <p className="text-[10px] text-muted-foreground/60 mt-0.5">+{formatDuration(gap)} after previous</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
