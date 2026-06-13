import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function docKeyForFile(name: string): string {
  if (name.startsWith("passport_photo.")) return "passport_photo";
  const dashIdx = name.indexOf("-");
  return dashIdx > 0 ? name.substring(0, dashIdx) : name.replace(/\.[^.]+$/, "");
}

function fileTime(file: any): number {
  const raw = file?.updated_at || file?.created_at || file?.last_accessed_at || "";
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Lists active files uploaded for an application using the service role so
// admins and counsellors are not blocked by storage RLS quirks. If an applicant
// re-uploads the same document key, only the newest replacement is returned.
// Returns a list of { name, path, url } entries.
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

    let files: any[] = [];
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

    const latestByDocKey = new Map<string, any>();
    files
      .filter((f: any) => f.name && !f.name.startsWith("."))
      .forEach((f: any) => {
        const key = docKeyForFile(f.name);
        const existing = latestByDocKey.get(key);
        if (!existing || fileTime(f) >= fileTime(existing)) latestByDocKey.set(key, f);
      });

    const docs = Array.from(latestByDocKey.values())
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((f: any) => {
        const path = `${usedPrefix}/${f.name}`;
        const { data: pub } = db.storage.from(bucket).getPublicUrl(path);
        return { name: f.name, path, url: pub.publicUrl };
      });

    const activePaths = new Set(docs.map(d => d.path));
    if (activePaths.size > 0) {
      const { data: reviewRows, error: reviewFetchErr } = await db
        .from("application_doc_reviews")
        .select("file_path")
        .eq("application_id", application_id);
      if (reviewFetchErr) {
        console.error("[list-app-docs] review lookup failed:", reviewFetchErr);
      } else {
        const staleReviewPaths = (reviewRows || [])
          .map((r: any) => r.file_path)
          .filter((path: string | null) => path && !activePaths.has(path));
        if (staleReviewPaths.length > 0) {
          const { error: staleDeleteErr } = await db
            .from("application_doc_reviews")
            .delete()
            .eq("application_id", application_id)
            .in("file_path", staleReviewPaths);
          if (staleDeleteErr) console.error("[list-app-docs] stale review cleanup failed:", staleDeleteErr);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, prefix: usedPrefix, docs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
