// receipt-pdf-backfill-cron
//
// Safety net for receipt PDFs stuck on "Generating…". lead_payments.receipt_url is
// only ever written by generate-payment-receipt, and the gateway settlement paths mint
// it via a fire-and-forget notify-event chain (easebuzz/icici skip the DB-trigger
// fallback entirely). When that single best-effort call fails/cold-starts, receipt_url
// stays null forever. This cron sweeps confirmed payments that have a receipt number but
// no PDF and re-runs the generator. Also backfills the historical backlog on first run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isCronCaller(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Confirmed payments with a receipt number but no PDF, settled >10 min ago (past the
  // synchronous window where the direct mint would normally have finished). Capped batch.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: rows, error } = await admin
    .from("lead_payments")
    .select("id")
    .eq("status", "confirmed")
    .not("receipt_no", "is", null)
    .is("receipt_url", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("[receipt-pdf-backfill] query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let generated = 0;
  const errors: string[] = [];
  for (const row of rows || []) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-payment-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ payment_id: row.id }),
      });
      if (res.ok) generated++;
      else errors.push(`${row.id}: gen ${res.status}`);
    } catch (e) {
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Pace calls — generate-payment-receipt bursts trip the edge invocation rate limit.
    await new Promise((r) => setTimeout(r, 400));
  }

  if (errors.length) console.error("[receipt-pdf-backfill] errors:", errors);
  return new Response(
    JSON.stringify({ ok: true, found: rows?.length ?? 0, generated, errors: errors.length ? errors : undefined }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
