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
    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    const results: any = {};

    // 1. Submit a new course info template with very neutral wording
    const courseTemplate = {
      name: "inquiry_course_update",
      category: "UTILITY",
      language: "en",
      components: [{
        type: "BODY",
        text: "Dear {{1}}, this is an update regarding your inquiry about {{2}} at NIMT Educational Institutions.\n\nThe admissions office has noted your interest and a counsellor has been assigned to assist you. For curriculum details, fee structure, and eligibility, you may visit our website or reply to this message.\n\nThank you for considering NIMT Educational Institutions.",
        example: { body_text: [["Priya Singh", "B.Tech Computer Science"]] },
      }],
    };

    const createRes = await fetch(`${metaUrl}?access_token=${waToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(courseTemplate),
    });
    results.course_template = { ok: createRes.ok, response: await createRes.json() };

    // 2. Test visit_confirmed with button_urls parameter
    const visitPayload = {
      messaging_product: "whatsapp",
      to: "919871763193",
      type: "template",
      template: {
        name: "visit_confirmed",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Test Student" },
              { type: "text", text: "15/04/26 10:00 AM" },
              { type: "text", text: "Greater Noida Campus" },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: "1820424915210710582" }],
          },
        ],
      },
    };

    const visitRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(visitPayload),
    });
    results.visit_test = { ok: visitRes.ok, response: await visitRes.json() };

    return new Response(JSON.stringify(results), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
