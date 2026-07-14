import { digits, type WhatsAppProvider } from "./whatsapp-channel.ts";

export type WhatsAppAutomationEventType =
  | "inbound_received"
  | "lead_created"
  | "lead_linked"
  | "classified_admission"
  | "classified_job"
  | "classified_vendor"
  | "inbound_reply_to_outbound"
  | "ai_reply_requested"
  | "ai_reply_sent"
  | "human_mode_skip"
  | "handoff_created"
  | "send_failed"
  | "dnc_marked"
  | "knowledge_gap_logged";

export interface WhatsAppAutomationEvent {
  phone: string;
  businessNumber?: string | null;
  provider?: WhatsAppProvider | null;
  leadId?: string | null;
  messageId?: string | null;
  eventType: WhatsAppAutomationEventType;
  decision?: string | null;
  reason?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

interface SupabaseLike {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
  };
}

export async function logWhatsAppAutomationEvent(
  admin: SupabaseLike,
  event: WhatsAppAutomationEvent,
): Promise<void> {
  if (!event.phone || !event.eventType) return;

  const { error } = await admin.from("whatsapp_automation_events").insert({
    phone: digits(event.phone),
    business_number: event.businessNumber ? digits(event.businessNumber) || event.businessNumber : null,
    provider: event.provider || null,
    lead_id: event.leadId || null,
    message_id: event.messageId || null,
    event_type: event.eventType,
    decision: event.decision || null,
    reason: event.reason || null,
    confidence: event.confidence ?? null,
    metadata: event.metadata || {},
  });

  if (error) console.error("whatsapp_automation_events insert failed:", error.message);
}
