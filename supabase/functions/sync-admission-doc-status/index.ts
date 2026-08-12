import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getRequiredDocs, computeAdmissionDocStatus } from "../_shared/requiredDocs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Recompute applications.mandatory_docs_complete + admission_doc_status for one
// application (or the application of a lead), then re-run the admission-number
// engine so a now-complete student is admitted. Internal: service-role only.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let isServiceRole = token === serviceKey;
    if (!isServiceRole && token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.role === "service_role") isServiceRole = true;
      } catch { /* not a jwt */ }
    }
    if (!isServiceRole) return json({ error: "service role required" }, 401);

    const body = await req.json().catch(() => ({}));
    let application_id: string | undefined = body.application_id;

    const db = createClient(supabaseUrl, serviceKey);

    // Resolve application by lead_id if only that was given.
    if (!application_id && body.lead_id) {
      const { data } = await db.from("applications")
        .select("application_id").eq("lead_id", body.lead_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      application_id = data?.application_id;
    }
    if (!application_id) return json({ error: "application_id or resolvable lead_id required" }, 400);

    const { data: app, error: appErr } = await db.from("applications")
      .select("id, application_id, lead_id, program_category, academic_details, course_selections, category")
      .eq("application_id", application_id).maybeSingle();
    if (appErr) return json({ error: `application lookup failed: ${appErr.message}` }, 500);
    if (!app) return json({ error: "application not found" }, 404);

    const required = getRequiredDocs(
      app.program_category || "",
      (app.academic_details || {}) as Record<string, unknown>,
      Array.isArray(app.course_selections) ? app.course_selections : [],
      app.category || "",
    );

    // Canonical uploaded-doc + review state (same source the admin panel uses).
    let docs: { doc_key: string; review_status?: string }[] = [];
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/list-app-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id }),
      });
      const payload = await resp.json();
      docs = Array.isArray(payload) ? payload : (payload.docs || []);
    } catch (e) {
      return json({ error: `list-app-docs failed: ${(e as Error).message}` }, 502);
    }

    const status = computeAdmissionDocStatus(required, docs);

    const { error: upErr } = await db.from("applications")
      .update({
        mandatory_docs_complete: status.complete,
        admission_doc_status: status,
        admission_doc_status_at: new Date().toISOString(),
      })
      .eq("application_id", application_id);
    if (upErr) return json({ error: `update failed: ${upErr.message}` }, 500);

    // Let the engine (re)issue the AN now that the gate flag may have changed.
    if (app.lead_id) {
      const { error: rpcErr } = await db.rpc("recompute_lead_fee_stage", { _lead_id: app.lead_id });
      if (rpcErr) console.warn(`[sync-admission-doc-status] recompute failed for ${app.lead_id}: ${rpcErr.message}`);
    }

    return json({ success: true, application_id, lead_id: app.lead_id, status });
  } catch (err) {
    console.error("sync-admission-doc-status error:", err);
    return json({ error: (err as Error).message || "unknown error" }, 500);
  }
});
