import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeRenderedWhatsAppTemplate, renderWhatsAppTemplate } from "@/lib/whatsappTemplateRender";

const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const templateRenderer = readFileSync("src/lib/whatsappTemplateRender.ts", "utf8");
const whatsappSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const whatsappReply = readFileSync("supabase/functions/whatsapp-reply/index.ts", "utf8");
const conversationAction = readFileSync("supabase/functions/_shared/whatsapp-conversation-action.ts", "utf8");
const inboxEngineMigration = readFileSync("supabase/migrations/20260629113000_whatsapp_inbox_engine_deepening.sql", "utf8");
const aiReviewSlaMigration = readFileSync("supabase/migrations/20260629133000_whatsapp_ai_review_sla_evals.sql", "utf8");
const inboxPageHook = readFileSync("src/hooks/useWhatsAppInboxPage.ts", "utf8");
const threadHook = readFileSync("src/hooks/useWhatsAppThread.ts", "utf8");
const bufferWorker = readFileSync("supabase/functions/whatsapp-buffer-worker/index.ts", "utf8");
const whatsappAiReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");
const whatsappCopilotAssist = readFileSync("supabase/functions/whatsapp-copilot-assist/index.ts", "utf8");
const admissionsContext = readFileSync("supabase/functions/_shared/nimt-admissions-context.ts", "utf8");
const replyLearning = readFileSync("supabase/functions/whatsapp-reply-learning/index.ts", "utf8");

