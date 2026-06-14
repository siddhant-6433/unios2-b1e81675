import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ClaimedCampaign = {
  channel: "whatsapp" | "email";
  campaign_id: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isService = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCron && !isService) {
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit) || 4, 10));
    const batchSize = Math.max(1, Math.min(Number(body?.batch_size) || 10, 50));

    const { data: claimed, error: claimError } = await admin.rpc("claim_due_marketing_campaigns" as any, {
      _limit: limit,
    });
    if (claimError) throw claimError;

    const results = [];
    for (const campaign of ((claimed || []) as ClaimedCampaign[])) {
      const fn = campaign.channel === "whatsapp" ? "whatsapp-campaign-send" : "email-campaign-send";
      const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
          },
          body: JSON.stringify({
            campaign_id: campaign.campaign_id,
            batch_size: batchSize,
          }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok || payload?.error) {
          const message = payload?.error || `HTTP ${res.status}`;
          const retryable = res.status >= 500 || res.status === 429;
          const nextStatus = payload?.paused ? "paused" : retryable ? "pending" : "failed";
          await admin.from(table).update({
            status: nextStatus,
            worker_locked_at: null,
            worker_error: message,
            next_attempt_at: nextStatus === "paused" ? null : new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          } as any).eq("id", campaign.campaign_id);
          results.push({ ...campaign, ok: false, error: message });
          continue;
        }

        await admin.from(table).update({
          worker_locked_at: null,
          worker_error: null,
          next_attempt_at: payload?.done ? null : new Date(Date.now() + 60 * 1000).toISOString(),
        } as any).eq("id", campaign.campaign_id);
        results.push({ ...campaign, ok: true, ...payload });
      } catch (err: any) {
        await admin.from(table).update({
          status: "pending",
          worker_locked_at: null,
          worker_error: err?.message || "Dispatcher error",
          next_attempt_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        } as any).eq("id", campaign.campaign_id);
        results.push({ ...campaign, ok: false, error: err?.message || "Dispatcher error" });
      }
    }

    return new Response(JSON.stringify({ ok: true, claimed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[campaign-dispatcher] error", err);
    return new Response(JSON.stringify({ error: err?.message || "Campaign dispatcher failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
