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

    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${waToken}`;
    const results: Record<string, any> = {};

    for (const tpl of TEMPLATES) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tpl),
        });
        const body = await res.json();
        results[tpl.name] = { ok: res.ok, status: res.status, body };
      } catch (e: any) {
        results[tpl.name] = { ok: false, error: e.message };
      }
    }

    return new Response(JSON.stringify({ submitted: TEMPLATES.length, results }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
