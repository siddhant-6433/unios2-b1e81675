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
