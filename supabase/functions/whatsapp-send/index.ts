import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Template definitions with their expected parameters
const TEMPLATES: Record<string, { name: string; params: string[] }> = {
  lead_welcome: { name: "admissions_lead_intro", params: ["student_name", "course_name", "lead_source"] },
  visit_confirmation: { name: "visit_confirmed", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder", params: ["student_name", "visit_date", "campus_name"] },
  application_received: { name: "application_received", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  course_details: { name: "inquiry_course_update", params: ["student_name", "course_name"] },
  course_info_video: { name: "course_info_video", params: ["student_name", "course_name", "duration", "eligibility", "campus_name"] },
  // Counsellor utility — tap-to-call link sent to counsellor's own phone
  counsellor_call_lead: { name: "lead_queue_item", params: ["counsellor_name", "lead_name", "lead_phone", "course"] },
  // Call disposition auto-replies to leads
  // admissions_call_attempt is MARKETING (won't deliver). Use followup_update as fallback.
  missed_call: { name: "admissions_followup_update", params: ["student_name", "course_name"] },
  callback_scheduled: { name: "admissions_followup_update", params: ["student_name", "course_name"] },
  // User onboarding templates
  staff_welcome: { name: "nimt_new_staff", params: ["name", "role", "campus"] },
  student_welcome: { name: "nimt_student_admitted", params: ["name", "admission_no", "course", "campus"] },
  applicant_welcome: { name: "nimt_application_started", params: ["name", "application_id", "course"] },
  // Counsellor notification templates (internal)
  counsellor_lead_assigned: { name: "counsellor_lead_assigned", params: ["counsellor_name", "lead_name", "lead_phone_last4", "sla_hours"] },
  counsellor_sla_warning: { name: "counsellor_sla_warning", params: ["lead_name", "hours_remaining"] },
  counsellor_lead_reclaimed: { name: "counsellor_lead_reclaimed", params: ["lead_name", "course_name"] },
  // AI call follow-up with course link + apply button
  ai_call_course_info: { name: "ai_call_course_info", params: ["student_name", "course_name", "campus_name", "course_url", "apply_url"] },
  // Post-call summary — sent at the end of an answered AI call.
  // Body opens with "as discussed on our call" so it reads as a natural
  // continuation. Includes course video URL when the course has one.
  // Submit to Meta as UTILITY category so it sends without 24h reply window.
  ai_call_post_summary: { name: "ai_call_post_summary", params: ["student_name", "course_name", "campus_name", "course_url", "apply_url", "video_url"] },
  // Missed-call follow-up — sent when AI couldn't reach the lead. Apologises,
  // gives the dialer number to call back, and shares course info + video.
  // Submit to Meta as UTILITY (informational, not promotional).
  ai_missed_call_followup: { name: "ai_missed_call_followup", params: ["student_name", "course_name", "dialer_phone", "course_url", "video_url"] },
  // Team leader TAT defaults
  team_leader_defaults: { name: "team_leader_defaults_report", params: ["leader_name", "total_count", "summary"] },
  counsellor_visit_confirmation: { name: "counsellor_visit_confirmation", params: ["lead_name", "visit_date", "campus_name"] },
  // Student feedback (post-call / post-visit)
  post_call_feedback: { name: "post_interaction_feedback", params: ["student_name", "interaction_text"] },
  post_visit_feedback: { name: "post_interaction_feedback", params: ["student_name", "interaction_text"] },
  counsellor_followup_overdue: { name: "counsellor_followup_overdue", params: ["lead_name", "followup_date"] },
  // Sent when AN issues — gives student a one-click link to claim StudentPortal access.
  // Body params: name, admission_no. The claim URL is passed as the dynamic suffix
  // for the template's URL button (button_urls=[claim_url]).
  student_portal_invite: { name: "student_portal_invite", params: ["student_name", "admission_no"] },

  // Manual apply-portal magic link sent by counsellors from the
  // ApplyMagicLinkButton dialog ("Send via WhatsApp"). URL button takes
  // the magic-link token as its dynamic suffix:
  //   button_urls=[token]
  // Body params: name, formatted-IST expiry string.
  apply_portal_login: { name: "apply_portal_login", params: ["student_name", "expiry"] },

  // ── Lifecycle notifications (5 events) ────────────────────────────────
  // Each requires a matching template in Meta Business Manager. Until
  // approved there, sends fail gracefully and the trigger logs the URL
  // for manual delivery via lead_activities.

  // 1. Application submitted — confirms receipt, attaches form PDF as button URL.
  application_submitted:  { name: "application_submitted",  params: ["student_name", "application_id"] },
  // 2. Application fee paid — receipt + form PDF link.
  app_fee_receipt:        { name: "app_fee_receipt",        params: ["student_name", "amount", "application_id"] },
  // 3. Offer letter issued — offer PDF + magic-link to accept & pay token.
  // button_urls = [offer_pdf_url, magic_pay_url]
  offer_letter_issued:    { name: "offer_letter_issued",    params: ["student_name", "course_name", "net_fee", "deadline"] },
  // 4. PAN issued — nudge to pay balance for AN. magic_pay_url for one-tap.
  pan_nudge_balance:      { name: "pan_nudge_balance",      params: ["student_name", "pre_admission_no", "balance_amount"] },
  // 6. Document rejected — student must re-upload. URL button to apply portal.
  doc_rejected:           { name: "doc_rejected",           params: ["student_name", "doc_name", "reason"] },
  // 7. Application rejected — admin declined the whole application.
  application_rejected:   { name: "application_rejected",   params: ["student_name", "application_id", "reason"] },
  // 8. Application approved — admin approved; student is invited to the apply portal.
  application_approved:   { name: "application_approved",   params: ["student_name", "application_id", "course_name"] },

  // 5. Token / other fee paid — uses the pre-existing APPROVED template
  // in Meta whose body is:
  //   "Hi {{1}}, we've received your payment of ₹{{3}} towards {{2}}.
  //    Receipt No: {{4}}
  //    Download: {{5}}
  //    NIMT Educational Institutions"
  // Note the unusual order (amount is {{3}}, type is {{2}}) — preserved
  // here because the template is already approved and we don't want to
  // submit a divergent variant.
  payment_receipt:        { name: "payment_receipt",        params: ["student_name", "payment_type", "amount", "receipt_no", "download_url"] },

  // ── Course info (data-driven) ─────────────────────────────────────────
  // Body params + both button URLs are resolved per-lead via the
  // fn_resolve_course_info_params RPC when caller passes only
  // {template_key, phone, lead_id}. Caller can also supply params/button_urls
  // explicitly to override.
  course_info_v1:         { name: "course_info_v1",         params: ["student_name", "course_name", "duration", "eligibility", "approval"] },
  // Fallback when lead.course_id is null — no params beyond name.
  course_info_generic:    { name: "course_info_generic",    params: ["student_name"] },

  // Visit reminder with counsellor name (replaces older visit_reminder once
  // approved by Meta). button_urls=[google_maps_cid].
  visit_reminder_v2:      { name: "visit_reminder_v2",      params: ["student_name", "course_name", "visit_date", "campus_name", "counsellor_name"] },

  // Offer letter with single-tap accept+pay portal. button_urls=[token].
  offer_letter_acceptance: { name: "offer_letter_acceptance", params: ["student_name", "course_name", "net_fee", "deadline"] },

  // Manual not-interested closure (counsellor-triggered only).
  nimt_not_interested_ack: { name: "nimt_not_interested_ack", params: ["student_name", "course_name", "counsellor_name", "counsellor_phone"] },

  // Personal follow-up after a connected interested / call-back disposition.
  // params: [student_name, formatted_date, counsellor_name, counsellor_phone]
  nimt_followup_v1:        { name: "nimt_followup_v1",        params: ["student_name", "followup_date", "counsellor_name", "counsellor_phone"] },
};

type WhatsAppRoute = "default" | "call" | "visit";

const CALL_TEMPLATE_KEYS = new Set([
  "missed_call",
  "callback_scheduled",
  "counsellor_call_lead",
  "ai_call_course_info",
  "ai_call_post_summary",
  "ai_missed_call_followup",
  "post_call_feedback",
  // Course info follow-up is sent right after an AI call disposition, so it
  // belongs on the call route to keep quality ratings aligned with the rest
  // of the post-call flow.
  "course_info_v1",
  "course_info_generic",
  // Follow-up to a manual call disposition — belongs on the call route.
  "nimt_not_interested_ack",
  "nimt_followup_v1",
]);

const VISIT_TEMPLATE_KEYS = new Set([
  "visit_confirmation",
  "visit_reminder_24hr",
  "visit_reminder_v2",
  "counsellor_visit_confirmation",
  "post_visit_feedback",
]);

function getRouteForTemplate(templateKey: string): WhatsAppRoute {
  if (CALL_TEMPLATE_KEYS.has(templateKey)) return "call";
  if (VISIT_TEMPLATE_KEYS.has(templateKey)) return "visit";
  return "default";
}

function getWhatsAppConfig(route: WhatsAppRoute) {
  const token =
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_API_TOKEN") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_API_TOKEN") : null) ||
    Deno.env.get("WHATSAPP_API_TOKEN");

  const phoneNumberId =
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_PHONE_NUMBER_ID") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_PHONE_NUMBER_ID") : null) ||
    Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  return { token, phoneNumberId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth — accept user JWT, service role key, cron secret, or voice agent key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("CRON_SECRET");
    const voiceAgentKey = Deno.env.get("VOICE_AGENT_KEY");

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
    const isServiceRole = token === serviceRoleKey || (voiceAgentKey && token === voiceAgentKey);
    // user.id must be a valid UUID or null (lead_activities.user_id is uuid).
    // For system/automation calls, use null so inserts don't fail.
    let user: { id: string | null } | null = null;

    if (isCronAuth || isServiceRole) {
      user = { id: null };
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

    let { template_key, phone, params, lead_id, header_video_url, button_urls } = await req.json();

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // course_info_v1 can be invoked with only {template_key, phone, lead_id}.
    // Fill body params + button URLs from fn_resolve_course_info_params so
    // every caller (AI post-call, disposition nudge, manual sends) emits a
    // consistent message without hand-assembling the args. If the lead has no
    // course_id the resolver returns null and we fall back to the generic
    // template.
    if (template_key === "course_info_v1" && lead_id && (!params || params.length === 0)) {
      const { data: resolved, error: resolveErr } = await admin.rpc(
        "fn_resolve_course_info_params",
        { p_lead_id: lead_id }
      );
      if (resolveErr) {
        console.error("course_info_v1 resolver failed:", resolveErr.message);
      }
      if (resolved && typeof resolved === "object") {
        params = [
          resolved.student_name,
          resolved.course_name,
          resolved.duration,
          resolved.eligibility,
          resolved.approval,
        ];
        // Both URL buttons take only the variable suffix appended after the
        // template's fixed prefix (https://www.nimt.ac.in/courses/). The
        // resolver returns full URLs, so strip the prefix here.
        const prefix = "https://www.nimt.ac.in/courses/";
        const videoSuffix = typeof resolved.video_url === "string" && resolved.video_url.startsWith(prefix)
          ? resolved.video_url.slice(prefix.length)
          : resolved.course_url?.slice(prefix.length) || "";
        const courseSuffix = typeof resolved.course_url === "string" && resolved.course_url.startsWith(prefix)
          ? resolved.course_url.slice(prefix.length)
          : "";
        button_urls = [videoSuffix, courseSuffix];
      } else {
        // No course on the lead — switch to the generic template.
        template_key = "course_info_generic";
        const { data: leadRow } = await admin.from("leads").select("name").eq("id", lead_id).single();
        params = [leadRow?.name || "there"];
        button_urls = undefined;
      }
    }

    // Block sends to DNC leads
    if (lead_id) {
      const { data: leadCheck } = await admin.from("leads").select("stage").eq("id", lead_id).single();
      if (leadCheck?.stage === "dnc") {
        return new Response(JSON.stringify({ error: "Lead is DNC — message not sent" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    const phoneRoute = getRouteForTemplate(template_key);
    const { token: whatsappToken, phoneNumberId } = getWhatsAppConfig(phoneRoute);

    if (!whatsappToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: `WhatsApp ${phoneRoute} route is not configured. Contact administrator.` }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Parse body as text first so we can keep the raw response for the failed
    // path even when Meta returns non-JSON (e.g. plain-text 5xx from the edge).
    const waResultText = await waResponse.text().catch(() => "");
    let waResult: any = null;
    try { waResult = waResultText ? JSON.parse(waResultText) : null; } catch { waResult = null; }

    // Log to whatsapp_messages + lead_activities (even if Meta rejected it)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const metaFailed = !waResponse.ok;

    if (metaFailed) {
      console.error("WhatsApp send error:", JSON.stringify(waResult));
    }

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
      counsellor_call_lead: "Hello {{1}}, a lead has been added to your queue.\n\nLead Name: {{2}}\nTap to Call: {{3}}\nCourse Interest: {{4}}\n\nTap the phone number above to dial the lead directly from your phone. Open the full lead record below to log the call outcome.",
      missed_call: "Dear {{1}}, the admissions office at NIMT Educational Institutions attempted to reach you regarding {{2}}. We were unable to connect on the call. You may reach us by replying to this message or by calling the admissions office during working hours. A counsellor will attempt to contact you again.",
      callback_scheduled: "Dear {{1}}, thank you for your time regarding {{2}} at NIMT Educational Institutions. As per your request, a counsellor from the admissions office will reach out to you at a suitable time. If you need to reschedule or have any queries, please reply to this message. We are happy to assist you.",
      staff_welcome: "Welcome to NIMT Educational Institutions, {{1}}!\n\nYou have been added as {{2}} at {{3}}.\n\nPlease check your email for login details.\n\nFor any assistance, contact the admin office.",
      student_welcome: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
      student_portal_invite: "Welcome {{1}}! Your admission (AN: {{2}}) is confirmed. Tap the button below to access the Student Portal — fees, attendance, notices, and more.",
      application_submitted: "Hi {{1}}, your application ({{2}}) has been received. Please pay the application fee to begin processing. The completed form PDF is attached for your records.",
      app_fee_receipt: "Hi {{1}}, we've received your application fee of ₹{{2}}. Application: {{3}}. Receipt PDF is attached. Our admissions team will reach out for the next steps.",
      offer_letter_issued: "Congratulations {{1}}! You have been offered admission to {{2}}. Net fee: ₹{{3}}. Please accept by {{4}}. Tap below to view the offer letter and pay your token fee online.",
      pan_nudge_balance: "Hi {{1}}, your pre-admission number is {{2}}. Pay the balance of ₹{{3}} to confirm enrollment and receive your Admission Number. Tap below to pay online.",
      payment_receipt: "Dear {{1}}, payment of ₹{{2}} received. Receipt no: {{3}}. The receipt PDF is attached for your records.",
      doc_rejected: "Hi {{1}}, your uploaded document \"{{2}}\" needs attention. Reason: {{3}}. Please re-upload a corrected version in the apply portal so your admission can proceed.",
      application_rejected: "Dear {{1}}, after review we are unable to proceed with your application {{2}}. Reason: {{3}}. Please contact our admissions office if you'd like to discuss alternatives.",
      application_approved: "Congratulations {{1}}! Your application {{2}} for {{3}} has been approved. Our admissions team will be in touch with your offer letter shortly. Tap below to track your application in the apply portal.",
      applicant_welcome: "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
      ai_call_course_info: "Hi {{1}}, thank you for speaking with us about {{2}} at NIMT Educational Institutions! 🎓\n\n🏫 Campus: {{3}}\n\n📄 Course Details: {{4}}\n📝 Apply Now: {{5}}\n\nFor questions, reply to this message or call our admissions team.\n\nWe look forward to welcoming you!",
      ai_call_post_summary: "Hi {{1}}, as discussed on our call, here are the details for {{2}} at NIMT Educational Institutions:\n\n🏫 Campus: {{3}}\n📄 Course details: {{4}}\n📝 Apply now: {{5}}\n🎥 Watch course video: {{6}}\n\nReply to this message for any questions, or our admissions team will reach out shortly.",
      ai_missed_call_followup: "Hi {{1}}, this is Navya from NIMT Educational Institutions. I tried calling you regarding your enquiry about {{2}}.\n\nPlease feel free to call back at {{3}} during 9 AM-8 PM IST.\n\n📄 Course information: {{4}}\n🎥 Watch course video: {{5}}\n\nLooking forward to assisting you with your admission journey.",
      apply_portal_login: "Hi {{1}}, your secure login link for the NIMT application portal is ready. Tap the button below to complete your application or pay your token fee directly — no OTP needed. The link is valid until {{2}}, so please use it before it expires.",
      course_info_v1: "Hi {{1}}, here are the details for {{2}} at NIMT:\n• Duration: {{3}}\n• Eligibility: {{4}}\n• Accreditation: {{5}}\n\nWatch a short course video or view the full fees and syllabus on the course page. Reply STOP to opt out.",
      course_info_generic: "Hi {{1}}, thanks for your interest in NIMT Educational Institutions. We offer programmes in nursing, paramedical, pharma, management, education, law, and engineering across our Greater Noida, Ghaziabad, and Kotputli campuses. Browse the full list, fees, and eligibility on our website. Reply STOP to opt out.",
      visit_reminder_v2: "Hi {{1}}, your campus visit for {{2}} is on {{3}} at {{4}}. Your counsellor {{5}} will meet you there. Tap below for directions to the campus.",
      offer_letter_acceptance: "Congratulations {{1}}! NIMT has issued your offer letter for {{2}}. Net fee: Rs.{{3}}. Please accept by {{4}}. Tap below to view your offer, accept it, and pay the token fee in one secure step.",
      nimt_not_interested_ack: "Hi {{1}}, thanks for speaking with us about {{2}}. We've marked your enquiry as \"not interested\" and won't reach out unless you'd like us to. If you'd like to revisit this in the future, message {{3}} directly on {{4}}. Reply STOP to fully opt out.",
    };

    let readableContent = TEMPLATE_TEXTS[template_key] || `[Template: ${template_key}]`;
    if (params && Array.isArray(params)) {
      params.forEach((p: string, i: number) => {
        readableContent = readableContent.replace(`{{${i + 1}}}`, p);
      });
    }

    // Insert into whatsapp_messages for inbox visibility — log even if Meta rejected.
    // status_error captures everything we know about the failure so the spam
    // dashboard and the per-message inbox can show what Meta complained about.
    const statusErrorPayload = metaFailed
      ? {
          http_status: waResponse.status,
          ...(waResult?.error ? { error: waResult.error } : {}),
          ...(waResult && !waResult.error ? { body: waResult } : {}),
          ...(!waResult && waResultText ? { raw: waResultText.slice(0, 1000) } : {}),
        }
      : null;

    await adminClient.from("whatsapp_messages").insert({
      lead_id: lead_id || null,
      wa_message_id: waResult?.messages?.[0]?.id || null,
      direction: "outbound",
      phone: waPhone,
      message_type: "template",
      content: readableContent,
      template_key,
      status: metaFailed ? "failed" : "sent",
      is_read: true,
      business_phone_number_id: phoneNumberId,
      status_error: statusErrorPayload,
    });

    if (lead_id) {
      const isSystem = user.id === null;
      const statusLabel = metaFailed ? "failed" : "sent";
      const { error: actErr } = await adminClient.from("lead_activities").insert({
        lead_id,
        user_id: user.id,
        type: "whatsapp",
        description: isSystem
          ? `Automated WhatsApp ${statusLabel} — ${template_key.replace(/_/g, " ")}`
          : `WhatsApp ${statusLabel} — Template: ${template_key.replace(/_/g, " ")}`,
      });
      if (actErr) console.error("lead_activities insert failed:", actErr.message);
    }

    if (metaFailed) {
      return new Response(
        JSON.stringify({
          error: waResult?.error?.message || "Failed to send WhatsApp message",
          meta_error: waResult?.error?.message,
        }),
        { status: waResponse.status >= 400 && waResponse.status < 500 ? waResponse.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message_id: waResult?.messages?.[0]?.id, phone_route: phoneRoute, business_phone_number_id: phoneNumberId }),
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
