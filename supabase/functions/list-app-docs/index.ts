import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lists every file uploaded for an application using the service role so admins
// and counsellors are not blocked by storage RLS quirks. Returns a list of
// { name, path, url } entries.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const bucket = "application-documents";
    const tryPrefixes = [
      application_id,
      String(application_id).toUpperCase(),
      String(application_id).toLowerCase(),
    ];

    let files: Array<{ name: string }> = [];
    let usedPrefix = "";

    for (const prefix of tryPrefixes) {
      const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100 });
      if (error) continue;
      if (data && data.length) {
        files = data;
        usedPrefix = prefix;
        break;
      }
    }

    const docs = files
      .filter(f => f.name && !f.name.startsWith("."))
      .map(f => {
        const path = `${usedPrefix}/${f.name}`;
        const { data: pub } = db.storage.from(bucket).getPublicUrl(path);
        return { name: f.name, path, url: pub.publicUrl };
      });

    return new Response(JSON.stringify({ ok: true, prefix: usedPrefix, docs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
