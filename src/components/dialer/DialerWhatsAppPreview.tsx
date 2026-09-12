import { MessageCircle } from "lucide-react";
import { formatWhatsAppPreview, useLeadWhatsAppPreview } from "@/hooks/useLeadWhatsAppPreview";
import type { QueueLead } from "@/lib/dialerQueue";

interface Props {
  lead: QueueLead;
  onOpenWhatsApp: () => void;
}

/**
 * Last few WhatsApp turns for the lead on screen. Fetched only for this lead
 * (not the queue) so the dialer does not pay a WhatsApp lookup per row.
 */
export function DialerWhatsAppPreview({ lead, onOpenWhatsApp }: Props) {
  const { data: messages = [], isLoading } = useLeadWhatsAppPreview({
    leadId: lead.kind === "contact" ? null : lead.id,
    phone: lead.phone,
    enabled: true,
  });

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-5 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <MessageCircle className="h-3 w-3 text-success" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent WhatsApp</span>
        <button
          type="button"
          onClick={onOpenWhatsApp}
          className="ml-auto text-[10px] font-medium text-primary hover:underline"
        >
          Open thread
        </button>
      </div>
      {isLoading && messages.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Checking conversation…</p>
      ) : messages.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No WhatsApp on this lead yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {messages.map((m) => (
            <li key={m.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-medium uppercase ${
                m.direction === "inbound"
                  ? "bg-info/10 text-info-foreground"
                  : "bg-success/10 text-success"
              }`}>
                {m.direction === "inbound" ? "In" : "Out"}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{formatWhatsAppPreview(m)}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                {new Date(m.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
