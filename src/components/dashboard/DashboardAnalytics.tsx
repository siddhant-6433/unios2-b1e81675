import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CampusStudentDatum = { name: string; total: number; active: number };
type FeeCampusDatum = { name: string; assigned: number; paid: number; due: number };
type LeadSourceDatum = { name: string; count: number };
type WeeklyLeadDatum = { day: string; leads: number };

type DashboardAnalyticsProps = {
  selectedCampusId: string;
  studentCount: number;
};

type DashboardAnalyticsPayload = {
  campus_students?: CampusStudentDatum[];
  fee_by_campus?: FeeCampusDatum[];
  lead_sources?: LeadSourceDatum[];
  weekly_leads?: { date: string; leads: number }[];
  fee_total?: { assigned: number; paid: number; due: number };
};

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#8b5cf6", "#14b8a6", "#ec4899", "#f97316"];
const AXIS_STYLE = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function fmtAmt(val: number): string {
  if (val >= 1_00_00_000) return `${(val / 1_00_00_000).toFixed(2)} Cr`;
  if (val >= 1_00_000) return `${(val / 1_00_000).toFixed(2)} L`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)} K`;
  return `₹${val}`;
}

function fmtSrc(src: string): string {
  return src.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

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

export default function DashboardAnalytics({
  selectedCampusId,
  studentCount,
}: DashboardAnalyticsProps) {
  const [loading, setLoading] = useState(true);
  const [campusStudents, setCampusStudents] = useState<CampusStudentDatum[]>([]);
  const [leadBySrc, setLeadBySrc] = useState<LeadSourceDatum[]>([]);
  const [feeByCampus, setFeeByCampus] = useState<FeeCampusDatum[]>([]);
  const [feeTotal, setFeeTotal] = useState({ assigned: 0, paid: 0, due: 0 });
  const [weeklyLeads, setWeeklyLeads] = useState<WeeklyLeadDatum[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchAnalytics = async () => {
      setLoading(true);
      const byCampus = selectedCampusId !== "all";
      const { data, error } = await (supabase as any).rpc("dashboard_analytics", {
        p_campus_id: byCampus ? selectedCampusId : null,
      });

      if (cancelled) return;
      if (error) {
        console.error("Failed to load dashboard analytics", error);
        setLoading(false);
        return;
      }

      const payload = (data || {}) as DashboardAnalyticsPayload;
      setCampusStudents((payload.campus_students || []).map((row) => ({
        name: row.name,
        total: Number(row.total) || 0,
        active: Number(row.active) || 0,
      })));
      setLeadBySrc((payload.lead_sources || []).map((row) => ({
        name: row.name,
        count: Number(row.count) || 0,
      })));
      setFeeByCampus((payload.fee_by_campus || []).map((row) => ({
        name: row.name,
        assigned: Number(row.assigned) || 0,
        paid: Number(row.paid) || 0,
        due: Number(row.due) || 0,
      })));
      setFeeTotal({
        assigned: Number(payload.fee_total?.assigned) || 0,
        paid: Number(payload.fee_total?.paid) || 0,
        due: Number(payload.fee_total?.due) || 0,
      });
      setWeeklyLeads((payload.weekly_leads || []).map(({ date, leads }) => ({
        day: new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
        leads: Number(leads) || 0,
      })));
      setLoading(false);
    };

    fetchAnalytics();
    return () => { cancelled = true; };
  }, [selectedCampusId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Analytics</p>
          <div className="flex-1 border-t border-border/50" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 h-64 rounded-lg border border-border/60 bg-muted/20" />
          <div className="lg:col-span-2 h-64 rounded-lg border border-border/60 bg-muted/20" />
        </div>
        <div className="h-72 rounded-lg border border-border/60 bg-muted/20" />
        <div className="h-48 rounded-lg border border-border/60 bg-muted/20" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">Analytics</p>
        <div className="flex-1 border-t border-border/50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
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
                  <Bar dataKey="total" name="Total" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="active" name="Active" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

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
                  <span className="font-semibold text-success">{fmtAmt(feeTotal.paid)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Due: </span>
                  <span className="font-semibold text-warning-foreground">{fmtAmt(feeTotal.due)}</span>
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
                <Bar dataKey="paid" name="Paid" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="due" name="Due" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

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
  );
}
