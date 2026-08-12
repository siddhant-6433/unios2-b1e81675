import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Flame, Trophy, ArrowRight } from "lucide-react";

interface LeaderRow {
  counsellor_id: string;
  counsellor_name: string;
  total_count: number;
  today_count: number;
  last_registered_at: string | null;
}

interface SprintStats {
  team_count: number;
  team_today: number;
  pool_remaining: number;
  deadline_at: string;
}

const TARGET_PER_COUNSELLOR = 15;

function daysRemaining(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function CahetSprintLeaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [stats, setStats] = useState<SprintStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [lb, st] = await Promise.all([
        supabase.rpc("cahet_sprint_leaderboard", { p_limit: 10 }),
        supabase.rpc("cahet_sprint_stats", { p_counsellor_id: null }),
      ]);
      if (cancelled) return;
      setRows(((lb.data as LeaderRow[]) || []).filter(r => r.total_count > 0));
      if (st.data) {
        const s = Array.isArray(st.data) ? st.data[0] : st.data;
        setStats(s as SprintStats);
      }
      setLoading(false);
    }
    load();
  }, []);

  const days = stats ? daysRemaining(stats.deadline_at) : 0;
  const top = rows[0];

  return (
    <Card className="rounded-2xl border-destructive/20 bg-gradient-to-br from-rose-50/60 to-amber-50/40">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10">
              <Flame className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">CAHET Sprint Leaderboard</h3>
              <p className="text-[11px] text-muted-foreground">
                {stats ? (
                  <>
                    {days} {days === 1 ? "day" : "days"} left · Team {stats.team_count} (+{stats.team_today} today) · {stats.pool_remaining} leads in pool
                  </>
                ) : (
                  <>Top counsellors driving BPT/BMRIT registrations</>
                )}
              </p>
            </div>
          </div>
          <Link
            to="/cahet-sprint"
            className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
          >
            Open sprint <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <ButtonOrb state="searching" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No registrations recorded yet. Be the first — open the sprint to start.
          </div>
        ) : (
          <div className="divide-y divide-rose-100/80">
            {rows.map((r, i) => {
              const progress = Math.min(100, Math.round((r.total_count / TARGET_PER_COUNSELLOR) * 100));
              const streak = r.today_count >= 3;
              const isLeader = i === 0;
              return (
                <div key={r.counsellor_id} className="flex items-center gap-3 py-2">
                  <div className={`w-6 text-center text-sm font-bold tabular-nums ${isLeader ? "text-warning-foreground" : "text-muted-foreground"}`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">{r.counsellor_name}</span>
                      {isLeader && <Trophy className="h-3.5 w-3.5 text-warning" />}
                      {streak && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 text-warning-foreground border border-warning/25 px-1.5 py-0 text-[10px] font-semibold">
                          <Flame className="h-2.5 w-2.5" /> {r.today_count} today
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 w-full bg-destructive/10 rounded mt-1 overflow-hidden">
                      <div className="h-full bg-destructive/50 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums text-destructive">
                      {r.total_count}
                      <span className="text-xs text-muted-foreground font-normal">/{TARGET_PER_COUNSELLOR}</span>
                    </div>
                    {!streak && r.today_count > 0 && (
                      <div className="text-[10px] text-muted-foreground">+{r.today_count} today</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
