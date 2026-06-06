import { createClient } from "npm:@supabase/supabase-js@2";
import { digits, type WhatsAppProvider } from "../_shared/whatsapp-channel.ts";
import { logWhatsAppAutomationEvent } from "../_shared/whatsapp-automation-events.ts";
import {
  upsertConversationState,
  type ConversationMode,
  type ConversationState,
} from "../_shared/whatsapp-conversation-state.ts";
import { loadLatestOutboundContext } from "../_shared/whatsapp-outbound-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HR_BUSINESS_PNID = "970526789470416";
const DNC_PATTERNS = /\b(stop|unsubscribe|opt.?out|do not contact|dont contact|don'?t contact|not interested|nahi chahiye|mujhe nahi chahiye|remove me|block me|dnc|irritating|irritate|stop calling|stop messaging|stop whatsapp|band karo|chhodiye|chhodo|mat karo|pareshan|hata do|hatao)\b/i;

const MENU_CONTEXT: Record<string, string> = {
  "1": "The user selected course option 1 — B.Sc Nursing.",
  "2": "The user selected course option 2 — GNM.",
  "3": "The user selected course option 3 — BPT.",
  "4": "The user selected course option 4 — BMRIT.",
  "5": "The user selected course option 5 — MBA.",
  "6": "The user selected course option 6 — PGDM.",
  "7": "The user selected course option 7 — BBA.",
  "8": "The user selected course option 8 — BCA.",
  "9": "The user selected course option 9 — BA LLB / LLB.",
  "10": "The user selected course option 10 — B.Ed.",
  "11": "The user selected course option 11 — D Pharma.",
  "12": "The user selected course option 12 — School admission.",
};

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isServiceRole(req: Request): boolean {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("Authorization") || "";
  return !!serviceRoleKey && auth === `Bearer ${serviceRoleKey}`;
}

async function dispatchClassifier(
  supabaseUrl: string,
  serviceRoleKey: string,
  queueId: string,
): Promise<void> {
  const classifyRes = await fetch(`${supabaseUrl}/functions/v1/wa-classify-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ queue_id: queueId, dispatch_reply: true }),
  });
  if (!classifyRes.ok) {
    throw new Error(`classifier ${classifyRes.status}: ${(await classifyRes.text()).slice(0, 300)}`);
  }
}

async function isLikelyFeedbackReply(admin: any, leadId: string | null, content: string): Promise<boolean> {
  if (!leadId) return false;
  const trimmed = content.trim().toLowerCase();
  if (!/^[1-5]$/.test(trimmed) && !["good", "bad"].includes(trimmed)) return false;

  const { data } = await admin
    .from("feedback_responses")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1);
  return !!data?.[0]?.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isServiceRole(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const provider: WhatsAppProvider = body.provider === "plivo" ? "plivo" : "meta";
    const phone = digits(body.phone);
    const businessNumber =
      digits(body.business_number || body.business_phone_number || body.business_phone_number_id) ||
      String(body.business_phone_number_id || "");
    const messageId: string | null = body.message_id || null;
    let leadId: string | null = body.lead_id || null;
    const content = typeof body.content === "string" ? body.content : "";
    const messageType = typeof body.message_type === "string" ? body.message_type : "text";
    const leadStage = typeof body.lead_stage === "string" ? body.lead_stage : null;
    const personRole = typeof body.person_role === "string" ? body.person_role : null;
    const ownerUserId = typeof body.owner_user_id === "string" ? body.owner_user_id : null;
    const dispatchReply = body.dispatch_reply === true;
    const isHrChannel = provider === "meta" && businessNumber === HR_BUSINESS_PNID;
    const roleHandoff = personRole === "job_applicant" || personRole === "vendor";
    const mediaHandoff = messageType !== "text";

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const outboundContext = await loadLatestOutboundContext(admin, phone, businessNumber);
    if (!leadId && typeof outboundContext?.lead_id === "string") {
      leadId = outboundContext.lead_id;
    }
    const responsePolicy = typeof outboundContext?.response_policy === "string"
      ? outboundContext.response_policy
      : "engine";
    const expectedReplyType = typeof outboundContext?.expected_reply_type === "string"
      ? outboundContext.expected_reply_type
      : null;
    const mode: ConversationMode =
      responsePolicy === "human" || responsePolicy === "suppress" || roleHandoff || mediaHandoff || leadStage === "dnc"
        ? "human"
        : "ai";
    const state: ConversationState = leadStage === "dnc"
      ? "dnc"
      : responsePolicy === "human"
        ? "needs_counsellor"
        : responsePolicy === "suppress"
          ? "human_active"
          : personRole === "job_applicant"
            ? "job_handoff"
            : personRole === "vendor"
              ? "vendor_handoff"
              : mediaHandoff
                ? "needs_counsellor"
                : "new_unqualified";
    const handoffReason = leadStage === "dnc"
      ? "dnc"
      : responsePolicy === "human"
        ? `reply_to_${outboundContext?.outbound_kind || "outbound"}`
        : responsePolicy === "suppress"
          ? `suppressed_reply_to_${outboundContext?.outbound_kind || "outbound"}`
          : personRole === "job_applicant"
            ? "classified_job_applicant"
            : personRole === "vendor"
              ? "classified_vendor"
              : mediaHandoff
                ? "inbound_media"
                : null;

    await logWhatsAppAutomationEvent(admin, {
      phone,
      businessNumber,
      provider,
      leadId,
      messageId,
      eventType: "inbound_received",
      decision: "accepted",
      metadata: {
        source: body.source || "webhook",
        message_type: messageType,
        dispatch_reply: dispatchReply,
        outbound_context_id: outboundContext?.id || null,
        outbound_kind: outboundContext?.outbound_kind || null,
        campaign_id: outboundContext?.campaign_id || null,
        template_key: outboundContext?.template_key || null,
      },
    });

    if (outboundContext) {
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "inbound_reply_to_outbound",
        decision: String(responsePolicy),
        reason: expectedReplyType,
        metadata: {
          outbound_context_id: outboundContext.id,
          outbound_kind: outboundContext.outbound_kind,
          campaign_id: outboundContext.campaign_id,
          campaign_recipient_id: outboundContext.campaign_recipient_id,
          template_key: outboundContext.template_key,
        },
      });
    }

    if (businessNumber) {
      await upsertConversationState(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        mode,
        state,
        ownerUserId,
        escalationRole: responsePolicy === "human" || roleHandoff || mediaHandoff ? "counsellor" : null,
        handoffReason,
        priority: responsePolicy === "human" || roleHandoff || mediaHandoff ? "high" : "normal",
        slaDueAt: responsePolicy === "human" || roleHandoff || mediaHandoff ? addMinutes(30) : null,
        lastIntent: expectedReplyType || personRole || (isHrChannel ? "hr_channel" : "admission"),
        lastBotAction: outboundContext ? `reply_to_${outboundContext.outbound_kind}` : dispatchReply ? "pending_decision" : "observed_by_orchestrator",
      });
    }

    if (leadStage === "dnc") {
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "dnc_marked",
        decision: "skip_reply",
        reason: "lead_stage_dnc",
      });
      return new Response(JSON.stringify({ ok: true, decision: "skip_reply", reason: "dnc" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (messageType === "text" && content.trim() && DNC_PATTERNS.test(content.trim())) {
      if (leadId) {
        await admin.from("leads").update({ stage: "dnc" }).eq("id", leadId);
        await admin.from("lead_activities").insert({
          lead_id: leadId,
          type: "whatsapp",
          description: `Lead marked DNC by conversation engine: "${content.substring(0, 100)}"`,
        });
      }
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "dnc_marked",
        decision: "skip_reply",
        reason: "opt_out_message",
      });
      return new Response(JSON.stringify({ ok: true, decision: "skip_reply", reason: "dnc_opt_out" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (responsePolicy === "suppress") {
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "human_mode_skip",
        decision: "suppress_reply",
        reason: `reply_to_${outboundContext?.outbound_kind || "outbound"}`,
      });
      return new Response(JSON.stringify({ ok: true, decision: "suppress_reply" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (responsePolicy === "human" || roleHandoff || mediaHandoff || isHrChannel) {
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "handoff_created",
        decision: "human_handoff",
        reason: responsePolicy === "human"
          ? `reply_to_${outboundContext?.outbound_kind || "outbound"}`
          : roleHandoff ? personRole : mediaHandoff ? "inbound_media" : "hr_channel",
      });
      return new Response(JSON.stringify({ ok: true, decision: "human_handoff" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (dispatchReply && messageType === "text" && content.trim()) {
      if (await isLikelyFeedbackReply(admin, leadId, content)) {
        await logWhatsAppAutomationEvent(admin, {
          phone,
          businessNumber,
          provider,
          leadId,
          messageId,
          eventType: "human_mode_skip",
          decision: "feedback_reply_skip",
          reason: "feedback_flow_handled_by_webhook",
        });
        return new Response(JSON.stringify({ ok: true, decision: "feedback_reply_skip" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (leadId) {
        try {
          const { data: catResult } = await admin.rpc("auto_categorize_lead_from_message", {
            _lead_id: leadId,
            _message_text: content,
          });

          if (catResult === "job_applicant" || catResult === "vendor") {
            await logWhatsAppAutomationEvent(admin, {
              phone,
              businessNumber,
              provider,
              leadId,
              messageId,
              eventType: catResult === "job_applicant" ? "classified_job" : "classified_vendor",
              decision: "human_handoff",
              reason: String(catResult),
            });
            return new Response(JSON.stringify({ ok: true, decision: "human_handoff", reason: catResult }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (catResult === "lead" && content.trim().length >= 6) {
            const { data: ambig } = await admin.rpc("wa_message_might_be_non_admission", {
              _text: content,
            });
            if (ambig === true && messageId) {
              const { data: queueId } = await admin.rpc("enqueue_wa_classification", {
                _lead_id: leadId,
                _message_id: messageId,
                _phone: phone,
                _content: content,
                _dispatch_reply: true,
              });
              if (queueId) {
                await logWhatsAppAutomationEvent(admin, {
                  phone,
                  businessNumber,
                  provider,
                  leadId,
                  messageId,
                  eventType: "ai_reply_requested",
                  decision: "classifier_deferred",
                  reason: "ambiguous_admission_message",
                });
                await dispatchClassifier(supabaseUrl, serviceRoleKey, queueId);
                return new Response(JSON.stringify({ ok: true, decision: "classifier_deferred", queue_id: queueId }), {
                  status: 200,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }
            }
          }

          if (catResult === "lead") {
            await logWhatsAppAutomationEvent(admin, {
              phone,
              businessNumber,
              provider,
              leadId,
              messageId,
              eventType: "classified_admission",
              decision: "admission_reply_allowed",
            });
          }
        } catch (classifyErr) {
          await logWhatsAppAutomationEvent(admin, {
            phone,
            businessNumber,
            provider,
            leadId,
            messageId,
            eventType: "send_failed",
            decision: "classification_failed",
            reason: classifyErr instanceof Error ? classifyErr.message.slice(0, 300) : "classification failed",
          });
        }
      }

      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber,
        provider,
        leadId,
        messageId,
        eventType: "ai_reply_requested",
        decision: "dispatch_ai_reply",
        metadata: { content_preview: content.slice(0, 120) },
      });

      const menuCtx = MENU_CONTEXT[content.trim()];
      const messageForAI = menuCtx
        ? `[System note: ${menuCtx}]\n\nUser message: ${content}`
        : content;

      const aiRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          phone,
          message: messageForAI,
          provider,
          business_phone_number_id: provider === "meta" ? businessNumber : undefined,
          business_number: provider === "plivo" ? businessNumber : undefined,
        }),
      });

      if (!aiRes.ok) {
        const detail = await aiRes.text();
        await logWhatsAppAutomationEvent(admin, {
          phone,
          businessNumber,
          provider,
          leadId,
          messageId,
          eventType: "send_failed",
          decision: "ai_dispatch_failed",
          reason: detail.slice(0, 300),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, decision: "observed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-conversation-orchestrator error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "orchestrator failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
