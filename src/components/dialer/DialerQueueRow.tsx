import { CheckCircle, MessageCircle, Mail, Calendar, RotateCcw } from "lucide-react";
import type { QueueLead } from "@/lib/dialerQueue";

const BUCKET_EDGE: Record<string, string> = {
  "Pinned": "bg-foreground",
  "Call List": "bg-primary",
  "Interested & Hot": "bg-destructive/70",
  "Priority Interested": "bg-primary",
  "Missed Callback": "bg-destructive",
  "Post-Visit": "bg-warning",
  "Visit Checkin": "bg-primary/50",
  "Overdue": "bg-destructive/60",
  "Today": "bg-info",
  "New Lead": "bg-warning/70",
};

interface Props {
  lead: QueueLead;
  state: "done" | "current" | "pending";
  /** Minutes until the SLA cron reclaims this lead; null when not applicable. */
  reclaimMins: number | null;
  onClick: () => void;
  disabled: boolean;
}

/**
 * One queue row. Two lines: name, then course · last-4. The bucket is a
 * coloured left edge rather than a badge — badges pushed every row to three
 * lines and the colour already carries the meaning.
 */
export function DialerQueueRow({ lead, state, reclaimMins, onClick, disabled }: Props) {
  const FollowupIcon = lead.followup_type === "whatsapp" ? MessageCircle
    : lead.followup_type === "email" ? Mail
    : lead.followup_type === "visit" ? Calendar
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${lead.name} · ${lead.bucket}${lead.course_name !== "—" ? ` · ${lead.course_name}` : ""}`}
      className={`relative w-full text-left pl-3 pr-2.5 py-2 border-b border-border/40 transition-colors disabled:cursor-default ${
        state === "current" ? "bg-cyan-50 dark:bg-cyan-950/20"
          : state === "done" ? "opacity-45 hover:opacity-70"
          : "hover:bg-muted/50"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${BUCKET_EDGE[lead.bucket] || "bg-muted-foreground/30"}`} />
      <div className="flex items-center gap-1.5">
        <span className={`flex-1 truncate text-[13px] leading-tight ${state === "current" ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
          {lead.name}
        </span>
        {FollowupIcon && <FollowupIcon className="h-3 w-3 shrink-0 text-muted-foreground" />}
        {lead.attempt_count > 0 && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{lead.attempt_count}x</span>
        )}
        {state === "done" && <CheckCircle className="h-3 w-3 shrink-0 text-success" />}
      </div>
      <div className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
        <span className="truncate">{lead.course_name}</span>
        <span className="shrink-0 tabular-nums">· ••{lead.phone.slice(-4)}</span>
        {reclaimMins !== null && reclaimMins <= 30 && (
          <span className={`ml-auto inline-flex shrink-0 items-center gap-0.5 font-medium ${
            reclaimMins <= 0 ? "text-destructive animate-pulse" : "text-destructive"
          }`}>
            <RotateCcw className="h-2.5 w-2.5" />
            {reclaimMins <= 0 ? "now" : `${reclaimMins}m`}
          </span>
        )}
      </div>
    </button>
  );
}
