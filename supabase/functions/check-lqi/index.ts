const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    // Step 1: check template status
    const statusRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100&access_token=${waToken}`);
    const statusData = await statusRes.json();
    const t = (statusData.data || []).find((x: any) => x.name === "lead_queue_item");

    // Step 2: try sending the template directly to Siddhant's phone
    const sendRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: "919871763193",
        type: "template",
        template: {
          name: "lead_queue_item",
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
              parameters: [{ type: "text", text: "test-abc-123" }],
            },
          ],
        },
      }),
    });
    const sendData = await sendRes.json();

    return new Response(JSON.stringify({
      template_status: t ? { name: t.name, status: t.status, category: t.category } : "not_found",
      send_result: { http_status: sendRes.status, ok: sendRes.ok, response: sendData },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
