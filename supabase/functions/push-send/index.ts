/**
 * push-send — fan a notification out to users' devices via Expo Push.
 * ─────────────────────────────────────────────────────────────────────────
 * Called by the DB trigger on public.notifications (pg_net, service-role)
 * and by other edge functions. Body:
 *   { user_ids: string[], title: string, body?: string,
 *     data?: Record<string, unknown>, channel?: string }
 *
 * - Resolves active device tokens from push_devices (service role).
 * - Chunks ≤100 messages per Expo Push API request.
 * - Prunes tokens Expo reports as DeviceNotRegistered so dead devices
 *   stop accumulating.
 *
 * Auth: service-role bearer only (this function can message any user).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PushBody {
  user_ids: string[];
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  channel?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== serviceKey) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: PushBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const userIds = Array.isArray(body.user_ids) ? body.user_ids.filter(Boolean) : [];
  if (userIds.length === 0 || !body.title) {
    return json({ error: "user_ids and title are required" }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: devices, error: devErr } = await supabase
    .from("push_devices")
    .select("expo_push_token")
    .in("user_id", userIds)
    .is("disabled_at", null);

  if (devErr) return json({ error: devErr.message }, 500);
  const tokens = [...new Set((devices ?? []).map((d) => d.expo_push_token))];
  if (tokens.length === 0) return json({ sent: 0, reason: "no active devices" });

  const messages = tokens.map((to) => ({
    to,
    title: body.title,
    body: body.body || undefined,
    data: body.data ?? {},
    sound: "default" as const,
    channelId: body.channel || "default",
  }));

  const deadTokens: string[] = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        console.error(`[push-send] Expo API ${res.status}: ${await res.text()}`);
        continue;
      }
      const payload = await res.json();
      const tickets: ExpoTicket[] = payload?.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent += 1;
        } else if (ticket.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[idx].to);
        } else {
          console.error(`[push-send] ticket error: ${ticket.message}`);
        }
      });
    } catch (err) {
      console.error(`[push-send] chunk failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (deadTokens.length > 0) {
    await supabase
      .from("push_devices")
      .update({ disabled_at: new Date().toISOString() })
      .in("expo_push_token", deadTokens);
  }

  return json({ sent, pruned: deadTokens.length, devices: tokens.length });
});
