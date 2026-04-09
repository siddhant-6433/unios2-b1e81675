/**
 * One-off function to submit WhatsApp templates to Meta.
 * Deploy, call once, then delete.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES_TO_SUBMIT = [
  {
    name: "nimt_new_staff",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Welcome to NIMT Educational Institutions, {{1}}!\n\nYou have been added as {{2}} at {{3}}.\n\nPlease check your email for login details.\n\nFor any assistance, contact the admin office.",
        example: { body_text: [["Rahul Sharma", "Faculty", "Greater Noida Campus"]] },
      },
    ],
  },
  // nimt_student_admitted — already submitted, PENDING
  // nimt_application_started — already submitted, PENDING
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!wabaId || !waToken) {
      return new Response(
        JSON.stringify({ error: "WhatsApp not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
    const results: any[] = [];

    for (const tmpl of TEMPLATES_TO_SUBMIT) {
      console.log(`Processing template: ${tmpl.name}`);

      // Skip delete — templates were already deleted in previous run

      // Step 2: Create new template
      const res = await fetch(`${metaUrl}?access_token=${waToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tmpl),
      });

      const data = await res.json();

      results.push({
        name: tmpl.name,
        status: res.ok ? "submitted" : "failed",
        http_status: res.status,
        response: data,
      });

      console.log(`${tmpl.name}: ${res.ok ? "OK" : "FAILED"}`, JSON.stringify(data));

      // Delay between templates
      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Batch submit error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