describe("WhatsApp inbox template rendering and speed guardrails", () => {
  it("treats explicitly provided template values as resolved even when they match defaults", () => {
    const render = renderWhatsAppTemplate({
      key: "course_info_v4",
      label: "Course Info",
      description: "Course details",
      params: ["student_name", "course_name", "duration", "eligibility", "approval", "video_url"],
      preview: "Hi {{student_name}}, here are the details for {{course_name}}.\n\nDuration: {{duration}}\nEligibility: {{eligibility}}\nApproval: {{approval}}\nCourse video: {{video_url}}",
    }, {
      student_name: "Riya Sharma",
      course_name: "B.Sc Nursing",
      duration: "4 years",
      eligibility: "10+2 / graduation as per programme norms",
      approval: "NIMT Educational Institutions",
      video_url: "https://nimt.ac.in/courses",
    });

    expect(render.unresolved).toEqual([]);
    expect(render.body).toContain("Approval: NIMT Educational Institutions");
  });

  it("renders course_info_v4 as readable message text instead of a template-key placeholder", () => {
    expect(inbox).toContain("course_info_v4:");
    expect(inbox).toContain("course_info_video_v2:");
    expect(inbox).toContain('key: "course_info_v4"');
    expect(inbox).toContain('key: "course_info_video_v2"');
    expect(inbox).toContain("bpt_bmrit_cahet_deadline:");
    expect(inbox).toContain("TEMPLATE_PLACEHOLDER_RE");
    expect(inbox).toContain("getMessageText(m)");
    expect(inbox).toContain("renderWhatsAppTemplate");
    expect(inbox).toContain("selectedTemplateRender");
    expect(templateRenderer).toContain("export function renderWhatsAppTemplate");
    expect(whatsappSend).toContain("rendered_template");
    expect(conversationAction).toContain("render_metadata");
    expect(inbox).not.toContain("Template: {m.template_key}");
    expect(inbox).toContain("appendTemplateBubble");
    expect(inbox).toContain("mergeMessageByIdentity");
    expect(inbox).toContain("apply_portal_login");
    expect(inbox).toContain("offer_letter_issued");
    expect(whatsappSend).toContain("course_info_v4:");
    expect(whatsappSend).toContain("Course video: {{6}}");
  });

  it("normalizes old partial render_metadata so the inbox can render template buttons safely", () => {
    const normalized = normalizeRenderedWhatsAppTemplate({
      key: "course_info_v4",
      body: "Hi Riya, here are the course details.",
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.buttons).toEqual([]);
    expect(normalized?.params).toEqual([]);
    expect(normalized?.unresolved).toEqual([]);
    expect(normalized?.label).toBe("Course Info V4");
  });

  it("shows backend sender names for authenticated outbound WhatsApp messages", () => {
    expect(inbox).toContain("sender_user_id");
    expect(inbox).toContain("localSenderNamesByWaId");
    expect(inbox).toContain("localSenderNamesBySignature");
    expect(inbox).toContain("wa_message_id");
    expect(inbox).toContain("getOutboundSenderLabel(m)");
    expect(inbox).toContain('select("user_id, display_name")');
  });

  it("renders WhatsApp-style delivery receipts from Meta status updates", () => {
    expect(inbox).toContain("const DeliveryReceipt");
    expect(inbox).toContain('title="Sent by Meta"');
    expect(inbox).toContain('title="Delivered"');
    expect(inbox).toContain('title="Read"');
    expect(inbox).toContain('title="Failed by Meta"');
    expect(inbox).toContain('event: "*"');
    expect(inbox).toContain("payload.eventType");
    expect(inbox).toContain("sent -> delivered -> read -> failed");
    expect(whatsappSend).toContain("business_phone_number_id");
  });

  it("keeps each admissions number segregated and discovers Meta channels from data", () => {
    expect(inbox).toContain("detectedInboxChannels");
    expect(inbox).toContain("KNOWN_ADMISSIONS_PHONE_CHANNELS");
    // 9555192192 migrated off Plivo onto Meta Cloud API coexistence, so every
    // known admissions channel is now provider "meta" — it still gets its own
    // inbox entry rather than being merged into the primary number.
    expect(inbox).toContain("PLIVO_WHATSAPP_NUMBER");
    expect(inbox).toContain('provider: "meta"');
    expect(inbox).not.toContain('provider: "plivo",');
    expect(inbox).toContain("PRIMARY_META_WHATSAPP_NUMBER");
    expect(inbox).toContain("919667641872");
    expect(inbox).toContain("917428499849");
    expect(inbox).not.toContain("9555192129");
    expect(inbox).not.toContain("919555192129");
    expect(inbox).toContain("primaryInboxLabel");
    expect(inbox).toContain("All WhatsApp numbers");
    expect(inbox).toContain('businessNumber === "all"');
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
    expect(whatsappReply).toContain("recordManualReplyConversationAction");
    expect(conversationAction).toContain("sender_user_id: action.userId");
    expect(inbox).toContain('invokeEdge<any>("whatsapp-send"');
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
    expect(inbox).toContain("messageColumns");
    expect(inbox).toContain("render_metadata");
    expect(inbox).toContain('eq("direction", "inbound")');
    expect(inbox).toContain('if (businessNumber === "all") return query');
    expect(inbox).toContain('businessNumber !== "primary" && isBusinessPhoneNumberChannel(businessNumber)');
    expect(inbox).toContain("mergeConversationRows(rows, messageBackedRows)");
  });

  it("learns from corrected/manual WhatsApp replies without blocking send", () => {
    expect(inbox).toContain('invokeEdge("whatsapp-reply-learning"');
    expect(inbox).toContain('action: "ingest_message"');
    expect(inbox).toContain("conversation_message_id");
  });

  it("answers fee-structure questions with verified fee details and the canonical fee page", () => {
    expect(whatsappAiReply).toContain("loadVerifiedAdmissionsContext");
    expect(whatsappCopilotAssist).toContain("loadVerifiedAdmissionsContext");
    expect(admissionsContext).toContain('from("fee_structures")');
    expect(admissionsContext).toContain('from("fee_structure_items")');
    expect(admissionsContext).toContain('from("eligibility_rules")');
    expect(admissionsContext).toContain('from "../../../web-chat-server/knowledge.ts"');
    expect(admissionsContext).toContain('const FEE_STRUCTURE_URL = "https://nimt.ac.in/admissions/fees/"');
    expect(whatsappAiReply).toContain("FEE ANSWER RULES (strict)");
    expect(whatsappAiReply).toContain("If the user asks about fee");
    // Fee amounts are no longer hardcoded in the prompt — they come from
    // course_facts / fee_structures via verifiedAdmissionsContext, so a price
    // change can't leave a stale number baked into the edge function.
    expect(whatsappAiReply).not.toContain("₹1,53,000/year");
    expect(whatsappAiReply).toContain("Never invent fee amounts.");
    expect(whatsappAiReply).toContain("full year-wise programme fees are published here: ${FEE_STRUCTURE_URL}");
    expect(whatsappAiReply).toContain("verifiedAdmissionsContext");
    expect(whatsappCopilotAssist).toContain("always include the canonical fee page: https://nimt.ac.in/admissions/fees/");
    expect(inbox).toContain("Detailed year-wise fees are published here");
    expect(inbox).toContain("https://nimt.ac.in/admissions/fees/");
    expect(inbox).not.toContain("Contact admissions for latest fee");
  });

  it("routes corrected replies through a review queue before they can influence AI answers", () => {
    expect(replyLearning).toContain('status: "needs_review"');
    expect(replyLearning).toContain('review_reason: "manual_or_corrected_whatsapp_reply"');
    expect(replyLearning).toContain('"review_example"');
    expect(replyLearning).toContain("review_admissions_ai_reply_example");
    expect(aiReviewSlaMigration).toContain("admissions_ai_reply_review_queue");
    expect(aiReviewSlaMigration).toContain("review_admissions_ai_reply_example");
    expect(aiReviewSlaMigration).toContain("status = case when p_decision = 'approve' then 'active' else 'rejected' end");
  });

  it("creates WhatsApp SLA alerts through the existing notification system", () => {
    expect(aiReviewSlaMigration).toContain("create table if not exists public.whatsapp_sla_alerts");
    expect(aiReviewSlaMigration).toContain("create_whatsapp_sla_alerts");
    expect(aiReviewSlaMigration).toContain("whatsapp_sla_warning");
    expect(aiReviewSlaMigration).toContain("whatsapp_sla_breach");
    expect(aiReviewSlaMigration).toContain("reply_window_expiring");
    expect(bufferWorker).toContain("create_whatsapp_sla_alerts");
    expect(bufferWorker).toContain("sla_alerts");
  });

  it("stores golden-answer evals for counsellor-grade WhatsApp answers", () => {
    expect(aiReviewSlaMigration).toContain("create table if not exists public.whatsapp_golden_answer_evals");
    expect(aiReviewSlaMigration).toContain("fee_bsc_nursing_en");
    expect(aiReviewSlaMigration).toContain("eligibility_bpt_en");
    expect(aiReviewSlaMigration).toContain("course_not_offered_mbbs");
    expect(aiReviewSlaMigration).toContain("fee_structures");
    expect(aiReviewSlaMigration).toContain("eligibility_rules");
  });

  it("has a dedicated 24-hour reply-window queue for unreplied inbound conversations", () => {
    expect(inbox).toContain('"reply_window"');
    expect(inbox).toContain("isReplyWindowConversation");
    expect(inbox).toContain("isWithinMetaReplyWindow");
    expect(inbox).toContain('label: "Reply now"');
    expect(inbox).toContain("last_direction === \"inbound\"");
    expect(inbox).toContain("24h");
    expect(inbox).toContain("bReplyNow - aReplyNow");
  });

  it("adds the server-side inbox and buffered conversation engine seams", () => {
    expect(inboxEngineMigration).toContain("create table if not exists public.whatsapp_message_buffers");
    expect(inboxEngineMigration).toContain("create table if not exists public.whatsapp_ai_drafts");
    expect(inboxEngineMigration).toContain("create or replace function public.whatsapp_inbox_page");
    expect(inboxEngineMigration).toContain("create or replace function public.whatsapp_thread");
    expect(inboxEngineMigration).toContain("claim_due_whatsapp_buffers");
    expect(inboxEngineMigration).toContain("interval '10 seconds'");
    expect(inboxEngineMigration).toContain("interval '60 seconds'");
    expect(inboxEngineMigration).toContain("reply_window_open");
    expect(inboxEngineMigration).toContain("lead_temperature");
    expect(inboxPageHook).toContain("useWhatsAppInboxPage");
    expect(inboxPageHook).toContain("whatsapp_inbox_page");
    expect(threadHook).toContain("useWhatsAppThread");
    expect(threadHook).toContain("mark_whatsapp_conversation_read");
    expect(bufferWorker).toContain("claim_due_whatsapp_buffers");
    expect(bufferWorker).toContain("whatsapp-ai-reply");
    expect(bufferWorker).toContain("human_mode_buffered_inbound");
    expect(bufferWorker).toContain("classifyLeadTemperature");
  });
});
