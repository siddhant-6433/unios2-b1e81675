import type { WhatsAppProvider } from "./whatsapp-channel.ts";
import { digits } from "./whatsapp-channel.ts";

export type ConversationMode = "ai" | "human" | "paused" | "closed";
export type ConversationState =
  | "new_unqualified"
  | "awaiting_name"
  | "awaiting_course"
  | "qualified"
  | "answered_by_ai"
  | "needs_counsellor"
  | "human_active"
  | "followup_scheduled"
  | "not_interested"
  | "dnc"
  | "job_handoff"
  | "vendor_handoff"
  | "knowledge_gap";

export interface ConversationStatePatch {
  phone: string;
  businessNumber: string | null;
  provider: WhatsAppProvider;
  leadId?: string | null;
  mode?: ConversationMode;
  state?: ConversationState;
  ownerUserId?: string | null;
  escalationRole?: string | null;
  handoffReason?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  slaDueAt?: string | null;
  lastIntent?: string | null;
  lastConfidence?: number | null;
  lastBotAction?: string | null;
  updatedBy?: string | null;
}

interface SupabaseLike {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => PromiseLike<{ error: { message?: string } | null }>;
  };
}

export function conversationBusinessKey(
  provider: WhatsAppProvider,
  businessPhoneNumberId: string | null | undefined,
  businessNumber: string | null | undefined,
): string | null {
  if (provider === "plivo") return digits(businessNumber || businessPhoneNumberId);
  return businessPhoneNumberId || businessNumber || null;
}

export async function upsertConversationState(
  admin: SupabaseLike,
  patch: ConversationStatePatch,
): Promise<void> {
  const businessNumber = digits(patch.businessNumber || "");
  if (!patch.phone || !businessNumber) return;

  const row: Record<string, unknown> = {
    phone: digits(patch.phone),
    business_number: businessNumber,
    provider: patch.provider,
    updated_at: new Date().toISOString(),
  };

  if (patch.leadId !== undefined) row.lead_id = patch.leadId;
  if (patch.mode !== undefined) row.mode = patch.mode;
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.ownerUserId !== undefined) row.owner_user_id = patch.ownerUserId;
  if (patch.escalationRole !== undefined) row.escalation_role = patch.escalationRole;
  if (patch.handoffReason !== undefined) row.handoff_reason = patch.handoffReason;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.slaDueAt !== undefined) row.sla_due_at = patch.slaDueAt;
  if (patch.lastIntent !== undefined) row.last_intent = patch.lastIntent;
  if (patch.lastConfidence !== undefined) row.last_confidence = patch.lastConfidence;
  if (patch.lastBotAction !== undefined) row.last_bot_action = patch.lastBotAction;
  if (patch.updatedBy !== undefined) row.updated_by = patch.updatedBy;

  const { error } = await admin
    .from("whatsapp_conversation_state")
    .upsert(row, { onConflict: "phone,business_number" });

  if (error) console.error("whatsapp_conversation_state upsert failed:", error.message);
}
