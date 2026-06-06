import { digits, type WhatsAppProvider } from "./whatsapp-channel.ts";

export type WhatsAppInboundEventKind = "inbound_message" | "status_update" | "unknown";
export type WhatsAppInboundProcessingStatus = "received" | "linked" | "skipped" | "error";

export interface WhatsAppInboundEventPatch {
  provider: WhatsAppProvider;
  providerEventId?: string | null;
  phone?: string | null;
  businessNumber?: string | null;
  leadId?: string | null;
  messageId?: string | null;
  eventKind?: WhatsAppInboundEventKind;
  messageType?: string | null;
  content?: string | null;
  mediaCount?: number;
  rawPayload?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  processingStatus?: WhatsAppInboundProcessingStatus;
  skipReason?: string | null;
}

interface SupabaseLike {
  from: (table: string) => any;
}

function preview(content: string | null | undefined): string | null {
  const trimmed = (content || "").trim();
  return trimmed ? trimmed.slice(0, 300) : null;
}

export async function recordWhatsAppInboundEvent(
  admin: SupabaseLike,
  patch: WhatsAppInboundEventPatch,
): Promise<string | null> {
  const providerEventId = patch.providerEventId || crypto.randomUUID();
  const { data, error } = await admin
    .from("whatsapp_inbound_events")
    .upsert({
      provider: patch.provider,
      provider_event_id: providerEventId,
      phone: patch.phone ? digits(patch.phone) : null,
      business_number: patch.businessNumber ? digits(patch.businessNumber) || patch.businessNumber : null,
      lead_id: patch.leadId || null,
      message_id: patch.messageId || null,
      event_kind: patch.eventKind || "inbound_message",
      message_type: patch.messageType || null,
      content_preview: preview(patch.content),
      media_count: patch.mediaCount || 0,
      raw_payload: patch.rawPayload || {},
      normalized: patch.normalized || {},
      processing_status: patch.processingStatus || "received",
      skip_reason: patch.skipReason || null,
      processed_at: patch.processingStatus && patch.processingStatus !== "received"
        ? new Date().toISOString()
        : null,
    }, { onConflict: "provider,provider_event_id" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("whatsapp_inbound_events upsert failed:", error.message);
    return null;
  }
  return data?.id || null;
}

export async function markWhatsAppInboundEvent(
  admin: SupabaseLike,
  eventId: string | null | undefined,
  patch: {
    leadId?: string | null;
    messageId?: string | null;
    processingStatus: WhatsAppInboundProcessingStatus;
    skipReason?: string | null;
    normalized?: Record<string, unknown>;
  },
): Promise<void> {
  if (!eventId) return;

  const updates: Record<string, unknown> = {
    processing_status: patch.processingStatus,
    processed_at: new Date().toISOString(),
  };
  if ("leadId" in patch) updates.lead_id = patch.leadId || null;
  if ("messageId" in patch) updates.message_id = patch.messageId || null;
  if ("skipReason" in patch) updates.skip_reason = patch.skipReason || null;
  if (patch.normalized) updates.normalized = patch.normalized;

  const { error } = await admin
    .from("whatsapp_inbound_events")
    .update(updates)
    .eq("id", eventId);

  if (error) console.error("whatsapp_inbound_events update failed:", error.message);
}
