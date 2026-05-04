/**
 * Quick lookup utility: returns name+status+category+body for templates
 * matching a query substring, OR all templates if no query. For debugging
 * the existing template inventory.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").toLowerCase();

    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=200&access_token=${waToken}`);
    const data = await res.json();
    const all = (data.data || []) as any[];

    const filtered = q
      ? all.filter(t => (t.name || "").toLowerCase().includes(q))
      : all;

    const trimmed = filtered.map(t => ({
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
      components: (t.components || []).map((c: any) => ({
        type: c.type,
        text: c.text,
        buttons: c.buttons,
      })),
    }));

    return new Response(JSON.stringify({ count: trimmed.length, templates: trimmed }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
