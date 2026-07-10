import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronSecret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (cronSecret !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: rows, error } = await admin
    .from("whatsapp_scheduled_sends")
    .select("id, lead_id, phone, template_key, params, button_urls")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(50);

  if (error || !rows?.length) {
    return Response.json({ flushed: 0, error: error?.message || null }, { headers: corsHeaders });
  }

  let sent = 0;
  for (const row of rows) {
    try {
      const body: Record<string, unknown> = {
        template_key: row.template_key,
        phone: row.phone,
        lead_id: row.lead_id,
        params: row.params || [],
      };
      if (row.button_urls) body.button_urls = row.button_urls;

      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(body),
      });

      const ok = res.ok;
      const errText = ok ? null : await res.text().catch(() => "unknown");

      await admin
        .from("whatsapp_scheduled_sends")
        .update({
          status: ok ? "sent" : "failed",
          error: errText,
          sent_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (ok) sent++;
    } catch (e) {
      await admin
        .from("whatsapp_scheduled_sends")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", row.id);
    }
  }

  return Response.json({ flushed: sent, total: rows.length }, { headers: corsHeaders });
});
