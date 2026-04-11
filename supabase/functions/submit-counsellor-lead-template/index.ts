/**
 * One-off function to submit `counsellor_new_lead` template to Meta.
 * Template includes a URL button that opens the lead page.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE = {
  name: "counsellor_new_lead",
  category: "UTILITY",
  language: "en",
  components: [
    {
      type: "BODY",
      text: "Hi {{1}},\n\nA new lead has been assigned to you:\n\nName: {{2}}\nPhone: {{3}}\nCourse Interest: {{4}}\n\nPlease contact the lead as soon as possible.",
      example: {
        body_text: [[
          "Rahul Sharma",
          "Priya Singh",
          "+919876543210",
          "B.Tech Computer Science",
        ]],
      },
    },
    {
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: "View Lead",
          url: "https://uni.nimt.ac.in/admissions/{{1}}",
          example: ["https://uni.nimt.ac.in/admissions/abc-123"],
        },
      ],
    },
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!wabaId || !waToken) {
      return new Response(JSON.stringify({ error: "WA not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${waToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEMPLATE),
      }
    );

    const data = await res.json();

    return new Response(JSON.stringify({
      ok: res.ok,
      http_status: res.status,
      response: data,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
