import { digits, type WhatsAppProvider } from "./whatsapp-channel.ts";

export type WhatsAppOutboundKind =
  | "manual_reply"
  | "ai_reply"
  | "auto_reply"
  | "template"
  | "bulk_campaign"
  | "system_notification";

export type WhatsAppExpectedReplyType =
  | "general"
  | "admission_query"
  | "callback_request"
  | "course_interest"
  | "feedback"
  | "payment"
  | "application"
  | "do_not_reply";

export type WhatsAppResponsePolicy = "engine" | "human" | "suppress";

export interface OutboundContextPatch {
  messageId?: string | null;
  providerMessageId?: string | null;
  phone: string;
  businessNumber?: string | null;
  provider?: WhatsAppProvider | null;
  leadId?: string | null;
  campaignId?: string | null;
  campaignRecipientId?: string | null;
  templateKey?: string | null;
  outboundKind: WhatsAppOutboundKind;
  expectedReplyType?: WhatsAppExpectedReplyType;
  responsePolicy?: WhatsAppResponsePolicy;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

interface SupabaseLike {
  from: (table: string) => any;
}

export function expectedReplyTypeForTemplate(templateKey: string | null | undefined): WhatsAppExpectedReplyType {
  if (!templateKey) return "general";
  if (templateKey.includes("feedback")) return "feedback";
  if (templateKey.includes("payment") || templateKey.includes("fee") || templateKey.includes("receipt")) return "payment";
  if (templateKey.includes("application") || templateKey.includes("apply") || templateKey.includes("offer")) return "application";
  if (templateKey.includes("course")) return "course_interest";
  if (templateKey.includes("missed_call") || templateKey.includes("callback") || templateKey.includes("followup")) return "callback_request";
  if (templateKey.includes("welcome") || templateKey.includes("lead")) return "admission_query";
  return "general";
}

export function responsePolicyForTemplate(templateKey: string | null | undefined): WhatsAppResponsePolicy {
  if (!templateKey) return "engine";
  if (templateKey.includes("counsellor_") || templateKey.includes("staff_") || templateKey.includes("student_")) return "suppress";
  if (templateKey.includes("feedback")) return "human";
  return "engine";
}

export async function recordWhatsAppOutboundContext(
  admin: SupabaseLike,
  patch: OutboundContextPatch,
): Promise<void> {
  if (!patch.phone || !patch.outboundKind) return;

  const businessNumber = digits(patch.businessNumber || "");
  const { error } = await admin.from("whatsapp_outbound_context").insert({
    message_id: patch.messageId || null,
    provider_message_id: patch.providerMessageId || null,
    phone: digits(patch.phone),
    business_number: businessNumber || patch.businessNumber || null,
    provider: patch.provider || null,
    lead_id: patch.leadId || null,
    campaign_id: patch.campaignId || null,
    campaign_recipient_id: patch.campaignRecipientId || null,
    template_key: patch.templateKey || null,
    outbound_kind: patch.outboundKind,
    expected_reply_type: patch.expectedReplyType || expectedReplyTypeForTemplate(patch.templateKey),
    response_policy: patch.responsePolicy || responsePolicyForTemplate(patch.templateKey),
    metadata: patch.metadata || {},
    expires_at: patch.expiresAt || null,
  });

  if (error) console.error("whatsapp_outbound_context insert failed:", error.message);
}

export async function loadLatestOutboundContext(
  admin: SupabaseLike,
  phone: string,
  businessNumber: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  const normalizedPhone = digits(phone);
  if (!normalizedPhone) return null;

  let query = admin
    .from("whatsapp_outbound_context")
    .select("id,message_id,provider_message_id,phone,business_number,provider,lead_id,campaign_id,campaign_recipient_id,template_key,outbound_kind,expected_reply_type,response_policy,metadata,expires_at,created_at")
    .eq("phone", normalizedPhone);

  const normalizedBusiness = digits(businessNumber || "");
  if (normalizedBusiness) query = query.eq("business_number", normalizedBusiness);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("whatsapp_outbound_context lookup failed:", error.message);
    return null;
  }
  const expiresAt = typeof data?.expires_at === "string" ? new Date(data.expires_at).getTime() : null;
  if (expiresAt && expiresAt < Date.now()) return null;
  return data as Record<string, unknown> | null;
}
