// Inbound webhook for the SECOND WhatsApp number (9555192192), which runs on
// Plivo in coexistence mode (WhatsApp Business app + BSP API on one number).
//
// Plivo's inbound shape differs from Meta's Graph webhook, so this is a
// separate function rather than another branch in whatsapp-webhook:
//   • Plivo POSTs form-encoded (default) or JSON to the URL configured against
//     the WABA in the Plivo console.
//   • Fields: From (sender E.164), To (our Plivo number), Text (body),
//     Type ("whatsapp"), MessageUUID (unique id), Media0..N (media URLs).
//
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPlivoWhatsAppText } from "../_shared/plivo.ts";
import { upsertConversationState } from "../_shared/whatsapp-conversation-state.ts";
import {
  markWhatsAppInboundEvent,
  recordWhatsAppInboundEvent,
} from "../_shared/whatsapp-inbound-events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function invokeConversationOrchestrator(payload: Record<string, unknown>): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-conversation-orchestrator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("conversation orchestrator dispatch failed:", res.status, await res.text());
  }
}

// Strip everything but digits. Plivo sends E.164 (+919555192192); the existing
// Meta path stores `phone` as bare digits (919555192192), so we match that.
function toDigits(value: string | null | undefined): string {
  return (value || "").replace(/[^0-9]/g, "");
}

