import { createClient } from "npm:@supabase/supabase-js@2";
import { digits } from "../_shared/whatsapp-channel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function envPresent(name: string | null | undefined): boolean {
  return !!name && !!Deno.env.get(name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  if (auth !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("id,label,provider,route,business_number,meta_phone_number_id,secret_token_name,is_active,allow_ai,allow_manual_reply,allow_bulk")
    .order("route", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const routeRows = await Promise.all((channels || []).map(async (channel: any) => {
    const businessNumber = digits(channel.business_number || channel.meta_phone_number_id || "");
    const { data: lastSuccess } = await admin
      .from("whatsapp_automation_events")
      .select("event_type,decision,created_at")
      .eq("business_number", businessNumber)
      .in("event_type", ["ai_reply_sent", "inbound_received"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: lastFailure } = await admin
      .from("whatsapp_automation_events")
      .select("event_type,decision,reason,created_at")
      .eq("business_number", businessNumber)
      .eq("event_type", "send_failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      id: channel.id,
      label: channel.label,
      route: channel.route,
      provider: channel.provider,
      is_active: channel.is_active,
      token_present: channel.provider === "meta" ? envPresent(channel.secret_token_name || "WHATSAPP_API_TOKEN") : envPresent("PLIVO_AUTH_TOKEN"),
      sender_present: channel.provider === "meta" ? !!channel.meta_phone_number_id : !!channel.business_number,
      fallback_status: channel.provider === "meta" && !channel.secret_token_name ? "default_token" : "configured",
      allow_ai: channel.allow_ai,
      allow_manual_reply: channel.allow_manual_reply,
      allow_bulk: channel.allow_bulk,
      last_success: lastSuccess || null,
      last_failure: lastFailure || null,
    };
  }));

  return new Response(JSON.stringify({ ok: true, routes: routeRows }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
