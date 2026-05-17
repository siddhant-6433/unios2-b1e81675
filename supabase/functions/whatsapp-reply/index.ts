import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type WhatsAppRoute = "default" | "otp" | "call" | "visit" | "bulk" | "reply";

function routeConfig(route: WhatsAppRoute) {
  const token =
    (route === "otp" ? Deno.env.get("WHATSAPP_OTP_API_TOKEN") : null) ||
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_API_TOKEN") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_API_TOKEN") : null) ||
    (route === "bulk" ? Deno.env.get("WHATSAPP_BULK_API_TOKEN") : null) ||
    (route === "reply" ? Deno.env.get("WHATSAPP_REPLY_API_TOKEN") : null) ||
    Deno.env.get("WHATSAPP_API_TOKEN");

  const phoneNumberId =
    (route === "otp" ? Deno.env.get("WHATSAPP_OTP_PHONE_NUMBER_ID") : null) ||
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_PHONE_NUMBER_ID") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_PHONE_NUMBER_ID") : null) ||
    (route === "bulk" ? Deno.env.get("WHATSAPP_BULK_PHONE_NUMBER_ID") : null) ||
    (route === "reply" ? Deno.env.get("WHATSAPP_REPLY_PHONE_NUMBER_ID") : null) ||
    Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  return { route, token, phoneNumberId };
}

function allowedPhoneConfigs() {
  const configs = [
    routeConfig("default"),
    routeConfig("otp"),
    routeConfig("call"),
    routeConfig("visit"),
    routeConfig("bulk"),
    routeConfig("reply"),
  ];

  return configs.filter((config, index, all) =>
    config.phoneNumberId &&
    all.findIndex((item) => item.phoneNumberId === config.phoneNumberId) === index
  );
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

    const { phone, message, lead_id, bypass_dnc, business_phone_number_id } = await req.json();
    if (!phone || !message) {
      return new Response(JSON.stringify({ error: "phone and message are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestedPhoneNumberId = typeof business_phone_number_id === "string" ? business_phone_number_id : null;
    const matchingConfig = requestedPhoneNumberId
      ? allowedPhoneConfigs().find((config) => config.phoneNumberId === requestedPhoneNumberId)
      : null;
    const defaultConfig = routeConfig("reply");
    const { token: whatsappToken, phoneNumberId } = matchingConfig || defaultConfig;

    if (!whatsappToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: "WhatsApp reply route is not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

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

    const waPhone = phone.replace(/[^0-9]/g, "");

    // Send free-form text message (only works within 24hr conversation window)
    const waResponse = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: waPhone,
          type: "text",
          text: { body: message },
        }),
      }
    );

    const waResult = await waResponse.json();

    if (!waResponse.ok) {
      return new Response(
        JSON.stringify({ error: waResult?.error?.message || "Failed to send" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log to whatsapp_messages
    await admin.from("whatsapp_messages").insert({
      lead_id: lead_id || null,
      wa_message_id: waResult?.messages?.[0]?.id || null,
      direction: "outbound",
      phone: waPhone,
      message_type: "text",
      content: message,
      status: "sent",
      is_read: true,
      business_phone_number_id: phoneNumberId,
    });

    // Log activity
    if (lead_id) {
      await admin.from("lead_activities").insert({
        lead_id,
        user_id: user.id,
        type: "whatsapp",
        description: `WhatsApp reply: ${message.substring(0, 100)}`,
      });
    }

    return new Response(
      JSON.stringify({ success: true, message_id: waResult?.messages?.[0]?.id, business_phone_number_id: phoneNumberId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("WhatsApp reply error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
