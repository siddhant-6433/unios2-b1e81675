import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import {
  Users, IndianRupee, GraduationCap,
  ClipboardCheck, BookOpen, CalendarDays, Bell,
  ArrowUpRight, ChevronRight, Loader2, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from "recharts";
import { JdCategoryMappingPanel } from "@/components/admissions/JdCategoryMappingPanel";
import { PendingApprovalsPanel } from "@/components/dashboard/PendingApprovalsPanel";
import { ConsultantVoiceMessagesPanel } from "@/components/dashboard/ConsultantVoiceMessagesPanel";

// ── Helpers ────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress", application_submitted: "App Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
};

const funnelColors = [
  "bg-primary", "bg-chart-2", "bg-chart-3",
  "bg-primary/85", "bg-primary/70",
  "bg-chart-2/80", "bg-chart-3/80",
  "bg-chart-5", "bg-chart-5/80",
  "bg-chart-4", "bg-chart-4/80",
];

const stageBadgeClass: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  ai_called: "bg-pastel-purple text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
};

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f97316"];

function fmtAmt(val: number): string {
  if (val >= 1_00_00_000) return `${(val / 1_00_00_000).toFixed(2)} Cr`;
  if (val >= 1_00_000)    return `${(val / 1_00_000).toFixed(2)} L`;
  if (val >= 1_000)       return `${(val / 1_000).toFixed(1)} K`;
  return `₹${val}`;
}

