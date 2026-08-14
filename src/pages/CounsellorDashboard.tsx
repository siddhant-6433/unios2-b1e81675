import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, MessageSquare, CalendarCheck, MapPin, UserCheck, Trophy, AlertTriangle, Clock, TrendingUp, ChevronDown, ChevronUp, Users, PhoneOff, PhoneCall, BarChart3, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, CalendarDays, History } from "lucide-react";
import { CahetSprintLeaderboard } from "@/components/dashboard/CahetSprintLeaderboard";
import { UpdeledSprintLeaderboard } from "@/components/dashboard/UpdeledSprintLeaderboard";
import { LeadAssignmentHistory } from "@/components/dashboard/LeadAssignmentHistory";
import { MorningBrief } from "@/components/dashboard/MorningBrief";
import { IncentiveWidget } from "@/components/dashboard/IncentiveWidget";

interface CounsellorStats {
  counsellor_id: string;
  counsellor_name: string;
  user_id: string;
  total_calls: number;
  total_whatsapps: number;
  followups_completed: number;
  followups_overdue: number;
  visits_scheduled: number;
  leads_assigned: number;
  conversions: number;
}

interface OverdueFollowup {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  counsellor_id: string | null;
  type: string;
  scheduled_at: string;
  days_overdue: number;
  notes: string | null;
}

interface CounsellorBreakdown {
  counsellor_id: string;
  counsellor_name: string;
  user_id: string;
  total: number;
  new_lead: number;
  called: number;
  not_called: number;
  application_in_progress: number;
  visit_scheduled: number;
  admitted: number;
  rejected: number;
  other_stages: number;
  dispositions: Record<string, number>;
  avg_response_hrs: number | null;
  call_rate: number;
  conversion_rate: number;
  visits_completed: number;
}

interface DispositionLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
  not_interested: "Not Interested",
};

const DISPOSITION_LABELS: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  not_answered: "Not Answered",
  call_back: "Call Back",
  wrong_number: "Wrong Number",
  do_not_contact: "DNC",
  voicemail: "Voicemail",
  busy: "Busy",
  cold: "Cold",
};

const DISPOSITION_COLORS: Record<string, string> = {
  interested: "bg-success/10 text-success",
  not_interested: "bg-destructive/10 text-destructive",
  ineligible: "bg-gray-100 text-gray-600",
  not_answered: "bg-warning/10 text-warning-foreground",
  call_back: "bg-info/10 text-info-foreground",
  wrong_number: "bg-pink-100 text-pink-700",
  do_not_contact: "bg-destructive/15 text-destructive",
  voicemail: "bg-primary/10 text-primary",
  busy: "bg-warning/10 text-warning-foreground",
  cold: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
};

type BreakdownSortCol = "counsellor_name" | "total" | "new_lead" | "called" | "not_called"
  | "application_in_progress" | "visit_scheduled" | "visits_completed" | "admitted" | "rejected"
  | "call_rate" | "conversion_rate" | "avg_response_hrs";

type DatePreset = "today" | "yesterday" | "this_week" | "past_week" | "this_month" | "all";

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const todayStr = fmt(today);

  switch (preset) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "this_week": {
      const d = new Date(today);
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday start
      d.setDate(d.getDate() - diff);
      return { from: fmt(d), to: todayStr };
    }
    case "past_week": {
      const end = new Date(today);
      const day = end.getDay();
      const diff = day === 0 ? 6 : day - 1;
      end.setDate(end.getDate() - diff - 1); // last Sunday
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { from: fmt(start), to: fmt(end) };
    }
    case "this_month": {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(d), to: todayStr };
    }
    case "all":
    default:
      return { from: "", to: "" };
  }
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "past_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "all", label: "All Time" },
];

