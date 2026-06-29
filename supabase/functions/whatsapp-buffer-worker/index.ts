import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ClaimedBuffer = {
  id: string;
  phone: string;
  provider: "meta" | "plivo" | string;
  business_number: string;
  lead_id: string | null;
  first_message_at: string;
  last_message_at: string;
  message_ids: string[];
};

const digits = (value: string | null | undefined) => (value || "").replace(/[^0-9]/g, "");

function classifyLeadTemperature(text: string): { lead_temperature: "hot" | "warm" | "cold"; lead_score: number } {
  const normalized = text.toLowerCase();
  if (/(visit|campus|fee|fees|hostel|apply|application|admission|seat|call|callback|tomorrow|today|pay|payment)/i.test(normalized)) {
    return { lead_temperature: "hot", lead_score: 80 };
  }
  if (/(course|eligibility|duration|placement|scholarship|brochure|details|interested)/i.test(normalized)) {
    return { lead_temperature: "warm", lead_score: 55 };
  }
  return { lead_temperature: "cold", lead_score: 25 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit || 25), 1), 100);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: claimed, error: claimError } = await admin.rpc("claim_due_whatsapp_buffers", { p_limit: limit });
    if (claimError) throw claimError;

    let processed = 0;
    let drafted = 0;
    let failed = 0;
    let slaAlerts = { warnings_created: 0, breaches_created: 0, expiring_created: 0 };

    for (const buffer of (claimed || []) as ClaimedBuffer[]) {
      try {
        const { data: messages, error: messageError } = await admin
          .from("whatsapp_messages")
          .select("id, content, created_at, lead_id")
          .in("id", buffer.message_ids)
          .order("created_at", { ascending: true });
        if (messageError) throw messageError;

        const inboundText = (messages || [])
          .map((message: { content?: string | null }) => message.content || "")
          .filter(Boolean)
          .join("\n")
          .trim();

        if (!inboundText) {
          await admin.from("whatsapp_message_buffers").update({
            status: "cancelled",
            processed_at: new Date().toISOString(),
            error: "empty_buffer",
          }).eq("id", buffer.id);
          continue;
        }

        const { data: state } = await admin
          .from("whatsapp_conversation_state")
          .select("mode,state")
          .eq("phone", digits(buffer.phone))
          .eq("business_number", buffer.business_number)
          .maybeSingle();

        const leadId = buffer.lead_id || (messages || []).find((message: { lead_id?: string | null }) => message.lead_id)?.lead_id || null;
        if (leadId) {
          const temperature = classifyLeadTemperature(inboundText);
          await admin.from("leads").update({
            lead_temperature: temperature.lead_temperature,
            lead_score: temperature.lead_score,
          }).eq("id", leadId);
        }

        if (state?.mode === "human") {
          await admin.from("whatsapp_ai_drafts").insert({
            conversation_key: `${digits(buffer.phone)}:${buffer.provider}:${buffer.business_number}`,
            phone: digits(buffer.phone),
            provider: buffer.provider || "meta",
            business_number: buffer.business_number,
            lead_id: leadId,
            draft_text: inboundText,
            reason: "human_mode_buffered_inbound",
            confidence: 0,
            grounding_refs: [{ type: "whatsapp_message_buffer", id: buffer.id }],
          });
          await admin.from("whatsapp_message_buffers").update({
            status: "processed",
            processed_at: new Date().toISOString(),
          }).eq("id", buffer.id);
          drafted += 1;
          continue;
        }

        const aiResponse = await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone: buffer.phone,
            message: inboundText,
            recent_messages: inboundText,
            lead_id: leadId,
            provider: buffer.provider === "plivo" ? "plivo" : "meta",
            business_number: buffer.business_number,
            business_phone_number_id: buffer.provider === "meta" ? buffer.business_number : null,
          }),
        });

        if (!aiResponse.ok) {
          const errorBody = await aiResponse.text();
          throw new Error(`whatsapp-ai-reply ${aiResponse.status}: ${errorBody.slice(0, 500)}`);
        }

        await admin.from("whatsapp_message_buffers").update({
          status: "processed",
          processed_at: new Date().toISOString(),
        }).eq("id", buffer.id);
        processed += 1;
      } catch (err) {
        failed += 1;
        await admin.from("whatsapp_message_buffers").update({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          processed_at: new Date().toISOString(),
        }).eq("id", buffer.id);
      }
    }

    const { data: slaData, error: slaError } = await admin.rpc("create_whatsapp_sla_alerts");
    if (slaError) {
      console.warn("WhatsApp SLA alert sweep failed:", slaError.message);
    } else if (Array.isArray(slaData) && slaData[0]) {
      slaAlerts = {
        warnings_created: Number(slaData[0].warnings_created || 0),
        breaches_created: Number(slaData[0].breaches_created || 0),
        expiring_created: Number(slaData[0].expiring_created || 0),
      };
    }

    return new Response(JSON.stringify({
      ok: true,
      claimed: claimed?.length || 0,
      processed,
      drafted,
      failed,
      sla_alerts: slaAlerts,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("whatsapp-buffer-worker error:", message);
    return new Response(JSON.stringify({ error: message || "Buffer worker failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
