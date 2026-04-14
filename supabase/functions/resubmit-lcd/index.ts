/**
 * Delete pending `lead_contact_details` and resubmit with improved wording
 * that emphasizes the tappable phone number.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE = {
  name: "lead_queue_item",
  category: "UTILITY",
  language: "en",
  components: [
    {
      type: "BODY",
      text: "Hello {{1}}, a lead has been added to your queue.\n\nLead Name: {{2}}\nTap to Call: {{3}}\nCourse Interest: {{4}}\n\nTap the phone number above to dial the lead directly from your phone. Open the full lead record below to log the call outcome.",
      example: {
        body_text: [[
          "Rahul Bhati",
          "Priya Kulkarni",
          "+919779472423",
          "B.Tech Computer Science",
        ]],
      },
    },
    {
      type: "BUTTONS",
      buttons: [
        {
          type: "URL",
          text: "Open Lead",
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
    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    // Skip delete — lead_contact_details was already deleted.
    // Use a fresh name to avoid the 4-week cooldown.
    const delData = { skipped: true };
    const delRes = { ok: true };

    // Step 2: Submit new version
    const createRes = await fetch(`${metaUrl}?access_token=${waToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TEMPLATE),
    });
    const createData = await createRes.json();

    return new Response(JSON.stringify({
      deleted: { ok: delRes.ok, response: delData },
      created: { ok: createRes.ok, response: createData },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
