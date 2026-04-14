const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE = {
  name: "test_phone_btn_dynamic",
  category: "UTILITY",
  language: "en",
  components: [
    {
      type: "BODY",
      text: "Test: lead contact for {{1}}. Lead Name: {{2}}, Course: {{3}}. This is a test template to see if phone number buttons support variables.",
      example: {
        body_text: [["Rahul", "Priya", "B.Tech"]],
      },
    },
    {
      type: "BUTTONS",
      buttons: [
        {
          type: "PHONE_NUMBER",
          text: "Call Lead",
          // Try with a variable
          phone_number: "+91{{1}}",
          example: ["+919999999999"],
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
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${waToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEMPLATE),
      }
    );
    const data = await res.json();
    return new Response(JSON.stringify({ ok: res.ok, http_status: res.status, response: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
