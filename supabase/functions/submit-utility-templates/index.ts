const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHECK_NAMES = [
  "nimt_course_info", "nimt_call_attempt", "nimt_followup_update", "nimt_lead_intro",
  "admissions_course_info", "admissions_call_attempt", "admissions_followup_update", "admissions_lead_intro",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100&access_token=${waToken}`);
    const data = await res.json();
    const all = (data.data || []);
    const found = all.filter((t: any) => CHECK_NAMES.includes(t.name)).map((t: any) => ({
      name: t.name, status: t.status, category: t.category,
    }));
    return new Response(JSON.stringify({ found }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
