import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionModule = readFileSync("supabase/functions/_shared/whatsapp-conversation-action.ts", "utf8");
const replyFunction = readFileSync("supabase/functions/whatsapp-reply/index.ts", "utf8");
const sendFunction = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const campaignSendFunction = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const aiReplyFunction = readFileSync("supabase/functions/whatsapp-ai-reply/index.ts", "utf8");
const orchestratorFunction = readFileSync("supabase/functions/whatsapp-conversation-orchestrator/index.ts", "utf8");

describe("WhatsApp conversation action module", () => {
  it("defines named conversation action variants and records manual reply effects", () => {
    for (const action of ["manualReply", "templateSend", "campaignSend", "aiReply", "dncAcknowledgement", "handoff"]) {
      expect(actionModule).toContain(action);
    }

    expect(actionModule).toContain('from("whatsapp_messages")');
    expect(actionModule).toContain("mark_whatsapp_conversation_read");
    expect(actionModule).toContain("recordWhatsAppOutboundContext");
    expect(actionModule).toContain("logWhatsAppAutomationEvent");
    expect(actionModule).toContain("upsertConversationState");
    expect(actionModule).toContain("conversationState?");
    expect(actionModule).toContain("confidence?");
    expect(actionModule).toContain('from("lead_activities")');
  });

  it("routes manual replies through the shared conversation action", () => {
    expect(replyFunction).toContain("recordManualReplyConversationAction");
    expect(replyFunction).toContain('kind: "manualReply"');
    expect(replyFunction).not.toContain('template_key: "manual_reply",\\n      sender_user_id');
  });

  it("routes template and campaign sends through the shared outbound action", () => {
    expect(actionModule).toContain("recordOutboundConversationAction");
    expect(sendFunction).toContain("recordOutboundConversationAction");
    expect(sendFunction).toContain('kind: "templateSend"');
    expect(sendFunction).not.toContain("recordWhatsAppOutboundContext");

    expect(campaignSendFunction).toContain("recordOutboundConversationAction");
    expect(campaignSendFunction).toContain('kind: "campaignSend"');
    expect(campaignSendFunction).not.toContain("recordWhatsAppOutboundContext");
  });

  it("routes AI, handoff, and DNC acknowledgement sends through the shared outbound action", () => {
    expect(aiReplyFunction).toContain("recordOutboundConversationAction");
    expect(aiReplyFunction).toContain('kind: "aiReply"');
    expect(aiReplyFunction).toContain('kind: "handoff"');
    expect(aiReplyFunction).toContain('outboundKind: "ai_reply"');
    expect(aiReplyFunction).toContain('outboundKind: "system_notification"');
    expect(aiReplyFunction).not.toContain('template_key: "ai_auto_reply"');
    expect(aiReplyFunction).not.toContain('template_key: role === "job_applicant" ? "hr_handoff" : "procurement_handoff"');

    expect(orchestratorFunction).toContain("recordOutboundConversationAction");
    expect(orchestratorFunction).toContain('kind: "dncAcknowledgement"');
    expect(orchestratorFunction).toContain('expectedReplyType: "do_not_reply"');
  });
});
