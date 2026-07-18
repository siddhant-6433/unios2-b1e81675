import { digits, type WhatsAppSendResult } from "./whatsapp-channel.ts";
import {
  logWhatsAppAutomationEvent,
  type WhatsAppAutomationEventType,
} from "./whatsapp-automation-events.ts";
import {
  recordWhatsAppOutboundContext,
  type WhatsAppExpectedReplyType,
  type WhatsAppOutboundKind,
  type WhatsAppResponsePolicy,
} from "./whatsapp-outbound-context.ts";
import {
  upsertConversationState,
  type ConversationStatePatch,
} from "./whatsapp-conversation-state.ts";

export type ConversationActionKind =
  | "manualReply"
  | "templateSend"
  | "campaignSend"
  | "aiReply"
  | "dncAcknowledgement"
  | "handoff";

interface SupabaseLike {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error?: { message?: string } | null }>;
}

export interface ManualReplyConversationAction {
  kind: "manualReply";
  phone: string;
  message: string;
  leadId?: string | null;
  userId: string;
  businessNumberFallback?: string | null;
  sendResult: WhatsAppSendResult;
  mediaUrl?: string | null;
  mediaType?: string | null;
}

export interface ConversationActionResult {
  messageId: string | null;
}

export interface OutboundConversationAction {
  kind: Exclude<ConversationActionKind, "manualReply">;
  phone: string;
  leadId?: string | null;
  content: string;
  messageType: "text" | "template";
  templateKey?: string | null;
  status: string;
  isRead?: boolean;
  userId?: string | null;
  sendResult: WhatsAppSendResult;
  statusError?: Record<string, unknown> | null;
  outboundKind: WhatsAppOutboundKind;
  expectedReplyType: WhatsAppExpectedReplyType;
  responsePolicy: WhatsAppResponsePolicy;
  campaignId?: string | null;
  campaignRecipientId?: string | null;
  metadata?: Record<string, unknown>;
  renderMetadata?: Record<string, unknown> | null;
  expiresAt?: string;
  activityDescription?: string | null;
  automationEvent?: {
    eventType: WhatsAppAutomationEventType;
    decision?: string | null;
    reason?: string | null;
    confidence?: number | null;
    metadata?: Record<string, unknown>;
  } | null;
  conversationState?: Omit<ConversationStatePatch, "phone" | "businessNumber" | "provider" | "leadId"> | null;
}

export async function recordOutboundConversationAction(
  admin: SupabaseLike,
  action: OutboundConversationAction,
): Promise<ConversationActionResult> {
  const waPhone = digits(action.phone);
  const sendResult = action.sendResult;
  const businessNumber = sendResult.businessNumber || sendResult.businessPhoneNumberId || null;

  const { data: insertedMessage } = await admin.from("whatsapp_messages").insert({
    lead_id: action.leadId || null,
    wa_message_id: sendResult.messageId,
    direction: "outbound",
    phone: waPhone,
    message_type: action.messageType,
    content: action.content,
    template_key: action.templateKey || null,
    status: action.status,
    is_read: action.isRead ?? true,
    provider: sendResult.provider,
    business_phone_number_id: sendResult.businessPhoneNumberId,
    business_phone_number: sendResult.businessNumber,
    status_error: action.statusError || null,
    render_metadata: action.renderMetadata || null,
    sender_user_id: action.userId || null,
  }).select("id").maybeSingle();

  await recordWhatsAppOutboundContext(admin, {
    messageId: insertedMessage?.id || null,
    providerMessageId: sendResult.messageId,
    phone: waPhone,
    businessNumber,
    provider: sendResult.provider,
    leadId: action.leadId || null,
    campaignId: action.campaignId || undefined,
    campaignRecipientId: action.campaignRecipientId || undefined,
    templateKey: action.templateKey || undefined,
    outboundKind: action.outboundKind,
    expectedReplyType: action.expectedReplyType,
    responsePolicy: action.responsePolicy,
    metadata: { ...(action.metadata || {}), action_kind: action.kind },
    expiresAt: action.expiresAt,
  });

  if (action.activityDescription && action.leadId) {
    await admin.from("lead_activities").insert({
      lead_id: action.leadId,
      user_id: action.userId || null,
      type: "whatsapp",
      description: action.activityDescription,
    });
  }

  if (action.automationEvent) {
    await logWhatsAppAutomationEvent(admin, {
      phone: waPhone,
      businessNumber,
      provider: sendResult.provider,
      leadId: action.leadId || null,
      eventType: action.automationEvent.eventType,
      decision: action.automationEvent.decision,
      reason: action.automationEvent.reason,
      confidence: action.automationEvent.confidence ?? undefined,
      metadata: { ...(action.automationEvent.metadata || {}), action_kind: action.kind },
    });
  }

  if (action.conversationState) {
    await upsertConversationState(admin, {
      phone: waPhone,
      businessNumber,
      provider: sendResult.provider,
      leadId: action.leadId || null,
      ...action.conversationState,
    });
  }

  return { messageId: insertedMessage?.id || null };
}

