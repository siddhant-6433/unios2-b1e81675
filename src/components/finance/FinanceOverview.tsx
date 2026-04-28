import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import {
  IndianRupee, TrendingUp, AlertTriangle, Loader2, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];
const OVERDUE_COLORS = ["#fbbf24", "#f97316", "#ef4444", "#dc2626"];

export function FinanceOverview() {
  const { selectedCampusId, campuses } = useCampus();
  const [ledger, setLedger] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [selectedCampusId]);

  const fetchData = async () => {
    setLoading(true);
    const [ledgerRes, paymentsRes] = await Promise.all([
      supabase.from("fee_ledger")
        .select("id, total_amount, paid_amount, balance, status, due_date, student_id, students:student_id(name, admission_no, campus_id, campuses:campus_id(name))")
        .order("due_date", { ascending: true })
        .limit(2000),
      supabase.from("payments")
        .select("id, amount, paid_at, payment_mode, students:student_id(campus_id)")
        .order("paid_at", { ascending: false })
        .limit(2000),
    ]);
    if (ledgerRes.data) setLedger(ledgerRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    setLoading(false);
  };

  const filteredLedger = useMemo(() =>
    selectedCampusId === "all" ? ledger : ledger.filter((l: any) => l.students?.campus_id === selectedCampusId),
  [ledger, selectedCampusId]);

  const filteredPayments = useMemo(() =>
    selectedCampusId === "all" ? payments : payments.filter((p: any) => p.students?.campus_id === selectedCampusId),
  [payments, selectedCampusId]);

  // KPIs
  const totalCollected = filteredLedger.reduce((s: number, l: any) => s + Number(l.paid_amount || 0), 0);
  const totalPending = filteredLedger.reduce((s: number, l: any) => s + Number(l.balance || 0), 0);
  const totalBilled = totalCollected + totalPending;
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months[key] = 0;
    }
    filteredPayments.forEach((p: any) => {
      const key = p.paid_at?.slice(0, 7);
      if (key && key in months) months[key] += Number(p.amount || 0);
    });
    return Object.entries(months).map(([month, amount]) => ({
      month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short" }),
      amount: Math.round(amount / 100000 * 10) / 10,
    }));
  }, [filteredPayments]);

  // Campus breakdown
  const campusBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLedger.forEach((l: any) => {
      const name = (l.students as any)?.campuses?.name || "Unknown";
      map[name] = (map[name] || 0) + Number(l.paid_amount || 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: Math.round(value / 100000 * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLedger]);

  // Overdue by age
  const overdueByAge = useMemo(() => {
    const today = new Date();
    const buckets = [
      { label: "0-30 days", min: 0, max: 30, amount: 0 },
      { label: "31-60 days", min: 31, max: 60, amount: 0 },
      { label: "61-90 days", min: 61, max: 90, amount: 0 },
      { label: "90+ days", min: 91, max: Infinity, amount: 0 },
    ];
    filteredLedger.filter((l: any) => l.status === "overdue").forEach((l: any) => {
      const dueDate = new Date(l.due_date);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const bucket = buckets.find(b => daysOverdue >= b.min && daysOverdue <= b.max);
      if (bucket) bucket.amount += Number(l.balance || 0);
    });
    return buckets.map(b => ({ ...b, amount: Math.round(b.amount / 1000) }));
  }, [filteredLedger]);

  // Overdue students list
  const overdueStudents = useMemo(() => {
    const today = new Date();
    return filteredLedger
      .filter((l: any) => l.status === "overdue" && Number(l.balance) > 0)
      .map((l: any) => ({
        name: l.students?.name || "—",
        admission_no: l.students?.admission_no || "—",
        balance: Number(l.balance),
        days_overdue: Math.floor((today.getTime() - new Date(l.due_date).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 20);
  }, [filteredLedger]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-green mb-4">
              <IndianRupee className="h-5 w-5 text-foreground/70" />
            </div>
            <p className="text-3xl font-bold text-foreground">₹{(totalCollected / 100000).toFixed(1)}L</p>
            <p className="text-sm text-muted-foreground mt-0.5">Total Collected</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-yellow mb-4">
              <AlertTriangle className="h-5 w-5 text-foreground/70" />
            </div>
            <p className="text-3xl font-bold text-foreground">₹{(totalPending / 100000).toFixed(1)}L</p>
            <p className="text-sm text-muted-foreground mt-0.5">Pending</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-blue mb-4">
              <TrendingUp className="h-5 w-5 text-foreground/70" />
            </div>
            <p className="text-3xl font-bold text-foreground">{collectionRate}%</p>
            <p className="text-sm text-muted-foreground mt-0.5">Collection Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly Trend */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Monthly Collections (₹ Lakhs)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyTrend} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  formatter={(v: number) => [`₹${v}L`, "Collected"]}
                />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Campus Breakdown */}
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Campus Breakdown (₹ Lakhs)</CardTitle>
          </CardHeader>
          <CardContent>
            {campusBreakdown.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={campusBreakdown}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ₹${value}L`}
                    labelLine={false}
                  >
                    {campusBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`₹${v}L`, "Collected"]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overdue by Age */}
      <Card className="border-border/60 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Overdue by Age (₹ Thousands)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={overdueByAge} barSize={40} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={80} />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                formatter={(v: number) => [`₹${v}K`, "Overdue"]}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                {overdueByAge.map((_, i) => (
                  <Cell key={i} fill={OVERDUE_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Overdue Students Table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Overdue Students
            </CardTitle>
            <span className="text-xs text-muted-foreground">{overdueStudents.length} students</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Adm. No</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days Overdue</th>
              </tr>
            </thead>
            <tbody>
              {overdueStudents.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No overdue students</td></tr>
              ) : overdueStudents.map((s, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.admission_no}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">₹{s.balance.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge className={`text-[10px] font-medium border-0 ${
                      s.days_overdue > 90 ? "bg-pastel-red text-foreground/80" :
                      s.days_overdue > 30 ? "bg-pastel-orange text-foreground/80" :
                      "bg-pastel-yellow text-foreground/80"
                    }`}>
                      {s.days_overdue} days
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
}
