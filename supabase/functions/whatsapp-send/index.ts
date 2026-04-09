import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Template definitions with their expected parameters
const TEMPLATES: Record<string, { name: string; params: string[] }> = {
  lead_welcome: { name: "lead_welcome", params: ["student_name", "course_name", "lead_source"] },
  visit_confirmation: { name: "visit_confirmed", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder", params: ["student_name", "visit_date", "campus_name"] },
  application_received: { name: "application_received", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  course_details: { name: "course_details", params: ["student_name", "course_name"] },
  course_info_video: { name: "course_info_video", params: ["student_name", "course_name", "duration", "eligibility", "campus_name"] },
  // User onboarding templates
  staff_welcome: { name: "nimt_new_staff", params: ["name", "role", "campus"] },
  student_welcome: { name: "nimt_student_admitted", params: ["name", "admission_no", "course", "campus"] },
  applicant_welcome: { name: "nimt_application_started", params: ["name", "application_id", "course"] },
  // Counsellor notification templates (internal)
  counsellor_lead_assigned: { name: "counsellor_lead_assigned", params: ["counsellor_name", "lead_name", "lead_phone_last4", "sla_hours"] },
  counsellor_sla_warning: { name: "counsellor_sla_warning", params: ["lead_name", "hours_remaining"] },
  counsellor_lead_reclaimed: { name: "counsellor_lead_reclaimed", params: ["lead_name", "course_name"] },
  counsellor_visit_confirmation: { name: "counsellor_visit_confirmation", params: ["lead_name", "visit_date", "campus_name"] },
  counsellor_followup_overdue: { name: "counsellor_followup_overdue", params: ["lead_name", "followup_date"] },
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

    // Validate auth — accept user JWT, service role key, or cron secret
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("CRON_SECRET");

    const authHeader = req.headers.get("Authorization");
    const reqCronSecret = req.headers.get("x-cron-secret");
    const isCronAuth = cronSecret && reqCronSecret === cronSecret;

    if (!authHeader && !isCronAuth) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader?.replace("Bearer ", "") || "";
    const isServiceRole = token === serviceRoleKey;
    let user: { id: string } | null = null;

    if (isCronAuth || isServiceRole) {
      user = { id: "system" };
    } else {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data, error: authError } = await userClient.auth.getUser();
      if (authError || !data?.user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      user = data.user;
    }

    const { template_key, phone, params, lead_id, header_video_url, button_urls } = await req.json();

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

    const components: any[] = [];

    // Header component (video or image)
    if (header_video_url) {
      components.push({
        type: "header",
        parameters: [{ type: "video", video: { link: header_video_url } }],
      });
    }

    // Body parameters
    if (bodyParams.length > 0) {
      components.push({ type: "body", parameters: bodyParams });
    }

    // URL button parameters (dynamic suffix for each button)
    if (button_urls && Array.isArray(button_urls)) {
      button_urls.forEach((url: string, index: number) => {
        components.push({
          type: "button",
          sub_type: "url",
          index,
          parameters: [{ type: "text", text: url }],
        });
      });
    }

    const waPayload: any = {
      messaging_product: "whatsapp",
      to: waPhone,
      type: "template",
      template: {
        name: templateDef.name,
        language: { code: "en" },
        ...(components.length > 0 ? { components } : {}),
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

    // Log to whatsapp_messages + lead_activities
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Build readable content from template params
    const TEMPLATE_TEXTS: Record<string, string> = {
      lead_welcome: "Hi {{1}}, thank you for your interest in {{2}} at NIMT Educational Institutions. Your inquiry was received from {{3}}. Our admissions team will get in touch with you shortly.",
      visit_confirmation: "Hi {{1}}, your campus visit has been scheduled for {{2}} at {{3}}. We look forward to seeing you! Please carry a valid ID.",
      visit_reminder_24hr: "Hi {{1}}, this is a reminder that your campus visit is scheduled for {{2}} at {{3}}. We look forward to seeing you!",
      application_received: "Hi {{1}}, we have received your application (ID: {{2}}). Our admissions team will review it and get back to you shortly.",
      fee_reminder: "Hi {{1}}, this is a reminder that a fee payment of Rs.{{2}} is due by {{3}}. Please complete the payment to avoid any delays.",
      course_info_video: "Hi {{1}}, here are the details for {{2}} at NIMT Educational Institutions:\n\nDuration: {{3}}\nEligibility: {{4}}\nCampus: {{5}}",
      counsellor_lead_assigned: "Hi {{1}}, a new lead has been assigned to you: {{2}} (Phone: ****{{3}}). Please make first contact within {{4}} hours.",
      counsellor_sla_warning: "Reminder: Lead {{1}} has not been contacted yet. You have {{2}} hour(s) remaining.",
      counsellor_lead_reclaimed: "Lead {{1}} ({{2}}) has been returned to the unassigned bucket due to SLA breach.",
      counsellor_visit_confirmation: "Action needed: Lead {{1}} has a campus visit scheduled for {{2}} at {{3}}. Please call to confirm.",
      counsellor_followup_overdue: "Alert: A follow-up for lead {{1}} was scheduled for {{2}} and is now overdue.",
      staff_welcome: "Welcome to NIMT Educational Institutions, {{1}}!\n\nYou have been added as {{2}} at {{3}}.\n\nPlease check your email for login details.\n\nFor any assistance, contact the admin office.",
      student_welcome: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
      applicant_welcome: "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
    };

    let readableContent = TEMPLATE_TEXTS[template_key] || `[Template: ${template_key}]`;
    if (params && Array.isArray(params)) {
      params.forEach((p: string, i: number) => {
        readableContent = readableContent.replace(`{{${i + 1}}}`, p);
      });
    }

    // Insert into whatsapp_messages for inbox visibility
    await adminClient.from("whatsapp_messages").insert({
      lead_id: lead_id || null,
      wa_message_id: waResult?.messages?.[0]?.id || null,
      direction: "outbound",
      phone: waPhone,
      message_type: "template",
      content: readableContent,
      template_key,
      status: "sent",
      is_read: true,
    });

    if (lead_id) {
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
