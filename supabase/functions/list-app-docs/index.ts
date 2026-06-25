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

function shouldReplaceFile(candidate: any, existing: any): boolean {
  const candidateTime = fileTime(candidate);
  const existingTime = fileTime(existing);
  if (candidateTime !== existingTime) return candidateTime > existingTime;
  return String(candidate?.name || "").localeCompare(String(existing?.name || "")) >= 0;
}

// Lists active files uploaded for an application using the service role so
// admins and counsellors are not blocked by storage RLS quirks. If an applicant
// re-uploads the same document key, only the newest replacement is returned.
// Returns a list of { name, path, url, doc_key, uploaded_at, review_status, review_notes } entries.
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

    const docsByKey = new Map<string, any>();

    const { data: metadataRows, error: metadataErr } = await db
      .from("application_documents")
      .select("doc_key, file_path, file_url, file_name, uploaded_at, storage_provider")
      .eq("application_id", application_id);
    if (metadataErr) {
      console.error("[list-app-docs] metadata lookup failed:", metadataErr);
    } else {
      (metadataRows || []).forEach((row: any) => {
        if (!row?.doc_key || !row?.file_path || !row?.file_url) return;
        docsByKey.set(row.doc_key, {
          name: row.file_name || row.file_path.split("/").pop() || row.doc_key,
          path: row.file_path,
          url: row.file_url,
          doc_key: row.doc_key,
          uploaded_at: row.uploaded_at || null,
          review_status: "pending",
          review_notes: null,
          storage_provider: row.storage_provider || "r2",
          _time: row.uploaded_at ? new Date(row.uploaded_at).getTime() : 0,
        });
      });
    }

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
        if (!existing || shouldReplaceFile(f, existing)) latestByDocKey.set(key, f);
      });

    Array.from(latestByDocKey.values())
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .forEach((f: any) => {
        const key = docKeyForFile(f.name);
        if (docsByKey.has(key)) return;
        const path = `${usedPrefix}/${f.name}`;
        const { data: pub } = db.storage.from(bucket).getPublicUrl(path);
        docsByKey.set(key, {
          name: f.name,
          path,
          url: pub.publicUrl,
          doc_key: key,
          uploaded_at: f.updated_at || f.created_at || f.last_accessed_at || null,
          review_status: "pending",
          review_notes: null,
          storage_provider: "supabase",
          _time: fileTime(f),
        });
      });

    const docs = Array.from(docsByKey.values())
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map(({ _time, ...doc }: any) => doc);

    const activePaths = new Set(docs.map(d => d.path));
    const reviewByPath = new Map<string, { status: string; notes: string | null }>();
    if (activePaths.size > 0) {
      const { data: reviewRows, error: reviewFetchErr } = await db
        .from("application_doc_reviews")
        .select("file_path, status, notes, reviewed_at, created_at, updated_at")
        .eq("application_id", application_id);
      if (reviewFetchErr) {
        console.error("[list-app-docs] review lookup failed:", reviewFetchErr);
      } else {
        (reviewRows || []).forEach((r: any) => {
          if (r.file_path && activePaths.has(r.file_path)) {
            reviewByPath.set(r.file_path, { status: r.status || "pending", notes: r.notes || null });
          }
        });
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

    docs.forEach((doc) => {
      const review = reviewByPath.get(doc.path);
      if (review) {
        doc.review_status = review.status;
        doc.review_notes = review.notes;
      }
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
