const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    // Test 1: send a known-working UTILITY template (nimt_new_staff) to Siddhant
    const payload = {
      messaging_product: "whatsapp",
      to: "919871763193",
      type: "template",
      template: {
        name: "nimt_new_staff",
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: "Test User" },
            { type: "text", text: "Test Role" },
            { type: "text", text: "Test Campus" },
          ],
        }],
      },
    };

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return new Response(JSON.stringify({ ok: res.ok, response: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
