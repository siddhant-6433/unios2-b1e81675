import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const metaWebhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
const plivoWebhook = readFileSync("supabase/functions/whatsapp-plivo-webhook/index.ts", "utf8");
const aiReply = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");
const classifier = readFileSync("supabase/functions/wa-classify-message/index.ts", "utf8");
const manualReply = readFileSync("supabase/functions/whatsapp-reply/index.ts", "utf8");
const templateSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const campaignSend = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const channelAdapter = readFileSync("supabase/functions/_shared/whatsapp-channel.ts", "utf8");
const conversationStateHelper = readFileSync("supabase/functions/_shared/whatsapp-conversation-state.ts", "utf8");
const automationEventsHelper = readFileSync("supabase/functions/_shared/whatsapp-automation-events.ts", "utf8");
const outboundContextHelper = readFileSync("supabase/functions/_shared/whatsapp-outbound-context.ts", "utf8");
const inboundEventsHelper = readFileSync("supabase/functions/_shared/whatsapp-inbound-events.ts", "utf8");
const orchestrator = readFileSync("supabase/functions/whatsapp-conversation-orchestrator/index.ts", "utf8");
const routeHealth = readFileSync("supabase/functions/whatsapp-route-health/index.ts", "utf8");
const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
const providerMigration = readFileSync("supabase/migrations/20260618212500_wa_conversations_provider.sql", "utf8");
const channelsMigration = readFileSync("supabase/migrations/20260618212600_whatsapp_channels.sql", "utf8");
const stateMigration = readFileSync("supabase/migrations/20260618212000_whatsapp_conversation_state.sql", "utf8");
const eventsMigration = readFileSync("supabase/migrations/20260618212100_whatsapp_automation_events.sql", "utf8");
const courseBriefMigration = readFileSync("supabase/migrations/20260618212200_course_admission_briefs.sql", "utf8");
const outboundContextMigration = readFileSync("supabase/migrations/20260618212300_whatsapp_outbound_context.sql", "utf8");
const inboundEventsMigration = readFileSync("supabase/migrations/20260618212400_whatsapp_inbound_events.sql", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

describe("WhatsApp inbound auto-reply and qualification routing", () => {
  it("creates a Meta webhook lead before logging and handing routing to the orchestrator", () => {
    const autoCreateIndex = metaWebhook.indexOf("Webhook auto-create lead failed");
    const insertIndex = metaWebhook.indexOf("// Insert message");
    const orchestratorIndex = metaWebhook.indexOf('source: "meta_webhook"');

    expect(autoCreateIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(autoCreateIndex);
    expect(orchestratorIndex).toBeGreaterThan(insertIndex);
    expect(metaWebhook).toContain("orchestratorOwnsReplyDecision");
  });

  it("runs classifier deferral and AI dispatch from the orchestrator", () => {
    const enqueueIndex = orchestrator.indexOf("enqueue_wa_classification");
    const aiReplyIndex = orchestrator.indexOf("/functions/v1/whatsapp-ai-reply");

    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(aiReplyIndex).toBeGreaterThan(-1);
    expect(orchestrator).toContain("dispatchClassifier(supabaseUrl, serviceRoleKey, queueId)");
    expect(orchestrator).toContain('decision: "classifier_deferred"');
    expect(orchestrator).toContain("auto_categorize_lead_from_message");
  });

  it("does not drop Plivo inbound messages when Type is a message kind", () => {
    expect(plivoWebhook).toContain('"text", "message", "inbound"');
    expect(plivoWebhook).toContain('Some Plivo payloads use Type for the message');
    expect(plivoWebhook).toContain('|| "919555192192"');
    expect(plivoWebhook).toContain("payloadSummary(body)");
  });

  it("prevents old Plivo webhook reply branches from double-sending", () => {
    expect(plivoWebhook).toContain("orchestratorOwnsReplyDecision");
    expect(plivoWebhook).toContain("sendPlivoWhatsAppText(toDigitsVal, fromDigits, matched.reply)");
    expect(plivoWebhook).toContain("!orchestratorOwnsReplyDecision && !shouldDeferAiReply");
    expect(plivoWebhook).toContain("!orchestratorOwnsReplyDecision && !keywordMatched");
    expect(plivoWebhook).toContain('template_key: "auto_reply"');
    expect(plivoWebhook).toContain('provider: "plivo"');
  });

  it("asks new admission leads for name and numbered course interest", () => {
    expect(metaWebhook).toContain("Please share your name and course interest");
    expect(plivoWebhook).toContain("Please share your name and course interest");
    expect(metaWebhook).toContain("1. B.Sc Nursing");
    expect(plivoWebhook).toContain("12. School admission");
  });

  it("turns course choices into CRM course_id updates before replying", () => {
    expect(aiReply).toContain("ADMISSION_COURSE_OPTIONS");
    expect(aiReply).toContain("detectCourseOption(message)");
    expect(aiReply).toContain("resolveCourseId(admin, selectedCourseOption)");
    expect(aiReply).toContain("update({ course_id: courseId })");
    expect(aiReply).toContain("Course interest (from WhatsApp)");
  });

  it("only accepts exact or explicit course option numbers", () => {
    expect(aiReply).toContain("course option");
    expect(aiReply).toContain("commaNumber");
    expect(aiReply).not.toContain("(?:^|[\\s,.:;-])(\\d{1,2})(?:$|[\\s,.:;-])");
  });

  it("keeps classifier-deferred replies on their original WhatsApp provider", () => {
    expect(classifier).toContain('select("provider, business_phone_number_id, business_phone_number")');
    expect(classifier).toContain('const provider = sourceMessage?.provider === "plivo" ? "plivo" : "meta"');
    expect(classifier).toContain('business_number: provider === "plivo" ? businessNumber : undefined');
    expect(classifier).toContain("business_phone_number_id: businessPhoneNumberId");
  });

  it("routes manual CRM replies through the conversation provider", () => {
    expect(manualReply).toContain('from "../_shared/whatsapp-channel.ts"');
    expect(manualReply).toContain("inferRouteFromLatestMessage");
    expect(manualReply).toContain("provider === \"plivo\"");
    expect(manualReply).toContain("sendWhatsAppText(admin, channelHint");
    expect(manualReply).toContain("provider: sendResult.provider");
  });

  it("passes provider and business number from the inbox to manual replies", () => {
    expect(providerMigration).toContain("provider text");
    expect(providerMigration).toContain("latest.provider");
    expect(inbox).toContain('provider: "meta" | "plivo" | null');
    expect(inbox).toContain("provider, business_phone_number_id, business_phone_number");
    expect(inbox).toContain("provider: conv?.provider || null");
    expect(inbox).toContain("business_number: conv?.business_phone_number || null");
  });

  it("centralizes WhatsApp channels in a DB registry and shared adapter", () => {
    expect(channelsMigration).toContain("create table if not exists public.whatsapp_channels");
    expect(channelsMigration).toContain("provider text not null check (provider in ('meta', 'plivo'))");
    expect(channelsMigration).toContain("'plivo_admissions'");
    expect(channelsMigration).toContain("'919555192192'");
    expect(channelAdapter).toContain("resolveWhatsAppChannel");
    expect(channelAdapter).toContain("sendWhatsAppText");
    expect(channelAdapter).toContain("sendWhatsAppTemplate");
  });

  it("uses the shared WhatsApp channel adapter for reply, AI, template, and campaign sends", () => {
    expect(manualReply).toContain("sendWhatsAppText(admin, channelHint");
    expect(aiReply).toContain("sendWhatsAppText(admin");
    expect(templateSend).toContain("sendWhatsAppTemplate(admin");
    expect(campaignSend).toContain("sendWhatsAppTemplate(adminClient");
  });

  it("tracks rich conversation state for AI/human handoff", () => {
    expect(stateMigration).toContain("create table if not exists public.whatsapp_conversation_state");
    expect(stateMigration).toContain("mode text not null default 'ai'");
    expect(stateMigration).toContain("'needs_counsellor'");
    expect(stateMigration).toContain("conversation_mode text");
    expect(stateMigration).toContain("conversation_state text");
    expect(conversationStateHelper).toContain("upsertConversationState");
    expect(conversationStateHelper).toContain("conversationBusinessKey");
  });

  it("makes bot and inbox respect conversation state", () => {
    expect(aiReply).toContain('from("whatsapp_conversation_state")');
    expect(aiReply).toContain('reason: `conversation_${stateRow.mode}`');
    expect(aiReply).toContain('state: confidence < 0.6 ? "knowledge_gap" : "answered_by_ai"');
    expect(manualReply).toContain('state: "human_active"');
    expect(inbox).toContain("conversation_mode, conversation_state");
    expect(inbox).toContain('from("whatsapp_conversation_state")');
    expect(inbox).toContain("stateLabel(selectedConv.conversation_state)");
  });

  it("allows internal service-role calls to AI reply and classifier functions", () => {
    expect(supabaseConfig).toMatch(/\[functions\.whatsapp-ai-reply\]\s+verify_jwt = false/);
    expect(supabaseConfig).toMatch(/\[functions\.wa-classify-message\]\s+verify_jwt = false/);
  });

  it("adds an automation audit trail and shared conversation orchestrator", () => {
    expect(eventsMigration).toContain("create table if not exists public.whatsapp_automation_events");
    expect(eventsMigration).toContain("event_type text not null");
    expect(eventsMigration).toContain("metadata jsonb not null default '{}'");
    expect(automationEventsHelper).toContain("logWhatsAppAutomationEvent");
    expect(automationEventsHelper).toContain("whatsapp_automation_events");
    expect(orchestrator).toContain('eventType: "inbound_received"');
    expect(orchestrator).toContain('eventType: "handoff_created"');
    expect(orchestrator).toContain("/functions/v1/whatsapp-ai-reply");
    expect(orchestrator).toContain("isLikelyFeedbackReply");
    expect(orchestrator).toContain("DNC_PATTERNS");
  });

  it("routes Meta and Plivo webhooks through the orchestrator after inbound logging", () => {
    expect(metaWebhook).toContain("invokeConversationOrchestrator");
    expect(metaWebhook).toContain('source: "meta_webhook"');
    expect(metaWebhook).toContain('provider: "meta"');
    expect(plivoWebhook).toContain("invokeConversationOrchestrator");
    expect(plivoWebhook).toContain('source: "plivo_webhook"');
    expect(plivoWebhook).toContain('provider: "plivo"');
    expect(metaWebhook).toContain("dispatch_reply: true");
    expect(plivoWebhook).toContain("dispatch_reply: true");
  });

  it("records send health events and exposes route diagnostics", () => {
    expect(aiReply).toContain('eventType: "ai_reply_sent"');
    expect(aiReply).toContain('eventType: "send_failed"');
    expect(aiReply).toContain('eventType: "human_mode_skip"');
    expect(manualReply).toContain('decision: "manual_reply_sent"');
    expect(routeHealth).toContain("token_present");
    expect(routeHealth).toContain("last_failure");
    expect(routeHealth).toContain("whatsapp_channels");
    expect(supabaseConfig).toMatch(/\[functions\.whatsapp-conversation-orchestrator\]\s+verify_jwt = false/);
    expect(supabaseConfig).toMatch(/\[functions\.whatsapp-route-health\]\s+verify_jwt = false/);
  });

  it("adds the course-brief knowledge base bridge without seeding USP copy", () => {
    expect(courseBriefMigration).toContain("create table if not exists public.course_admission_briefs");
    expect(courseBriefMigration).toContain("strongest_usp text");
    expect(courseBriefMigration).toContain("bot_first_reply text");
    expect(aiReply).toContain("loadCourseAdmissionBrief");
    expect(aiReply).toContain("COURSE-SPECIFIC VERIFIED BRIEF");
    expect(aiReply).toContain("courseBriefContext");
  });

  it("adds admin operations queue filters to the WhatsApp inbox", () => {
    expect(inbox).toContain("opsFilter");
    expect(inbox).toContain("isHandoffConversation");
    expect(inbox).toContain("isSlaBreached");
    expect(inbox).toContain('label: "Knowledge"');
    expect(inbox).toContain('label: "Unassigned"');
  });

  it("records outbound context for template, bulk, and manual replies", () => {
    expect(outboundContextMigration).toContain("create table if not exists public.whatsapp_outbound_context");
    expect(outboundContextMigration).toContain("campaign_recipient_id uuid references public.whatsapp_campaign_recipients");
    expect(outboundContextMigration).toContain("response_policy text not null default 'engine'");
    expect(outboundContextHelper).toContain("recordWhatsAppOutboundContext");
    expect(outboundContextHelper).toContain("expectedReplyTypeForTemplate");
    expect(templateSend).toContain("recordWhatsAppOutboundContext(adminClient");
    expect(templateSend).toContain('outboundKind: "template"');
    expect(campaignSend).toContain("recordWhatsAppOutboundContext(adminClient");
    expect(campaignSend).toContain('outboundKind: "bulk_campaign"');
    expect(campaignSend).toContain("campaignRecipientId: recipient.id");
    expect(manualReply).toContain('outboundKind: "manual_reply"');
    expect(manualReply).toContain('responsePolicy: "human"');
  });

  it("uses outbound context when routing inbound replies", () => {
    expect(automationEventsHelper).toContain("inbound_reply_to_outbound");
    expect(orchestrator).toContain("loadLatestOutboundContext");
    expect(orchestrator).toContain('eventType: "inbound_reply_to_outbound"');
    expect(orchestrator).toContain("campaign_recipient_id");
    expect(orchestrator).toContain("responsePolicy === \"human\"");
    expect(orchestrator).toContain("responsePolicy === \"suppress\"");
  });

  it("persists raw inbound provider events before routing", () => {
    expect(inboundEventsMigration).toContain("create table if not exists public.whatsapp_inbound_events");
    expect(inboundEventsMigration).toContain("provider_event_id text");
    expect(inboundEventsMigration).toContain("raw_payload jsonb not null default '{}'");
    expect(inboundEventsMigration).toContain("processing_status text not null default 'received'");
    expect(inboundEventsHelper).toContain("recordWhatsAppInboundEvent");
    expect(inboundEventsHelper).toContain("markWhatsAppInboundEvent");
    expect(metaWebhook).toContain("recordWhatsAppInboundEvent(admin");
    expect(metaWebhook).toContain('provider: "meta"');
    expect(metaWebhook).toContain('skipReason: "whatsapp_login_intent"');
    expect(metaWebhook).toContain('skipReason: "personal_document_flow"');
    expect(plivoWebhook).toContain("recordWhatsAppInboundEvent(admin");
    expect(plivoWebhook).toContain('provider: "plivo"');
    expect(plivoWebhook).toContain('skipReason: "duplicate_provider_message"');
    expect(plivoWebhook).toContain('skipReason: "no_from"');
  });
});
