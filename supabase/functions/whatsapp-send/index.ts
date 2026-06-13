import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsAppTemplate, type WhatsAppChannelRoute } from "../_shared/whatsapp-channel.ts";
import {
  expectedReplyTypeForTemplate,
  recordWhatsAppOutboundContext,
  responsePolicyForTemplate,
} from "../_shared/whatsapp-outbound-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function cahetDeadlineMessage(): string {
  const bodyDate = "14th June 2026";
  const prefix = "";
  return `Dear Applicant,

This is to inform you that for admission to *BPT (Bachelors of Physiotherapy) and BMRIT (Bachelors of Medical Radiological Imaging Technology)* - ${prefix}Last date for Application Submission is *${bodyDate}, 11:59 PM*

For admission Candidates *MUST*

1. Complete College Application Online at https://apply.nimt.ac.in
2. Complete the CAHET Registration on ABVMUP (This is mandatory for admission to BPT/BMRIT across Uttar Pradesh) : https://www.abvmucet26.co.in/entrance2026/login?form=4

Please note both form submissions are mandatory by ${bodyDate}, 11:59 PM to be included in the admission process for session 2026-27.

For any details please call 9555192192
9667691872
7428499849`;
}

// Template definitions with their expected parameters
const TEMPLATES: Record<string, { name: string; params: string[] }> = {
  lead_welcome: { name: "admissions_lead_intro", params: ["student_name", "course_name", "lead_source"] },
  visit_confirmation: { name: "visit_confirmed", params: ["student_name", "visit_date", "campus_name"] },
  visit_reminder_24hr: { name: "visit_reminder", params: ["student_name", "visit_date", "campus_name"] },
  // Meta-approved template is named `application_submitted` (see
  // submit-wa-templates). Internal key stays `application_received` for
  // backwards compatibility with callers, AutomationRules, and the inbox UI.
  application_received: { name: "application_submitted", params: ["student_name", "application_id"] },
  fee_reminder: { name: "fee_reminder", params: ["student_name", "amount", "due_date"] },
  course_details: { name: "inquiry_course_update", params: ["student_name", "course_name"] },
  course_info_video: { name: "course_info_video", params: ["student_name", "course_name", "duration", "eligibility", "campus_name"] },
  // Body-link replacement for course_info_video. Params resolved per-lead by
  // fn_resolve_course_info_video_params when caller passes only {template_key,
  // phone, lead_id}. URLs live in the body (no Meta button-prefix locks), each
  // with a fallback: /courses listing when untagged course, /contact page when
  // untagged campus, and the correct uni.nimt.ac.in apply domain.
  course_info_video_v2: { name: "course_info_video_v2", params: ["student_name", "course_label", "course_url", "campus_url", "apply_url"] },
  bpt_bmrit_cahet_deadline: { name: "bpt_bmrit_cahet_deadline", params: [] },
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
  // 4a. Token-fee deadline reminder — fired by token-fee-reminders cron
  // at 2d / 1d / 4h before offer.acceptance_deadline. Body params:
  //   student_name, course_name, amount, time_left (e.g. "2 days", "4 hours")
  // URL button suffix is the magic apply-portal token so one tap takes
  // the applicant straight to the pay screen.
  token_fee_reminder:     { name: "token_fee_reminder",     params: ["student_name", "course_name", "amount", "time_left"] },
  // 6. Document rejected — student must re-upload. URL button to apply portal.
  doc_rejected:           { name: "doc_rejected",           params: ["student_name", "doc_name", "reason"] },
  // 7. Application rejected — admin declined the whole application.
  application_rejected:   { name: "application_rejected",   params: ["student_name", "application_id", "reason"] },
  // 8. Application approved — admin approved; student is invited to the apply portal.
  application_approved:   { name: "application_approved",   params: ["student_name", "application_id", "course_name"] },

  // 4b. Admission payment nudge — manual send from the Applications-list
  // "Nudge" button. Body params:
  //   {{1}} student_name
  //   {{2}} course_name
  //   {{3}} an_amount       — ₹ amount the candidate must pay to trigger AN
  //   {{4}} year1_amount    — full Sem 1 balance still owed
  //   {{5}} due_date        — Sem 1 due date (formatted, e.g. "15 June 2026")
  // Submit to Meta as UTILITY (it's transactional — payment due for an
  // existing offer). No buttons by default; admin can add an "Apply Portal"
  // URL button later if desired.
  admission_payment_nudge: {
    name: "admission_payment_nudge",
    params: ["student_name", "course_name", "an_amount", "year1_amount", "due_date"],
  },

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
  // v2: single "View fees & apply" button, no video.
  course_info_v2:         { name: "course_info_v2",         params: ["student_name", "course_name", "duration", "eligibility", "approval"] },
  // v3: same body as v1/v2 + the actual courses.video_url as a 6th body
  // param (WhatsApp auto-linkifies URLs in body text). Single button to
  // the fees section. This is the right shape because Meta button prefixes
  // can't host arbitrary external URLs (youtu.be / instagram.com / etc).
  course_info_v3:         { name: "course_info_v3",         params: ["student_name", "course_name", "duration", "eligibility", "approval", "video_url"] },
  // v4: same 6 params as v3 but the body is rewritten as "as requested,
  // here are the details you enquired about" so Meta categorises as UTILITY
  // (v3 got auto-flipped to MARKETING because of promotional CTAs). Button
  // text changed to "Open course page" — no "fees & apply" wording.
  course_info_v4:         { name: "course_info_v4",         params: ["student_name", "course_name", "duration", "eligibility", "approval", "video_url"] },
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
  // v2 rewrites the body as an appointment-confirmation so Meta
  // categorises as UTILITY (v1 got auto-flipped to MARKETING).
  nimt_followup_v2:        { name: "nimt_followup_v2",        params: ["student_name", "followup_date", "counsellor_name", "counsellor_phone"] },

  // ── Video portal notifications ────────────────────────────────────────
  // Sent to super-admin phones when an editor submits a video for approval.
  video_submitted_admin:   { name: "video_submitted_admin",  params: ["editor_name", "video_title", "brand_name"] },
  // Sent to the editor's phone when their video is approved — prompts them to
  // post it and submit the published Instagram/LinkedIn/YouTube links.
  video_approved_editor:   { name: "video_approved_editor",  params: ["editor_name", "video_title"] },
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
  "course_info_v2",
  "course_info_v3",
  "course_info_v4",
  "course_info_generic",
  // Follow-up to a manual call disposition — belongs on the call route.
  "nimt_not_interested_ack",
  "nimt_followup_v1",
  "nimt_followup_v2",
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

    const requestBody = await req.json();
    let { template_key, params, button_urls } = requestBody;
    const { phone, lead_id, header_video_url, clear_unread_after_send } = requestBody;

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // nimt_followup_v1 and nimt_not_interested_ack: caller passes a short
    // 2-element params array (name+date for followup, name+course for
    // closure). We fill the counsellor signature (name + phone) from
    // profiles + PLIVO_DIALER_PHONE_NUMBER env var so the fallback chain
    // lives in one place and the Plivo number can be rotated via Supabase
    // secrets without a code change.
    if ((template_key === "nimt_followup_v1" || template_key === "nimt_followup_v2" || template_key === "nimt_not_interested_ack") && lead_id && params && params.length === 2) {
      let counsellorName = "the admissions team";
      let counsellorPhone: string | null = null;
      try {
        const { data: row } = await admin
          .from("leads")
          .select("counsellor:profiles!counsellor_id(display_name,official_phone)")
          .eq("id", lead_id)
          .maybeSingle();
        const c = (row as any)?.counsellor;
        if (c?.display_name) counsellorName = c.display_name;
        if (c?.official_phone && String(c.official_phone).trim().length > 0) {
          counsellorPhone = String(c.official_phone).trim();
        }
      } catch (e) {
        console.error("counsellor lookup failed:", e);
      }
      if (!counsellorPhone) {
        const plivoDid = (Deno.env.get("PLIVO_DIALER_PHONE_NUMBER") || "").trim();
        if (plivoDid) counsellorPhone = plivoDid;
      }
      if (!counsellorPhone) counsellorPhone = "+91 9555 192 192";
      params = [params[0], params[1], counsellorName, counsellorPhone];
    }

    // course_info_v1 can be invoked with only {template_key, phone, lead_id}.
    // Fill body params + button URLs from fn_resolve_course_info_params so
    // every caller (AI post-call, disposition nudge, manual sends) emits a
    // consistent message without hand-assembling the args. If the lead has no
    // course_id the resolver returns null and we fall back to the generic
    // template.
    // course_info_v1 and v2 share the same body. v1 has two URL buttons
    // (video + fees), v2 has one. Both Meta templates use the URL prefix
    // https://www.nimt.ac.in/courses/ — variable suffixes only:
    //   Button 1 (v1 only) "Watch course video" → bare slug, lands at the
    //     top of the course page where the embedded video plays
    //   Button 2 (v1) / Button 1 (v2) "View fees & apply" → slug + #admissions
    //     anchor scrolls to the fees section
    if ((template_key === "course_info_v1" || template_key === "course_info_v2" || template_key === "course_info_v3" || template_key === "course_info_v4") && lead_id && (!params || params.length === 0)) {
      const { data: resolved, error: resolveErr } = await admin.rpc(
        "fn_resolve_course_info_params",
        { p_lead_id: lead_id }
      );
      if (resolveErr) console.error(`${template_key} resolver failed:`, resolveErr.message);
      if (resolved && typeof resolved === "object") {
        const baseParams = [
          resolved.student_name,
          resolved.course_name,
          resolved.duration,
          resolved.eligibility,
          resolved.approval,
        ];
        // Derive the bare slug + the slug#admissions suffix from the resolver's
        // course_url ("https://www.nimt.ac.in/courses/{slug}#admissions").
        const prefix = "https://www.nimt.ac.in/courses/";
        const courseUrlFull = typeof resolved.course_url === "string" ? resolved.course_url : "";
        const afterPrefix = courseUrlFull.startsWith(prefix) ? courseUrlFull.slice(prefix.length) : "";
        const bareSlug = afterPrefix.split("#")[0] || "";
        const slugWithFees = bareSlug ? `${bareSlug}#admissions` : afterPrefix;
        if (template_key === "course_info_v3" || template_key === "course_info_v4") {
          // v3/v4 body has a 6th param: the actual video URL (youtu.be /
          // instagram / etc) from courses.video_url. WhatsApp auto-linkifies
          // URLs in body text so it renders as a tappable link, sidestepping
          // Meta's button-prefix lock-in for arbitrary external URLs. v4 is
          // the UTILITY-categorised rewrite (v3 got auto-flipped to MARKETING).
          const videoUrl = (typeof resolved.video_url === "string" && resolved.video_url.length > 0)
            ? resolved.video_url
            : courseUrlFull;
          params = [...baseParams, videoUrl];
          // v4's single URL button is the bare slug ("Open course page"),
          // v3's was slug#admissions ("View fees & apply").
          button_urls = template_key === "course_info_v4" ? [bareSlug] : [slugWithFees];
        } else if (template_key === "course_info_v2") {
          params = baseParams;
          button_urls = [slugWithFees];
        } else {
          // v1: button 1 = video (top of page), button 2 = fees section
          params = baseParams;
          button_urls = [bareSlug, slugWithFees];
        }
      } else {
        // No course on the lead — switch to the generic template.
        template_key = "course_info_generic";
        const { data: leadRow } = await admin.from("leads").select("name").eq("id", lead_id).single();
        params = [leadRow?.name || "there"];
        button_urls = undefined;
      }
    }

    // course_info_video_v2: body-link template (no URL buttons). Resolve the
    // course page / campus Maps / apply links — each with a graceful fallback
    // (courses listing / contact page) — when the caller didn't pass params.
    if (template_key === "course_info_video_v2" && lead_id && (!params || params.length === 0)) {
      const { data: resolved, error: resolveErr } = await admin.rpc(
        "fn_resolve_course_info_video_params",
        { p_lead_id: lead_id }
      );
      if (resolveErr) console.error("course_info_video_v2 resolver failed:", resolveErr.message);
      if (resolved && typeof resolved === "object") {
        params = [
          resolved.student_name,
          resolved.course_label,
          resolved.course_url,
          resolved.campus_url,
          resolved.apply_url,
        ];
      } else {
        // Resolver returned null (lead not found) — fully generic fallback so
        // the send still produces a useful, correct message.
        params = [
          "there",
          "our programmes",
          "https://nimt.ac.in/courses/",
          "https://nimt.ac.in/contact/",
          "https://uni.nimt.ac.in/apply/nimt",
        ];
      }
      // All links are in the body — never attach button suffixes.
      button_urls = undefined;
    }

    // visit_confirmation: the Meta template requires a URL-button suffix
    // (Google Maps CID). Resolve in priority order:
    //   1. course.maps_cid (per-course override for campuses with multiple
    //      buildings — e.g. Mirai vs. School of Education on Ghaziabad 2)
    //   2. campus.maps_cid (default for the lead's campus)
    //   3. hard-coded fallback so the send never fails
    // Without a suffix Meta rejects with 131008 "Required parameter is missing".
    if (template_key === "visit_confirmation" && (!button_urls || !Array.isArray(button_urls) || button_urls.length === 0)) {
      let mapsCid: string | null = null;
      if (lead_id) {
        try {
          const { data: row } = await admin
            .from("leads")
            .select("course:courses!course_id(maps_cid), campus:campuses!campus_id(maps_cid)")
            .eq("id", lead_id)
            .maybeSingle();
          const courseCid = (row as any)?.course?.maps_cid;
          const campusCid = (row as any)?.campus?.maps_cid;
          if (typeof courseCid === "string" && courseCid.trim().length > 0) {
            mapsCid = courseCid.trim();
          } else if (typeof campusCid === "string" && campusCid.trim().length > 0) {
            mapsCid = campusCid.trim();
          }
        } catch (e) {
          console.error("visit_confirmation maps_cid lookup failed:", e);
        }
      }
      // Fallback to the original example CID (Greater Noida) so a missing
      // per-course / per-campus value still produces a sendable message.
      button_urls = [mapsCid || "1820424915210710582"];
    }

    // course_info_video: 2 URL buttons need suffixes
    //   button 1: https://maps.google.com/?q={{1}} — e.g. "NIMT+Greater+Noida"
    //   button 2: https://app.nimt.ac.in/apply/{{1}} — apply-portal slug
    // Resolve from the lead's campus + a fixed "nimt" slug when the caller
    // hasn't supplied button_urls — otherwise Meta rejects with 131009
    // "Parameter value is not valid" because the dynamic suffix is empty.
    if (template_key === "course_info_video" && (!button_urls || !Array.isArray(button_urls) || button_urls.length === 0)) {
      let campusName = "NIMT";
      if (lead_id) {
        try {
          const { data: row } = await admin
            .from("leads")
            .select("campus:campuses!campus_id(name)")
            .eq("id", lead_id)
            .maybeSingle();
          const n = (row as any)?.campus?.name;
          if (typeof n === "string" && n.trim().length > 0) campusName = n.trim();
        } catch (e) {
          console.error("course_info_video campus lookup failed:", e);
        }
      }
      const mapsQuery = encodeURIComponent(campusName).replace(/%20/g, "+");
      button_urls = [mapsQuery, "nimt"];
    }

    // Meta 131009 "Parameter value is not valid" also triggers when body
    // params contain newlines or tabs. Sanitise just before send — leading
    // and trailing whitespace is stripped too.
    if (Array.isArray(params)) {
      params = params.map((p: unknown) =>
        typeof p === "string" ? p.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim() : p
      );
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
    const channelRoute: WhatsAppChannelRoute = phoneRoute === "default" ? "admissions" : phoneRoute;

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

    const sendResult = await sendWhatsAppTemplate(admin, {
      route: channelRoute,
      requireBulk: channelRoute === "bulk",
    }, waPhone, {
      name: templateDef.name,
      language: "en",
      components,
    });
    const waResult = sendResult.raw as { error?: { message?: string }; messages?: { id?: string }[] } | null;
    const phoneNumberId = sendResult.businessPhoneNumberId;
    const waResultText = "";

    // Log to whatsapp_messages + lead_activities (even if Meta rejected it)
    const adminClient = admin;
    const metaFailed = !sendResult.ok;

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
      course_info_video_v2: "Hi {{1}}, here are the details you requested for {{2}} at NIMT Educational Institutions:\n\n📚 Course information: {{3}}\n📍 Campus locations: {{4}}\n📝 Application portal: {{5}}\n\nReply to this message if you have any questions — our admissions team will be glad to assist you.",
      bpt_bmrit_cahet_deadline: cahetDeadlineMessage(),
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
      course_info_v4: "Hi {{1}}, here are the details for {{2}} at NIMT Educational Institutions:\n\nDuration: {{3}}\nEligibility: {{4}}\nApproval: {{5}}\nCourse video: {{6}}\n\nOpen the course page below for fees and application steps. Reply STOP to opt out.",
      course_info_generic: "Hi {{1}}, thanks for your interest in NIMT Educational Institutions. We offer programmes in nursing, paramedical, pharma, management, education, law, and engineering across our Greater Noida, Ghaziabad, and Kotputli campuses. Browse the full list, fees, and eligibility on our website. Reply STOP to opt out.",
      visit_reminder_v2: "Hi {{1}}, your campus visit for {{2}} is on {{3}} at {{4}}. Your counsellor {{5}} will meet you there. Tap below for directions to the campus.",
      offer_letter_acceptance: "Congratulations {{1}}! NIMT has issued your offer letter for {{2}}. Net fee: Rs.{{3}}. Please accept by {{4}}. Tap below to view your offer, accept it, and pay the token fee in one secure step.",
      nimt_not_interested_ack: "Hi {{1}}, thanks for speaking with us about {{2}}. We've marked your enquiry as \"not interested\" and won't reach out unless you'd like us to. If you'd like to revisit this in the future, message {{3}} directly on {{4}}. Reply STOP to fully opt out.",
      video_submitted_admin: "New video submitted for approval on the NIMT Video Portal.\n\nEditor: {{1}}\nTitle: {{2}}\nBrand: {{3}}\n\nPlease review it in the Video Approvals queue.",
      video_approved_editor: "Hi {{1}}, your video \"{{2}}\" has been approved on the NIMT Video Portal. Please post it on Instagram, LinkedIn and YouTube, then add the published links (with date & time) in your portal so it counts toward your billing.",
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
          http_status: sendResult.status,
          ...(waResult?.error ? { error: waResult.error } : {}),
          ...(waResult && !waResult.error ? { body: waResult } : {}),
          ...(!waResult && waResultText ? { raw: waResultText.slice(0, 1000) } : {}),
        }
      : null;

    const { data: insertedMessage } = await adminClient.from("whatsapp_messages").insert({
      lead_id: lead_id || null,
      wa_message_id: sendResult.messageId,
      direction: "outbound",
      phone: waPhone,
      message_type: "template",
      content: readableContent,
      template_key,
      status: metaFailed ? "failed" : "sent",
      is_read: true,
      provider: sendResult.provider,
      business_phone_number_id: phoneNumberId,
      business_phone_number: sendResult.businessNumber,
      status_error: statusErrorPayload,
      sender_user_id: user.id,
    }).select("id").maybeSingle();

    await recordWhatsAppOutboundContext(adminClient, {
      messageId: insertedMessage?.id || null,
      providerMessageId: sendResult.messageId,
      phone: waPhone,
      businessNumber: sendResult.businessNumber || phoneNumberId,
      provider: sendResult.provider,
      leadId: lead_id || null,
      templateKey: template_key,
      outboundKind: "template",
      expectedReplyType: expectedReplyTypeForTemplate(template_key),
      responsePolicy: responsePolicyForTemplate(template_key),
      metadata: {
        route: phoneRoute,
        params,
        button_urls,
        status: metaFailed ? "failed" : "sent",
        invoked_by_user_id: user.id,
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
          error: waResult?.error?.message || sendResult.error || "Failed to send WhatsApp message",
          meta_error: waResult?.error?.message,
        }),
        { status: sendResult.status >= 400 && sendResult.status < 500 ? sendResult.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (clear_unread_after_send === true) {
      await adminClient.rpc("mark_whatsapp_conversation_read", {
        p_phone: waPhone,
        p_provider: sendResult.provider,
        p_business_phone_number_id: phoneNumberId,
        p_business_phone_number: sendResult.businessNumber,
      }).then(({ error }) => {
        if (error) console.error("mark_whatsapp_conversation_read failed:", error.message);
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: sendResult.messageId,
        phone_route: phoneRoute,
        provider: sendResult.provider,
        business_phone_number_id: phoneNumberId,
        business_phone_number: sendResult.businessNumber,
      }),
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
