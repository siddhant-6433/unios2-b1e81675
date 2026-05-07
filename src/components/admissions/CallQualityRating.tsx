/**
 * Inline 1-5 star rating + notes for an AI call.
 *
 * Calls the `set_call_quality_score` RPC (migration 20260606150000)
 * which captures who rated and when. Use on any list view that shows
 * AI calls — AiCallLog row, lead-detail timeline entry, etc.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star } from "lucide-react";

interface Props {
  callLogId: string;
  initialScore?: number | null;
  initialNotes?: string | null;
  onRated?: (score: number) => void;
  /** Compact mode — just the stars, no notes input. */
  compact?: boolean;
}

export function CallQualityRating({
  callLogId,
  initialScore = null,
  initialNotes = null,
  onRated,
  compact = false,
}: Props) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [hoverScore, setHoverScore] = useState<number | null>(null);
  const [notes, setNotes] = useState(initialNotes || "");
  const [saving, setSaving] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const display = hoverScore ?? score ?? 0;

  const persist = async (newScore: number, newNotes?: string) => {
    setSaving(true);
    const { error } = await supabase.rpc("set_call_quality_score" as any, {
      _call_log_id: callLogId,
      _score: newScore,
      _notes: newNotes ?? notes ?? null,
    });
    setSaving(false);
    if (error) {
      console.error("set_call_quality_score failed:", error.message);
      return;
    }
    setScore(newScore);
    onRated?.(newScore);
  };

  const onClickStar = async (n: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (saving) return;
    await persist(n);
  };

  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-flex flex-col gap-1">
      <div className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={saving}
            onClick={(e) => onClickStar(n, e)}
            onMouseEnter={() => setHoverScore(n)}
            onMouseLeave={() => setHoverScore(null)}
            className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
            title={["Bad", "Below avg", "OK", "Good", "Excellent"][n - 1]}
          >
            <Star
              className={`h-4 w-4 ${
                n <= display
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40"
              }`}
            />
          </button>
        ))}
        {!compact && score != null && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowNotes(!showNotes); }}
            className="ml-1 text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            {showNotes ? "hide" : notes ? "edit notes" : "add notes"}
          </button>
        )}
      </div>
      {!compact && showNotes && (
        <div className="flex items-center gap-1">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => score != null && notes !== (initialNotes || "") && persist(score, notes)}
            placeholder="What was good/bad?"
            className="flex-1 text-xs bg-background border border-input rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Read-only metric chip showing the auto-computed quality_metrics
 * inline. Compact format suitable for table cells.
 */
export function CallQualityMetricsChip({ metrics }: { metrics: Record<string, any> | null }) {
  if (!metrics) return <span className="text-[10px] text-muted-foreground">—</span>;
  const ttfa = metrics.time_to_first_audio_ms;
  const latency = metrics.mean_turn_latency_ms;
  const reps = metrics.repetition_count || 0;
  const swaps = metrics.voice_switch_count || 0;
  const dispOk = metrics.disposition_set === true;
  const turns = metrics.total_turns || 0;
  return (
    <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
      <span>{turns} turns · {latency != null ? `${(latency / 1000).toFixed(1)}s lat` : "—"}</span>
      <span className="flex gap-1.5">
        {reps > 0 && <span className="text-amber-600">↻{reps}</span>}
        {swaps > 0 && <span className="text-red-600">≠{swaps}</span>}
        {!dispOk && <span className="text-red-600">no disp</span>}
        {ttfa != null && <span>{(ttfa / 1000).toFixed(1)}s start</span>}
      </span>
    </div>
  );
}