function fmtSrc(src: string): string {
  return src.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Reusable chart tooltips ─────────────────────────────────────────────────

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function FeeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{fmtAmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── SuperAdminDashboard ─────────────────────────────────────────────────────

const SuperAdminDashboard = ({ isSuperAdmin }: { isSuperAdmin: boolean }) => {
  const { selectedCampusId } = useCampus();
  const [loading, setLoading] = useState(true);

  // CRM stats
  const [leadCount,    setLeadCount]    = useState(0);
  const [todayLeads,   setTodayLeads]   = useState(0);
  const [admittedCount,setAdmittedCount]= useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [funnel,       setFunnel]       = useState<{ stage: string; count: number }[]>([]);
  const [recentLeads,  setRecentLeads]  = useState<any[]>([]);
  const [appInProgress,setAppInProgress]= useState(0);
  const [appSubmitted, setAppSubmitted] = useState(0);

  // Chart data
  const [campusStudents, setCampusStudents] = useState<{ name: string; total: number; active: number }[]>([]);
  const [feeByCampus,    setFeeByCampus]    = useState<{ name: string; assigned: number; paid: number; due: number }[]>([]);
  const [leadBySrc,      setLeadBySrc]      = useState<{ name: string; count: number }[]>([]);
  const [weeklyLeads,    setWeeklyLeads]    = useState<{ day: string; leads: number }[]>([]);
  const [feeTotal,       setFeeTotal]       = useState({ assigned: 0, paid: 0, due: 0 });

  const fetchDashboard = async () => {
    setLoading(true);
    const today    = new Date().toISOString().slice(0, 10);
    const byCampus = selectedCampusId !== "all";

    const baseLeads = () => {
      let q = supabase.from("leads").select("id", { count: "exact", head: true });
      if (byCampus) q = q.eq("campus_id", selectedCampusId);
      return q;
    };
    const baseStudents = () => {
      let q = supabase.from("students").select("id", { count: "exact", head: true });
      if (byCampus) q = q.eq("campus_id", selectedCampusId);
      return q;
    };

    // ── Core counts ──
    const [leadsRes, todayRes, admittedRes, studentsRes, recentRes, appInProgRes, appSubmRes] = await Promise.all([
      baseLeads(),
      baseLeads().gte("created_at", today),
      baseLeads().eq("stage", "admitted"),
      baseStudents(),
      (() => {
        let q = supabase.from("leads")
          .select("id, name, phone, stage, source, created_at, courses:course_id(name), campuses:campus_id(name)")
          .order("created_at", { ascending: false }).limit(5);
        if (byCampus) q = q.eq("campus_id", selectedCampusId);
        return q;
      })(),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "draft"),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    ]);

    setLeadCount(leadsRes.count || 0);
    setTodayLeads(todayRes.count || 0);
    setAdmittedCount(admittedRes.count || 0);
    setStudentCount(studentsRes.count || 0);
    setAppInProgress(appInProgRes.count || 0);
    setAppSubmitted(appSubmRes.count || 0);

    if (recentRes.data) {
      setRecentLeads(recentRes.data.map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        initials: (l.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
      })));
    }

    // ── Funnel ──
    const stages = Object.keys(STAGE_LABELS);
    const funnelCounts = await Promise.all(
      stages.map(async (stage) => {
        let q = supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", stage as any);
        if (byCampus) q = q.eq("campus_id", selectedCampusId);
        const { count } = await q;
        return { stage: STAGE_LABELS[stage], count: count || 0 };
      })
    );
    setFunnel(funnelCounts);

    // ── Chart data (parallel) ──
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let campusStuQ = supabase.from("students").select("status, campuses:campus_id(name)").limit(5000);
    if (byCampus) campusStuQ = campusStuQ.eq("campus_id", selectedCampusId);

    let feeQ = supabase.from("fee_ledger")
      .select("total_amount, paid_amount, balance, students:student_id(campus_id, campuses:campus_id(name))")
      .limit(5000);

    let srcQ = supabase.from("leads").select("source").limit(5000);
    if (byCampus) srcQ = srcQ.eq("campus_id", selectedCampusId);

    let weekQ = supabase.from("leads").select("created_at").gte("created_at", sevenDaysAgo);
    if (byCampus) weekQ = weekQ.eq("campus_id", selectedCampusId);

    const [campStuRes, feeRes, srcRes, weekRes] = await Promise.all([campusStuQ, feeQ, srcQ, weekQ]);

    // Aggregate: students by campus
    if (campStuRes.data) {
      const map: Record<string, { name: string; total: number; active: number }> = {};
      (campStuRes.data as any[]).forEach(s => {
        const name = (s.campuses as any)?.name || "Unknown";
        if (!map[name]) map[name] = { name, total: 0, active: 0 };
        map[name].total++;
        if (s.status === "active") map[name].active++;
      });
      setCampusStudents(Object.values(map).sort((a, b) => b.total - a.total));
    }

    // Aggregate: fee by campus
    if (feeRes.data) {
      const map: Record<string, { name: string; assigned: number; paid: number; due: number }> = {};
      let totAssigned = 0, totPaid = 0, totDue = 0;
      (feeRes.data as any[]).forEach((f: any) => {
        const name = (f.students as any)?.campuses?.name || "Unknown";
        if (!map[name]) map[name] = { name, assigned: 0, paid: 0, due: 0 };
        map[name].assigned += f.total_amount || 0;
        map[name].paid     += f.paid_amount  || 0;
        map[name].due      += f.balance      || 0;
        totAssigned += f.total_amount || 0;
        totPaid     += f.paid_amount  || 0;
        totDue      += f.balance      || 0;
      });
      setFeeByCampus(Object.values(map).filter(c => c.assigned > 0).sort((a, b) => b.assigned - a.assigned));
      setFeeTotal({ assigned: totAssigned, paid: totPaid, due: totDue });
    }

    // Aggregate: lead sources
    if (srcRes.data) {
      const map: Record<string, number> = {};
      (srcRes.data as any[]).forEach(l => {
        const s = l.source || "unknown";
        map[s] = (map[s] || 0) + 1;
      });
      setLeadBySrc(
        Object.entries(map)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
      );
    }

    // Aggregate: weekly leads
    if (weekRes.data) {
      const days: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days[d.toISOString().slice(0, 10)] = 0;
      }
      (weekRes.data as any[]).forEach(l => {
        const day = l.created_at.slice(0, 10);
        if (day in days) days[day]++;
      });
      setWeeklyLeads(
        Object.entries(days).map(([date, leads]) => ({
          day: new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
          leads,
        }))
      );
    }

    setLoading(false);
  };

  useEffect(() => { fetchDashboard(); }, [selectedCampusId]);

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  const funnelMax       = Math.max(...funnel.map(s => s.count), 1);
  const conversionRate  = leadCount > 0 ? Math.round((admittedCount / leadCount) * 100) : 0;

  const statCards = [
    { label: "Total Leads",            value: String(leadCount),    sub: `+${todayLeads} today`,      subColor: "text-primary",   icon: Users,         iconBg: "bg-pastel-blue" },
    { label: "Applications In Progress",value: String(appInProgress),sub: "Filling application",      subColor: "text-chart-2",   icon: FileText,      iconBg: "bg-pastel-orange" },
    { label: "Applications Submitted",  value: String(appSubmitted), sub: "Ready for review",          subColor: "text-chart-3",   icon: ClipboardCheck,iconBg: "bg-pastel-green" },
    { label: "Admitted",               value: String(admittedCount),sub: `${conversionRate}% conversion`,subColor: "text-primary",icon: GraduationCap, iconBg: "bg-pastel-purple" },
  ];

  const AXIS_STYLE = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

  return (
    <>
      {/* ── JD Category Mapping Alert (super admin only) ── */}
      {isSuperAdmin && <JdCategoryMappingPanel />}

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className={`text-xs font-medium mt-1 ${stat.subColor}`}>{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Funnel + Recent Leads ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border/60 shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Admission Funnel</CardTitle>
              <Button variant="link" size="sm" className="text-primary gap-1 px-0" asChild>
                <Link to="/admissions">View all <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {funnel.map((item, i) => (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground w-28 shrink-0">{item.stage}</span>
                <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${funnelColors[i] || "bg-primary"} rounded-lg flex items-center justify-end pr-3 transition-all duration-500`}
                    style={{ width: `${Math.max((item.count / funnelMax) * 100, 5)}%` }}>
                    <span className="text-xs font-semibold text-primary-foreground">{item.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Recent Leads</CardTitle>
              <Button variant="link" size="sm" className="text-primary gap-1 px-0" asChild>
                <Link to="/admissions">View all <ChevronRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            {recentLeads.map((lead: any) => (
              <Link to={`/admissions/${lead.id}`} key={lead.id}
                className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pastel-purple text-xs font-bold text-foreground/70">
                  {lead.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{lead.name}</p>
                  <p className="text-xs text-muted-foreground">{lead.course_name} · {lead.campus_name}</p>
                </div>
                <Badge className={`text-[11px] font-medium border-0 ${stageBadgeClass[lead.stage] || "bg-muted text-foreground/70"}`}>
                  {STAGE_LABELS[lead.stage] || lead.stage}
                </Badge>
              </Link>
            ))}
            {recentLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No leads yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ── Analytics Section ── */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Analytics</p>
          <div className="flex-1 border-t border-border/50" />
        </div>

        {/* Row 1: Student Count + Lead Sources */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Students by Campus */}
          <Card className="lg:col-span-3 border-border/60 shadow-none">
            <CardHeader className="pb-1 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Student Count</CardTitle>
                <span className="text-xs text-muted-foreground font-mono">{studentCount} total</span>
              </div>
            </CardHeader>
            <CardContent className="px-2 pb-4 pt-1">
              {campusStudents.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No student data</div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={campusStudents} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} axisLine={false}
                      tickFormatter={v => v.length > 13 ? v.slice(0, 13) + "…" : v} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<CountTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="total"  name="Total"  fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="active" name="Active" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Lead Sources */}
          <Card className="lg:col-span-2 border-border/60 shadow-none">
            <CardHeader className="pb-1 pt-4 px-5">
              <CardTitle className="text-sm font-semibold">Lead Sources</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4 pt-1">
              {leadBySrc.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No lead data</div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={leadBySrc.map(d => ({ name: fmtSrc(d.name), value: d.count }))}
                      cx="50%" cy="45%"
                      innerRadius={52} outerRadius={78}
                      paddingAngle={2} dataKey="value">
                      {leadBySrc.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v, n]} />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Fee Summary */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-1 pt-4 px-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <CardTitle className="text-sm font-semibold">Fee Summary</CardTitle>
              {feeTotal.assigned > 0 && (
                <div className="flex gap-5 text-xs">
                  <span>
                    <span className="text-muted-foreground">Net Assigned: </span>
                    <span className="font-semibold text-foreground">{fmtAmt(feeTotal.assigned)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Paid: </span>
                    <span className="font-semibold text-green-600">{fmtAmt(feeTotal.paid)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Due: </span>
                    <span className="font-semibold text-amber-600">{fmtAmt(feeTotal.due)}</span>
                  </span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-4 pt-1">
            {feeByCampus.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No fee data</div>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={feeByCampus} margin={{ top: 8, right: 12, left: 8, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} axisLine={false}
                    tickFormatter={v => v.length > 14 ? v.slice(0, 14) + "…" : v} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false}
                    tickFormatter={fmtAmt} width={58} />
                  <Tooltip content={<FeeTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="assigned" name="Net Assigned" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="paid"     name="Paid"         fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="due"      name="Due"          fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Row 3: Weekly Lead Trend */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-sm font-semibold">Lead Trend — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4 pt-1">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weeklyLeads} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<CountTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="leads" name="Leads" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

// ── Placeholder role dashboards ─────────────────────────────────────────────

const FacultyDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Today's Classes",     value: "—", icon: CalendarDays,  iconBg: "bg-pastel-blue" },
        { label: "Attendance %",         value: "—", icon: ClipboardCheck,iconBg: "bg-pastel-green" },
        { label: "Assignments Pending",  value: "—", icon: BookOpen,      iconBg: "bg-pastel-orange" },
        { label: "Announcements",        value: "—", icon: Bell,          iconBg: "bg-pastel-purple" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-8 text-center">
        <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your class schedule and assignments will appear here.</p>
      </CardContent>
    </Card>
  </>
);

const StudentDashboard = () => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Attendance %",   value: "—", icon: ClipboardCheck, iconBg: "bg-pastel-green" },
        { label: "Upcoming Exams", value: "—", icon: BookOpen,       iconBg: "bg-pastel-orange" },
        { label: "Fee Due",        value: "—", icon: IndianRupee,    iconBg: "bg-pastel-red" },
        { label: "Announcements",  value: "—", icon: Bell,           iconBg: "bg-pastel-blue" },
      ].map((stat) => (
        <Card key={stat.label} className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{stat.value}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-8 text-center">
        <GraduationCap className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Your academic overview, schedule, and results will appear here.</p>
      </CardContent>
    </Card>
  </>
);

const ParentDashboard = () => {
  const { user } = useAuth();
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const fetchChildren = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no, pre_admission_no, section, status, phone, grade, courses:course_id(name), campuses:campus_id(name)")
        .or(`father_user_id.eq.${user.id},mother_user_id.eq.${user.id},guardian_user_id.eq.${user.id}`);
      setChildren(data || []);
      setLoading(false);
    };
    fetchChildren();
  }, [user?.id]);

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  const statusColor: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    pre_admitted: "bg-blue-100 text-blue-700",
    inactive: "bg-gray-100 text-gray-600",
    alumni: "bg-purple-100 text-purple-700",
  };

  return (
    <>
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">My Children</CardTitle>
            <Badge variant="secondary" className="ml-auto text-xs">{children.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <div className="text-center py-10">
              <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No students linked to your account yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {children.map((child: any) => {
                const admNo = child.admission_no || child.pre_admission_no || "—";
                const initials = (child.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <Link
                    key={child.id}
                    to={`/students/${child.admission_no || child.pre_admission_no}`}
                    className="flex items-start gap-4 rounded-xl border border-border/60 p-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pastel-purple text-sm font-bold text-foreground/70">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{child.name}</p>
                        <Badge className={`text-[11px] font-medium border-0 shrink-0 ${statusColor[child.status] || "bg-muted text-foreground/70"}`}>
                          {(child.status || "—").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(child.courses as any)?.name || "—"} {child.grade ? `· ${child.grade}` : ""} {child.section ? `· Sec ${child.section}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Adm No: <span className="font-medium text-foreground/80">{admNo}</span>
                        {(child.campuses as any)?.name ? ` · ${(child.campuses as any).name}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { role } = useAuth();

  // Redirect consultant to their portal
  if (role === "consultant") return <Navigate to="/consultant-portal" replace />;
  // Redirect counsellor to admissions dashboard
  if (role === "counsellor") return <Navigate to="/admissions" replace />;

  const isAdmin   = ["super_admin", "campus_admin", "admission_head", "principal"].includes(role || "");
  const isFaculty = ["faculty", "teacher"].includes(role || "");
  const isStudent = role === "student";
  const isParent  = role === "parent";
  const isCounsellor = role === "counsellor";

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome back. Here's your overview.</p>
      </div>
      {isAdmin && <PendingApprovalsPanel />}
      {isAdmin && <ConsultantVoiceMessagesPanel />}
      {isAdmin   && <SuperAdminDashboard isSuperAdmin={role === "super_admin"} />}
      {isCounsellor && <SuperAdminDashboard isSuperAdmin={false} />}
      {isFaculty && <FacultyDashboard />}
      {isStudent && <StudentDashboard />}
      {isParent  && <ParentDashboard />}
      {!isAdmin && !isCounsellor && !isFaculty && !isStudent && !isParent && <SuperAdminDashboard isSuperAdmin={false} />}
    </div>
  );
};

export default Dashboard;
