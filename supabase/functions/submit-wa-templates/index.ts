/**
 * One-shot: submits the 6 lifecycle WhatsApp templates to Meta
 * Business Manager via the WhatsApp Business Management API.
 *
 * Idempotent — Meta returns 400 with code=2388023 if the template
 * already exists with the same name. We return all results so the
 * caller can see which made it through.
 *
 * Auth: requires service-role JWT (mirrors check-call-template etc).
 *
 * Curl:
 *   curl -X POST "$SUPABASE_URL/functions/v1/submit-wa-templates" \
 *     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Each template has BODY (parameterised) + optionally BUTTONS.
// Button URLs follow Meta's rules: full URL prefix + {{1}} suffix.
// For PDF receipts (no fixed prefix possible) we use a static button to
// the apply portal — applicant authenticates via OTP/magic link to
// retrieve the actual PDF in-portal.
const TEMPLATES = [
  {
    name: "student_portal_invite",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Welcome {{1}}! Your admission (AN: {{2}}) is confirmed. Tap the button below to access the Student Portal — fees, attendance, notices, and more.",
        example: { body_text: [["Rahul Sharma", "AN-A1B2C3D4"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Open Student Portal",
          url: "https://uni.nimt.ac.in/student?token={{1}}",
          example: ["https://uni.nimt.ac.in/student?token=a1b2c3d4e5f6789012345678abcdef00"],
        }],
      },
    ],
  },
  {
    name: "application_submitted",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your application ({{2}}) has been received at NIMT Educational Institutions. Please complete the application fee payment to begin processing. Your form PDF is available in the apply portal.",
        example: { body_text: [["Rahul Sharma", "APP-26-AB12"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Open Apply Portal", url: "https://uni.nimt.ac.in/apply" }],
      },
    ],
  },
  {
    name: "app_fee_receipt",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, we've received your application fee of Rs.{{2}} for application {{3}}. The receipt is available in the apply portal. Our admissions team will be in touch with the next steps.",
        example: { body_text: [["Rahul Sharma", "750", "APP-26-AB12"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "View Receipt", url: "https://uni.nimt.ac.in/apply" }],
      },
    ],
  },
  {
    name: "offer_letter_issued",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Congratulations {{1}}! You have been offered admission to {{2}} at NIMT Educational Institutions. Net fee: Rs.{{3}}. Please accept by {{4}}. Tap below to view your offer letter and pay your token fee securely online.",
        example: { body_text: [["Rahul Sharma", "BBA", "120000", "30 Jun 2026"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "View Offer & Pay Token",
          url: "https://uni.nimt.ac.in/apply?token={{1}}",
          example: ["https://uni.nimt.ac.in/apply?token=a1b2c3d4e5f6789012345678abcdef00"],
        }],
      },
    ],
  },
  {
    name: "pan_nudge_balance",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your pre-admission number is {{2}}. Pay the balance of Rs.{{3}} to confirm enrollment and receive your Admission Number. Tap below to pay securely online.",
        example: { body_text: [["Rahul Sharma", "PAN-A1B2C3D4", "29250"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Pay Balance Online",
          url: "https://uni.nimt.ac.in/apply?token={{1}}",
          example: ["https://uni.nimt.ac.in/apply?token=a1b2c3d4e5f6789012345678abcdef00"],
        }],
      },
    ],
  },
  // Token-fee deadline reminder — fired by the token-fee-reminders cron
  // at 2 days / 1 day / 4 hours before offer.acceptance_deadline. Body
  // params: name, course, amount, time_left ("2 days" / "1 day" / "just
  // 4 hours"). URL button suffix is the magic apply-portal token so one
  // tap lands on the pay screen.
  {
    name: "token_fee_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        // Body must not end on a variable (Meta subcode 2388299), so the
        // {{4}} time_left is followed by a closing line.
        text: "Hi {{1}}, this is a friendly reminder that your token fee of Rs.{{3}} for {{2}} is due in {{4}}. Pay now to secure your seat — once paid, your Pre-Admission Number is issued instantly and your admission process moves forward.",
        example: { body_text: [["Rahul Sharma", "BBA", "12000", "2 days"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Pay Token Fee Now",
          url: "https://uni.nimt.ac.in/apply?token={{1}}",
          example: ["https://uni.nimt.ac.in/apply?token=a1b2c3d4e5f6789012345678abcdef00"],
        }],
      },
    ],
  },
  {
    name: "doc_rejected",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your uploaded document \"{{2}}\" needs attention. Reason: {{3}}. Please re-upload a corrected version in the apply portal so your admission can proceed.",
        example: { body_text: [["Rahul Sharma", "Class 12 Marksheet", "Photo unclear, please rescan"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Re-upload in Portal", url: "https://uni.nimt.ac.in/apply" }],
      },
    ],
  },
  {
    name: "application_rejected",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Dear {{1}}, after review we are unable to proceed with your application {{2}}. Reason: {{3}}. Please contact our admissions office if you'd like to discuss alternatives.",
        example: { body_text: [["Rahul Sharma", "APP-26-AB12", "Eligibility criteria not met for selected programme"]] },
      },
    ],
  },
  // Application approved — fired from notify-event when admin approves an
  // application. Body params (3): student_name, application_id, course_name.
  // URL button takes the apply-portal magic-link token as its dynamic suffix
  // so one tap lands the student on their application status page.
  {
    name: "application_approved",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Congratulations {{1}}! Your application {{2}} for {{3}} has been approved. Our admissions team will be in touch with your offer letter shortly. Tap below to track your application in the apply portal.",
        example: { body_text: [["Rahul Sharma", "APP-26-AB12", "Bachelor of Science in Nursing"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Track Application",
          url: "https://uni.nimt.ac.in/apply?token={{1}}",
          example: ["https://uni.nimt.ac.in/apply?token=a1b2c3d4e5f6789012345678abcdef00"],
        }],
      },
    ],
  },
  {
    name: "payment_receipt",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Dear {{1}}, payment of Rs.{{2}} received. Receipt no: {{3}}. The full receipt PDF is available in the apply portal.",
        example: { body_text: [["Rahul Sharma", "30000", "N00123"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Open Apply Portal", url: "https://uni.nimt.ac.in/apply" }],
      },
    ],
  },
  // Magic-link login for the apply portal — sent when staff hands a lead
  // a one-tap entry to their application (no OTP required for the lead).
  // Body params: name, expiry (formatted IST string).
  // URL button suffix: the magic-link token.
  // Send call from frontend:
  //   whatsapp-send {
  //     template_key: "apply_portal_login",
  //     params: [name, expiry_str],
  //     button_urls: [token],
  //     phone, lead_id,
  //   }
  // Counsellor call/visit feedback — quick-reply buttons (Good/Bad).
  // Sent by feedback-sender-cron on a 10% sample of completed interactions.
  // Body params: {{1}} lead name, {{2}} counsellor name.
  // Button payload (set at send time): "feedback_good_<feedback_id>" /
  // "feedback_bad_<feedback_id>" — parsed by whatsapp-webhook to update the
  // matching feedback_responses row.
  {
    name: "counsellor_feedback",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, we noticed you just had an interaction with our counsellor, {{2}}. We'd love to know how it went! Your feedback means a lot to us. How was your experience?",
        example: { body_text: [["Siddhant", "Adarsh Raj"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Good" },
          { type: "QUICK_REPLY", text: "Bad" },
        ],
      },
    ],
  },
  {
    name: "apply_portal_login",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        // Meta rejects bodies where a variable sits at the very end (subcode
        // 2388299), so the {{2}} expiry is followed by substantive text.
        text: "Hi {{1}}, your secure login link for the NIMT application portal is ready. Tap the button below to complete your application or pay your token fee directly — no OTP needed. The link is valid until {{2}}, so please use it before it expires.",
        example: { body_text: [["Rahul Sharma", "12 May 2026, 3:34 pm"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Open Apply Portal",
          url: "https://uni.nimt.ac.in/apply?token={{1}}",
          example: ["https://uni.nimt.ac.in/apply?token=251fe6ea-b0a2-4bf0-beb5-3b2205bc3f39"],
        }],
      },
    ],
  },
  // ── Course info (data-driven from fn_resolve_course_info_params) ────────
  // Replaces the per-category course welcome templates. Single body whose
  // params (duration / eligibility / approval) are filled per-lead at send
  // time by the resolver RPC. Used for AI post-call follow-up, counsellor
  // disposition nudge, and ad-hoc sends from LeadDetail.
  {
    name: "course_info_v1",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, here are the details for {{2}} at NIMT:\n• Duration: {{3}}\n• Eligibility: {{4}}\n• Accreditation: {{5}}\n\nWatch a short course video or view the full fees and syllabus on the course page. Reply STOP to opt out.",
        example: { body_text: [["Rahul Sharma", "Bachelor of Science in Nursing", "4 years (semester)", "10+2 PCB, min 50%", "INC, AKTU"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Watch course video",
            url: "https://www.nimt.ac.in/courses/{{1}}",
            example: ["https://www.nimt.ac.in/courses/bachelor-of-science-in-nursing"],
          },
          {
            type: "URL",
            text: "View fees & apply",
            url: "https://www.nimt.ac.in/courses/{{1}}",
            example: ["https://www.nimt.ac.in/courses/bachelor-of-science-in-nursing#admissions"],
          },
        ],
      },
    ],
  },
  // Fallback when the lead has no course_id. Single CTA to the course listing
  // so the recipient can browse rather than receiving an empty/awkward body.
  {
    name: "course_info_generic",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, thanks for your interest in NIMT Educational Institutions. We offer programmes in nursing, paramedical, pharma, management, education, law, and engineering across our Greater Noida, Ghaziabad, and Kotputli campuses. Browse the full list, fees, and eligibility on our website. Reply STOP to opt out.",
        example: { body_text: [["Rahul Sharma"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "View all courses",
          url: "https://www.nimt.ac.in/courses",
        }],
      },
    ],
  },
  // Course-info follow-up auto-sent on new lead entry. Replaces the legacy
  // course_info_video, whose course/campus/apply links lived in Meta URL-button
  // prefixes (so the wrong apply domain and the "?q=NIMT" maps search couldn't
  // be fixed from our side). Like course_info_v3/v4, every URL lives in the BODY
  // — WhatsApp auto-linkifies them, so there are no fixed button prefixes to get
  // wrong. All five params are resolved per-lead by fn_resolve_course_info_video_params:
  //   {{2}} course label (name, or "our programmes" when untagged)
  //   {{3}} course page URL, or the /courses listing when untagged
  //   {{4}} campus Maps link, or the /contact page (all campuses) when untagged
  //   {{5}} https://uni.nimt.ac.in/apply/nimt
  // Worded as a response to an enquiry so Meta keeps it UTILITY (promotional
  // CTAs flip the category to MARKETING — see course_info_v3 → v4 history).
  {
    name: "course_info_video_v2",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, here are the details you requested for {{2}} at NIMT Educational Institutions:\n\n📚 Course information: {{3}}\n📍 Campus locations: {{4}}\n📝 Application portal: {{5}}\n\nReply to this message if you have any questions — our admissions team will be glad to assist you.",
        example: {
          body_text: [[
            "Rahul Sharma",
            "Bachelor of Science in Nursing",
            "https://nimt.ac.in/courses/bachelor-of-science-in-nursing",
            "https://maps.google.com/?cid=1820424915210710582",
            "https://uni.nimt.ac.in/apply/nimt",
          ]],
        },
      },
    ],
  },
  {
    name: "bpt_bmrit_cahet_deadline",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Dear Applicant,\n\nThis is to inform you that for admission to *BPT (Bachelors of Physiotherapy) and BMRIT (Bachelors of Medical Radiological Imaging Technology)* - Last date for Application Submission is *TODAY (5th June 2026)*\n\nFor admission Candidates *MUST*\n\n1. Complete College Application Online at https://apply.nimt.ac.in\n2. Complete the CAHET Registration on ABVMUP (This is mandatory for admission to BPT/BMRIT across Uttar Pradesh) : https://www.abvmucet26.co.in/entrance2026/login?form=4\n\nPlease note both form submissions are mandatory by 5th June 2026 to be included in the admission process for session 2026-27.\n\nFor any details please call 9555192192\n9667691872\n7428499849",
      },
    ],
  },
  // Visit reminder with counsellor name. Replaces the older visit_reminder
  // (which did not name the counsellor) — kept as a separate template so
  // the old one stays available during Meta review.
  {
    name: "visit_reminder_v2",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your campus visit for {{2}} is on {{3}} at {{4}}. Your counsellor {{5}} will meet you there. Tap below for directions to the campus.",
        example: { body_text: [["Rahul Sharma", "Bachelor of Science in Nursing", "12 May 2026, 11:00 am", "NIMT Greater Noida", "Priya Kapoor"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Get directions",
          url: "https://maps.google.com/?cid={{1}}",
          example: ["https://maps.google.com/?cid=1820424915210710582"],
        }],
      },
    ],
  },
  // Connected-call follow-up. Sent after a counsellor marks a call as
  // Interested or Call Back. Says the counsellor will call back on the
  // scheduled date and signs off with the counsellor's name + reach-me phone
  // so the lead has a personal point of contact.
  // Body params: name, formatted-date, counsellor_name, counsellor_phone.
  {
    name: "nimt_followup_v1",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        // Body cannot end with a variable (Meta error 2388299 "Leading or
        // trailing params not allowed") — trailing text after {{4}}.
        text: "Hi {{1}}, thanks for speaking with us at NIMT Educational Institutions. As per our discussion I will call you back on {{2}}. Looking forward to assisting you with your admission journey.\n\n— {{3}}, NIMT Counsellor\nReach me directly on {{4}} for any questions before our next call.",
        example: { body_text: [["Rahul Sharma", "Fri, 2nd May", "Priya Kapoor", "+91 9555 192 192"]] },
      },
    ],
  },
  // Counsellor-friendly closure when the lead said "not interested" during a
  // MANUAL call disposition. NOT sent from AI calls (that would amplify spam
  // exactly when the user has signalled they don't want messages). Body is
  // intentionally personal — counsellor name + their Plivo phone — so it
  // reads as a one-to-one wrap-up, not a marketing blast. No URL button.
  {
    name: "nimt_not_interested_ack",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, thanks for speaking with us about {{2}} at NIMT Educational Institutions. We've marked your enquiry as \"not interested\" and won't reach out unless you'd like us to. If you'd like to revisit this in the future, message {{3}} directly on {{4}}. Reply STOP to fully opt out of all messages.",
        example: { body_text: [["Rahul Sharma", "Bachelor of Science in Nursing", "Priya Kapoor", "+91 9555192192"]] },
      },
    ],
  },
  // Offer letter with a single-tap "Submit Offer Acceptance" button that
  // takes the lead to a magic-link portal where they can view the letter,
  // accept it, and pay the token fee in one flow. Replaces the older
  // offer_letter_issued template, which routed via a separate accept-pay UI.
  {
    name: "offer_letter_acceptance",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Congratulations {{1}}! NIMT has issued your offer letter for {{2}}. Net fee: Rs.{{3}}. Please accept by {{4}}. Tap below to view your offer, accept it, and pay the token fee in one secure step.",
        example: { body_text: [["Rahul Sharma", "Bachelor of Science in Nursing", "120000", "30 Jun 2026"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Submit Offer Acceptance",
          url: "https://uni.nimt.ac.in/apply/offer/{{1}}",
          example: ["https://uni.nimt.ac.in/apply/offer/251fe6ea-b0a2-4bf0-beb5-3b2205bc3f39"],
        }],
      },
    ],
  },
  // ── Video portal notifications ──────────────────────────────────────────
  // Sent to super-admin phones when an editor submits a video for approval.
  // Static URL button (no variable) straight to the approvals queue.
  {
    name: "video_submitted_admin",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "New video submitted for approval on the NIMT Video Portal.\n\nEditor: {{1}}\nTitle: {{2}}\nBrand: {{3}}\n\nPlease review it in the Video Approvals queue.",
        example: { body_text: [["Rohit Bhati", "Campus Tour 2026", "NIMT Educational Institutions"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Open Video Approvals", url: "https://uni.nimt.ac.in/video-approvals" }],
      },
    ],
  },
  // Sent to the editor when their video is approved — prompts them to post it
  // and submit the published Instagram/LinkedIn/YouTube links in their portal.
  {
    name: "video_approved_editor",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, your video \"{{2}}\" has been approved on the NIMT Video Portal. Please post it on Instagram, LinkedIn and YouTube, then add the published links (with date & time) in your portal so it counts toward your billing.",
        example: { body_text: [["Rohit Bhati", "Campus Tour 2026"]] },
      },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Open Video Portal", url: "https://uni.nimt.ac.in/video-editor" }],
      },
    ],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    if (!wabaId || !waToken) {
      return new Response(JSON.stringify({ error: "WHATSAPP_WABA_ID and WHATSAPP_API_TOKEN required" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action || "submit";

    // ── status: list current state (name → status) for all templates ──
    if (action === "status") {
      const namesParam = body?.names ? `&name=${(body.names as string[]).join(",")}` : "";
      const includeComponents = body?.include_components === true;
      const fields = includeComponents
        ? "name,status,category,id,language,components"
        : "name,status,category,id";
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=${fields}&limit=200${namesParam}&access_token=${waToken}`
      );
      const data = await res.json();
      const summary = (data?.data || []).map((t: any) =>
        includeComponents
          ? { name: t.name, status: t.status, category: t.category, id: t.id, language: t.language, components: t.components }
          : { name: t.name, status: t.status, category: t.category, id: t.id }
      );
      return new Response(JSON.stringify({ count: summary.length, templates: summary }, null, 2), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${waToken}`;
    const results: Record<string, any> = {};

    // Optional { names: [...] } filter — submit only the listed templates.
    // If omitted, every template in the array is (re-)submitted; Meta returns
    // 400 with code 2388023 for any that already exist, which is fine.
    const filterNames: string[] | null = Array.isArray(body?.names) ? body.names : null;
    const queue = filterNames
      ? TEMPLATES.filter(t => filterNames.includes(t.name))
      : TEMPLATES;

    for (const tpl of queue) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tpl),
        });
        const result = await res.json();
        results[tpl.name] = { ok: res.ok, status: res.status, body: result };
      } catch (e: any) {
        results[tpl.name] = { ok: false, error: e.message };
      }
    }

    return new Response(JSON.stringify({ submitted: queue.length, results }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
