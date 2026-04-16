import { useNavigate } from "react-router-dom";
import { Phone, MessageSquare, ChevronRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionLead } from "@/hooks/useActionCenter";

export type BucketVariant =
  | "overdue"
  | "new_lead"
  | "today_followup"
  | "today_visit"
  | "post_visit"
  | "stalled"
  | "upcoming";

interface ActionLeadRowProps {
  lead: ActionLead;
  variant: BucketVariant;
  onCall?: (lead: ActionLead) => void;
  onCompleteVisit?: (lead: ActionLead) => void;
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function ContextBadge({ lead, variant }: { lead: ActionLead; variant: BucketVariant }) {
  switch (variant) {
    case "overdue": {
      const days = lead.days_overdue || 0;
      const label = days === 0 ? "< 1d overdue" : `${days}d overdue`;
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
          {lead.followup_type === "call" ? "Call" : lead.followup_type || "Follow-up"} · {label}
        </span>
      );
    }
    case "new_lead":
      return (
        <span className="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
          Assigned {lead.assigned_ago}
        </span>
      );
    case "today_followup":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
          {formatTime(lead.scheduled_at)} · {lead.followup_type === "call" ? "Call" : lead.followup_type || "Follow-up"}
        </span>
      );
    case "today_visit":
      return (
        <span className="inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
          {formatTime(lead.visit_date)} · {lead.visit_campus || "Campus visit"}
        </span>
      );
    case "post_visit":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          Visited {lead.days_since_visit}d ago, no follow-up
        </span>
      );
    case "stalled": {
      const days = lead.days_inactive || 0;
      return (
        <span className="inline-flex items-center rounded-full bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
          {lead.app_completion_pct != null ? `App ${lead.app_completion_pct}% · ` : ""}Last activity {days}d ago
        </span>
      );
    }
    case "upcoming": {
      const dateStr = lead.scheduled_at || lead.visit_date;
      const isVisit = !!lead.visit_date && !lead.scheduled_at;
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300">
          {formatDate(dateStr)} {formatTime(dateStr)} · {isVisit ? "Visit" : lead.followup_type || "Follow-up"}
        </span>
      );
    }
    default:
      return null;
  }
}

export function ActionLeadRow({ lead, variant, onCall, onCompleteVisit }: ActionLeadRowProps) {
  const navigate = useNavigate();

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    const phone = lead.phone.replace(/\D/g, "");
    const formatted = phone.startsWith("91") ? phone : `91${phone}`;
    window.open(`https://wa.me/${formatted}`, "_blank");
  };

  const handleCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCall?.(lead);
  };

  const handleCompleteVisit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCompleteVisit?.(lead);
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors border-b border-border/40 last:border-0"
      onClick={() => navigate(`/admissions/${lead.lead_id}`)}
    >
      {/* Left: Name + phone, course + source */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{lead.name}</span>
          <ContextBadge lead={lead} variant={variant} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{lead.phone}</span>
          {lead.course_name && lead.course_name !== "—" && (
            <>
              <span className="text-border">·</span>
              <span className="truncate">{lead.course_name}</span>
            </>
          )}
          {lead.source && (
            <>
              <span className="text-border">·</span>
              <span className="capitalize">{lead.source.replace(/_/g, " ")}</span>
            </>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={handleCall} title="Log call">
          <Phone className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-green-600" onClick={handleWhatsApp} title="WhatsApp">
          <MessageSquare className="h-4 w-4" />
        </Button>
        {variant === "today_visit" && onCompleteVisit && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-violet-600" onClick={handleCompleteVisit} title="Complete visit">
            <CheckCircle className="h-4 w-4" />
          </Button>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
      </div>
    </div>
  );
}
