/**
 * WhatsApp Channel Profile Sync
 * ─────────────────────────────────────────────────────────────
 * For each active Meta channel with a phone-number id, fetch its real WhatsApp
 * business identity from Meta (verified name + profile photo) and store it on
 * whatsapp_channels so the marketing sender picker can show distinct name/photo
 * per number instead of the same NIMT logo.
 *
 * The photo is re-hosted into the public whatsapp-media bucket because Meta's
 * pps.whatsapp.net URL expires / is CORS-flaky (same reason template headers are
 * re-hosted). Channels whose token doesn't authorize their phone-number id
 * (numbers under a different WABA) are skipped and reported, never fatal.
 *
 * Auth: cron secret or service role (isServiceCaller). verify_jwt=false.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/service-auth.ts";
import { fetchWithTimeout } from "../_shared/whatsapp-channel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// route -> token env var (mirrors META_ROUTE_ENV in _shared/whatsapp-channel.ts,
// which isn't exported). Token for a channel is its own secret_token_name, then
// its route token, then the admissions default.
const ROUTE_TOKEN_ENV: Record<string, string> = {
  admissions: "WHATSAPP_API_TOKEN",
  reply: "WHATSAPP_REPLY_API_TOKEN",
  otp: "WHATSAPP_OTP_API_TOKEN",
  call: "WHATSAPP_CALL_API_TOKEN",
  visit: "WHATSAPP_VISIT_API_TOKEN",
  bulk: "WHATSAPP_BULK_API_TOKEN",
  hr: "WHATSAPP_API_TOKEN",
  plivo_admissions: "WHATSAPP_API_TOKEN",
};

function resolveToken(channel: { secret_token_name?: string | null; route?: string | null }): string | null {
  const own = channel.secret_token_name ? Deno.env.get(channel.secret_token_name) : null;
  const byRoute = channel.route ? Deno.env.get(ROUTE_TOKEN_ENV[channel.route] || "WHATSAPP_API_TOKEN") : null;
  return (own || byRoute || Deno.env.get("WHATSAPP_API_TOKEN") || "").trim() || null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Download Meta's profile picture and re-host it in the public bucket. */
async function rehostAvatar(
  admin: any,
  supabaseUrl: string,
  phoneNumberId: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(sourceUrl, {}, 15000);
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = EXT_BY_MIME[blob.type] || "jpg";
    const path = `channel-avatars/${phoneNumberId}.${ext}`;
    const { error } = await admin.storage
      .from("whatsapp-media")
      .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true });
    if (error) {
      console.warn(`[profile-sync] avatar upload failed for ${phoneNumberId}:`, error.message);
      return null;
    }
    return `${supabaseUrl}/storage/v1/object/public/whatsapp-media/${path}`;
  } catch (err) {
    console.warn(`[profile-sync] avatar rehost error for ${phoneNumberId}:`, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!(await isServiceCaller(req, admin))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("id, label, route, secret_token_name, meta_phone_number_id, provider, is_active")
    .eq("is_active", true)
    .eq("provider", "meta")
    .not("meta_phone_number_id", "is", null);
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const ch of (channels || []) as any[]) {
    const pnid = ch.meta_phone_number_id as string;
    const token = resolveToken(ch);
    if (!token) {
      results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: "no token" });
      continue;
    }
    const authHdr = { Authorization: `Bearer ${token}` };
    try {
      // Verified name + display number.
      const nameRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${pnid}?fields=verified_name,display_phone_number`,
        { headers: authHdr },
        15000,
      );
      const nameBody = await nameRes.json().catch(() => ({}));
      if (!nameRes.ok) {
        results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: `name ${nameRes.status}: ${nameBody?.error?.message || ""}`.trim() });
        continue;
      }
      const verifiedName: string | null = nameBody?.verified_name || null;

      // Business profile picture (may be absent).
      let avatarUrl: string | null = null;
      const profRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${pnid}/whatsapp_business_profile?fields=profile_picture_url,about`,
        { headers: authHdr },
        15000,
      );
      const profBody = await profRes.json().catch(() => ({}));
      const sourcePic = profRes.ok ? (profBody?.data?.[0]?.profile_picture_url || null) : null;
      if (sourcePic) avatarUrl = await rehostAvatar(admin, supabaseUrl, pnid, sourcePic);

      const patch: Record<string, unknown> = { profile_synced_at: new Date().toISOString() };
      if (verifiedName) patch.verified_name = verifiedName;
      if (avatarUrl) patch.profile_picture_url = avatarUrl;
      await admin.from("whatsapp_channels").update(patch).eq("id", ch.id);

      results.push({ id: ch.id, phone_number_id: pnid, ok: true, verified_name: verifiedName, avatar: !!avatarUrl });
    } catch (err: any) {
      results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: err?.message || "fetch error" });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  return json({ ok: true, channels: results.length, synced, results });
});
