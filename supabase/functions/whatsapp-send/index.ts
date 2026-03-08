import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Template definitions with their expected parameters
const TEMPLATES: Record<string, { name: string; params: string[] }> = {
  lead_welcome: { name: "lead_welcome", params: ["student_name", "course_name"] },
  visit_confirmation: { name: "visit_confirmation", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder_24hr", params: ["student_name", "visit_date"] },
  application_received: { name: "application_received", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  course_details: { name: "course_details", params: ["student_name", "course_name"] },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const whatsappToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!whatsappToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: "WhatsApp API not configured. Contact administrator." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate auth
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { template_key, phone, params, lead_id } = await req.json();

    if (!template_key || !phone) {
      return new Response(
        JSON.stringify({ error: "template_key and phone are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateDef = TEMPLATES[template_key];
    if (!templateDef) {
      return new Response(
        JSON.stringify({ error: `Unknown template: ${template_key}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build template components
    const waPhone = phone.replace(/[^0-9]/g, "");
    const bodyParams = (params || []).map((p: string) => ({ type: "text", text: p }));

    const waPayload: any = {
      messaging_product: "whatsapp",
      to: waPhone,
      type: "template",
      template: {
        name: templateDef.name,
        language: { code: "en" },
        ...(bodyParams.length > 0
          ? { components: [{ type: "body", parameters: bodyParams }] }
          : {}),
      },
    };

    const waResponse = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(waPayload),
      }
    );

    const waResult = await waResponse.json();

    if (!waResponse.ok) {
      console.error("WhatsApp send error:", JSON.stringify(waResult));
      return new Response(
        JSON.stringify({
          error: waResult?.error?.message || "Failed to send WhatsApp message",
          meta_error: waResult?.error?.message,
        }),
        { status: waResponse.status >= 400 && waResponse.status < 500 ? waResponse.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log activity if lead_id provided
    if (lead_id) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      await adminClient.from("lead_activities").insert({
        lead_id,
        user_id: user.id,
        type: "whatsapp",
        description: `WhatsApp sent — Template: ${template_key.replace(/_/g, " ")}`,
      });
    }

    return new Response(
      JSON.stringify({ success: true, message_id: waResult?.messages?.[0]?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("WhatsApp send error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
