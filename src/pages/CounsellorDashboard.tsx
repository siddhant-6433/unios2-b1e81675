import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Phone, MessageSquare, CalendarCheck, MapPin, UserCheck,
  Trophy, AlertTriangle, Clock, TrendingUp,
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

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const CounsellorDashboard = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [stats, setStats] = useState<CounsellorStats[]>([]);
  const [overdue, setOverdue] = useState<OverdueFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"leaderboard" | "overdue">("leaderboard");

  useEffect(() => {
    (async () => {
      const [statsRes, overdueRes] = await Promise.all([
        supabase.from("counsellor_performance_stats" as any).select("*"),
        supabase.from("overdue_followups" as any).select("*").limit(100),
      ]);
      if (statsRes.data) setStats(statsRes.data as any);
      if (overdueRes.data) setOverdue(overdueRes.data as any);
      setLoading(false);
    })();
  }, []);

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

  // Rank counsellors by composite score
  const ranked = useMemo(() => {
    return [...stats]
      .map(s => ({
        ...s,
        score: Number(s.conversions) * 10 + Number(s.followups_completed) * 2 + Number(s.total_calls) + Number(s.visits_scheduled) * 3,
      }))
      .sort((a, b) => b.score - a.score);
  }, [stats]);

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
      <div className="flex items-center gap-3">
        <div className="flex rounded-xl border border-input bg-card p-0.5">
          <button
            onClick={() => setTab("leaderboard")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${tab === "leaderboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setTab("overdue")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${tab === "overdue" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Overdue Follow-ups
            {overdue.length > 0 && (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${tab === "overdue" ? "bg-white/20 text-primary-foreground" : "bg-red-500 text-white"}`}>
                {overdue.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === "leaderboard" ? (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leads</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calls</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Follow-ups</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Visits</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conversions</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overdue</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s, i) => (
                  <tr key={s.counsellor_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-center">
                      {i === 0 ? <Trophy className="h-4 w-4 text-amber-500 mx-auto" /> :
                       i === 1 ? <Trophy className="h-4 w-4 text-gray-400 mx-auto" /> :
                       i === 2 ? <Trophy className="h-4 w-4 text-amber-700 mx-auto" /> :
                       <span className="text-muted-foreground text-xs">{i + 1}</span>}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{s.counsellor_name || "Unknown"}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{s.leads_assigned}</td>
                    <td className="px-4 py-3 text-center font-medium text-foreground">{s.total_calls}</td>
                    <td className="px-4 py-3 text-center font-medium text-foreground">{s.total_whatsapps}</td>
                    <td className="px-4 py-3 text-center font-medium text-foreground">{s.followups_completed}</td>
                    <td className="px-4 py-3 text-center font-medium text-foreground">{s.visits_scheduled}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-primary">{s.conversions}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {Number(s.followups_overdue) > 0 ? (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-[10px] font-semibold">
                          {s.followups_overdue}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className="bg-primary/10 text-primary border-0 text-xs font-bold">{s.score}</Badge>
                    </td>
                  </tr>
                ))}
                {ranked.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No counsellor data available</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
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
      )}
    </div>
  );
};

export default CounsellorDashboard;
