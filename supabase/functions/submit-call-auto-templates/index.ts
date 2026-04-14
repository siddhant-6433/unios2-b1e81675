const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES = [
  {
    name: "nimt_missed_call",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, we tried reaching you from NIMT Educational Institutions regarding your interest in {{2}}.\n\nWe were unable to connect with you on the call. If you have any questions about admissions or courses, feel free to reply to this message.\n\nOur counsellor will try reaching you again shortly.",
        example: {
          body_text: [["Priya Singh", "B.Tech Computer Science"]],
        },
      },
    ],
  },
  {
    name: "nimt_callback_scheduled",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, thank you for speaking with us about {{2}} at NIMT Educational Institutions.\n\nAs discussed, our counsellor will call you back at your preferred time. If you'd like to schedule a campus visit or need any information before that, feel free to reply here.\n\nWe look forward to helping you with your admission journey!",
        example: {
          body_text: [["Priya Singh", "B.Tech Computer Science"]],
        },
      },
    ],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    const results: any[] = [];
    for (const tmpl of TEMPLATES) {
      const res = await fetch(`${metaUrl}?access_token=${waToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tmpl),
      });
      const data = await res.json();
      results.push({ name: tmpl.name, ok: res.ok, status: res.status, response: data });
      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
