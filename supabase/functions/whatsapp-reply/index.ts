import { createClient } from "npm:@supabase/supabase-js@2";
import {
  digits,
  errorMessage,
  isLikelyBusinessPhoneNumber,
  sendWhatsAppText,
  type WhatsAppChannelHint,
  type WhatsAppProvider,
} from "../_shared/whatsapp-channel.ts";
import { logWhatsAppAutomationEvent } from "../_shared/whatsapp-automation-events.ts";
import { recordManualReplyConversationAction } from "../_shared/whatsapp-conversation-action.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function inferRouteFromLatestMessage(
  admin: ReturnType<typeof createClient>,
  phone: string,
  requestedPhoneNumberId: string | null,
): Promise<WhatsAppChannelHint> {
  let query = admin
    .from("whatsapp_messages")
    .select("provider, business_phone_number_id, business_phone_number")
    .eq("phone", digits(phone))
    .order("created_at", { ascending: false })
    .limit(1);

  if (requestedPhoneNumberId) {
    query = query.eq("business_phone_number_id", requestedPhoneNumberId);
  }

  const { data } = await query;
  const latest = data?.[0] as {
    provider?: string | null;
    business_phone_number_id?: string | null;
    business_phone_number?: string | null;
  } | undefined;

  return {
    provider: latest?.provider === "plivo" ? "plivo" : "meta",
    route: "reply",
    businessPhoneNumberId: latest?.business_phone_number_id || requestedPhoneNumberId,
    businessNumber: latest?.business_phone_number || latest?.business_phone_number_id || null,
    requireManualReply: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { phone, message, lead_id, bypass_dnc, business_phone_number_id, provider, business_number } = await req.json();
    if (!phone || !message) {
      return new Response(JSON.stringify({ error: "phone and message are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const requestedProvider: WhatsAppProvider | null = provider === "plivo" || provider === "meta" ? provider : null;
    const rawRequestedPhoneNumberId = typeof business_phone_number_id === "string" ? business_phone_number_id : null;
    const requestedPhoneNumberId = rawRequestedPhoneNumberId && !isLikelyBusinessPhoneNumber(rawRequestedPhoneNumberId)
      ? rawRequestedPhoneNumberId
      : null;
    const requestedBusinessNumber = typeof business_number === "string"
      ? digits(business_number)
      : rawRequestedPhoneNumberId && isLikelyBusinessPhoneNumber(rawRequestedPhoneNumberId)
        ? digits(rawRequestedPhoneNumberId)
        : null;
    const channelHint: WhatsAppChannelHint = requestedProvider
      ? {
        provider: requestedProvider,
        route: requestedProvider === "plivo" ? "plivo_admissions" : "reply",
        businessPhoneNumberId: requestedPhoneNumberId,
        businessNumber: requestedBusinessNumber || requestedPhoneNumberId,
        requireManualReply: true,
      }
      : await inferRouteFromLatestMessage(admin, phone, requestedPhoneNumberId);

    // Block sends to DNC leads — except when the caller is explicitly the
    // DNC farewell flow (Mark DNC button), which marks the lead DNC first
    // and then needs to send the one final notification.
    if (lead_id && !bypass_dnc) {
      const { data: leadCheck } = await admin.from("leads").select("stage").eq("id", lead_id).single();
      if (leadCheck?.stage === "dnc") {
        return new Response(JSON.stringify({ error: "Lead is DNC — message not sent" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const waPhone = digits(phone);
    const sendResult = await sendWhatsAppText(admin, channelHint, waPhone, message);

    if (!sendResult.ok) {
      await logWhatsAppAutomationEvent(admin, {
        phone: waPhone,
        businessNumber: sendResult.businessNumber || sendResult.businessPhoneNumberId || channelHint.businessNumber,
        provider: sendResult.provider,
        leadId: lead_id || null,
        eventType: "send_failed",
        decision: "manual_reply_failed",
        reason: sendResult.error,
        metadata: { status: sendResult.status, raw: sendResult.raw },
      });
      return new Response(
        JSON.stringify({ error: sendResult.error || "Failed to send", detail: sendResult.raw }),
        { status: sendResult.status >= 400 ? sendResult.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actionResult = await recordManualReplyConversationAction(admin, {
      kind: "manualReply",
      phone: waPhone,
      message,
      leadId: lead_id || null,
      userId: user.id,
      businessNumberFallback: channelHint.businessNumber,
      sendResult,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message_id: sendResult.messageId,
        conversation_message_id: actionResult.messageId,
        provider: sendResult.provider,
        business_phone_number_id: sendResult.businessPhoneNumberId,
        business_phone_number: sendResult.businessNumber,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("WhatsApp reply error:", err);
    return new Response(JSON.stringify({ error: errorMessage(err, "WhatsApp reply failed") }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
