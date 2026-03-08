import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, Users, BarChart3, PieChart } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RechartsPie, Pie, Cell, Legend } from "recharts";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const SOURCE_LABELS: Record<string, string> = {
  website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads",
  shiksha: "Shiksha", walk_in: "Walk-in", consultant: "Consultant",
  justdial: "JustDial", referral: "Referral", education_fair: "Education Fair", other: "Other",
};

const COLORS = [
  "hsl(175, 40%, 40%)", "hsl(250, 60%, 60%)", "hsl(45, 80%, 55%)",
  "hsl(0, 65%, 55%)", "hsl(215, 70%, 55%)", "hsl(30, 80%, 50%)",
  "hsl(150, 50%, 45%)", "hsl(330, 60%, 55%)", "hsl(190, 50%, 50%)", "hsl(280, 40%, 50%)",
];

const AdmissionAnalytics = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("leads").select("id, stage, source, counsellor_id, created_at, course_id, campus_id, profiles:counsellor_id(display_name)")
      .order("created_at", { ascending: false }).limit(1000)
      .then(({ data }) => { if (data) setLeads(data); setLoading(false); });
  }, []);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Stage-wise funnel
  const stageCounts = Object.entries(STAGE_LABELS).map(([key, label]) => ({
    name: label, count: leads.filter(l => l.stage === key).length,
  }));

  // Source-wise distribution
  const sourceCounts = Object.entries(SOURCE_LABELS).map(([key, label]) => ({
    name: label, value: leads.filter(l => l.source === key).length,
  })).filter(s => s.value > 0);

  // Source-wise conversion (admitted / total per source)
  const sourceConversion = Object.entries(SOURCE_LABELS).map(([key, label]) => {
    const total = leads.filter(l => l.source === key).length;
    const admitted = leads.filter(l => l.source === key && l.stage === "admitted").length;
    return { name: label, total, admitted, rate: total > 0 ? Math.round((admitted / total) * 100) : 0 };
  }).filter(s => s.total > 0).sort((a, b) => b.rate - a.rate);

  // Counsellor-wise
  const counsellorMap: Record<string, { name: string; total: number; admitted: number }> = {};
  leads.forEach(l => {
    const cName = (l.profiles as any)?.display_name || "Unassigned";
    if (!counsellorMap[cName]) counsellorMap[cName] = { name: cName, total: 0, admitted: 0 };
    counsellorMap[cName].total++;
    if (l.stage === "admitted") counsellorMap[cName].admitted++;
  });
  const counsellorData = Object.values(counsellorMap).sort((a, b) => b.total - a.total).slice(0, 10);

  // Weekly trend (last 8 weeks)
  const weeklyData: { week: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(); start.setDate(start.getDate() - (i + 1) * 7);
    const end = new Date(); end.setDate(end.getDate() - i * 7);
    const weekLabel = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
    const count = leads.filter(l => { const d = new Date(l.created_at); return d >= start && d < end; }).length;
    weeklyData.push({ week: weekLabel, count });
  }

  const totalLeads = leads.length;
  const admitted = leads.filter(l => l.stage === "admitted").length;
  const conversionRate = totalLeads > 0 ? Math.round((admitted / totalLeads) * 100) : 0;
  const thisMonth = leads.filter(l => new Date(l.created_at).getMonth() === new Date().getMonth()).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admission Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Conversion insights, source performance & counsellor metrics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: totalLeads, icon: Users, bg: "bg-pastel-blue" },
          { label: "Admitted", value: admitted, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Conversion Rate", value: `${conversionRate}%`, icon: BarChart3, bg: "bg-pastel-purple" },
          { label: "This Month", value: thisMonth, icon: PieChart, bg: "bg-pastel-orange" },
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

        {/* Source Distribution */}
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

        {/* Weekly Trend */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Weekly Lead Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={weeklyData}>
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(250, 60%, 60%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Source Conversion */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Source Conversion Rates</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sourceConversion.map(s => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="text-xs text-foreground font-medium w-24 shrink-0">{s.name}</span>
                  <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all flex items-center justify-end px-2" style={{ width: `${Math.max(s.rate, 5)}%` }}>
                      <span className="text-[10px] font-bold text-primary-foreground">{s.rate}%</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground w-16 text-right">{s.admitted}/{s.total}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Counsellor Leaderboard */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Counsellor Performance</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Leads</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Admitted</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {counsellorData.map(c => (
                <tr key={c.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{c.total}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{c.admitted}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge className={`text-[11px] border-0 ${c.total > 0 && Math.round((c.admitted / c.total) * 100) >= 20 ? "bg-pastel-green" : "bg-muted"}`}>
                      {c.total > 0 ? Math.round((c.admitted / c.total) * 100) : 0}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdmissionAnalytics;
