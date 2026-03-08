import { Card, CardContent } from "@/components/ui/card";
import { Bot, Mic, FileText } from "lucide-react";

interface AiCallSummaryProps {
  callLog: {
    disposition?: string | null;
    duration_seconds?: number | null;
    notes?: string | null;
    called_at?: string;
    recording_url?: string | null;
  } | null;
}

export function AiCallSummary({ callLog }: AiCallSummaryProps) {
  if (!callLog) return null;

  const duration = callLog.duration_seconds
    ? `${Math.floor(callLog.duration_seconds / 60)}m ${callLog.duration_seconds % 60}s`
    : null;

  // Extract conversion probability from notes if present (pattern: "Conversion probability: XX%")
  const probMatch = callLog.notes?.match(/conversion probability[:\s]*(\d+)%/i);
  const conversionProb = probMatch ? parseInt(probMatch[1]) : null;

  return (
    <Card className="border-2 border-amber-300 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40 shrink-0">
            <Bot className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-foreground">AI Call Summary</h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-800/50 dark:text-amber-300">
                {callLog.called_at
                  ? new Date(callLog.called_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) === new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                    ? "Today"
                    : new Date(callLog.called_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                  : "Recent"}
              </span>
            </div>

            {/* Meta row */}
            <p className="text-xs text-muted-foreground mt-1.5">
              {callLog.disposition && <>Disposition: <span className="font-medium text-foreground">{callLog.disposition}</span></>}
              {callLog.disposition && duration && <> · </>}
              {duration && <>Duration: <span className="font-medium text-foreground">{duration}</span></>}
            </p>

            {/* Summary text */}
            {callLog.notes && (
              <p className="text-sm text-foreground/80 mt-3 leading-relaxed">{callLog.notes}</p>
            )}

            {/* Conversion probability */}
            {conversionProb != null && (
              <p className="text-sm mt-3">
                Conversion probability:{" "}
                <span className={`font-bold ${
                  conversionProb >= 70 ? "text-green-600 dark:text-green-400"
                  : conversionProb >= 40 ? "text-amber-600 dark:text-amber-400"
                  : "text-red-500 dark:text-red-400"
                }`}>
                  {conversionProb}%
                </span>
              </p>
            )}

            {/* Action links */}
            <div className="flex items-center gap-4 mt-3">
              {callLog.recording_url && (
                <a href={callLog.recording_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                  <Mic className="h-3.5 w-3.5" /> Listen to recording
                </a>
              )}
              {callLog.notes && (
                <button className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Full transcript
                </button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
