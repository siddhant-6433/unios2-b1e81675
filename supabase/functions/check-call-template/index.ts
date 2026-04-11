const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100&access_token=${waToken}`);
    const data = await res.json();
    const templates = (data.data || []).map((t: any) => ({ name: t.name, status: t.status, category: t.category }));
    const target = ["counsellor_call_lead", "counsellor_new_lead"];
    const filtered = templates.filter((t: any) => target.includes(t.name));
    return new Response(JSON.stringify({ templates: filtered }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
