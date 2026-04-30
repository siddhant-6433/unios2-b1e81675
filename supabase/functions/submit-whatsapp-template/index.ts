// One-shot helper to register WhatsApp templates with Meta via the
// Graph API. POST { name } to submit one of the templates defined
// below; reads WABA_ID + API_TOKEN from secrets.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const TEMPLATES: Record<string, any> = {
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

    const { name } = await req.json();
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
