import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Placement & Internship report request.
//
// The public marketing site's "download the Placement & Internship report" modal
// calls this ONE endpoint. It:
//   1. Upserts the lead through lead-ingest (dedup + attribution + activity), so
//      these behave exactly like any other website lead.
//   2. Sends the approved Meta template `placement_report_download` via
//      whatsapp-send, which auto-attaches the report PDF from the template's
//      whatsapp_template_settings.media_url (DOCUMENT header).
//   3. Logs a timeline activity so staff can see the report went out.
//
// Sending the PDF here (not on the marketing site) keeps the template + media in
// one place and guarantees the document is actually attached.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Same auth as lead-ingest so the marketing sites can call it with the anon
    // key (or a shared x-api-key).
    const apiKey = req.headers.get("x-api-key");
    const anonKeyHeader = req.headers.get("apikey");
    const expectedKey = Deno.env.get("LEAD_INGEST_API_KEY");
    const expectedAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const authorized =
      (expectedKey && apiKey === expectedKey) || (expectedAnon && anonKeyHeader === expectedAnon);
    if (!authorized) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const name = (body.name || body.student_name || body.full_name || "").toString().trim();
    const phone = (body.phone || body.mobile || body.phone_number || "").toString().trim();
    if (!name) return json({ error: "Missing required field: name" }, 400);
    if (!phone) return json({ error: "Missing required field: phone" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // 1) Upsert the lead via lead-ingest (reuses all dedup/attribution logic).
    const ingestSource = (body.source || "website").toString();
    const ingestRes = await fetch(
      `${supabaseUrl}/functions/v1/lead-ingest?source=${encodeURIComponent(ingestSource)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(expectedKey ? { "x-api-key": expectedKey } : {}),
          ...(expectedAnon ? { apikey: expectedAnon } : {}),
        },
        body: JSON.stringify({
          ...body,
          source: ingestSource,
          notes: body.notes || "Requested Clinical Training, Internship & Placement Report (2025-26)",
        }),
      },
    );
    const ingestJson = await ingestRes.json().catch(() => ({} as any));
    const leadId = ingestJson?.lead?.id || ingestJson?.lead_id || null;
    if (!leadId) return json({ error: "Lead upsert failed", detail: ingestJson }, 502);

    // 2) Send the report. whatsapp-send resolves the DOCUMENT header URL from
    //    whatsapp_template_settings.media_url, so the PDF is attached.
    const firstName = name.split(/\s+/)[0] || name;
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        template_key: "placement_report_download",
        phone,
        params: [firstName],
        lead_id: leadId,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({} as any));
    const sent = sendRes.ok && !sendJson?.error;

    // 3) Timeline activity.
    await admin.from("lead_activities").insert({
      lead_id: leadId,
      type: sent ? "whatsapp" : "system",
      description: sent
        ? "Placement & Internship Report (2025-26) sent via WhatsApp."
        : `Placement & Internship Report send FAILED: ${sendJson?.error || sendRes.status}`,
    });

    return json(
      { status: sent ? "sent" : "send_failed", lead_id: leadId, whatsapp: sendJson },
      sent ? 200 : 502,
    );
  } catch (err: any) {
    console.error("placement-report-request error:", err);
    return json({ error: err.message }, 500);
  }
});