// Lead phone is stored in +E.164 form, matching whatsapp-ai-reply's convention:
// a bare 10-digit Indian number gets +91, anything else is prefixed with '+'.
function toLeadPhone(digits: string): string {
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

// Parse Plivo's inbound payload regardless of whether it arrives form-encoded
// (the default) or as JSON. Field names are case-sensitive in Plivo's docs
// (From/To/Text/Type/MessageUUID) but we read defensively just in case.
async function parsePlivoBody(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") || "";
  const out: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const json = await req.json().catch(() => ({}));
    for (const [k, v] of Object.entries(json || {})) {
      out[k] = v == null ? "" : String(v);
    }
    return out;
  }

  // form-urlencoded or multipart
  const form = await req.formData().catch(() => null);
  if (form) {
    for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

function pick(body: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (body[k] != null && body[k] !== "") return body[k];
  }
  return "";
}

function payloadSummary(body: Record<string, string>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(body).slice(0, 30)) {
    summary[key] = value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  return summary;
}

const AUTO_REPLIES: { patterns: RegExp; reply: string }[] = [
  {
    patterns: /^(hi|hello|hey|hii+|hlo|good\s*(morning|evening|afternoon)|namaste|namaskar|helo|hy)[\s!.]*$/i,
    reply: "Hi! 👋 Welcome to NIMT Admissions.\n\nPlease share your name and course interest. You can reply like: *Priya, 3*\n\n1. B.Sc Nursing\n2. GNM\n3. BPT\n4. BMRIT\n5. MBA\n6. PGDM\n7. BBA\n8. BCA\n9. BA LLB / LLB\n10. B.Ed\n11. D Pharma\n12. School admission",
  },
  {
    patterns: /\b(thank|thanks|thanku|thnx|thnks|dhanyawad|shukriya|ty)\b/i,
    reply: "You're welcome! 😊 Feel free to reach out anytime if you have more questions. We're here to help!",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Plivo doesn't do a Meta-style verify handshake — a plain 200 on GET is
  // enough for connectivity checks from the console.
  if (req.method === "GET") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await parsePlivoBody(req);

    const channelType = pick(body, "Type", "type", "Channel", "channel").toLowerCase();
    const fromDigits = toDigits(pick(
      body,
      "From",
      "from",
      "src",
      "Src",
      "Source",
      "source",
      "Sender",
      "sender",
      "ContactNumber",
      "contact_number",
      "WaId",
      "wa_id",
    ));
    const toDigitsVal = toDigits(pick(
      body,
      "To",
      "to",
      "dst",
      "Dst",
      "Destination",
      "destination",
      "Recipient",
      "recipient",
    )) || "919555192192";
    const text = pick(body, "Text", "text", "Body", "body", "Message", "message", "Content", "content") || null;
    const waMessageId = pick(body, "MessageUUID", "MessageUuid", "message_uuid", "MessageUUID0", "Uuid", "uuid") || null;
    const media0 = pick(body, "Media0", "media0", "MediaUrl0", "media_url", "MediaURL") || null;
    const declaredMessageType = pick(body, "MessageType", "message_type", "Type", "type").toLowerCase();
    const msgType = media0 ? "image" : declaredMessageType && declaredMessageType !== "whatsapp" ? declaredMessageType : "text";
    const leadPhone = toLeadPhone(fromDigits);
    const inboundEventId = await recordWhatsAppInboundEvent(admin, {
      provider: "plivo",
      providerEventId: waMessageId || undefined,
      phone: fromDigits,
      businessNumber: toDigitsVal,
      messageType: msgType,
      content: text,
      mediaCount: media0 ? 1 : 0,
      rawPayload: body,
      normalized: {
        channel_type: channelType || null,
        from: fromDigits,
        to: toDigitsVal,
        message_uuid: waMessageId,
        media0,
      },
    });

    if (!fromDigits) {
      // Status callbacks (delivery receipts) and other non-message events have
      // no From — ack so Plivo doesn't retry.
      await markWhatsAppInboundEvent(admin, inboundEventId, {
        processingStatus: "skipped",
        skipReason: "no_from",
      });
      console.error("Plivo webhook skipped: no sender in payload", payloadSummary(body));
      return new Response(JSON.stringify({ skipped: true, reason: "no_from", keys: Object.keys(body).slice(0, 30) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only skip known non-WhatsApp traffic after we know there is no real
    // WhatsApp sender problem. Some Plivo payloads use Type for the message
    // kind ("text") rather than the channel ("whatsapp"), so From/Text wins.
    if (channelType && !["whatsapp", "text", "message", "inbound"].includes(channelType) && !text && !media0) {
      await markWhatsAppInboundEvent(admin, inboundEventId, {
        processingStatus: "skipped",
        skipReason: `unsupported_type:${channelType}`,
      });
      console.error("Plivo webhook skipped: unsupported type", channelType, payloadSummary(body));
      return new Response(JSON.stringify({ skipped: true, reason: `type=${channelType}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: Plivo retries on non-200 / timeout. Skip if we've already
    // logged this MessageUUID.
    if (waMessageId) {
      const { data: dupe } = await admin
        .from("whatsapp_messages")
        .select("id")
        .eq("wa_message_id", waMessageId)
        .limit(1);
      if (dupe && dupe.length > 0) {
        await markWhatsAppInboundEvent(admin, inboundEventId, {
          processingStatus: "skipped",
          skipReason: "duplicate_provider_message",
          messageId: dupe[0]?.id || null,
        });
        return new Response(JSON.stringify({ skipped: true, reason: "duplicate" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Find or create the lead (mirrors whatsapp-ai-reply) ──────────────────
    const { data: existingLeads } = await admin
      .from("leads")
      .select("id, counsellor_id, name, stage, person_role")
      .or(`phone.eq.${fromDigits},phone.eq.${leadPhone},phone.eq.+${fromDigits}`)
      .eq("is_mirror", false)
      .limit(1);

    let lead = existingLeads?.[0] || null;

    if (!lead) {
      // Same primitive the Meta webhook uses: promotes a bulk-imported
      // marketing_contacts row on reply, mints a lead only for an unknown
      // number, and runs the intake round-robin. That last part is new here —
      // this path never assigned an owner, so every Plivo-created lead used to
      // land unowned and stay that way.
      const { data: resolvedId, error: leadErr } = await admin.rpc(
        "resolve_or_create_lead_by_phone",
        { _phone: leadPhone, _source: "whatsapp", _reason: "whatsapp_reply" },
      );
      if (leadErr) console.error("plivo resolve/create lead failed:", leadErr);
      if (resolvedId) {
        const { data: resolvedRows } = await admin
          .from("leads")
          .select("id, counsellor_id, name, stage, person_role")
          .eq("id", resolvedId as string)
          .limit(1);
        lead = resolvedRows?.[0] || null;
      }
    }

    // ── Log the inbound message ──────────────────────────────────────────────
    const { data: insertedMsg } = await admin.from("whatsapp_messages").insert({
      lead_id: lead?.id || null,
      wa_message_id: waMessageId,
      direction: "inbound",
      phone: fromDigits,
      message_type: msgType,
      content: text,
      media_url: media0,
      status: "received",
      is_read: false,
      assigned_to: lead?.counsellor_id || null,
      provider: "plivo",
      business_phone_number_id: toDigitsVal || null,
      business_phone_number: toDigitsVal || null,
    }).select("id").single();
    const inboundMessageId: string | null = insertedMsg?.id || null;
    await markWhatsAppInboundEvent(admin, inboundEventId, {
      leadId: lead?.id || null,
      messageId: inboundMessageId,
      processingStatus: inboundMessageId ? "linked" : "error",
      skipReason: inboundMessageId ? null : "whatsapp_message_insert_missing_id",
    });

    if (toDigitsVal) {
      await upsertConversationState(admin, {
        phone: fromDigits,
        businessNumber: toDigitsVal,
        provider: "plivo",
        leadId: lead?.id || null,
        mode: "ai",
        state: msgType === "text" ? "new_unqualified" : "needs_counsellor",
        ownerUserId: lead?.counsellor_id || null,
        escalationRole: msgType === "text" ? null : "counsellor",
        handoffReason: msgType === "text" ? null : "inbound_media",
        priority: msgType === "text" ? "normal" : "high",
      });
    }

    try {
      await invokeConversationOrchestrator({
        source: "plivo_webhook",
        provider: "plivo",
        phone: fromDigits,
        business_number: toDigitsVal,
        message_id: inboundMessageId,
        lead_id: lead?.id || null,
        lead_stage: lead?.stage || null,
        person_role: lead?.person_role || null,
        owner_user_id: lead?.counsellor_id || null,
        message_type: msgType,
        content: text || "",
        dispatch_reply: true,
      });
    } catch (dispatchErr) {
      console.error("conversation orchestrator dispatch error:", dispatchErr);
    }

    // ── Activity + engagement signal (only when we have a lead) ──────────────
    if (lead?.id) {
      await admin.from("lead_activities").insert({
        lead_id: lead.id,
        type: "whatsapp",
        description: `Inbound WhatsApp (Plivo): ${text?.substring(0, 100) || "[media]"}`,
      });
      await admin.from("lead_engagement_events").insert({
        lead_id: lead.id,
        phone: leadPhone,
        event_type: "whatsapp_reply",
        metadata: { message_type: msgType, preview: text?.substring(0, 50) || null, provider: "plivo" },
      });
    }

    // ── Ensure the AI/human guard row exists (defaults to 'ai') ──────────────
    // Creating it here means the inbox toggle has a row to flip from the first
    // message on. whatsapp-ai-reply re-reads this and is the single authority on
    // whether to actually reply (so we can dispatch unconditionally below).
    if (toDigitsVal) {
      await admin
        .from("whatsapp_ai_mode")
        .upsert(
          { phone: fromDigits, business_number: toDigitsVal },
          { onConflict: "phone,business_number", ignoreDuplicates: true },
        );
    }

    let shouldDeferAiReply = false;
    const orchestratorOwnsReplyDecision = true;
    const isClassifiedAwayFromAdmissions =
      lead?.person_role === "job_applicant" || lead?.person_role === "vendor";

    if (!orchestratorOwnsReplyDecision && lead?.id && msgType === "text" && text && !isClassifiedAwayFromAdmissions && lead.stage !== "dnc") {
      try {
        const { data: catResult } = await admin.rpc("auto_categorize_lead_from_message", {
          _lead_id: lead.id,
          _message_text: text,
        });

        if (catResult === "lead" && text.trim().length >= 6) {
          const { data: ambig } = await admin.rpc("wa_message_might_be_non_admission", {
            _text: text,
          });
          if (ambig === true) {
            const { data: queueId } = await admin.rpc("enqueue_wa_classification", {
              _lead_id: lead.id,
              _message_id: inboundMessageId,
              _phone: fromDigits,
              _content: text,
              _dispatch_reply: true,
            });
            if (queueId) {
              shouldDeferAiReply = true;
              const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
              const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
              const classifyRes = await fetch(`${supabaseUrl}/functions/v1/wa-classify-message`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({ queue_id: queueId, dispatch_reply: true }),
              });
              if (!classifyRes.ok) {
                console.error("Plivo classify dispatch failed:", classifyRes.status, await classifyRes.text());
              }
            }
          }
        }
      } catch (classifyErr) {
        console.error("Plivo classification enqueue error:", classifyErr);
      }
    }

    let keywordMatched = false;
    if (!orchestratorOwnsReplyDecision && !shouldDeferAiReply && !isClassifiedAwayFromAdmissions && lead?.stage !== "dnc" && msgType === "text" && text && toDigitsVal) {
      const matched = AUTO_REPLIES.find((rule) => rule.patterns.test(text.trim()));
      if (matched) {
        keywordMatched = true;
        try {
          const sendRes = await sendPlivoWhatsAppText(toDigitsVal, fromDigits, matched.reply);
          if (sendRes.ok) {
            await admin.from("whatsapp_messages").insert({
              lead_id: lead?.id || null,
              wa_message_id: sendRes.messageUuid,
              direction: "outbound",
              phone: fromDigits,
              message_type: "text",
              content: matched.reply,
              status: "sent",
              is_read: true,
              provider: "plivo",
              business_phone_number_id: toDigitsVal,
              template_key: "auto_reply",
            });
          } else {
            console.error("Plivo keyword auto-reply failed:", sendRes.raw);
          }
        } catch (replyErr) {
          console.error("Plivo keyword auto-reply error:", replyErr);
        }
      }
    }

    // ── Dispatch the AI reply (provider = plivo) ─────────────────────────────
    // Only for text. whatsapp-ai-reply gates on human-mode + recent-counsellor
    // backoff, so dispatching here is safe even if the chat is human-handled.
    if (!orchestratorOwnsReplyDecision && !keywordMatched && !shouldDeferAiReply && msgType === "text" && text && toDigitsVal) {
      try {
        const { data: recentMsgs } = await admin
          .from("whatsapp_messages")
          .select("direction, content")
          .eq("phone", fromDigits)
          .order("created_at", { ascending: false })
          .limit(6);

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const aiRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            phone: fromDigits,
            message: text,
            lead_name: lead?.name || null,
            lead_stage: lead?.stage || null,
            course_interest: null,
            recent_messages: (recentMsgs || []).reverse(),
            provider: "plivo",
            business_number: toDigitsVal,
          }),
        });
        if (!aiRes.ok) {
          console.error("Plivo AI reply failed:", aiRes.status, await aiRes.text());
        }
      } catch (aiErr) {
        console.error("Plivo AI reply dispatch error:", aiErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, lead_id: lead?.id || null }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-plivo-webhook error:", err);
    // Still 200 so Plivo doesn't hammer us with retries on a parse edge case;
    // the error is logged for investigation.
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
