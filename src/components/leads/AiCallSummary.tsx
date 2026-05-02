import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  call_type: string | null;
  created_at: string;
}

interface AiCallSummaryProps {
  leadId: string;
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
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <div className="px-3 py-1.5 bg-muted/30 border-b border-border/40">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Bot className="h-3 w-3" /> Call Records ({calls.length})
        </p>
      </div>
      <div className="divide-y divide-border/30">
        {visibleCalls.map(call => {
          const isExpanded = expandedId === call.id;
          const dur = call.duration_seconds;
          const durLabel = dur ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}` : null;
          const dt = new Date(call.created_at);
          const dateLabel = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
          const timeLabel = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
          const prob = call.conversion_probability;
          const isManual = call.call_type === "manual";

          return (
            <div key={call.id} className="px-3 py-2">
              {/* Single compact row */}
              <div className="flex items-center gap-2 flex-wrap">
                {isManual
                  ? <Phone className="h-3 w-3 text-cyan-600 shrink-0" />
                  : <Bot className="h-3 w-3 text-amber-600 shrink-0" />
                }
                <span className="text-[10px] text-muted-foreground">{dateLabel} {timeLabel}</span>
                {durLabel && <span className="text-[10px] text-muted-foreground">{durLabel}</span>}
                {prob != null && (
                  <Badge className={`text-[9px] border-0 ${prob >= 70 ? "bg-emerald-100 text-emerald-700" : prob >= 40 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                    {prob}%
                  </Badge>
                )}
                {call.disposition && (
                  <Badge variant="outline" className="text-[9px] capitalize">{call.disposition.replace(/_/g, " ")}</Badge>
                )}
                <Badge className={`text-[9px] border-0 ${call.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                  {call.status}
                </Badge>
                <div className="flex items-center gap-2 ml-auto shrink-0">
                  {call.recording_url && (
                    <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5">
                      <Play className="h-2.5 w-2.5" /> Play
                    </a>
                  )}
                  {call.transcript && (
                    <button onClick={() => setExpandedId(isExpanded ? null : call.id)}
                      className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5">
                      <FileText className="h-2.5 w-2.5" /> {isExpanded ? "Hide" : "Transcript"}
                      <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
              </div>
              {/* Summary — single line clamp */}
              {call.summary && (
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-snug">{call.summary}</p>
              )}
              {/* Transcript */}
              {isExpanded && call.transcript && (
                <div className="mt-1.5 rounded-lg bg-muted/50 p-2 text-[10px] text-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto border border-border/40">
                  {call.transcript}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {calls.length > 3 && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full text-center py-1.5 text-[10px] font-medium text-primary hover:underline border-t border-border/30 bg-muted/20">
          {showAll ? "Show less" : `View ${calls.length - 3} more`}
        </button>
      )}
    </div>
  );
}