// Student Feedback Summary sub-component
function FeedbackSummary() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [fbLoading, setFbLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("counsellor_feedback_summary" as any)
        .select("*");
      setFeedback((data || []).sort((a: any, b: any) => (b.avg_rating || 0) - (a.avg_rating || 0)));
      setFbLoading(false);
    })();
  }, []);

  if (fbLoading || feedback.length === 0) return null;

  const totalResponses = feedback.reduce((s: number, f: any) => s + Number(f.total_responses || 0), 0);
  const avgAll = totalResponses > 0
    ? (feedback.reduce((s: number, f: any) => s + (Number(f.avg_rating || 0) * Number(f.total_responses || 0)), 0) / totalResponses).toFixed(1)
    : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Student Feedback (1:10 Sample)</h3>
        <span className="text-xs text-muted-foreground">{totalResponses} responses · Avg {avgAll}/5</span>
      </div>
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase">Counsellor</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Avg Rating</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Responses</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-success uppercase">5-Star</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-info-foreground uppercase">4-Star</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-destructive uppercase">Low (1-2)</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Pending</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f: any) => (
                <tr key={f.counsellor_id} className="border-b border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground text-xs">{f.counsellor_name}</td>
                  <td className="px-3 py-2.5 text-center">
                    {f.avg_rating ? (
                      <span className={`text-xs font-bold ${
                        f.avg_rating >= 4 ? "text-success" : f.avg_rating >= 3 ? "text-warning-foreground" : "text-destructive"
                      }`}>
                        {f.avg_rating}/5
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs">{f.total_responses}</td>
                  <td className="px-3 py-2.5 text-center">
                    {f.five_star > 0 ? (
                      <span className="text-[10px] font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5">{f.five_star}</span>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {f.four_star > 0 ? (
                      <span className="text-[10px] font-bold text-info-foreground bg-info/10 rounded-full px-1.5 py-0.5">{f.four_star}</span>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {f.low_rating > 0 ? (
                      <span className="text-[10px] font-bold text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">{f.low_rating}</span>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{f.pending || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// Post-Visit Pipeline sub-component
function PostVisitPipeline() {
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("post_visit_pipeline" as any)
        .select("*");
      setPipeline((data || []).sort((a: any, b: any) => b.pending_total - a.pending_total));
      setPipelineLoading(false);
    })();
  }, []);

  if (pipelineLoading) return null;
  if (pipeline.length === 0) return null;

  const totalVisited = pipeline.reduce((s: number, c: any) => s + Number(c.visited_7d || 0), 0);
  const totalFollowed = pipeline.reduce((s: number, c: any) => s + Number(c.followed_up_7d || 0), 0);
  const totalPending = pipeline.reduce((s: number, c: any) => s + Number(c.pending_total || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Post-Visit Pipeline</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{totalPending} pending follow-ups</span>
          {totalVisited > 0 && (
            <span className={`font-medium ${totalFollowed / totalVisited >= 0.8 ? "text-success" : "text-warning-foreground"}`}>
              {Math.round((totalFollowed / totalVisited) * 100)}% follow-up rate (7d)
            </span>
          )}
        </div>
      </div>
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase">Counsellor</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Visited (7d)</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Followed Up</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-destructive uppercase">Pending</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">F/U Rate</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase">Avg Wait</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map((c: any) => {
                const rate = Number(c.visited_7d) > 0 ? Math.round((Number(c.followed_up_7d) / Number(c.visited_7d)) * 100) : 0;
                return (
                  <tr key={c.counsellor_id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium text-foreground text-xs">{c.counsellor_name}</td>
                    <td className="px-3 py-2.5 text-center text-xs">{c.visited_7d}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-success font-medium">{c.followed_up_7d}</td>
                    <td className="px-3 py-2.5 text-center">
                      {Number(c.pending_total) > 0 ? (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-destructive/10 text-destructive">
                          {c.pending_total}
                        </span>
                      ) : (
                        <span className="text-xs text-success">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-bold ${rate >= 80 ? "text-success" : rate >= 50 ? "text-warning-foreground" : "text-destructive"}`}>
                        {rate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                      {c.avg_days_pending ? `${c.avg_days_pending}d` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

const CounsellorDashboard = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [stats, setStats] = useState<CounsellorStats[]>([]);
  const [overdue, setOverdue] = useState<OverdueFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"leaderboard" | "overdue" | "tat-defaults" | "breakdown" | "activity" | "calling" | "assignments" | "funnel">("leaderboard");
  const [activityData, setActivityData] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [callingData, setCallingData] = useState<any[]>([]);
  const [callingLoading, setCallingLoading] = useState(false);
  // Funnel: rows from counsellor_funnel_stats — one row per (counsellor, stage, week).
  const [funnelRows, setFunnelRows] = useState<{ counsellor_id: string; counsellor_name: string; stage: string; week_start: string; leads_reached: number }[]>([]);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelRange, setFunnelRange] = useState<"7d" | "30d" | "all">("30d");
  const [callingDatePreset, setCallingDatePreset] = useState<DatePreset>("today");
  const [activityDatePreset, setActivityDatePreset] = useState<DatePreset>("today");
  const [tatDefaults, setTatDefaults] = useState<any[]>([]);
  const [teamDefaults, setTeamDefaults] = useState<any[]>([]);
  const [breakdownData, setBreakdownData] = useState<CounsellorBreakdown[]>([]);
  const [expandedCounsellor, setExpandedCounsellor] = useState<string | null>(null);

  // Sort state for breakdown table
  const [sortCol, setSortCol] = useState<BreakdownSortCol>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Overdue follow-ups counsellor filter
  const [overdueFilter, setOverdueFilter] = useState("all");

  // Date filter state
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  // Disposition drill-down
  const [dispLeads, setDispLeads] = useState<DispositionLead[]>([]);
  const [dispLoading, setDispLoading] = useState(false);
  const [activeDisp, setActiveDisp] = useState<{ counsellorId: string; disposition: string } | null>(null);

  // Online presence map: user_id → last_seen_at
  const [onlineMap, setOnlineMap] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [statsRes, overdueRes, tatRes, teamRes] = await Promise.all([
        supabase.rpc("get_counsellor_performance_stats" as any),
        supabase.from("overdue_followups" as any).select("*").limit(100),
        supabase.from("counsellor_tat_defaults" as any).select("*"),
        supabase.from("team_leader_defaults_summary" as any).select("*"),
      ]);
      if (statsRes.data) setStats(statsRes.data as any);
      if (overdueRes.data) setOverdue(overdueRes.data as any);
      if (tatRes.data) setTatDefaults(tatRes.data as any);
      if (teamRes.data) setTeamDefaults(teamRes.data as any);

      setLoading(false);
    })();
  }, []);

  const fetchBreakdown = useCallback(async (from: string, to: string) => {
    setBreakdownLoading(true);

    // get_counsellor_breakdown aggregates on the server — no raw-row scan of
    // leads/call_logs/campus_visits to the client (20260617130000 migration).
    const { data, error } = await supabase.rpc("get_counsellor_breakdown" as any, {
      _from_date: from || null,
      _to_date:   to   || null,
    });

    if (error) {
      console.error("fetchBreakdown RPC error:", error);
      setBreakdownLoading(false);
      return;
    }

    const rows = ((data || []) as any[]).map((r: any) => ({
      counsellor_id:            r.counsellor_id,
      counsellor_name:          r.counsellor_name,
      user_id:                  r.user_id,
      total:                    Number(r.total),
      new_lead:                 Number(r.new_lead),
      called:                   Number(r.called),
      not_called:               Number(r.not_called),
      application_in_progress:  Number(r.application_in_progress),
      visit_scheduled:          Number(r.visit_scheduled),
      admitted:                 Number(r.admitted),
      rejected:                 Number(r.rejected),
      other_stages:             Number(r.other_stages),
      visits_completed:         Number(r.visits_completed),
      avg_response_hrs:         r.avg_response_hrs != null ? Number(r.avg_response_hrs) : null,
      dispositions:             r.dispositions ?? {},
      call_rate:     r.total > 0 ? Math.round((Number(r.called)   / Number(r.total)) * 100) : 0,
      conversion_rate: r.total > 0 ? Math.round((Number(r.admitted) / Number(r.total)) * 100) : 0,
    }));

    setBreakdownData(rows);

    // Fetch presence for the counsellors in this result
    const userIds = rows.map((r) => r.user_id).filter(Boolean);
    if (userIds.length > 0) {
      const { data: presenceRows } = await supabase
        .from("profiles")
        .select("user_id, last_seen_at")
        .in("user_id", userIds);
      const map: Record<string, string> = {};
      for (const p of (presenceRows || []) as any[]) {
        if (p.last_seen_at) map[p.user_id] = p.last_seen_at;
      }
      setOnlineMap(map);
    }

    setBreakdownLoading(false);
  }, []);

  // Fetch activity log per counsellor
  const fetchActivity = useCallback(async (preset: DatePreset) => {
    setActivityLoading(true);
    setActivityDatePreset(preset);
    const { from, to } = getDateRange(preset);

    // Get counsellor profiles
    const { data: roleData } = await supabase
      .from("user_roles" as any).select("user_id, role").in("role", ["counsellor", "admission_head"]);
    const counsellorUserIds = (roleData || []).map((r: any) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles").select("id, user_id, display_name").in("user_id", counsellorUserIds);

    if (!profiles?.length) { setActivityLoading(false); return; }
    const profileMap = new Map((profiles as any[]).map(p => [p.user_id, p]));
    const profileIdMap = new Map((profiles as any[]).map(p => [p.id, p]));

    // Fetch activities in date range
    let actQ = supabase
      .from("lead_activities" as any)
      .select("id, lead_id, type, description, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (from) actQ = actQ.gte("created_at", `${from}T00:00:00`);
    if (to) actQ = actQ.lte("created_at", `${to}T23:59:59`);
    const { data: activities } = await actQ;

    // Fetch call logs in date range
    let clQ = supabase
      .from("call_logs" as any)
      .select("id, lead_id, disposition, duration_seconds, user_id, called_at")
      .order("called_at", { ascending: false })
      .limit(500);
    if (from) clQ = clQ.gte("called_at", `${from}T00:00:00`);
    if (to) clQ = clQ.lte("called_at", `${to}T23:59:59`);
    const { data: callLogs } = await clQ;

    // Fetch leads per counsellor to compute not-called
    const profileIds = (profiles as any[]).map(p => p.id);
    const { data: counsellorLeads } = await supabase
      .from("leads")
      .select("id, counsellor_id")
      .in("counsellor_id", profileIds)
      .not("stage", "in", "(admitted,rejected,not_interested)");

    // Build set of lead IDs that have call logs
    const calledLeadIds = new Set<string>();
    for (const cl of (callLogs || []) as any[]) calledLeadIds.add(cl.lead_id);

    // Aggregate per counsellor
    const agg = new Map<string, {
      name: string; userId: string; profileId: string;
      calls: number; whatsapps: number; notes: number; stageChanges: number; aiCalls: number;
      dispositions: Record<string, number>; totalCallDuration: number;
      totalLeads: number; notCalled: number;
    }>();

    for (const p of profiles as any[]) {
      agg.set(p.user_id, {
        name: p.display_name || "Unknown", userId: p.user_id, profileId: p.id,
        calls: 0, whatsapps: 0, notes: 0, stageChanges: 0, aiCalls: 0,
        dispositions: {}, totalCallDuration: 0,
        totalLeads: 0, notCalled: 0,
      });
    }

    // Count leads and not-called per counsellor
    const profileIdToUserId = new Map((profiles as any[]).map(p => [p.id, p.user_id]));
    for (const l of (counsellorLeads || []) as any[]) {
      const userId = profileIdToUserId.get(l.counsellor_id);
      if (!userId) continue;
      const entry = agg.get(userId);
      if (!entry) continue;
      entry.totalLeads++;
      if (!calledLeadIds.has(l.id)) entry.notCalled++;
    }

    for (const a of (activities || []) as any[]) {
      const entry = agg.get(a.user_id);
      if (!entry) continue;
      if (a.type === "call") entry.calls++;
      else if (a.type === "whatsapp") entry.whatsapps++;
      else if (a.type === "note") entry.notes++;
      else if (a.type === "stage_change") entry.stageChanges++;
      else if (a.type === "ai_call") entry.aiCalls++;
    }

    for (const cl of (callLogs || []) as any[]) {
      const entry = agg.get(cl.user_id);
      if (!entry) continue;
      entry.calls++;
      entry.totalCallDuration += cl.duration_seconds || 0;
      if (cl.disposition) {
        entry.dispositions[cl.disposition] = (entry.dispositions[cl.disposition] || 0) + 1;
      }
    }

    // Also count by counsellor_id (profiles.id) for activities that use profile-based user tracking
    for (const a of (activities || []) as any[]) {
      if (a.user_id) continue; // already counted above
      // Some activities might have a lead's counsellor_id as the implicit actor
    }

    setActivityData(
      Array.from(agg.values())
        .filter(a => a.calls + a.whatsapps + a.notes + a.stageChanges + a.aiCalls > 0)
        .sort((a, b) => (b.calls + b.whatsapps + b.notes) - (a.calls + a.whatsapps + a.notes))
    );
    setActivityLoading(false);
  }, []);

  // Fetch lead calling data per counsellor
  const fetchCalling = useCallback(async (preset: DatePreset) => {
    setCallingLoading(true);
    setCallingDatePreset(preset);
    const { from, to } = getDateRange(preset);

    const { data, error } = await (supabase as any).rpc("counsellor_calling_summary", {
      p_from_date: from || null,
      p_to_date: to || null,
    });

    if (error) {
      console.error("fetchCalling RPC error:", error);
      setCallingLoading(false);
      return;
    }

    setCallingData((data || []) as any[]);
    setCallingLoading(false);
  }, []);

  const fetchFunnel = useCallback(async (range: "7d" | "30d" | "all") => {
    setFunnelLoading(true);
    let q = (supabase.from("counsellor_funnel_stats" as any) as any).select("counsellor_id, counsellor_name, stage, week_start, leads_reached");
    if (range !== "all") {
      const days = range === "7d" ? 7 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      q = q.gte("week_start", since);
    }
    const { data } = await q;
    setFunnelRows((data || []) as any);
    setFunnelLoading(false);
  }, []);

  // Auto-fetch when tab switches to a data-heavy tab (lazy loading).
  // Breakdown is included here so the page doesn't block on fetching all
  // leads + call_logs + visits before showing the default leaderboard tab.
  useEffect(() => {
    if (tab === "breakdown" && breakdownData.length === 0 && !breakdownLoading) {
      fetchBreakdown("", "");
    }
    if (tab === "activity" && activityData.length === 0 && !activityLoading) {
      fetchActivity(activityDatePreset);
    }
    if (tab === "calling" && callingData.length === 0 && !callingLoading) {
      fetchCalling(callingDatePreset);
    }
    if (tab === "funnel" && funnelRows.length === 0 && !funnelLoading) {
      fetchFunnel(funnelRange);
    }
  }, [tab]);

  // Apply date preset
  const applyPreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    const { from, to } = getDateRange(preset);
    setDateFrom(from);
    setDateTo(to);
    setExpandedCounsellor(null);
    setActiveDisp(null);
    fetchBreakdown(from, to);
  }, [fetchBreakdown]);

  // Apply custom date range
  const applyCustomDate = useCallback(() => {
    setDatePreset("all"); // deselect presets
    setExpandedCounsellor(null);
    setActiveDisp(null);
    fetchBreakdown(dateFrom, dateTo);
  }, [dateFrom, dateTo, fetchBreakdown]);

  // Sorted breakdown data
  const sortedBreakdown = useMemo(() => {
    const data = [...breakdownData];
    data.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortCol === "counsellor_name") {
        aVal = a.counsellor_name.toLowerCase();
        bVal = b.counsellor_name.toLowerCase();
      } else if (sortCol === "avg_response_hrs") {
        aVal = a.avg_response_hrs ?? 9999;
        bVal = b.avg_response_hrs ?? 9999;
      } else {
        aVal = a[sortCol] as number;
        bVal = b[sortCol] as number;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return data;
  }, [breakdownData, sortCol, sortDir]);

  const handleSort = (col: BreakdownSortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  // Fetch leads for a specific disposition + counsellor
  const fetchDispositionLeads = useCallback(async (counsellorUserId: string, counsellorId: string, disposition: string) => {
    // Toggle off if same disposition clicked again
    if (activeDisp?.counsellorId === counsellorId && activeDisp?.disposition === disposition) {
      setActiveDisp(null);
      setDispLeads([]);
      return;
    }
    setActiveDisp({ counsellorId, disposition });
    setDispLoading(true);

    // Get lead IDs with this disposition from this counsellor
    let callQ = supabase
      .from("call_logs" as any)
      .select("lead_id")
      .eq("user_id", counsellorUserId)
      .eq("disposition", disposition);
    if (dateFrom) callQ = callQ.gte("called_at", `${dateFrom}T00:00:00`);
    if (dateTo) callQ = callQ.lte("called_at", `${dateTo}T23:59:59`);
    const { data: callData } = await callQ;

    if (!callData || callData.length === 0) {
      setDispLeads([]);
      setDispLoading(false);
      return;
    }

    const leadIds = [...new Set((callData as any[]).map((c: any) => c.lead_id))];
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, phone, stage, created_at")
      .in("id", leadIds.slice(0, 100))
      .order("created_at", { ascending: false });

    setDispLeads((leads as DispositionLead[]) || []);
    setDispLoading(false);
  }, [activeDisp, dateFrom, dateTo]);

  // Aggregate totals
  const totals = useMemo(() => stats.reduce((acc, s) => ({
    calls: acc.calls + Number(s.total_calls),
    whatsapps: acc.whatsapps + Number(s.total_whatsapps),
    followups: acc.followups + Number(s.followups_completed),
    visits: acc.visits + Number(s.visits_scheduled),
    conversions: acc.conversions + Number(s.conversions),
    overdue: acc.overdue + Number(s.followups_overdue),
    leads: acc.leads + Number(s.leads_assigned),
  }), { calls: 0, whatsapps: 0, followups: 0, visits: 0, conversions: 0, overdue: 0, leads: 0 }), [stats]);

  // DB-backed leaderboard
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<"weekly" | "monthly" | "all">("all");

  // Cloud Dialer adoption % per counsellor, aggregated over the last 30 days.
  // Visibility only — no enforcement yet. NULL pct means no attributed calls
  // (cloud_dialer + manual_log combined are zero); shown as "—".
  const [dialerUsage, setDialerUsage] = useState<Record<string, number | null>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_counsellor_leaderboard" as any);
      if (data) setLeaderboard(data);
    })();
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data } = await (supabase.from("counsellor_dialer_usage" as any) as any)
        .select("counsellor_id, cloud_dialer_calls, manual_log_calls")
        .gte("week_start", since);
      if (!data) return;
      // Re-aggregate weekly rows into a single per-counsellor pct so the
      // leaderboard cell shows one number, not a per-week breakdown.
      const agg: Record<string, { cd: number; ml: number }> = {};
      for (const r of data as { counsellor_id: string; cloud_dialer_calls: number; manual_log_calls: number }[]) {
        const a = agg[r.counsellor_id] || { cd: 0, ml: 0 };
        a.cd += r.cloud_dialer_calls;
        a.ml += r.manual_log_calls;
        agg[r.counsellor_id] = a;
      }
      const pct: Record<string, number | null> = {};
      for (const [id, v] of Object.entries(agg)) {
        const total = v.cd + v.ml;
        pct[id] = total > 0 ? Math.round((v.cd / total) * 100) : null;
      }
      setDialerUsage(pct);
    })();
  }, []);

  const ranked = useMemo(() => {
    // Build from leaderboard data (source of truth for scores); merge in stats for activity columns
    const statsMap = new Map<string, any>();
    for (const s of stats) statsMap.set(s.counsellor_id, s);

    const base = leaderboard.length > 0 ? leaderboard : stats.map(s => ({
      counsellor_id: s.counsellor_id,
      counsellor_name: s.counsellor_name,
      user_id: s.user_id,
      total_score: 0, weekly_score: 0, monthly_score: 0, daily_score: 0,
      positive_actions: 0, negative_actions: 0,
    }));

    return [...base]
      .map(lb => {
        const s = statsMap.get(lb.counsellor_id) || {};
        const score = leaderboardPeriod === "weekly" ? lb.weekly_score
          : leaderboardPeriod === "monthly" ? lb.monthly_score
          : lb.total_score;
        return {
          counsellor_id: lb.counsellor_id,
          counsellor_name: lb.counsellor_name || s.counsellor_name || "Unknown",
          user_id: lb.user_id || s.user_id,
          leads_assigned: s.leads_assigned || 0,
          total_calls: s.total_calls || 0,
          followups_completed: s.followups_completed || 0,
          visits_scheduled: s.visits_scheduled || 0,
          conversions: s.conversions || 0,
          followups_overdue: s.followups_overdue || 0,
          applications: s.applications || 0,
          applications_paid: s.applications_paid || 0,
          score,
          weekly_score: lb.weekly_score || 0,
          monthly_score: lb.monthly_score || 0,
          total_score: lb.total_score || 0,
          daily_score: lb.daily_score || 0,
          positive_actions: lb.positive_actions || 0,
          negative_actions: lb.negative_actions || 0,
          dialer_usage_pct: dialerUsage[lb.counsellor_id] ?? null,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [stats, leaderboard, leaderboardPeriod, dialerUsage]);

  const isCounsellorOnline = (userId: string) => {
    const t = onlineMap[userId];
    return !!t && Date.now() - new Date(t).getTime() < 2 * 60 * 1000;
  };

  const breakdownTotals = useMemo(() => breakdownData.reduce((acc, b) => ({
    total: acc.total + b.total,
    new_lead: acc.new_lead + b.new_lead,
    called: acc.called + b.called,
    not_called: acc.not_called + b.not_called,
    admitted: acc.admitted + b.admitted,
  }), { total: 0, new_lead: 0, called: 0, not_called: 0, admitted: 0 }), [breakdownData]);

  // Counsellor name map for overdue filter — tatDefaults has full coverage, ranked as fallback
  const overdueCounsellorNameMap: Record<string, string> = {};
  for (const d of tatDefaults) {
    if (d.profile_id) overdueCounsellorNameMap[d.profile_id] = d.counsellor_name;
  }
  for (const s of ranked) {
    if (s.counsellor_id && !overdueCounsellorNameMap[s.counsellor_id]) {
      overdueCounsellorNameMap[s.counsellor_id] = s.counsellor_name;
    }
  }
  const overdueCouns = Array.from(
    new Map(
      overdue
        .filter(f => f.counsellor_id)
        .map(f => [f.counsellor_id, overdueCounsellorNameMap[f.counsellor_id!] || "Unknown"])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const filteredOverdue = overdueFilter === "all"
    ? overdue
    : overdueFilter === "unassigned"
      ? overdue.filter(f => !f.counsellor_id)
      : overdue.filter(f => f.counsellor_id === overdueFilter);

  if (loading) {
    return <PageLoader />;
  }

  const summaryCards = [
    { label: "Total Calls", value: totals.calls, icon: Phone, color: "bg-info/10 dark:bg-info/80/30", iconColor: "text-info-foreground" },
    { label: "WhatsApps Sent", value: totals.whatsapps, icon: MessageSquare, color: "bg-success/10 dark:bg-success/80/30", iconColor: "text-success" },
    { label: "Follow-ups Done", value: totals.followups, icon: CalendarCheck, color: "bg-warning/10 dark:bg-warning/80/30", iconColor: "text-warning-foreground" },
    { label: "Visits Scheduled", value: totals.visits, icon: MapPin, color: "bg-primary/10 dark:bg-primary/80/30", iconColor: "text-primary" },
    { label: "Conversions", value: totals.conversions, icon: UserCheck, color: "bg-success/10 dark:bg-success/80/30", iconColor: "text-success" },
    { label: "Overdue Follow-ups", value: totals.overdue, icon: AlertTriangle, color: totals.overdue > 0 ? "bg-destructive/10 dark:bg-destructive/80/30" : "bg-muted", iconColor: totals.overdue > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  // Sortable column header renderer
  const SortHeader = ({ col, label, className }: { col: BreakdownSortCol; label: string; className?: string }) => (
    <th
      className={`px-3 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors ${className || "text-center"}`}
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortCol === col ? (
          sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </span>
    </th>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Counsellor Performance</h1>
        <p className="text-sm text-muted-foreground mt-1">Team activity, conversions & overdue follow-ups</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><MorningBrief /></div>
        <IncentiveWidget />
      </div>

      {/* Summary cards — reference-inspired stat-card shape (rounded-2xl,
          softer border, larger tinted icon chip, hero number with tight
          tracking). Vertical layout preserved because 6-up packs better
          this way. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label} className="rounded-2xl border-border/40 shadow-none transition-all hover:shadow-sm">
            <CardContent className="p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.color} mb-3`}>
                <card.icon className={`h-[18px] w-[18px] ${card.iconColor}`} />
              </div>
              <p className="text-2xl font-bold text-foreground leading-none tracking-tight">{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CahetSprintLeaderboard />
        <UpdeledSprintLeaderboard />
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-3 overflow-x-auto">
        <div className="flex rounded-xl border border-input bg-card p-0.5">
          <button
            onClick={() => setTab("leaderboard")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${tab === "leaderboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setTab("breakdown")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${tab === "breakdown" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Lead Breakdown
          </button>
          <button
            onClick={() => setTab("overdue")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${tab === "overdue" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Overdue Follow-ups
            {overdue.length > 0 && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === "overdue" ? "bg-white/20 text-primary-foreground" : "bg-destructive/50 text-white"}`}>
                {overdue.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("tat-defaults")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${tab === "tat-defaults" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            TAT Defaults
            {tatDefaults.filter(d => d.total_defaults > 0).length > 0 && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === "tat-defaults" ? "bg-white/20 text-primary-foreground" : "bg-destructive/50 text-white"}`}>
                {tatDefaults.reduce((s: number, d: any) => s + d.total_defaults, 0)}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("activity")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${tab === "activity" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Activity Log
          </button>
          <button
            onClick={() => setTab("calling")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${tab === "calling" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Lead Calling
          </button>
          <button
            onClick={() => setTab("assignments")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${tab === "assignments" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <History className="h-3.5 w-3.5" />
            Assignments
          </button>
          <button
            onClick={() => setTab("funnel")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${tab === "funnel" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Funnel
          </button>
        </div>
      </div>

      {tab === "leaderboard" ? (
        <div className="space-y-4">
          {/* Period toggle */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-input bg-card p-0.5">
              {([
                { key: "weekly", label: "This Week" },
                { key: "monthly", label: "This Month" },
                { key: "all", label: "All Time" },
              ] as const).map(p => (
                <button
                  key={p.key}
                  onClick={() => setLeaderboardPeriod(p.key)}
                  className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    leaderboardPeriod === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leads</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calls</th>
                    <th
                      className="px-3 py-3 text-center text-[10px] font-semibold text-cyan-700 uppercase tracking-wide"
                      title="Share of attributable calls (cloud_dialer + manual_log) over the last 30 days that used the Cloud Dialer. Visibility only — not yet enforced."
                    >
                      Dialer %
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversions</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-primary uppercase tracking-wide">Apps</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-warning-foreground uppercase tracking-wide" title="New leads not contacted within SLA">New Due</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-warning-foreground uppercase tracking-wide" title="Overdue follow-ups">F/U Due</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-info-foreground uppercase tracking-wide" title="Application stage check-ins overdue">Check-ins</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-destructive uppercase tracking-wide" title="Total TAT defaults">Defaults</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold text-success uppercase">+</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold text-destructive uppercase">-</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-info-foreground uppercase tracking-wide">Today</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Time</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((s, i) => {
                    const tat = tatDefaults.find((d: any) => d.profile_id === s.counsellor_id);
                    return (
                    <tr key={s.counsellor_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-center">
                        {i === 0 ? <Trophy className="h-4 w-4 text-warning mx-auto" /> :
                         i === 1 ? <Trophy className="h-4 w-4 text-gray-400 mx-auto" /> :
                         i === 2 ? <Trophy className="h-4 w-4 text-warning-foreground mx-auto" /> :
                         <span className="text-muted-foreground text-xs">{i + 1}</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {s.counsellor_name || "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{s.leads_assigned}</td>
                      <td className="px-4 py-3 text-center font-medium text-foreground">{s.total_calls}</td>
                      <td className="px-3 py-3 text-center">
                        {s.dialer_usage_pct === null || s.dialer_usage_pct === undefined ? (
                          <span className="text-[10px] text-muted-foreground/60">—</span>
                        ) : (
                          <span className={`inline-flex h-5 min-w-[34px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                            s.dialer_usage_pct >= 70 ? "bg-success/10 text-success" :
                            s.dialer_usage_pct >= 50 ? "bg-warning/10 text-warning-foreground" :
                            "bg-destructive/10 text-destructive"
                          }`}>{s.dialer_usage_pct}%</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-primary">{s.conversions}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {s.applications > 0 ? (
                          <span className="text-xs">
                            <span className="font-semibold text-primary">{s.applications_paid}</span>
                            <span className="text-muted-foreground">/{s.applications}</span>
                          </span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.new_leads_overdue > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-warning/10 text-warning-foreground">{tat.new_leads_overdue}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.overdue_followups > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-warning/10 text-warning-foreground">{tat.overdue_followups}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.app_checkins_overdue > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-info/10 text-info-foreground">{tat.app_checkins_overdue}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.total_defaults > 0 ? (
                          <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold ${tat.total_defaults > 5 ? "bg-destructive/50 text-white" : "bg-destructive/10 text-destructive"}`}>{tat.total_defaults}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-[10px] font-bold text-success">{s.positive_actions}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[10px] font-bold ${s.negative_actions > 0 ? "text-destructive" : "text-muted-foreground"}`}>{s.negative_actions}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`border-0 text-xs font-bold ${
                          s.daily_score > 0 ? "bg-info/10 text-info-foreground" : s.daily_score < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                        }`}>{s.daily_score > 0 ? `+${s.daily_score}` : s.daily_score}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`border-0 text-xs font-bold ${
                          s.total_score > 0 ? "bg-primary/10 text-primary" : s.total_score < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                        }`}>{s.total_score}</Badge>
                      </td>
                    </tr>
                    );
                  })}
                  {ranked.length === 0 && (
                    <tr><td colSpan={15} className="px-4 py-8 text-center text-sm text-muted-foreground">No counsellor data available</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </CardContent>
          </Card>

          {/* Post-Visit Pipeline */}
          <PostVisitPipeline />
          <FeedbackSummary />
        </div>

      ) : tab === "breakdown" ? (
        <div className="space-y-4">
          {/* Date filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick presets */}
            <div className="flex rounded-lg border border-input bg-card p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    datePreset === p.key && !((datePreset === "all" && (dateFrom || dateTo)))
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div className="flex items-center gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground w-[120px]"
              />
              <span className="text-muted-foreground">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground w-[120px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={applyCustomDate}
              >
                Apply
              </Button>
            </div>

            {breakdownLoading && <ButtonOrb state="searching" />}
          </div>

          {/* Breakdown summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: "Total Assigned", value: breakdownTotals.total, icon: Users, color: "bg-info/10 dark:bg-info/80/30", iconColor: "text-info-foreground" },
              { label: "New / Untouched", value: breakdownTotals.new_lead, icon: Clock, color: "bg-warning/10 dark:bg-warning/80/30", iconColor: "text-warning-foreground" },
              { label: "Called", value: breakdownTotals.called, icon: PhoneCall, color: "bg-success/10 dark:bg-success/80/30", iconColor: "text-success" },
              { label: "Not Called", value: breakdownTotals.not_called, icon: PhoneOff, color: breakdownTotals.not_called > 0 ? "bg-destructive/10 dark:bg-destructive/80/30" : "bg-muted", iconColor: breakdownTotals.not_called > 0 ? "text-destructive" : "text-muted-foreground" },
              { label: "Admitted", value: breakdownTotals.admitted, icon: UserCheck, color: "bg-success/10 dark:bg-success/80/30", iconColor: "text-success" },
              { label: "Online Now", value: breakdownData.filter((b) => isCounsellorOnline(b.user_id)).length, icon: Users, color: "bg-success/10 dark:bg-success/80/30", iconColor: "text-success" },
            ].map((c) => (
              <Card key={c.label} className="rounded-2xl border-border/40 shadow-none transition-all hover:shadow-sm">
                <CardContent className="p-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.color} mb-3`}>
                    <c.icon className={`h-[18px] w-[18px] ${c.iconColor}`} />
                  </div>
                  <p className="text-2xl font-bold text-foreground leading-none tracking-tight">{c.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5">{c.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Main breakdown table */}
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <SortHeader col="counsellor_name" label="Counsellor" className="text-left min-w-[140px]" />
                      <SortHeader col="total" label="Assigned" />
                      <SortHeader col="new_lead" label="New" />
                      <SortHeader col="called" label="Called" />
                      <SortHeader col="not_called" label="Not Called" />
                      <SortHeader col="application_in_progress" label="In Progress" />
                      <SortHeader col="visit_scheduled" label="Visit Sched." />
                      <SortHeader col="visits_completed" label="Visits Done" />
                      <SortHeader col="admitted" label="Admitted" />
                      <SortHeader col="rejected" label="Rejected" />
                      <SortHeader col="call_rate" label="Call Rate" />
                      <SortHeader col="conversion_rate" label="Conv. Rate" />
                      <SortHeader col="avg_response_hrs" label="Avg Response" />
                      <th className="px-3 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBreakdown.map((b) => {
                      const isExpanded = expandedCounsellor === b.counsellor_id;
                      const hasDispositions = Object.keys(b.dispositions).length > 0;
                      const isDispActive = activeDisp?.counsellorId === b.counsellor_id;

                      return (
                        <>
                          <tr
                            key={b.counsellor_id}
                            className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${hasDispositions ? "cursor-pointer" : ""}`}
                            onClick={() => {
                              if (hasDispositions) {
                                setExpandedCounsellor(isExpanded ? null : b.counsellor_id);
                                if (isExpanded) { setActiveDisp(null); setDispLeads([]); }
                              }
                            }}
                          >
                            <td className="px-3 py-3 font-medium text-foreground">
                              <div className="flex items-center gap-2">
                                {isCounsellorOnline(b.user_id) && (
                                  <span className="h-2 w-2 rounded-full bg-success/50 shrink-0" title="Online now" />
                                )}
                                {b.counsellor_name}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center font-bold text-foreground">{b.total}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-semibold ${b.new_lead > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>{b.new_lead}</span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className="text-xs font-semibold text-success">{b.called}</span>
                            </td>
                            <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                              {b.not_called > 0 ? (
                                <button
                                  onClick={() => navigate(`/admissions?counsellor=${b.counsellor_id}&not_called=true`)}
                                  className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border-0 text-[10px] font-bold px-2.5 py-0.5 hover:bg-destructive/15 transition-colors cursor-pointer"
                                  title="View not-called leads — bulk transfer available"
                                >
                                  {b.not_called}
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{b.application_in_progress}</td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{b.visit_scheduled}</td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{b.visits_completed}</td>
                            <td className="px-3 py-3 text-center">
                              <span className="text-xs font-bold text-primary">{b.admitted}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{b.rejected}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${b.call_rate >= 80 ? "text-success" : b.call_rate >= 50 ? "text-warning-foreground" : "text-destructive"}`}>
                                {b.call_rate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${b.conversion_rate >= 10 ? "text-success" : b.conversion_rate >= 5 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                                {b.conversion_rate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {b.avg_response_hrs !== null ? (
                                <span className={`text-xs font-medium ${b.avg_response_hrs <= 2 ? "text-success" : b.avg_response_hrs <= 6 ? "text-warning-foreground" : "text-destructive"}`}>
                                  {b.avg_response_hrs < 1 ? `${Math.round(b.avg_response_hrs * 60)}m` : `${b.avg_response_hrs}h`}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {hasDispositions && (
                                isExpanded
                                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                              )}
                            </td>
                          </tr>
                          {/* Expanded disposition row */}
                          {isExpanded && hasDispositions && (
                            <tr key={`${b.counsellor_id}-disp`} className="border-b border-border/40 bg-muted/20">
                              <td colSpan={14} className="px-3 py-3">
                                <div className="pl-2">
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Call Disposition Breakdown — click to view leads
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {Object.entries(b.dispositions)
                                      .sort(([, a], [, b]) => b - a)
                                      .map(([disp, count]) => {
                                        const isActive = activeDisp?.counsellorId === b.counsellor_id && activeDisp?.disposition === disp;
                                        return (
                                          <button
                                            key={disp}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              fetchDispositionLeads(b.user_id, b.counsellor_id, disp);
                                            }}
                                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                                              isActive
                                                ? "ring-2 ring-primary ring-offset-1 shadow-sm"
                                                : "hover:ring-1 hover:ring-border"
                                            } ${DISPOSITION_COLORS[disp] || "bg-muted text-muted-foreground"}`}
                                          >
                                            <span className="capitalize">{DISPOSITION_LABELS[disp] || disp.replace(/_/g, " ")}</span>
                                            <span className="font-bold">{count}</span>
                                          </button>
                                        );
                                      })}
                                  </div>
                                  {/* Visual bar */}
                                  <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-muted">
                                    {(() => {
                                      const totalDisp = Object.values(b.dispositions).reduce((a, b) => a + b, 0);
                                      const barColors: Record<string, string> = {
                                        interested: "bg-success/50", not_interested: "bg-destructive/40",
                                        ineligible: "bg-gray-400", not_answered: "bg-warning/40",
                                        call_back: "bg-info/40", wrong_number: "bg-pink-400",
                                        do_not_contact: "bg-destructive", voicemail: "bg-primary/40",
                                        busy: "bg-warning/50",
                                      };
                                      return Object.entries(b.dispositions)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([disp, count]) => (
                                          <div
                                            key={disp}
                                            className={`${barColors[disp] || "bg-gray-300"} transition-all`}
                                            style={{ width: `${(count / totalDisp) * 100}%` }}
                                            title={`${DISPOSITION_LABELS[disp] || disp}: ${count}`}
                                          />
                                        ));
                                    })()}
                                  </div>

                                  {/* Disposition leads list */}
                                  {isDispActive && (
                                    <div className="mt-3 rounded-lg border border-border bg-card overflow-hidden">
                                      <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                          {DISPOSITION_LABELS[activeDisp!.disposition] || activeDisp!.disposition} leads — {b.counsellor_name}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">{dispLeads.length} leads</span>
                                      </div>
                                      {dispLoading ? (
                                        <div className="flex items-center justify-center py-6">
                                          <ButtonOrb state="searching" />
                                        </div>
                                      ) : dispLeads.length === 0 ? (
                                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">No leads found</div>
                                      ) : (
                                        <div className="max-h-[250px] overflow-y-auto">
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="border-b border-border/50 bg-muted/20">
                                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Phone</th>
                                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Stage</th>
                                                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Created</th>
                                                <th className="px-3 py-1.5 w-8"></th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {dispLeads.map((lead) => (
                                                <tr
                                                  key={lead.id}
                                                  className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(`/admissions/${lead.id}`, "_blank");
                                                  }}
                                                >
                                                  <td className="px-3 py-2 font-medium text-foreground">{lead.name}</td>
                                                  <td className="px-3 py-2 text-muted-foreground">{lead.phone}</td>
                                                  <td className="px-3 py-2">
                                                    <Badge variant="outline" className="text-[9px]">{STAGE_LABELS[lead.stage] || lead.stage}</Badge>
                                                  </td>
                                                  <td className="px-3 py-2 text-muted-foreground">
                                                    {new Date(lead.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {sortedBreakdown.length === 0 && (
                      <tr><td colSpan={14} className="px-4 py-8 text-center text-sm text-muted-foreground">No lead data available</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

      ) : tab === "overdue" ? (
          <div className="space-y-3">
            {/* Counsellor filter — always shown when there are overdue items */}
            {overdue.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-medium shrink-0">Filter by counsellor:</span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setOverdueFilter("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${overdueFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    All
                    <span className="ml-1 opacity-70">({overdue.length})</span>
                  </button>
                  {overdueCouns.map(([id, name]) => {
                    const count = overdue.filter(f => f.counsellor_id === id).length;
                    return (
                      <button
                        key={id}
                        onClick={() => setOverdueFilter(id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${overdueFilter === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                      >
                        {name}
                        <span className={`ml-1 text-[10px] font-bold ${overdueFilter === id ? "opacity-70" : "text-destructive"}`}>({count})</span>
                      </button>
                    );
                  })}
                  {overdue.some(f => !f.counsellor_id) && (
                    <button
                      onClick={() => setOverdueFilter("unassigned")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${overdueFilter === "unassigned" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      Unassigned
                      <span className={`ml-1 text-[10px] font-bold ${overdueFilter === "unassigned" ? "opacity-70" : "text-warning"}`}>({overdue.filter(f => !f.counsellor_id).length})</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <Card className="border-border/60 shadow-none overflow-hidden">
              <CardContent className="p-0">
                {filteredOverdue.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <CalendarCheck className="h-8 w-8 text-success mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">All caught up!</p>
                    <p className="text-xs text-muted-foreground">No overdue follow-ups</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scheduled</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overdue</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOverdue.map((f) => (
                        <tr
                          key={f.id}
                          className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => navigate(`/admissions/${f.lead_id}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{f.lead_name}</div>
                            <div className="text-xs text-muted-foreground">{f.lead_phone}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {f.counsellor_id ? (overdueCounsellorNameMap[f.counsellor_id] || "—") : <span className="text-warning">Unassigned</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-[10px]">{STAGE_LABELS[f.lead_stage] || f.lead_stage}</Badge>
                          </td>
                          <td className="px-4 py-3 capitalize text-muted-foreground">{f.type}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {new Date(f.scheduled_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={`border-0 text-[10px] font-semibold ${
                              f.days_overdue > 5 ? "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80"
                                : f.days_overdue > 2 ? "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
                                  : "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
                            }`}>
                              {f.days_overdue}d
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{f.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
      ) : tab === "tat-defaults" ? (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            {tatDefaults.filter(d => d.total_defaults > 0).length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                All counsellors are on track — no TAT defaults
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Counsellor</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">New Leads Overdue</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Overdue Follow-ups</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">App Check-ins Due</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Total Defaults</th>
                  </tr>
                </thead>
                <tbody>
                  {tatDefaults
                    .filter(d => d.total_defaults > 0)
                    .sort((a: any, b: any) => b.total_defaults - a.total_defaults)
                    .map((d: any) => (
                    <tr key={d.profile_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{d.counsellor_name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.new_leads_overdue > 0 ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}>
                          {d.new_leads_overdue}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.overdue_followups > 0 ? "bg-warning/10 text-warning-foreground" : "text-muted-foreground"}`}>
                          {d.overdue_followups}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.app_checkins_overdue > 0 ? "bg-warning/10 text-warning-foreground" : "text-muted-foreground"}`}>
                          {d.app_checkins_overdue}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${
                          d.total_defaults > 5 ? "bg-destructive/50 text-white" : d.total_defaults > 0 ? "bg-destructive/10 text-destructive" : "text-muted-foreground"
                        }`}>
                          {d.total_defaults}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : tab === "activity" ? (
        <div className="space-y-4">
          {/* Date filter */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-input bg-card p-0.5">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => fetchActivity(p.key)}
                  className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    activityDatePreset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {activityLoading && <ButtonOrb state="searching" />}
          </div>

          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              {activityData.length === 0 && !activityLoading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No activity recorded for this period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Counsellor</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Leads</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-destructive uppercase">Not Called</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Time</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">WhatsApp</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Notes</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Stage Changes</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">AI Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Total Actions</th>
                        {/* Disposition columns */}
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-success uppercase">Interested</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-destructive uppercase">Not Int.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-warning-foreground uppercase">No Ans.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-info-foreground uppercase">Call Back</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-warning-foreground uppercase">Busy</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-gray-600 uppercase">Other</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityData.map(a => {
                        const totalActions = a.calls + a.whatsapps + a.notes + a.stageChanges + a.aiCalls;
                        const otherDisp = Object.entries(a.dispositions)
                          .filter(([k]) => !["interested", "not_interested", "not_answered", "call_back", "busy"].includes(k))
                          .reduce((s, [, v]) => s + (v as number), 0);
                        const callMins = Math.round(a.totalCallDuration / 60);

                        return (
                          <tr key={a.userId} className="border-b border-border/40 hover:bg-muted/20">
                            <td className="px-4 py-3 font-medium text-foreground">{a.name}</td>
                            <td className="px-3 py-3 text-center text-xs font-bold text-foreground">{a.totalLeads}</td>
                            <td className="px-3 py-3 text-center">
                              {a.notCalled > 0 ? (
                                <button
                                  onClick={() => navigate(`/admissions?counsellor=${a.profileId}&not_called=true`)}
                                  className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold px-2 py-0.5 hover:bg-destructive/15 transition-colors"
                                >
                                  {a.notCalled}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${a.calls > 0 ? "text-info-foreground" : "text-muted-foreground"}`}>{a.calls}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {callMins > 0 ? `${callMins}m` : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${a.whatsapps > 0 ? "text-success" : "text-muted-foreground"}`}>{a.whatsapps}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{a.notes || "—"}</td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{a.stageChanges || "—"}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs ${a.aiCalls > 0 ? "font-bold text-primary" : "text-muted-foreground"}`}>{a.aiCalls || "—"}</span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${
                                totalActions > 20 ? "bg-success/10 text-success" : totalActions > 5 ? "bg-info/10 text-info-foreground" : "bg-muted text-muted-foreground"
                              }`}>
                                {totalActions}
                              </span>
                            </td>
                            {/* Dispositions */}
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.interested ? (
                                <span className="text-[10px] font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5">{a.dispositions.interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.not_interested ? (
                                <span className="text-[10px] font-bold text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">{a.dispositions.not_interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.not_answered ? (
                                <span className="text-[10px] font-bold text-warning-foreground bg-warning/10 rounded-full px-1.5 py-0.5">{a.dispositions.not_answered}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.call_back ? (
                                <span className="text-[10px] font-bold text-info-foreground bg-info/10 rounded-full px-1.5 py-0.5">{a.dispositions.call_back}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.busy ? (
                                <span className="text-[10px] font-bold text-warning-foreground bg-warning/10 rounded-full px-1.5 py-0.5">{a.dispositions.busy}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {otherDisp > 0 ? (
                                <span className="text-[10px] font-bold text-gray-700 bg-gray-100 rounded-full px-1.5 py-0.5">{otherDisp}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "calling" ? (
        <div className="space-y-4">
          {/* Date filter */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-input bg-card p-0.5">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => fetchCalling(p.key)}
                  className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    callingDatePreset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {callingLoading && <ButtonOrb state="searching" />}
          </div>

          {/* Summary pills */}
          {callingData.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <span className="text-sm font-medium text-foreground">
                {callingData.reduce((s: number, c: any) => s + c.activeLeads, 0)} active leads across {callingData.length} counsellors
              </span>
              {(() => {
                const totalNotCalled = callingData.reduce((s: number, c: any) => s + c.notCalled, 0);
                const totalCalls = callingData.reduce((s: number, c: any) => s + c.callsInPeriod, 0);
                const totalOverdue = callingData.reduce((s: number, c: any) => s + c.overdueFollowups, 0);
                return (
                  <>
                    {totalNotCalled > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 dark:bg-destructive/80/30 px-2.5 py-1 text-xs font-semibold text-destructive dark:text-destructive/60">
                        <PhoneOff className="h-3 w-3" /> {totalNotCalled} Not Called
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-info/10 dark:bg-info/80/30 px-2.5 py-1 text-xs font-semibold text-info-foreground dark:text-info/60">
                      <PhoneCall className="h-3 w-3" /> {totalCalls} Calls
                    </span>
                    {totalOverdue > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 dark:bg-warning/80/30 px-2.5 py-1 text-xs font-semibold text-warning-foreground dark:text-warning/70">
                        <Clock className="h-3 w-3" /> {totalOverdue} Overdue
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              {callingData.length === 0 && !callingLoading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No counsellors with active leads found
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Counsellor</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Active Leads</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-destructive uppercase">Not Called</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Time</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Rate</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-warning-foreground uppercase">Overdue F/U</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Avg Response</th>
                        {/* Disposition columns */}
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-success uppercase">Interested</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-destructive uppercase">Not Int.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-warning-foreground uppercase">No Ans.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-info-foreground uppercase">Call Back</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-warning-foreground uppercase">Busy</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-gray-600 uppercase">Other</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {callingData.map((c: any) => {
                        const callRate = c.activeLeads > 0 ? Math.round(((c.activeLeads - c.notCalled) / c.activeLeads) * 100) : 0;
                        const callMins = Math.round(c.callDuration / 60);
                        const otherDisp = Object.entries(c.dispositions)
                          .filter(([k]) => !["interested", "not_interested", "not_answered", "call_back", "busy"].includes(k))
                          .reduce((s: number, [, v]) => s + (v as number), 0);

                        return (
                          <tr key={c.profileId} className="border-b border-border/40 hover:bg-muted/20">
                            <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                            <td className="px-3 py-3 text-center text-xs font-bold text-foreground">{c.activeLeads}</td>
                            <td className="px-3 py-3 text-center">
                              {c.notCalled > 0 ? (
                                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold bg-destructive/10 text-destructive dark:bg-destructive/80/40 dark:text-destructive/60">
                                  {c.notCalled}
                                </span>
                              ) : (
                                <span className="text-xs text-success font-medium">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${c.callsInPeriod > 0 ? "text-info-foreground" : "text-muted-foreground"}`}>{c.callsInPeriod}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {callMins > 0 ? `${callMins}m` : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex h-6 min-w-8 items-center justify-center rounded-full text-[10px] font-bold ${
                                callRate >= 80 ? "bg-success/10 text-success" : callRate >= 50 ? "bg-warning/10 text-warning-foreground" : "bg-destructive/10 text-destructive"
                              }`}>
                                {callRate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {c.overdueFollowups > 0 ? (
                                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold bg-warning/10 text-warning-foreground">
                                  {c.overdueFollowups}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {c.avgResponseHrs != null ? (
                                <span className={`font-medium ${c.avgResponseHrs <= 4 ? "text-success" : c.avgResponseHrs <= 12 ? "text-warning-foreground" : "text-destructive"}`}>
                                  {c.avgResponseHrs}h
                                </span>
                              ) : "—"}
                            </td>
                            {/* Dispositions */}
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.interested ? (
                                <span className="text-[10px] font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5">{c.dispositions.interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.not_interested ? (
                                <span className="text-[10px] font-bold text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">{c.dispositions.not_interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.not_answered ? (
                                <span className="text-[10px] font-bold text-warning-foreground bg-warning/10 rounded-full px-1.5 py-0.5">{c.dispositions.not_answered}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.call_back ? (
                                <span className="text-[10px] font-bold text-info-foreground bg-info/10 rounded-full px-1.5 py-0.5">{c.dispositions.call_back}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.busy ? (
                                <span className="text-[10px] font-bold text-warning-foreground bg-warning/10 rounded-full px-1.5 py-0.5">{c.dispositions.busy}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {otherDisp > 0 ? (
                                <span className="text-[10px] font-bold text-gray-700 bg-gray-100 rounded-full px-1.5 py-0.5">{otherDisp}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {c.notCalled > 0 ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] gap-1 border-destructive/20 text-destructive hover:bg-destructive/5"
                                  onClick={() => navigate(`/admissions?counsellor=${c.profileId}&not_called=true`)}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View {c.notCalled}
                                </Button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      {callingData.length > 1 && (
                        <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                          <td className="px-4 py-3 text-foreground text-xs uppercase">Total</td>
                          <td className="px-3 py-3 text-center text-xs">{callingData.reduce((s: number, c: any) => s + c.activeLeads, 0)}</td>
                          <td className="px-3 py-3 text-center">
                            <span className="text-xs font-bold text-destructive">{callingData.reduce((s: number, c: any) => s + c.notCalled, 0)}</span>
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-info-foreground">{callingData.reduce((s: number, c: any) => s + c.callsInPeriod, 0)}</td>
                          <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                            {Math.round(callingData.reduce((s: number, c: any) => s + c.callDuration, 0) / 60)}m
                          </td>
                          <td className="px-3 py-3 text-center">
                            {(() => {
                              const tActive = callingData.reduce((s: number, c: any) => s + c.activeLeads, 0);
                              const tNotCalled = callingData.reduce((s: number, c: any) => s + c.notCalled, 0);
                              const rate = tActive > 0 ? Math.round(((tActive - tNotCalled) / tActive) * 100) : 0;
                              return <span className="text-[10px] font-bold">{rate}%</span>;
                            })()}
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-warning-foreground">{callingData.reduce((s: number, c: any) => s + c.overdueFollowups, 0)}</td>
                          <td className="px-3 py-3 text-center text-xs text-muted-foreground">—</td>
                          <td className="px-2 py-3 text-center text-[10px] text-success">{callingData.reduce((s: number, c: any) => s + (c.dispositions.interested || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-destructive">{callingData.reduce((s: number, c: any) => s + (c.dispositions.not_interested || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-warning-foreground">{callingData.reduce((s: number, c: any) => s + (c.dispositions.not_answered || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-info-foreground">{callingData.reduce((s: number, c: any) => s + (c.dispositions.call_back || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-warning-foreground">{callingData.reduce((s: number, c: any) => s + (c.dispositions.busy || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-gray-700">
                            {callingData.reduce((s: number, c: any) => {
                              const other = Object.entries(c.dispositions)
                                .filter(([k]) => !["interested", "not_interested", "not_answered", "call_back", "busy"].includes(k))
                                .reduce((ss: number, [, v]) => ss + (v as number), 0);
                              return s + other;
                            }, 0) || "—"}
                          </td>
                          <td className="px-3 py-3"></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "assignments" ? (
        <LeadAssignmentHistory limit={200} />
      ) : tab === "funnel" ? (
        <FunnelTab
          rows={funnelRows}
          loading={funnelLoading}
          range={funnelRange}
          onRangeChange={(r) => { setFunnelRange(r); fetchFunnel(r); }}
        />
      ) : null}
    </div>
  );
};

// Stage ordering used to compute adjacent-stage conversion. Terminal forks
// (rejected / not_interested / dnc / deferred / ineligible) are intentionally
// excluded — they're outcomes, not progressions.
const FUNNEL_STAGES = [
  "new_lead",
  "ai_called",
  "counsellor_call",
  "application_in_progress",
  "visit_scheduled",
  "interview",
  "offer_sent",
  "token_paid",
  "pre_admitted",
  "admitted",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new_lead: "New Lead",
  ai_called: "AI Called",
  counsellor_call: "Counsellor Call",
  application_in_progress: "App In Progress",
  visit_scheduled: "Visit Scheduled",
  interview: "Interview",
  offer_sent: "Offer Sent",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
};

interface FunnelRow {
  counsellor_id: string;
  counsellor_name: string;
  stage: string;
  week_start: string;
  leads_reached: number;
}

const FunnelTab = ({
  rows,
  loading,
  range,
  onRangeChange,
}: {
  rows: FunnelRow[];
  loading: boolean;
  range: "7d" | "30d" | "all";
  onRangeChange: (r: "7d" | "30d" | "all") => void;
}) => {
  // Aggregate team-wide counts per stage across the date range.
  const teamTotals: Record<string, number> = {};
  for (const r of rows) {
    teamTotals[r.stage] = (teamTotals[r.stage] || 0) + r.leads_reached;
  }
  const teamMax = Math.max(1, ...FUNNEL_STAGES.map(s => teamTotals[s] || 0));

  // Aggregate per-counsellor counts across the date range.
  const perCounsellor = new Map<string, { name: string; counts: Record<string, number> }>();
  for (const r of rows) {
    const existing = perCounsellor.get(r.counsellor_id) || { name: r.counsellor_name, counts: {} };
    existing.counts[r.stage] = (existing.counts[r.stage] || 0) + r.leads_reached;
    perCounsellor.set(r.counsellor_id, existing);
  }
  const counsellors = Array.from(perCounsellor.entries()).sort(
    (a, b) => (b[1].counts["admitted"] || 0) - (a[1].counts["admitted"] || 0),
  );

  const conv = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-input bg-card p-0.5">
          {([
            { key: "7d", label: "Last 7 days" },
            { key: "30d", label: "Last 30 days" },
            { key: "all", label: "All time" },
          ] as const).map(p => (
            <button
              key={p.key}
              onClick={() => onRangeChange(p.key)}
              className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                range === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {loading && <ButtonOrb state="searching" />}
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-sm">Team funnel — where leads drop off</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Counts distinct leads pushed into each stage by any counsellor in the selected window.
            % below each bar is the conversion to the next stage — the smallest % is your biggest leak.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {FUNNEL_STAGES.map((stage, idx) => {
              const count = teamTotals[stage] || 0;
              const nextStage = FUNNEL_STAGES[idx + 1];
              const nextCount = nextStage ? teamTotals[nextStage] || 0 : null;
              const dropTo = nextStage ? conv(nextCount as number, count) : null;
              const width = (count / teamMax) * 100;
              const isLeak = dropTo !== null && dropTo < 30 && count > 0;
              return (
                <div key={stage}>
                  <div className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-xs text-muted-foreground">{STAGE_LABEL[stage]}</div>
                    <div className="flex-1 relative h-7 rounded-md bg-muted/40 overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 ${idx === FUNNEL_STAGES.length - 1 ? "bg-success/50/80" : "bg-primary/70"} transition-all`}
                        style={{ width: `${width}%` }}
                      />
                      <span className="relative z-10 flex items-center h-full px-2.5 text-xs font-semibold text-foreground">
                        {count}
                      </span>
                    </div>
                    {nextStage && (
                      <div className={`w-20 text-right text-xs tabular-nums ${isLeak ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                        {dropTo !== null ? `${dropTo}% →` : "—"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No stage transitions logged in this window. Stage changes are recorded as counsellors move leads forward.
            </p>
          )}
        </CardContent>
      </Card>

      {counsellors.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-sm">Per-counsellor — leads reached at each stage</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Rows ordered by admissions. Compare counts horizontally to see whose pipeline is healthy at the late stages even if their admissions count looks low.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground sticky left-0 bg-muted/40">Counsellor</th>
                    {FUNNEL_STAGES.map(s => (
                      <th key={s} className="px-2 py-2 text-center font-medium text-muted-foreground">{STAGE_LABEL[s]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {counsellors.map(([id, c]) => (
                    <tr key={id} className="border-t border-border/40">
                      <td className="px-3 py-2 text-foreground font-medium sticky left-0 bg-background">{c.name}</td>
                      {FUNNEL_STAGES.map(s => {
                        const n = c.counts[s] || 0;
                        return (
                          <td key={s} className={`px-2 py-2 text-center tabular-nums ${n === 0 ? "text-muted-foreground/40" : "text-foreground"}`}>
                            {n || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CounsellorDashboard;
