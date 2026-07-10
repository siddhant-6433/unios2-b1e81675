import { useState, useEffect } from "react";
import { Trophy, TrendingUp, TrendingDown, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ScoreData {
  total_score: number;
  weekly_score: number;
  monthly_score: number;
  daily_score: number;
  positive_actions: number;
  negative_actions: number;
}

export function CounsellorScoreBadge() {
  const { profile, role } = useAuth();
  const [score, setScore] = useState<ScoreData | null>(null);

  useEffect(() => {
    if (!profile?.id || role !== "counsellor") return;
    (async () => {
      const { data: allData } = await supabase.rpc("get_counsellor_leaderboard" as any);
      const data = (allData || []).find((r: any) => r.counsellor_id === profile.id);
      if (data) setScore(data as any);
    })();

    // Listen for score changes
    const channel = supabase
      .channel("score-badge")
      .on("postgres_changes" as any, {
        event: "INSERT",
        schema: "public",
        table: "counsellor_score_events",
        filter: `counsellor_id=eq.${profile.id}`,
      }, () => {
        // Refetch score
        supabase.rpc("get_counsellor_leaderboard" as any)
          .then(({ data: allData }: any) => {
            const found = (allData || []).find((r: any) => r.counsellor_id === profile.id);
            if (found) setScore(found as any);
          });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, role]);

  if (!score || role !== "counsellor") return null;

  const isHot = score.daily_score >= 20;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
        score.weekly_score >= 50 ? "bg-warning/10 dark:bg-warning/80/30" : "bg-muted"
      }`}>
        {isHot ? (
          <Flame className="h-4.5 w-4.5 text-warning" />
        ) : (
          <Trophy className={`h-4.5 w-4.5 ${score.weekly_score >= 50 ? "text-warning" : "text-muted-foreground"}`} />
        )}
      </div>
      <div>
        <div className="flex items-center gap-2">
          {score.daily_score !== 0 && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              score.daily_score > 0
                ? "bg-success/10 dark:bg-success/80/30 text-success dark:text-success/60"
                : "bg-destructive/10 dark:bg-destructive/80/30 text-destructive dark:text-destructive/60"
            }`}>
              <TrendingUp className="h-2.5 w-2.5" />
              Today: {score.daily_score > 0 ? `+${score.daily_score}` : score.daily_score}
            </span>
          )}
          <span className="text-sm font-bold text-foreground">All-time: {score.total_score}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Weekly: <span className="font-semibold text-foreground">{score.weekly_score}</span></span>
          <span>Monthly: <span className="font-semibold text-foreground">{score.monthly_score}</span></span>
          <span className="text-success">+{score.positive_actions}</span>
          {score.negative_actions > 0 && <span className="text-destructive">-{score.negative_actions}</span>}
        </div>
      </div>
    </div>
  );
}
