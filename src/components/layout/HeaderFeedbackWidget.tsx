import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface FeedbackRow {
  counsellor_id: string;
  counsellor_name: string | null;
  total_responses: number | null;
  avg_rating: number | null;
  five_star: number | null;
  four_star: number | null;
  low_rating: number | null;
  pending: number | null;
}

const SHOWN_ROLES = ["super_admin", "admission_head", "campus_admin", "principal", "counsellor"];

function weightedAverage(rows: FeedbackRow[]): string {
  const totalResponses = rows.reduce((sum, row) => sum + Number(row.total_responses || 0), 0);
  if (totalResponses === 0) return "—";

  const weighted = rows.reduce((sum, row) => {
    return sum + Number(row.avg_rating || 0) * Number(row.total_responses || 0);
  }, 0);

  return (weighted / totalResponses).toFixed(1);
}

export function HeaderFeedbackWidget() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const canShow = Boolean(role && SHOWN_ROLES.includes(role));
  const isCounsellor = role === "counsellor";

  const fetchFeedback = useCallback(async () => {
    if (!canShow) return;

    const { data } = await supabase
      .from("counsellor_feedback_summary")
      .select("*");

    const nextRows = ((data || []) as FeedbackRow[])
      .filter((row) => !isCounsellor || row.counsellor_id === profile?.id)
      .sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0));

    setRows(nextRows);
    setLoaded(true);
  }, [canShow, isCounsellor, profile?.id]);

  useEffect(() => {
    if (!canShow || (isCounsellor && !profile?.id)) return;

    fetchFeedback();

    const channel = supabase
      .channel("header-feedback")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "feedback_responses",
      }, () => fetchFeedback())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [canShow, fetchFeedback, isCounsellor, profile?.id]);

  const summary = useMemo(() => {
    const totalResponses = rows.reduce((sum, row) => sum + Number(row.total_responses || 0), 0);
    const lowRatings = rows.reduce((sum, row) => sum + Number(row.low_rating || 0), 0);
    const pending = rows.reduce((sum, row) => sum + Number(row.pending || 0), 0);
    return {
      avg: weightedAverage(rows),
      totalResponses,
      lowRatings,
      pending,
    };
  }, [rows]);

  if (!canShow || !loaded || summary.totalResponses === 0) return null;

  const isLow = summary.avg !== "—" && Number(summary.avg) <= 2;
  const isStrong = summary.avg !== "—" && Number(summary.avg) >= 4;
  const label = isCounsellor ? "Your feedback" : "Team feedback";
  const detailPath = isCounsellor ? "/counsellor-dashboard" : "/admission-analytics";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => navigate(detailPath)}
          className={`hidden md:flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors ${
            isLow
              ? "border-destructive/25/60 bg-destructive/5 text-destructive hover:bg-destructive/10 dark:bg-destructive/90/30 dark:text-destructive/80"
              : isStrong
              ? "border-success/30/60 bg-success/5 text-success hover:bg-success/10 dark:bg-success/90/30 dark:text-success"
              : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted"
          }`}
          aria-label={`${label}: ${summary.avg} out of 5 from ${summary.totalResponses} responses`}
        >
          <Star className={`h-3.5 w-3.5 shrink-0 ${isStrong ? "fill-current" : ""}`} />
          <span className="hidden xl:inline font-medium">Feedback</span>
          <span className="font-bold tabular-nums">{summary.avg}</span>
          <span className="text-muted-foreground tabular-nums">({summary.totalResponses})</span>
          {summary.lowRatings > 0 && (
            <span className="rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-bold text-destructive">
              {summary.lowRatings} low
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-72 text-xs">
        <p className="font-semibold mb-1">{label}</p>
        <div className="space-y-0.5">
          <p>Average rating: <strong>{summary.avg}/5</strong></p>
          <p>Responses: <strong>{summary.totalResponses}</strong></p>
          {summary.pending > 0 && <p>Pending requests: <strong>{summary.pending}</strong></p>}
          {summary.lowRatings > 0 && <p className="text-destructive">Low ratings: <strong>{summary.lowRatings}</strong></p>}
        </div>
        {!isCounsellor && rows.length > 0 && (
          <div className="mt-2 border-t border-border/60 pt-2 space-y-1">
            {rows.slice(0, 3).map((row) => (
              <div key={row.counsellor_id} className="flex items-center justify-between gap-3">
                <span className="truncate text-muted-foreground">{row.counsellor_name || "Unknown"}</span>
                <span className="font-semibold tabular-nums">{row.avg_rating ?? "—"}/5</span>
              </div>
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
