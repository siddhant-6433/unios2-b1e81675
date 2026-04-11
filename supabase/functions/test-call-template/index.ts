const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    // Test: send to Siddhant's phone
    const payload = {
      messaging_product: "whatsapp",
      to: "919871763193",
      type: "template",
      template: {
        name: "counsellor_call_lead",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Siddhant Singh" },
              { type: "text", text: "Test Lead" },
              { type: "text", text: "+919999999999" },
              { type: "text", text: "B.Tech Computer Science" },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: "test-lead-id-123" }],
          },
        ],
      },
    };

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return new Response(JSON.stringify({
      ok: res.ok,
      http_status: res.status,
      response: data,
      sent_payload: payload,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
