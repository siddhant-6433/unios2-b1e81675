import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, TrendingUp, Users, BarChart3, AlertTriangle, IndianRupee } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { SOURCE_LABELS } from "@/config/leadSources";

const STAGE_ORDER = [
  "new_lead", "application_in_progress", "application_fee_paid", "application_submitted",
  "ai_called", "counsellor_call", "visit_scheduled", "interview",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
};

// SOURCE_LABELS imported from @/config/leadSources

const COLORS = [
  "hsl(175, 40%, 40%)", "hsl(250, 60%, 60%)", "hsl(45, 80%, 55%)",
  "hsl(0, 65%, 55%)", "hsl(215, 70%, 55%)", "hsl(30, 80%, 50%)",
  "hsl(150, 50%, 45%)", "hsl(330, 60%, 55%)", "hsl(190, 50%, 50%)", "hsl(280, 40%, 50%)",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const AdmissionAnalytics = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [sourceROI, setSourceROI] = useState<any[]>([]);
  const [stageAging, setStageAging] = useState<any[]>([]);
  const [dailyTrend, setDailyTrend] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any[]>([]);
  const [sourceFunnel, setSourceFunnel] = useState<any[]>([]);
  const [seatMatrix, setSeatMatrix] = useState<any[]>([]);
  const [counsellorStats, setCounsellorStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("leads").select("id, stage, source, counsellor_id, created_at, profiles:counsellor_id(display_name)").order("created_at", { ascending: false }).limit(2000),
      supabase.from("source_roi_summary" as any).select("*"),
      supabase.from("stage_aging_summary" as any).select("*"),
      supabase.from("daily_admission_trend" as any).select("*"),
      supabase.from("hourly_activity_heatmap" as any).select("*"),
      supabase.from("source_funnel" as any).select("*"),
      supabase.from("seat_matrix" as any).select("*"),
      supabase.from("counsellor_performance_stats" as any).select("*"),
    ]).then(([leadsR, roiR, agingR, trendR, heatR, funnelR, seatR, counsellorR]) => {
      if (leadsR.data) setLeads(leadsR.data);
      if (roiR.data) setSourceROI(roiR.data);
      if (agingR.data) setStageAging(agingR.data);
      if (trendR.data) setDailyTrend(trendR.data);
      if (heatR.data) setHeatmap(heatR.data);
      if (funnelR.data) setSourceFunnel(funnelR.data);
      if (seatR.data) setSeatMatrix(seatR.data);
      if (counsellorR.data) setCounsellorStats(counsellorR.data);
      setLoading(false);
    });
  }, []);

  const totalLeads = leads.length;
  const admitted = leads.filter(l => l.stage === "admitted").length;
  const rejected = leads.filter(l => l.stage === "rejected").length;
  const conversionRate = totalLeads > 0 ? Math.round((admitted / totalLeads) * 100) : 0;
  const thisMonth = leads.filter(l => new Date(l.created_at).getMonth() === new Date().getMonth() && new Date(l.created_at).getFullYear() === new Date().getFullYear()).length;

  // Stage funnel data
  const stageCounts = STAGE_ORDER.map(key => ({
    name: STAGE_LABELS[key] || key,
    count: leads.filter(l => l.stage === key).length,
  }));

  // Source distribution for pie chart
  const sourceCounts = Object.entries(SOURCE_LABELS)
    .map(([key, label]) => ({ name: label, value: leads.filter(l => l.source === key).length }))
    .filter(s => s.value > 0);

  // Drop-off analysis
  const dropOff = useMemo(() => {
    const counts = STAGE_ORDER.map(s => leads.filter(l => {
      const idx = STAGE_ORDER.indexOf(l.stage);
      return idx >= STAGE_ORDER.indexOf(s);
    }).length);
    return STAGE_ORDER.map((s, i) => ({
      name: STAGE_LABELS[s] || s,
      reached: counts[i],
      dropOff: i > 0 ? counts[i - 1] - counts[i] : 0,
      dropPct: i > 0 && counts[i - 1] > 0 ? Math.round(((counts[i - 1] - counts[i]) / counts[i - 1]) * 100) : 0,
    }));
  }, [leads]);

  // Heatmap grid
  const heatmapGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    heatmap.forEach((h: any) => {
      if (h.day_of_week >= 0 && h.day_of_week < 7 && h.hour >= 0 && h.hour < 24) {
        grid[h.day_of_week][h.hour] = Number(h.activity_count);
      }
    });
    const max = Math.max(...grid.flat(), 1);
    return { grid, max };
  }, [heatmap]);

  // Seat fill
  const totalSeats = seatMatrix.reduce((s: number, r: any) => s + Number(r.total_seats), 0);
  const totalAdmitted = seatMatrix.reduce((s: number, r: any) => s + Number(r.admitted), 0);
  const overallFill = totalSeats > 0 ? Math.round((totalAdmitted / totalSeats) * 100) : 0;

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admission Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Conversion insights, source ROI, counsellor metrics & operations</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: totalLeads, icon: Users, bg: "bg-pastel-blue" },
          { label: "Admitted", value: admitted, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Conversion Rate", value: `${conversionRate}%`, icon: BarChart3, bg: "bg-pastel-purple" },
          { label: "Seat Fill", value: `${overallFill}%`, icon: AlertTriangle, bg: overallFill >= 80 ? "bg-pastel-red" : "bg-pastel-orange" },
        ].map(s => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${s.bg} mb-3`}>
                <s.icon className="h-5 w-5 text-foreground/70" />
              </div>
              <p className="text-3xl font-bold text-foreground">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Overview", "Sources", "Counsellors", "Courses", "Operations"].map(t => (
            <TabsTrigger key={t} value={t.toLowerCase()}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stage Funnel */}
            <Card className="border-border/60 shadow-none">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stage-wise Funnel</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stageCounts} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(175, 40%, 40%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Daily Trend */}
            <Card className="border-border/60 shadow-none">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Daily Trend (90 days)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyTrend.slice(-30)}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("en-IN")} />
                    <Legend />
                    <Line type="monotone" dataKey="new_leads" stroke="hsl(215, 70%, 55%)" strokeWidth={2} dot={false} name="New Leads" />
                    <Line type="monotone" dataKey="admissions" stroke="hsl(150, 50%, 45%)" strokeWidth={2} dot={false} name="Admissions" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Drop-off Analysis */}
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Drop-off Analysis</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Stage</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Reached</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Dropped</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Drop %</th>
                  </tr>
                </thead>
                <tbody>
                  {dropOff.map(d => (
                    <tr key={d.name} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">{d.name}</td>
                      <td className="px-4 py-2 text-center text-foreground">{d.reached}</td>
                      <td className="px-4 py-2 text-center text-muted-foreground">{d.dropOff || "—"}</td>
                      <td className="px-4 py-2 text-center">
                        {d.dropPct > 0 ? (
                          <Badge className={`text-[10px] border-0 font-semibold ${d.dropPct > 50 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : d.dropPct > 25 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                            {d.dropPct}%
                          </Badge>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SOURCES TAB */}
        <TabsContent value="sources" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Source Distribution Pie */}
            <Card className="border-border/60 shadow-none">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Source Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPie>
                    <Pie data={sourceCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => `${e.name} (${e.value})`}>
                      {sourceCounts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </RechartsPie>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Source Conversion */}
            <Card className="border-border/60 shadow-none">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Source Conversion Rates</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sourceFunnel.map((s: any) => {
                    const rate = Number(s.total) > 0 ? Math.round((Number(s.admitted) / Number(s.total)) * 100) : 0;
                    return (
                      <div key={s.source} className="flex items-center gap-3">
                        <span className="text-xs text-foreground font-medium w-24 shrink-0">{SOURCE_LABELS[s.source] || s.source}</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all flex items-center justify-end px-2" style={{ width: `${Math.max(rate, 5)}%` }}>
                            <span className="text-[10px] font-bold text-primary-foreground">{rate}%</span>
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground w-16 text-right">{s.admitted}/{s.total}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Source ROI Table */}
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Source ROI (Monthly)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Source</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Month</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Leads</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Applied</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Admitted</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Conv %</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Ad Spend</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">CPA</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceROI.sort((a: any, b: any) => b.month?.localeCompare(a.month) || 0).slice(0, 30).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">{SOURCE_LABELS[r.source] || r.source}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.month ? new Date(r.month).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : "—"}</td>
                      <td className="px-4 py-2 text-center">{r.total_leads}</td>
                      <td className="px-4 py-2 text-center">{r.applied}</td>
                      <td className="px-4 py-2 text-center font-semibold text-primary">{r.admitted}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge className={`text-[10px] border-0 ${Number(r.conversion_pct) >= 20 ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                          {r.conversion_pct}%
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{Number(r.ad_spend) > 0 ? `₹${Number(r.ad_spend).toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-2 text-right font-medium">{r.cost_per_admission != null ? `₹${Number(r.cost_per_admission).toLocaleString("en-IN")}` : "—"}</td>
                    </tr>
                  ))}
                  {sourceROI.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COUNSELLORS TAB */}
        <TabsContent value="counsellors" className="mt-4">
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Counsellor Scorecard</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Counsellor</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Leads</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Calls</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">WhatsApp</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Follow-ups</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Visits</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Conversions</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {counsellorStats
                    .sort((a: any, b: any) => Number(b.conversions) - Number(a.conversions))
                    .map((c: any) => (
                      <tr key={c.counsellor_id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-medium text-foreground">{c.counsellor_name || "Unknown"}</td>
                        <td className="px-4 py-2 text-center text-muted-foreground">{c.leads_assigned}</td>
                        <td className="px-4 py-2 text-center">{c.total_calls}</td>
                        <td className="px-4 py-2 text-center">{c.total_whatsapps}</td>
                        <td className="px-4 py-2 text-center">{c.followups_completed}</td>
                        <td className="px-4 py-2 text-center">{c.visits_scheduled}</td>
                        <td className="px-4 py-2 text-center font-bold text-primary">{c.conversions}</td>
                        <td className="px-4 py-2 text-center">
                          {Number(c.followups_overdue) > 0 ? (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]">{c.followups_overdue}</Badge>
                          ) : "0"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COURSES TAB */}
        <TabsContent value="courses" className="mt-4">
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Course-wise Seat Fill</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {seatMatrix
                  .filter((r: any) => Number(r.total_seats) > 0)
                  .sort((a: any, b: any) => (Number(b.admitted) / Number(b.total_seats)) - (Number(a.admitted) / Number(a.total_seats)))
                  .map((r: any) => {
                    const pct = Math.round((Number(r.admitted) / Number(r.total_seats)) * 100);
                    return (
                      <div key={r.course_id} className="flex items-center gap-3">
                        <div className="w-40 shrink-0">
                          <span className="text-xs font-medium text-foreground block truncate">{r.course_name}</span>
                          <span className="text-[10px] text-muted-foreground">{r.campus_name}</span>
                        </div>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all flex items-center justify-end px-2 ${pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`}
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          >
                            {pct >= 15 && <span className="text-[10px] font-bold text-white">{pct}%</span>}
                          </div>
                        </div>
                        <span className="text-[11px] text-muted-foreground w-20 text-right">{r.admitted}/{r.total_seats}</span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OPERATIONS TAB */}
        <TabsContent value="operations" className="mt-4 space-y-6">
          {/* Stage Aging */}
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Stage Aging</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Stage</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Count</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Avg Days</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Max Days</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase">Stale (&gt;7d)</th>
                  </tr>
                </thead>
                <tbody>
                  {stageAging
                    .sort((a: any, b: any) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
                    .map((s: any) => (
                      <tr key={s.stage} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-medium text-foreground">{STAGE_LABELS[s.stage] || s.stage}</td>
                        <td className="px-4 py-2 text-center">{s.lead_count}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={Number(s.avg_days_in_stage) > 7 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                            {s.avg_days_in_stage}d
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center text-muted-foreground">{s.max_days_in_stage}d</td>
                        <td className="px-4 py-2 text-center">
                          {Number(s.stale_count) > 0 ? (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px]">{s.stale_count}</Badge>
                          ) : "0"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Activity Heatmap */}
          <Card className="border-border/60 shadow-none">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Activity Heatmap (Last 30 Days, IST)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="inline-flex flex-col gap-1">
                  {/* Hour labels */}
                  <div className="flex gap-0.5 ml-10">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="w-5 text-center text-[8px] text-muted-foreground">{h}</div>
                    ))}
                  </div>
                  {/* Rows */}
                  {DAYS.map((day, di) => (
                    <div key={day} className="flex items-center gap-0.5">
                      <span className="w-9 text-[10px] text-muted-foreground text-right pr-1">{day}</span>
                      {Array.from({ length: 24 }, (_, h) => {
                        const val = heatmapGrid.grid[di]?.[h] || 0;
                        const intensity = heatmapGrid.max > 0 ? val / heatmapGrid.max : 0;
                        return (
                          <div
                            key={h}
                            className="w-5 h-5 rounded-sm"
                            style={{ backgroundColor: intensity > 0 ? `hsl(175, 40%, ${80 - intensity * 50}%)` : "hsl(var(--muted))" }}
                            title={`${day} ${h}:00 — ${val} activities`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdmissionAnalytics;
