/**
 * 7-day rolling voice-agent quality stats. Reads from the
 * `voice_agent_quality_daily` view (see migration 20260606150000).
 *
 * Why: every config change so far has been a vibe check. This card
 * gives ground truth — average score, mean turn latency, repetitions,
 * voice switches, calls without dispositions — so a regression after
 * a deploy is visible immediately.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Star, Repeat, Mic2, AlertTriangle, Clock } from "lucide-react";

interface DailyRow {
  day_ist: string;
  total_calls: number;
  rated_calls: number;
  good_calls: number;
  bad_calls: number;
  mean_score: number | null;
  avg_ttfa_ms: number | null;
  avg_turn_latency_ms: number | null;
  avg_turns: number | null;
  total_repetitions: number | null;
  total_voice_switches: number | null;
  missing_disposition_count: number | null;
}

function sumWindow(rows: DailyRow[], days: number, key: keyof DailyRow): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  return rows
    .filter(r => r.day_ist >= cutoff)
    .reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

function avgWindow(rows: DailyRow[], days: number, key: keyof DailyRow): number | null {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const vals = rows.filter(r => r.day_ist >= cutoff)
    .map(r => Number(r[key])).filter(n => Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function VoiceQualityDashboard() {
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("voice_agent_quality_daily" as any)
        .select("*")
        .limit(14);
      if (cancelled) return;
      if (error) {
        console.error("voice_agent_quality_daily fetch failed:", error.message);
        setLoading(false);
        return;
      }
      setRows((data as DailyRow[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const total7   = sumWindow(rows, 7, "total_calls");
  const rated7   = sumWindow(rows, 7, "rated_calls");
  const good7    = sumWindow(rows, 7, "good_calls");
  const bad7     = sumWindow(rows, 7, "bad_calls");
  const mean7    = avgWindow(rows, 7, "mean_score");
  const ttfa7    = avgWindow(rows, 7, "avg_ttfa_ms");
  const turn7    = avgWindow(rows, 7, "avg_turn_latency_ms");
  const reps7    = sumWindow(rows, 7, "total_repetitions");
  const swaps7   = sumWindow(rows, 7, "total_voice_switches");
  const noDisp7  = sumWindow(rows, 7, "missing_disposition_count");

  const goodPct = rated7 ? Math.round((good7 / rated7) * 100) : null;

  const fmtMs = (n: number | null) => n == null ? "—" : `${(n / 1000).toFixed(1)}s`;
  const fmtScore = (n: number | null) => n == null ? "—" : n.toFixed(2);

  const cards = [
    {
      label: "Mean score (7d)",
      value: fmtScore(mean7),
      sub: rated7 ? `${rated7} rated of ${total7}` : `${total7} calls — none rated yet`,
      icon: Star,
      bg: "bg-pastel-blue",
    },
    {
      label: "Good calls (≥4★)",
      value: goodPct == null ? "—" : `${goodPct}%`,
      sub: `${good7} good, ${bad7} bad (≤2★)`,
      icon: Activity,
      bg: "bg-pastel-green",
    },
    {
      label: "Avg first audio",
      value: fmtMs(ttfa7),
      sub: `Turn latency ${fmtMs(turn7)}`,
      icon: Clock,
      bg: "bg-pastel-purple",
    },
    {
      label: "Repetitions (7d)",
      value: String(reps7),
      sub: `Voice switches ${swaps7}`,
      icon: Repeat,
      bg: "bg-pastel-orange",
    },
    {
      label: "Missing disposition",
      value: String(noDisp7),
      sub: noDisp7 > 0 ? "calls with no followup" : "all calls dispositioned",
      icon: AlertTriangle,
      bg: noDisp7 > 0 ? "bg-red-100 dark:bg-red-900/40" : "bg-pastel-green",
    },
  ];

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-foreground/70" />
            <h3 className="text-sm font-semibold text-foreground">Voice Agent Quality — Last 7 days</h3>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {loading ? "loading…" : `${total7} calls`}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-border/40 p-3 bg-card">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.bg} mb-2`}>
                <c.icon className="h-3.5 w-3.5 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{loading ? "—" : c.value}</p>
              <p className="text-[10px] font-medium text-foreground/80">{c.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
