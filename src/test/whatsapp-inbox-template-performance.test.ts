import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const whatsappSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const whatsappReply = readFileSync("supabase/functions/whatsapp-reply/index.ts", "utf8");

describe("WhatsApp inbox template rendering and speed guardrails", () => {
  it("renders course_info_v4 as readable message text instead of a template-key placeholder", () => {
    expect(inbox).toContain("course_info_v4:");
    expect(inbox).toContain("bpt_bmrit_cahet_deadline:");
    expect(inbox).toContain("TEMPLATE_PLACEHOLDER_RE");
    expect(inbox).toContain("getMessageText(m)");
    expect(inbox).not.toContain("Template: {m.template_key}");
    expect(whatsappSend).toContain("course_info_v4:");
    expect(whatsappSend).toContain("Course video: {{6}}");
  });

  it("shows backend sender names for authenticated outbound WhatsApp messages", () => {
    expect(inbox).toContain("sender_user_id");
    expect(inbox).toContain("localSenderNamesByWaId");
    expect(inbox).toContain("localSenderNamesBySignature");
    expect(inbox).toContain("wa_message_id");
    expect(inbox).toContain("getOutboundSenderLabel(m)");
    expect(inbox).toContain('select("user_id, display_name")');
  });

  it("keeps the Plivo admissions channel segregated and discovers Meta channels from data", () => {
    expect(inbox).toContain("detectedInboxChannels");
    expect(inbox).toContain("KNOWN_ADMISSIONS_PHONE_CHANNELS");
    expect(inbox).toContain('provider: "plivo"');
    expect(inbox).toContain("PRIMARY_META_WHATSAPP_NUMBER");
    expect(inbox).toContain("919667691872");
    expect(inbox).toContain("917428499849");
    expect(inbox).not.toContain("9555192129");
    expect(inbox).not.toContain("919555192129");
    expect(inbox).toContain("primaryInboxLabel");
    expect(inbox).toContain('select("business_phone_number_id, business_phone_number, counsellor_id, lead_counsellor_ids")');
    expect(inbox).toContain('from("whatsapp_messages" as any)');
    expect(inbox).toContain("isHrBusinessChannel");
    expect(inbox).toContain("isBusinessPhoneNumberChannel");
    expect(inbox).toContain("conversationMatchesBusinessChannel");
    expect(inbox).toContain("businessChannelVariants");
    expect(inbox).toContain("isKnownAdmissionsPhoneConversation");
    expect(inbox).toContain("matchesActiveBusinessNumber");
    expect(whatsappReply).toContain("sendWhatsAppText");
    expect(whatsappReply).toContain('provider: requestedProvider');
    expect(whatsappReply).toContain('route: requestedProvider === "plivo" ? "plivo_admissions" : "reply"');
    expect(whatsappReply).toContain("businessNumber: requestedBusinessNumber || requestedPhoneNumberId");
    expect(whatsappReply).toContain("sender_user_id: user.id");
  });

  it("does not block first paint by draining every WhatsApp conversation page", () => {
    expect(inbox).toContain("CONVERSATION_PAGE_SIZE = 120");
    expect(inbox).toContain("loadingMoreConversations");
    expect(inbox).toContain("fetchConversationPage(false)");
    expect(inbox).not.toContain("const BATCH = 1000");
    expect(inbox).not.toContain("while (true)");
  });

  it("falls back to raw messages when a selected phone-number inbox has no conversation rows", () => {
    expect(inbox).toContain("fetchMessageBackedConversationRows");
    expect(inbox).toContain('from("whatsapp_messages" as any)');
    expect(inbox).toContain('select("phone, lead_id, direction, content, created_at, provider, business_phone_number_id, business_phone_number, is_read")');
    expect(inbox).toContain('businessNumber !== "primary" && isBusinessPhoneNumberChannel(businessNumber)');
    expect(inbox).toContain("rows = await fetchMessageBackedConversationRows(businessNumber)");
  });
});
