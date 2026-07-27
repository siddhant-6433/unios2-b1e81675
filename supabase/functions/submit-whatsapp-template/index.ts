// One-shot helper to register WhatsApp templates with Meta via the
// Graph API. POST { name } to submit one of the templates defined
// below; reads WABA_ID + API_TOKEN from secrets.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const TEMPLATES: Record<string, any> = {
  // Entrance-exam registration check — two quick-reply buttons. The webhook
  // (exam-registration-intake) matches the button titles "Yes, registered" /
  // "Not registered yet", so keep those EXACT.
  exam_registration_check: {
    name: "exam_registration_check",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, regarding your {{2}} application at NIMT — have you completed your *{{3}}* registration/counselling? " +
          "Please tap below so our team can guide your next step.",
        example: {
          body_text: [[
            "Rohan Sharma",
            "B.Sc Nursing",
            "CNET (BSc Nursing - Conducted by ABVMU Lucknow)",
          ]],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, registered" },
          { type: "QUICK_REPLY", text: "Not registered yet" },
        ],
      },
    ],
  },

  // Application put on hold for eligibility (candidate can't be processed).
  application_on_hold_eligibility: {
    name: "application_on_hold_eligibility",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, your application for {{2}} at NIMT is currently on hold. " +
          "Our records show the {{3}} eligibility/registration requirement isn't met. " +
          "If this is a mistake or you'd like to discuss alternative courses, reply here and our team will help.\n\n" +
          "NIMT Admissions",
        example: {
          body_text: [[
            "Rohan Sharma",
            "B.Sc Nursing",
            "CNET (BSc Nursing - Conducted by ABVMU Lucknow)",
          ]],
        },
      },
    ],
  },

  payment_receipt: {
    name: "payment_receipt",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, we've received your payment of ₹{{3}} towards {{2}}.\n\n" +
          "Receipt No: {{4}}\nDownload: {{5}}\n\n" +
          "NIMT Educational Institutions",
        example: {
          body_text: [
            [
              "Rohan Sharma",
              "Token Fee",
              "15,300",
              "N123",
              "https://uni.nimt.ac.in/r/N123",
            ],
          ],
        },
      },
    ],
  },

  // Payment link request — sent when staff/consultant sends a custom-amount
  // payment link (create-payment-link, send_channel whatsapp/both). Worded as
  // a follow-through on a conversation ("as discussed") so Meta categorises
  // UTILITY, not MARKETING (lesson from course_info v3→v4). Button URL must
  // be our own domain with a single {{1}} suffix (Meta constraint) — /pay/<token>
  // redirects to the Razorpay hosted page when applicable.
  payment_link_request: {
    name: "payment_link_request",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, as discussed, here is your secure payment link for {{2}} of Rs. {{3}}. " +
          "The link is valid till {{4}}. Your receipt will be generated automatically once the payment is complete.\n\n" +
          "NIMT Educational Institutions",
        example: {
          body_text: [[
            "Rohan Sharma",
            "Token fee prior to admission",
            "25,000",
            "16 Jul 2026",
          ]],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Pay Now",
            url: "https://uni.nimt.ac.in/pay/{{1}}",
            example: ["https://uni.nimt.ac.in/pay/0a1b2c3d4e5f60718293a4b5c6d7e8f9"],
          },
        ],
      },
    ],
  },

  // PGDM diploma certificate workflow — internal staff + candidate notices.
  // Param order MUST match supabase/functions/pgdm-certificate-notify.
  pgdm_certificate_submitted_admin: {
    name: "pgdm_certificate_submitted_admin",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, a PGDM diploma certificate for request {{2}} ({{3}}) has been submitted by {{4}} and is awaiting your approval. " +
          "Review and approve it here: {{5}}\n\nNIMT Educational Institutions",
        example: {
          body_text: [[
            "Umesh",
            "ADR-00030",
            "Akash Singh",
            "Priya Sharma",
            "https://uni.nimt.ac.in/alumni-verifications?request=abc123",
          ]],
        },
      },
    ],
  },

  pgdm_certificate_approved_handler: {
    name: "pgdm_certificate_approved_handler",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Hi {{1}}, the PGDM diploma certificate for request {{2}} ({{3}}) has been approved. " +
          "Download and print it here: {{4}}\n\nNIMT Educational Institutions",
        example: {
          body_text: [[
            "Priya Sharma",
            "ADR-00030",
            "Akash Singh",
            "https://uni.nimt.ac.in/alumni-verifications?request=abc123",
          ]],
        },
      },
    ],
  },

  pgdm_diploma_ready_student: {
    name: "pgdm_diploma_ready_student",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text:
          "Dear {{1}}, your Post Graduate Diploma in Management (PGDM) for request {{2}} is ready for collection at " +
          "NIMT Educational Institutions. Please carry a valid photo ID. For assistance, contact {{3}} at {{4}}.\n\n" +
          "Warm regards, NIMT Educational Institutions",
        example: {
          body_text: [[
            "Akash Singh",
            "ADR-00030",
            "Student Services Team",
            "+91-7428477664",
          ]],
        },
      },
    ],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const token = Deno.env.get("WHATSAPP_API_TOKEN");
    if (!wabaId || !token) {
      return new Response(JSON.stringify({ error: "Missing WHATSAPP_WABA_ID or WHATSAPP_API_TOKEN" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reqBody = await req.json();

    // Status check: POST { check: ["name1","name2"] } → current Meta review
    // status for those templates. Used to decide when it's safe to schedule
    // dependent automation (e.g. the exam-registration intake cron).
    if (Array.isArray(reqBody.check)) {
      const listUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=200`;
      const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
      const listBody = await listRes.json();
      const wanted = new Set(reqBody.check.map((n: string) => String(n)));
      const found = (listBody?.data || [])
        .filter((t: any) => wanted.has(t.name))
        .map((t: any) => ({ name: t.name, status: t.status, category: t.category, language: t.language }));
      return new Response(JSON.stringify({ ok: listRes.ok, templates: found }), {
        status: listRes.ok ? 200 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name } = reqBody;
    const tmpl = TEMPLATES[name];
    if (!tmpl) {
      return new Response(JSON.stringify({ error: `Unknown template "${name}". Known: ${Object.keys(TEMPLATES).join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(tmpl),
    });
    const body = await res.json();

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, body, submitted: tmpl }), {
      status: res.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
