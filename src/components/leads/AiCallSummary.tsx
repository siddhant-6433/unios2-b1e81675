import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Play, FileText, ChevronDown, Phone } from "lucide-react";

interface AiCallRecord {
  id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  conversion_probability: number | null;
  disposition: string | null;
  created_at: string;
}

interface AiCallSummaryProps {
  leadId: string;
  /** Legacy fallback — ignored if ai_call_records exist */
  callLog?: any;
  lead?: any;
}

export function AiCallSummary({ leadId }: AiCallSummaryProps) {
  const [calls, setCalls] = useState<AiCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_call_records" as any)
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setCalls(data as any);
      setLoading(false);
    })();
  }, [leadId]);

  if (loading || calls.length === 0) return null;

  const visibleCalls = showAll ? calls : calls.slice(0, 3);

  return (
    <div className="space-y-2">
      {visibleCalls.map((call, idx) => {
        const isExpanded = expandedId === call.id;
        const durationLabel = call.duration_seconds
          ? `${Math.floor(call.duration_seconds / 60)}:${(call.duration_seconds % 60).toString().padStart(2, "0")}`
          : null;
        const isToday = new Date(call.created_at).toDateString() === new Date().toDateString();
        const dateLabel = isToday ? "Today" : new Date(call.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        const timeLabel = new Date(call.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
        const probColor = (call.conversion_probability || 0) >= 70 ? "bg-emerald-100 text-emerald-700"
          : (call.conversion_probability || 0) >= 40 ? "bg-amber-200 text-amber-800"
          : call.conversion_probability ? "bg-red-100 text-red-700" : "";

        return (
          <Card key={call.id} className={`border-2 ${idx === 0 ? ((call as any).call_type === "manual" ? "border-cyan-300 dark:border-cyan-600 bg-cyan-50/50 dark:bg-cyan-950/20" : "border-amber-300 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/20") : "border-border bg-card"} overflow-hidden`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl shrink-0 ${idx === 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-muted"}`}>
                  {(call as any).call_type === "manual"
                    ? <Phone className={`h-4 w-4 ${idx === 0 ? "text-cyan-600" : "text-muted-foreground"}`} />
                    : <Bot className={`h-4 w-4 ${idx === 0 ? "text-amber-600" : "text-muted-foreground"}`} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  {/* Header row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-foreground">{(call as any).call_type === "manual" ? "Cloud Call" : "AI Call"} {calls.length > 1 ? `#${calls.length - idx}` : ""}</h3>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-800/50 dark:text-amber-300">
                      {dateLabel} {timeLabel}
                    </span>
                    {durationLabel && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{durationLabel}</span>
                    )}
                    {call.conversion_probability != null && (
                      <Badge className={`text-[10px] border-0 ${probColor}`}>{call.conversion_probability}% conversion</Badge>
                    )}
                    {call.disposition && (
                      <Badge variant="outline" className="text-[9px] capitalize">{call.disposition.replace(/_/g, " ")}</Badge>
                    )}
                    <Badge className={`text-[9px] border-0 ${call.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                      {call.status}
                    </Badge>
                  </div>

                  {/* Summary */}
                  {call.summary && (
                    <p className="text-sm text-foreground/80 mt-2 leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {call.summary}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {call.recording_url && (
                      <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                        <Play className="h-3.5 w-3.5" /> Listen to recording
                      </a>
                    )}
                    {call.transcript && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : call.id)}
                        className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                      >
                        <FileText className="h-3.5 w-3.5" /> {isExpanded ? "Hide" : "Show"} transcript
                        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                    )}
                    {!call.recording_url && !call.transcript && !call.summary && (
                      <span className="text-[10px] text-muted-foreground">No recording or summary available yet</span>
                    )}
                  </div>

                  {/* Transcript (collapsible) */}
                  {isExpanded && call.transcript && (
                    <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs text-foreground/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto border border-border">
                      {call.transcript}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {!showAll && calls.length > 3 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center py-2 text-xs font-medium text-primary hover:underline"
        >
          View {calls.length - 3} more call{calls.length - 3 > 1 ? "s" : ""}
        </button>
      )}
      {showAll && calls.length > 3 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full text-center py-2 text-xs font-medium text-muted-foreground hover:underline"
        >
          Show less
        </button>
      )}
    </div>
  );
}
