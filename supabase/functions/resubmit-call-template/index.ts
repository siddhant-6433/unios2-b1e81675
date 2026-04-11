/**
 * Delete old MARKETING version and submit a new UTILITY version
 * with neutral informational wording.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NEW_TEMPLATE = {
  name: "lead_contact_details",
  category: "UTILITY",
  language: "en",
  components: [
    {
      type: "BODY",
      // Longer body with more context so variable-to-word ratio stays within limits
      text: "Hello {{1}}, here are the contact details of a lead from your assigned list.\n\nLead Name: {{2}}\nPhone Number: {{3}}\nCourse Interest: {{4}}\n\nYou can open the lead record from the button below to view more details and log the call outcome.",
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
    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;

    // Skip delete — old template was already deleted in previous run
    const delData = { skipped: true };
    const delRes = { ok: true };

    // Step 2: Create new UTILITY template
    const createRes = await fetch(`${metaUrl}?access_token=${waToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(NEW_TEMPLATE),
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
