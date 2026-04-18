import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Phone, MessageSquare, CalendarCheck, MapPin, UserCheck,
  Trophy, AlertTriangle, Clock, TrendingUp, ChevronDown, ChevronUp,
  Users, PhoneOff, PhoneCall, BarChart3, ArrowUpDown, ArrowUp, ArrowDown,
  ExternalLink, CalendarDays,
} from "lucide-react";

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
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
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
};

const DISPOSITION_COLORS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-700",
  not_interested: "bg-red-100 text-red-700",
  ineligible: "bg-gray-100 text-gray-600",
  not_answered: "bg-amber-100 text-amber-700",
  call_back: "bg-blue-100 text-blue-700",
  wrong_number: "bg-pink-100 text-pink-700",
  do_not_contact: "bg-red-200 text-red-800",
  voicemail: "bg-purple-100 text-purple-700",
  busy: "bg-orange-100 text-orange-700",
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
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-emerald-600 uppercase">5-Star</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-blue-600 uppercase">4-Star</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-red-600 uppercase">Low (1-2)</th>
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
                        f.avg_rating >= 4 ? "text-emerald-600" : f.avg_rating >= 3 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {f.avg_rating}/5
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs">{f.total_responses}</td>
                  <td className="px-3 py-2.5 text-center">
                    {f.five_star > 0 ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-0.5">{f.five_star}</span>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {f.four_star > 0 ? (
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-100 rounded-full px-1.5 py-0.5">{f.four_star}</span>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {f.low_rating > 0 ? (
                      <span className="text-[10px] font-bold text-red-700 bg-red-100 rounded-full px-1.5 py-0.5">{f.low_rating}</span>
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
            <span className={`font-medium ${totalFollowed / totalVisited >= 0.8 ? "text-emerald-600" : "text-amber-600"}`}>
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
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-red-600 uppercase">Pending</th>
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
                    <td className="px-3 py-2.5 text-center text-xs text-emerald-600 font-medium">{c.followed_up_7d}</td>
                    <td className="px-3 py-2.5 text-center">
                      {Number(c.pending_total) > 0 ? (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                          {c.pending_total}
                        </span>
                      ) : (
                        <span className="text-xs text-green-600">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-bold ${rate >= 80 ? "text-emerald-600" : rate >= 50 ? "text-amber-600" : "text-red-600"}`}>
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
  const [tab, setTab] = useState<"leaderboard" | "overdue" | "tat-defaults" | "breakdown" | "activity" | "calling">("leaderboard");
  const [activityData, setActivityData] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [callingData, setCallingData] = useState<any[]>([]);
  const [callingLoading, setCallingLoading] = useState(false);
  const [callingDatePreset, setCallingDatePreset] = useState<DatePreset>("today");
  const [activityDatePreset, setActivityDatePreset] = useState<DatePreset>("today");
  const [tatDefaults, setTatDefaults] = useState<any[]>([]);
  const [teamDefaults, setTeamDefaults] = useState<any[]>([]);
  const [breakdownData, setBreakdownData] = useState<CounsellorBreakdown[]>([]);
  const [expandedCounsellor, setExpandedCounsellor] = useState<string | null>(null);

  // Sort state for breakdown table
  const [sortCol, setSortCol] = useState<BreakdownSortCol>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Date filter state
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  // Disposition drill-down
  const [dispLeads, setDispLeads] = useState<DispositionLead[]>([]);
  const [dispLoading, setDispLoading] = useState(false);
  const [activeDisp, setActiveDisp] = useState<{ counsellorId: string; disposition: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [statsRes, overdueRes, tatRes, teamRes] = await Promise.all([
        supabase.from("counsellor_performance_stats" as any).select("*"),
        supabase.from("overdue_followups" as any).select("*").limit(100),
        supabase.from("counsellor_tat_defaults" as any).select("*"),
        supabase.from("team_leader_defaults_summary" as any).select("*"),
      ]);
      if (statsRes.data) setStats(statsRes.data as any);
      if (overdueRes.data) setOverdue(overdueRes.data as any);
      if (tatRes.data) setTatDefaults(tatRes.data as any);
      if (teamRes.data) setTeamDefaults(teamRes.data as any);

      await fetchBreakdown("", "");
      setLoading(false);
    })();
  }, []);

  const fetchBreakdown = useCallback(async (from: string, to: string) => {
    setBreakdownLoading(true);

    const { data: roleData } = await supabase
      .from("user_roles" as any)
      .select("user_id, role")
      .in("role", ["counsellor", "admission_head"]);

    if (!roleData) { setBreakdownLoading(false); return; }

    const counsellorUserIds = (roleData as any[]).map((r: any) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, display_name")
      .in("user_id", counsellorUserIds);

    if (!profiles || profiles.length === 0) { setBreakdownLoading(false); return; }

    // Fetch leads with optional date filter on created_at
    let leadsQ = supabase
      .from("leads")
      .select("id, counsellor_id, stage, assigned_at, first_contact_at, created_at")
      .not("counsellor_id", "is", null);
    if (from) leadsQ = leadsQ.gte("created_at", `${from}T00:00:00`);
    if (to) leadsQ = leadsQ.lte("created_at", `${to}T23:59:59`);
    const { data: leads } = await leadsQ;

    // Fetch call logs with optional date filter
    let callQ = supabase
      .from("call_logs" as any)
      .select("id, lead_id, disposition, user_id, called_at")
      .order("called_at", { ascending: false });
    if (from) callQ = callQ.gte("called_at", `${from}T00:00:00`);
    if (to) callQ = callQ.lte("called_at", `${to}T23:59:59`);
    const { data: callLogs } = await callQ;

    // Fetch completed visits with optional date filter
    let visitsQ = supabase
      .from("campus_visits" as any)
      .select("id, lead_id, scheduled_by, status, visit_date")
      .eq("status", "completed");
    if (from) visitsQ = visitsQ.gte("visit_date", `${from}T00:00:00`);
    if (to) visitsQ = visitsQ.lte("visit_date", `${to}T23:59:59`);
    const { data: completedVisits } = await visitsQ;

    const calledLeadIds = new Set<string>();
    if (callLogs) {
      for (const cl of callLogs as any[]) calledLeadIds.add(cl.lead_id);
    }

    const breakdownMap = new Map<string, CounsellorBreakdown>();
    for (const p of profiles as any[]) {
      breakdownMap.set(p.id, {
        counsellor_id: p.id,
        counsellor_name: p.display_name || "Unknown",
        user_id: p.user_id,
        total: 0, new_lead: 0, called: 0, not_called: 0,
        application_in_progress: 0, visit_scheduled: 0, admitted: 0,
        rejected: 0, other_stages: 0, dispositions: {},
        avg_response_hrs: null, call_rate: 0, conversion_rate: 0, visits_completed: 0,
      });
    }

    const responseTimes = new Map<string, number[]>();
    if (leads) {
      for (const l of leads as any[]) {
        const bd = breakdownMap.get(l.counsellor_id);
        if (!bd) continue;
        bd.total++;
        if (l.stage === "new_lead") bd.new_lead++;
        else if (["application_in_progress", "application_fee_paid", "application_submitted"].includes(l.stage)) bd.application_in_progress++;
        else if (l.stage === "visit_scheduled") bd.visit_scheduled++;
        else if (l.stage === "admitted") bd.admitted++;
        else if (["rejected", "not_interested"].includes(l.stage)) bd.rejected++;
        else bd.other_stages++;
        if (calledLeadIds.has(l.id)) bd.called++;
        else bd.not_called++;
        if (l.assigned_at && l.first_contact_at) {
          const hrs = (new Date(l.first_contact_at).getTime() - new Date(l.assigned_at).getTime()) / (1000 * 60 * 60);
          if (hrs >= 0 && hrs < 720) {
            if (!responseTimes.has(l.counsellor_id)) responseTimes.set(l.counsellor_id, []);
            responseTimes.get(l.counsellor_id)!.push(hrs);
          }
        }
      }
    }

    const userIdToProfileId = new Map((profiles as any[]).map((p: any) => [p.user_id, p.id]));
    if (callLogs) {
      for (const cl of callLogs as any[]) {
        if (!cl.disposition) continue;
        const profileId = userIdToProfileId.get(cl.user_id);
        if (!profileId) continue;
        const bd = breakdownMap.get(profileId);
        if (!bd) continue;
        bd.dispositions[cl.disposition] = (bd.dispositions[cl.disposition] || 0) + 1;
      }
    }

    if (completedVisits) {
      for (const v of completedVisits as any[]) {
        const bd = breakdownMap.get(v.scheduled_by);
        if (bd) bd.visits_completed++;
      }
    }

    for (const [cid, bd] of breakdownMap) {
      bd.call_rate = bd.total > 0 ? Math.round((bd.called / bd.total) * 100) : 0;
      bd.conversion_rate = bd.total > 0 ? Math.round((bd.admitted / bd.total) * 100) : 0;
      const times = responseTimes.get(cid);
      if (times && times.length > 0) {
        bd.avg_response_hrs = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
      }
    }

    setBreakdownData(Array.from(breakdownMap.values()).filter(b => b.total > 0));
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

    // Get counsellor profiles
    const { data: roleData } = await supabase
      .from("user_roles" as any).select("user_id, role").in("role", ["counsellor", "admission_head"]);
    const counsellorUserIds = (roleData || []).map((r: any) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles").select("id, user_id, display_name").in("user_id", counsellorUserIds);

    if (!profiles?.length) { setCallingLoading(false); return; }

    const profileIdToUserId = new Map((profiles as any[]).map(p => [p.id, p.user_id]));
    const userIdToProfileId = new Map((profiles as any[]).map(p => [p.user_id, p.id]));

    // Active leads per counsellor (not in terminal stages)
    const { data: activeLeads } = await supabase
      .from("leads")
      .select("id, counsellor_id, stage, first_contact_at, assigned_at, created_at")
      .not("counsellor_id", "is", null)
      .not("stage", "in", "(admitted,rejected,not_interested)");

    // Call logs in date range
    let callQ = supabase
      .from("call_logs" as any)
      .select("id, lead_id, disposition, duration_seconds, user_id, called_at")
      .order("called_at", { ascending: false });
    if (from) callQ = callQ.gte("called_at", `${from}T00:00:00`);
    if (to) callQ = callQ.lte("called_at", `${to}T23:59:59`);
    const { data: callLogs } = await callQ;

    // ALL call logs (to determine never-called leads)
    const { data: allCallLogs } = await supabase
      .from("call_logs" as any)
      .select("lead_id")
      .limit(5000);

    // Overdue followups per counsellor
    const { data: overdueData } = await supabase
      .from("overdue_followups" as any)
      .select("id, counsellor_id");

    // Build set of ever-called lead IDs
    const everCalledLeadIds = new Set<string>();
    for (const cl of (allCallLogs || []) as any[]) everCalledLeadIds.add(cl.lead_id);

    // Build per-counsellor aggregation
    const agg = new Map<string, {
      name: string; profileId: string; userId: string;
      activeLeads: number; notCalled: number; callsInPeriod: number;
      callDuration: number; overdueFollowups: number;
      avgResponseHrs: number | null;
      dispositions: Record<string, number>;
    }>();

    for (const p of profiles as any[]) {
      agg.set(p.id, {
        name: p.display_name || "Unknown",
        profileId: p.id,
        userId: p.user_id,
        activeLeads: 0, notCalled: 0, callsInPeriod: 0,
        callDuration: 0, overdueFollowups: 0,
        avgResponseHrs: null,
        dispositions: {},
      });
    }

    // Count active leads and not-called
    const responseTimes: Record<string, number[]> = {};
    for (const l of (activeLeads || []) as any[]) {
      const entry = agg.get(l.counsellor_id);
      if (!entry) continue;
      entry.activeLeads++;
      if (!everCalledLeadIds.has(l.id)) entry.notCalled++;
      if (l.assigned_at && l.first_contact_at) {
        const hrs = (new Date(l.first_contact_at).getTime() - new Date(l.assigned_at).getTime()) / 3600000;
        if (hrs >= 0 && hrs < 720) {
          if (!responseTimes[l.counsellor_id]) responseTimes[l.counsellor_id] = [];
          responseTimes[l.counsellor_id].push(hrs);
        }
      }
    }

    // Count calls in period and dispositions
    for (const cl of (callLogs || []) as any[]) {
      const profileId = userIdToProfileId.get(cl.user_id);
      if (!profileId) continue;
      const entry = agg.get(profileId);
      if (!entry) continue;
      entry.callsInPeriod++;
      entry.callDuration += cl.duration_seconds || 0;
      if (cl.disposition) {
        entry.dispositions[cl.disposition] = (entry.dispositions[cl.disposition] || 0) + 1;
      }
    }

    // Count overdue followups
    for (const o of (overdueData || []) as any[]) {
      const entry = agg.get(o.counsellor_id);
      if (entry) entry.overdueFollowups++;
    }

    // Compute avg response time
    for (const [pid, entry] of agg) {
      const times = responseTimes[pid];
      if (times?.length) {
        entry.avgResponseHrs = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
      }
    }

    setCallingData(
      Array.from(agg.values())
        .filter(a => a.activeLeads > 0)
        .sort((a, b) => b.notCalled - a.notCalled) // worst performers first
    );
    setCallingLoading(false);
  }, []);

  // Auto-fetch activity when tab switches to it
  useEffect(() => {
    if (tab === "activity" && activityData.length === 0 && !activityLoading) {
      fetchActivity(activityDatePreset);
    }
    if (tab === "calling" && callingData.length === 0 && !callingLoading) {
      fetchCalling(callingDatePreset);
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("counsellor_leaderboard" as any)
        .select("*");
      if (data) setLeaderboard(data);
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
          score,
          weekly_score: lb.weekly_score || 0,
          monthly_score: lb.monthly_score || 0,
          total_score: lb.total_score || 0,
          daily_score: lb.daily_score || 0,
          positive_actions: lb.positive_actions || 0,
          negative_actions: lb.negative_actions || 0,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [stats, leaderboard, leaderboardPeriod]);

  const breakdownTotals = useMemo(() => breakdownData.reduce((acc, b) => ({
    total: acc.total + b.total,
    new_lead: acc.new_lead + b.new_lead,
    called: acc.called + b.called,
    not_called: acc.not_called + b.not_called,
    admitted: acc.admitted + b.admitted,
  }), { total: 0, new_lead: 0, called: 0, not_called: 0, admitted: 0 }), [breakdownData]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const summaryCards = [
    { label: "Total Calls", value: totals.calls, icon: Phone, color: "bg-blue-100 dark:bg-blue-900/30", iconColor: "text-blue-600" },
    { label: "WhatsApps Sent", value: totals.whatsapps, icon: MessageSquare, color: "bg-green-100 dark:bg-green-900/30", iconColor: "text-green-600" },
    { label: "Follow-ups Done", value: totals.followups, icon: CalendarCheck, color: "bg-orange-100 dark:bg-orange-900/30", iconColor: "text-orange-600" },
    { label: "Visits Scheduled", value: totals.visits, icon: MapPin, color: "bg-purple-100 dark:bg-purple-900/30", iconColor: "text-purple-600" },
    { label: "Conversions", value: totals.conversions, icon: UserCheck, color: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-600" },
    { label: "Overdue Follow-ups", value: totals.overdue, icon: AlertTriangle, color: totals.overdue > 0 ? "bg-red-100 dark:bg-red-900/30" : "bg-muted", iconColor: totals.overdue > 0 ? "text-red-600" : "text-muted-foreground" },
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.color} mb-2`}>
                <card.icon className={`h-4 w-4 ${card.iconColor}`} />
              </div>
              <p className="text-2xl font-bold text-foreground">{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{card.label}</p>
            </CardContent>
          </Card>
        ))}
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
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === "overdue" ? "bg-white/20 text-primary-foreground" : "bg-red-500 text-white"}`}>
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
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === "tat-defaults" ? "bg-white/20 text-primary-foreground" : "bg-red-500 text-white"}`}>
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
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversions</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-orange-600 uppercase tracking-wide" title="New leads not contacted within SLA">New Due</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-amber-600 uppercase tracking-wide" title="Overdue follow-ups">F/U Due</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-blue-600 uppercase tracking-wide" title="Application stage check-ins overdue">Check-ins</th>
                    <th className="px-4 py-3 text-center text-[10px] font-semibold text-red-600 uppercase tracking-wide" title="Total TAT defaults">Defaults</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold text-emerald-600 uppercase">+</th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold text-red-600 uppercase">-</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((s, i) => {
                    const tat = tatDefaults.find((d: any) => d.profile_id === s.counsellor_id);
                    return (
                    <tr key={s.counsellor_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-center">
                        {i === 0 ? <Trophy className="h-4 w-4 text-amber-500 mx-auto" /> :
                         i === 1 ? <Trophy className="h-4 w-4 text-gray-400 mx-auto" /> :
                         i === 2 ? <Trophy className="h-4 w-4 text-amber-700 mx-auto" /> :
                         <span className="text-muted-foreground text-xs">{i + 1}</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {s.counsellor_name || "Unknown"}
                        {s.daily_score > 0 && (
                          <span className="ml-1.5 text-[10px] font-bold text-emerald-600">+{s.daily_score} today</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{s.leads_assigned}</td>
                      <td className="px-4 py-3 text-center font-medium text-foreground">{s.total_calls}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-primary">{s.conversions}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.new_leads_overdue > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">{tat.new_leads_overdue}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.overdue_followups > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">{tat.overdue_followups}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.app_checkins_overdue > 0 ? (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">{tat.app_checkins_overdue}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tat && tat.total_defaults > 0 ? (
                          <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold ${tat.total_defaults > 5 ? "bg-red-500 text-white" : "bg-red-100 text-red-700"}`}>{tat.total_defaults}</span>
                        ) : <span className="text-[10px] text-muted-foreground">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-[10px] font-bold text-emerald-600">{s.positive_actions}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[10px] font-bold ${s.negative_actions > 0 ? "text-red-600" : "text-muted-foreground"}`}>{s.negative_actions}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`border-0 text-xs font-bold ${
                          s.score > 0 ? "bg-primary/10 text-primary" : s.score < 0 ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                        }`}>{s.score}</Badge>
                      </td>
                    </tr>
                    );
                  })}
                  {ranked.length === 0 && (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-muted-foreground">No counsellor data available</td></tr>
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

            {breakdownLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Breakdown summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Total Assigned", value: breakdownTotals.total, icon: Users, color: "bg-blue-100 dark:bg-blue-900/30", iconColor: "text-blue-600" },
              { label: "New / Untouched", value: breakdownTotals.new_lead, icon: Clock, color: "bg-amber-100 dark:bg-amber-900/30", iconColor: "text-amber-600" },
              { label: "Called", value: breakdownTotals.called, icon: PhoneCall, color: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-600" },
              { label: "Not Called", value: breakdownTotals.not_called, icon: PhoneOff, color: breakdownTotals.not_called > 0 ? "bg-red-100 dark:bg-red-900/30" : "bg-muted", iconColor: breakdownTotals.not_called > 0 ? "text-red-600" : "text-muted-foreground" },
              { label: "Admitted", value: breakdownTotals.admitted, icon: UserCheck, color: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-600" },
            ].map((c) => (
              <Card key={c.label} className="border-border/60 shadow-none">
                <CardContent className="p-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.color} mb-1.5`}>
                    <c.icon className={`h-3.5 w-3.5 ${c.iconColor}`} />
                  </div>
                  <p className="text-xl font-bold text-foreground">{c.value}</p>
                  <p className="text-[10px] text-muted-foreground">{c.label}</p>
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
                            <td className="px-3 py-3 font-medium text-foreground">{b.counsellor_name}</td>
                            <td className="px-3 py-3 text-center font-bold text-foreground">{b.total}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-semibold ${b.new_lead > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{b.new_lead}</span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className="text-xs font-semibold text-emerald-600">{b.called}</span>
                            </td>
                            <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                              {b.not_called > 0 ? (
                                <button
                                  onClick={() => navigate(`/admissions?counsellor=${b.counsellor_id}&not_called=true`)}
                                  className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 border-0 text-[10px] font-bold px-2.5 py-0.5 hover:bg-red-200 transition-colors cursor-pointer"
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
                              <span className={`text-xs font-bold ${b.call_rate >= 80 ? "text-emerald-600" : b.call_rate >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                {b.call_rate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${b.conversion_rate >= 10 ? "text-emerald-600" : b.conversion_rate >= 5 ? "text-amber-600" : "text-muted-foreground"}`}>
                                {b.conversion_rate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {b.avg_response_hrs !== null ? (
                                <span className={`text-xs font-medium ${b.avg_response_hrs <= 2 ? "text-emerald-600" : b.avg_response_hrs <= 6 ? "text-amber-600" : "text-red-600"}`}>
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
                                        interested: "bg-emerald-500", not_interested: "bg-red-400",
                                        ineligible: "bg-gray-400", not_answered: "bg-amber-400",
                                        call_back: "bg-blue-400", wrong_number: "bg-pink-400",
                                        do_not_contact: "bg-red-600", voicemail: "bg-purple-400",
                                        busy: "bg-orange-400",
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
                                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            {overdue.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CalendarCheck className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground">No overdue follow-ups</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scheduled</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overdue</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((f) => (
                    <tr
                      key={f.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/admissions/${f.lead_id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{f.lead_name}</div>
                        <div className="text-xs text-muted-foreground">{f.lead_phone}</div>
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
                          f.days_overdue > 5 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : f.days_overdue > 2 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
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
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.new_leads_overdue > 0 ? "bg-red-100 text-red-700" : "text-muted-foreground"}`}>
                          {d.new_leads_overdue}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.overdue_followups > 0 ? "bg-amber-100 text-amber-700" : "text-muted-foreground"}`}>
                          {d.overdue_followups}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${d.app_checkins_overdue > 0 ? "bg-orange-100 text-orange-700" : "text-muted-foreground"}`}>
                          {d.app_checkins_overdue}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${
                          d.total_defaults > 5 ? "bg-red-500 text-white" : d.total_defaults > 0 ? "bg-red-100 text-red-700" : "text-muted-foreground"
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
            {activityLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                        <th className="px-3 py-3 text-center text-xs font-semibold text-red-600 uppercase">Not Called</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Time</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">WhatsApp</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Notes</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Stage Changes</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">AI Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Total Actions</th>
                        {/* Disposition columns */}
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-emerald-600 uppercase">Interested</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-red-600 uppercase">Not Int.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-amber-600 uppercase">No Ans.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-blue-600 uppercase">Call Back</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-orange-600 uppercase">Busy</th>
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
                                  className="inline-flex items-center gap-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 hover:bg-red-200 transition-colors"
                                >
                                  {a.notCalled}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${a.calls > 0 ? "text-blue-600" : "text-muted-foreground"}`}>{a.calls}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {callMins > 0 ? `${callMins}m` : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${a.whatsapps > 0 ? "text-green-600" : "text-muted-foreground"}`}>{a.whatsapps}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{a.notes || "—"}</td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">{a.stageChanges || "—"}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs ${a.aiCalls > 0 ? "font-bold text-purple-600" : "text-muted-foreground"}`}>{a.aiCalls || "—"}</span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${
                                totalActions > 20 ? "bg-emerald-100 text-emerald-700" : totalActions > 5 ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"
                              }`}>
                                {totalActions}
                              </span>
                            </td>
                            {/* Dispositions */}
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.interested ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-0.5">{a.dispositions.interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.not_interested ? (
                                <span className="text-[10px] font-bold text-red-700 bg-red-100 rounded-full px-1.5 py-0.5">{a.dispositions.not_interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.not_answered ? (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">{a.dispositions.not_answered}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.call_back ? (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-100 rounded-full px-1.5 py-0.5">{a.dispositions.call_back}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {a.dispositions.busy ? (
                                <span className="text-[10px] font-bold text-orange-700 bg-orange-100 rounded-full px-1.5 py-0.5">{a.dispositions.busy}</span>
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
            {callingLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
                        <PhoneOff className="h-3 w-3" /> {totalNotCalled} Not Called
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                      <PhoneCall className="h-3 w-3" /> {totalCalls} Calls
                    </span>
                    {totalOverdue > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
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
                        <th className="px-3 py-3 text-center text-xs font-semibold text-red-600 uppercase">Not Called</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Calls</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Time</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Call Rate</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-amber-600 uppercase">Overdue F/U</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Avg Response</th>
                        {/* Disposition columns */}
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-emerald-600 uppercase">Interested</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-red-600 uppercase">Not Int.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-amber-600 uppercase">No Ans.</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-blue-600 uppercase">Call Back</th>
                        <th className="px-2 py-3 text-center text-[9px] font-semibold text-orange-600 uppercase">Busy</th>
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
                                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                  {c.notCalled}
                                </span>
                              ) : (
                                <span className="text-xs text-green-600 font-medium">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs font-bold ${c.callsInPeriod > 0 ? "text-blue-600" : "text-muted-foreground"}`}>{c.callsInPeriod}</span>
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {callMins > 0 ? `${callMins}m` : "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex h-6 min-w-8 items-center justify-center rounded-full text-[10px] font-bold ${
                                callRate >= 80 ? "bg-emerald-100 text-emerald-700" : callRate >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                              }`}>
                                {callRate}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              {c.overdueFollowups > 0 ? (
                                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                                  {c.overdueFollowups}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center text-xs text-muted-foreground">
                              {c.avgResponseHrs != null ? (
                                <span className={`font-medium ${c.avgResponseHrs <= 4 ? "text-emerald-600" : c.avgResponseHrs <= 12 ? "text-amber-600" : "text-red-600"}`}>
                                  {c.avgResponseHrs}h
                                </span>
                              ) : "—"}
                            </td>
                            {/* Dispositions */}
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.interested ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-0.5">{c.dispositions.interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.not_interested ? (
                                <span className="text-[10px] font-bold text-red-700 bg-red-100 rounded-full px-1.5 py-0.5">{c.dispositions.not_interested}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.not_answered ? (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">{c.dispositions.not_answered}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.call_back ? (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-100 rounded-full px-1.5 py-0.5">{c.dispositions.call_back}</span>
                              ) : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-3 text-center">
                              {c.dispositions.busy ? (
                                <span className="text-[10px] font-bold text-orange-700 bg-orange-100 rounded-full px-1.5 py-0.5">{c.dispositions.busy}</span>
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
                                  className="h-7 text-[10px] gap-1 border-red-200 text-red-700 hover:bg-red-50"
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
                            <span className="text-xs font-bold text-red-700">{callingData.reduce((s: number, c: any) => s + c.notCalled, 0)}</span>
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-blue-600">{callingData.reduce((s: number, c: any) => s + c.callsInPeriod, 0)}</td>
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
                          <td className="px-3 py-3 text-center text-xs text-amber-700">{callingData.reduce((s: number, c: any) => s + c.overdueFollowups, 0)}</td>
                          <td className="px-3 py-3 text-center text-xs text-muted-foreground">—</td>
                          <td className="px-2 py-3 text-center text-[10px] text-emerald-700">{callingData.reduce((s: number, c: any) => s + (c.dispositions.interested || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-red-700">{callingData.reduce((s: number, c: any) => s + (c.dispositions.not_interested || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-amber-700">{callingData.reduce((s: number, c: any) => s + (c.dispositions.not_answered || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-blue-700">{callingData.reduce((s: number, c: any) => s + (c.dispositions.call_back || 0), 0) || "—"}</td>
                          <td className="px-2 py-3 text-center text-[10px] text-orange-700">{callingData.reduce((s: number, c: any) => s + (c.dispositions.busy || 0), 0) || "—"}</td>
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
      ) : null}
    </div>
  );
};

export default CounsellorDashboard;
