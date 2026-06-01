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
// PR1 scope: log the inbound message, create/lookup the lead (so every new
// message generates a lead — the core ask), and ensure a whatsapp_ai_mode row
// exists for the conversation. Outbound AI/template sending via Plivo is a
// follow-up PR; this function deliberately does NOT reply yet.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Only handle WhatsApp inbound. If Plivo ever points SMS at this URL, ack
    // and ignore rather than misfiling it as a WhatsApp lead.
    const channelType = pick(body, "Type", "type").toLowerCase();
    if (channelType && channelType !== "whatsapp") {
      return new Response(JSON.stringify({ skipped: true, reason: `type=${channelType}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromDigits = toDigits(pick(body, "From", "from", "src"));
    const toDigitsVal = toDigits(pick(body, "To", "to", "dst"));
    const text = pick(body, "Text", "text", "Body", "body") || null;
    const waMessageId = pick(body, "MessageUUID", "message_uuid", "MessageUUID0") || null;
    const media0 = pick(body, "Media0", "media0", "MediaUrl0") || null;

    if (!fromDigits) {
      // Status callbacks (delivery receipts) and other non-message events have
      // no From — ack so Plivo doesn't retry.
      return new Response(JSON.stringify({ skipped: true, reason: "no_from" }), {
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
        return new Response(JSON.stringify({ skipped: true, reason: "duplicate" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const msgType = media0 ? "image" : "text";
    const leadPhone = toLeadPhone(fromDigits);

    // ── Find or create the lead (mirrors whatsapp-ai-reply) ──────────────────
    const { data: existingLeads } = await admin
      .from("leads")
      .select("id, counsellor_id, name, stage")
      .or(`phone.eq.${fromDigits},phone.eq.${leadPhone},phone.eq.+${fromDigits}`)
      .eq("is_mirror", false)
      .limit(1);

    let lead = existingLeads?.[0] || null;

    if (!lead) {
      const { data: newLead, error: leadErr } = await admin
        .from("leads")
        .insert({
          phone: leadPhone,
          source: "whatsapp",
          stage: "new_lead",
          name: leadPhone,
        })
        .select("id, counsellor_id, name, stage")
        .single();
      if (leadErr) console.error("plivo lead insert failed:", leadErr);
      lead = newLead || null;
    }

    // ── Log the inbound message ──────────────────────────────────────────────
    await admin.from("whatsapp_messages").insert({
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
    });

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

    // ── Dispatch the AI reply (provider = plivo) ─────────────────────────────
    // Only for text. whatsapp-ai-reply gates on human-mode + recent-counsellor
    // backoff, so dispatching here is safe even if the chat is human-handled.
    if (msgType === "text" && text && toDigitsVal) {
      try {
        const { data: recentMsgs } = await admin
          .from("whatsapp_messages")
          .select("direction, content")
          .eq("phone", fromDigits)
          .order("created_at", { ascending: false })
          .limit(6);

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
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
