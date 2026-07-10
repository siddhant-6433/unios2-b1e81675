import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Bot, ChevronDown, Play, Sparkles } from "lucide-react";

interface TriggeringCall {
  id: string;
  conversion_probability: number;
  disposition: string | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  created_at: string;
}

interface Props {
  leadId: string;
  compact?: boolean; // true = Cloud Dialer style, false = Lead page style
}

export function PriorityInterestedCard({ leadId, compact = false }: Props) {
  const [call, setCall] = useState<TriggeringCall | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setCall(null);
    setShowTranscript(false);
    (async () => {
      const { data } = await supabase
        .from("ai_call_records" as any)
        .select("id, conversion_probability, disposition, summary, transcript, recording_url, created_at")
        .eq("lead_id", leadId)
        .eq("status", "completed")
        .gte("conversion_probability", 60)
        .order("conversion_probability", { ascending: false })
        .limit(1)
        .single();
      if (data) setCall(data as any);
      setLoading(false);
    })();
  }, [leadId]);

  if (loading || !call) return null;

  const prob = call.conversion_probability;
  const probColor = prob >= 80 ? "text-success" : prob >= 60 ? "text-warning-foreground" : "text-muted-foreground";
  const probBg   = prob >= 80 ? "bg-success/10" : prob >= 60 ? "bg-warning/10" : "bg-muted";
  const dateStr = new Date(call.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

  if (compact) {
    // Cloud Dialer compact version
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5/60 dark:border-primary/50/40 dark:bg-primary/90/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/80/40 shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-[10px] font-bold text-primary dark:text-primary/60 uppercase tracking-wide flex-1">Why Priority Interested</p>
          <Badge className={`text-[9px] border-0 ${probBg} ${probColor}`}>{prob}% conversion</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Bot className="h-2.5 w-2.5" /> AI call · {dateStr}
          </span>
          {call.disposition && (
            <Badge variant="outline" className="text-[9px] capitalize border-primary/20 text-primary">
              {call.disposition.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {call.summary && (
          <p className="text-[11px] text-foreground/80 leading-snug italic">"{call.summary}"</p>
        )}

        <div className="flex items-center gap-3">
          {call.recording_url && (
            <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5">
              <Play className="h-2.5 w-2.5" /> Play recording
            </a>
          )}
          {call.transcript && (
            <button onClick={() => setShowTranscript(v => !v)}
              className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5">
              <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showTranscript ? "rotate-180" : ""}`} />
              {showTranscript ? "Hide transcript" : "View transcript"}
            </button>
          )}
        </div>

        {showTranscript && call.transcript && (
          <div className="rounded-lg bg-white/70 dark:bg-card border border-primary/20/60 p-2 text-[10px] text-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed">
            {call.transcript}
          </div>
        )}
      </div>
    );
  }

  // Lead page full version
  return (
    <div className="rounded-xl border-2 border-primary/25 bg-primary/5/50 dark:border-primary/50/50 dark:bg-primary/90/20 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-primary/10/60 dark:bg-primary/80/20 border-b border-primary/20 dark:border-primary/50/40">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs font-bold text-primary dark:text-primary/60 flex-1">Marked Priority Interested by AI</p>
        <Badge className={`text-[10px] border-0 ${probBg} ${probColor} font-semibold`}>{prob}% conversion probability</Badge>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Bot className="h-3 w-3 text-warning-foreground" /> AI call on {dateStr}
          </span>
          {call.disposition && (
            <Badge variant="outline" className="text-[10px] capitalize border-primary/25 text-primary">
              {call.disposition.replace(/_/g, " ")}
            </Badge>
          )}
          {call.recording_url && (
            <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1 ml-auto">
              <Play className="h-3 w-3" /> Play recording
            </a>
          )}
        </div>

        {call.summary && (
          <div className="rounded-lg bg-white/80 dark:bg-card border border-primary/20/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">AI Summary</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{call.summary}</p>
          </div>
        )}

        {call.transcript && (
          <div>
            <button onClick={() => setShowTranscript(v => !v)}
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
              <ChevronDown className={`h-3 w-3 transition-transform ${showTranscript ? "rotate-180" : ""}`} />
              {showTranscript ? "Hide full transcript" : "View full transcript"}
            </button>
            {showTranscript && (
              <div className="mt-2 rounded-lg bg-white/70 dark:bg-card border border-primary/20/60 p-3 text-[11px] text-foreground/70 whitespace-pre-wrap max-h-[320px] overflow-y-auto leading-relaxed">
                {call.transcript}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