export async function recordManualReplyConversationAction(
  admin: SupabaseLike,
  action: ManualReplyConversationAction,
): Promise<ConversationActionResult> {
  const waPhone = digits(action.phone);
  const sendResult = action.sendResult;
  const businessNumber = sendResult.businessNumber || sendResult.businessPhoneNumberId || action.businessNumberFallback || null;

  const { data: insertedMessage } = await admin.from("whatsapp_messages").insert({
    lead_id: action.leadId || null,
    wa_message_id: sendResult.messageId,
    direction: "outbound",
    phone: waPhone,
    message_type: action.mediaType || "text",
    content: action.message || null,
    media_url: action.mediaUrl || null,
    status: "sent",
    is_read: true,
    provider: sendResult.provider,
    business_phone_number_id: sendResult.businessPhoneNumberId,
    business_phone_number: sendResult.businessNumber,
    template_key: "manual_reply",
    sender_user_id: action.userId,
  }).select("id").maybeSingle();

  await admin.rpc("mark_whatsapp_conversation_read", {
    p_phone: waPhone,
    p_provider: sendResult.provider,
    p_business_phone_number_id: sendResult.businessPhoneNumberId,
    p_business_phone_number: sendResult.businessNumber,
  }).then(({ error }) => {
    if (error) console.error("mark_whatsapp_conversation_read failed:", error.message);
  });

  await recordWhatsAppOutboundContext(admin, {
    messageId: insertedMessage?.id || null,
    providerMessageId: sendResult.messageId,
    phone: waPhone,
    businessNumber,
    provider: sendResult.provider,
    leadId: action.leadId || null,
    templateKey: "manual_reply",
    outboundKind: "manual_reply",
    expectedReplyType: "general",
    responsePolicy: "human",
    metadata: { user_id: action.userId, action_kind: action.kind },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  await logWhatsAppAutomationEvent(admin, {
    phone: waPhone,
    businessNumber,
    provider: sendResult.provider,
    leadId: action.leadId || null,
    eventType: "handoff_created",
    decision: "manual_reply_sent",
    reason: "counsellor_reply",
    metadata: { message_id: sendResult.messageId, user_id: action.userId, action_kind: action.kind },
  });

  if (action.leadId) {
    await admin.from("lead_activities").insert({
      lead_id: action.leadId,
      user_id: action.userId,
      type: "whatsapp",
      description: `WhatsApp reply: ${action.message.substring(0, 100)}`,
    });
  }

  if (businessNumber) {
    await admin
      .from("whatsapp_ai_mode")
      .upsert(
        {
          phone: waPhone,
          business_number: businessNumber,
          mode: "human",
          updated_at: new Date().toISOString(),
          updated_by: action.userId,
        },
        { onConflict: "phone,business_number" },
      );

    await upsertConversationState(admin, {
      phone: waPhone,
      businessNumber,
      provider: sendResult.provider,
      leadId: action.leadId || null,
      mode: "human",
      state: "human_active",
      ownerUserId: action.userId,
      handoffReason: "manual_reply",
      updatedBy: action.userId,
    });
  }

  return { messageId: insertedMessage?.id || null };
}
