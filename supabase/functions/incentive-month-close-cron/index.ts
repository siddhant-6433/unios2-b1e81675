import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/*
  Incentive Month Close — runs on the 1st of each month (00:31 IST).
  Closes the PREVIOUS month: computes achievement %, eligibility gates,
  multiplier repricing, volume + team bonuses, and creates
  incentive_statements in pending_approval. All logic lives in the
  fn_incentive_month_close() SQL function; this is a thin auth wrapper.

  Accepts an optional { "month": "YYYY-MM-DD" } body to (re)close a
  specific month — used by the approval UI's "Recompute" action.
*/

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expectedCronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = req.headers.get("x-cron-secret");
  const auth = req.headers.get("Authorization") || "";
  const authorizedByCron = !!expectedCronSecret && cronSecret === expectedCronSecret;
  const authorizedByServiceRole = auth === `Bearer ${serviceRoleKey}`;

  if (!authorizedByCron && !authorizedByServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let month: string | undefined;
    try {
      const body = await req.json();
      if (typeof body?.month === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.month)) {
        month = body.month;
      }
    } catch {
      // no/invalid body: default to previous month
    }

    if (!month) {
      const now = new Date();
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      month = prev.toISOString().slice(0, 10);
    }

    const { data, error } = await supabase.rpc("fn_incentive_month_close", { p_month: month });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, result: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Incentive month close error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
