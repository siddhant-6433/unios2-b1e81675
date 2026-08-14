import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Staff (super_admin / principal) mark one application document verified or
// rejected. Writing the review through this function — instead of a direct
// client upsert — lets us recompute admission document-completeness and re-run
// the admission-number engine in the same step.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization header" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Auth failed" }, 401);
    const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => String(r.role));
    if (!roles.some(r => r === "super_admin" || r === "principal")) {
      return json({ error: "Forbidden: reviewer role required" }, 403);
    }

    const { application_id, file_path, status, notes } = await req.json();
    if (!application_id || !file_path || !["verified", "rejected", "pending"].includes(status)) {
      return json({ error: "application_id, file_path and a valid status are required" }, 400);
    }

    // reviewed_by FK → profiles.id, NOT auth.uid. Resolve the reviewer's
    // profile row; fall back to null (column is nullable) if none exists so
    // the review still saves instead of FK-violating.
    const { data: prof } = await db.from("profiles").select("id").eq("user_id", user.id).maybeSingle();

    const { error: upErr } = await db.from("application_doc_reviews").upsert({
      application_id,
      file_path,
      status,
      notes: notes ?? null,
      reviewed_by: prof?.id ?? null,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: "application_id,file_path" });
    if (upErr) return json({ error: `review write failed: ${upErr.message}` }, 500);

    // Recompute completeness + (re)issue AN. Best-effort — the review is saved
    // regardless, so a sync hiccup never loses the reviewer's action.
    let syncResult: unknown = null;
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/sync-admission-doc-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id }),
      });
      syncResult = await resp.json();
    } catch (e) {
      console.warn("[review-admission-doc] sync failed:", (e as Error).message);
    }

    return json({ success: true, status, sync: syncResult });
  } catch (err) {
    console.error("review-admission-doc error:", err);
    return json({ error: (err as Error).message || "unknown error" }, 500);
  }
});
