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
 * Also writes Meta's phone-number `status` (CONNECTED / DISCONNECTED / …) so
 * Marketing can show whether a sender is actually registered. Reply-route
 * school numbers (Mirai 9220522282, Beacon) had no waba_id, so they never
 * appeared as a connected account and sends failed with Meta 133010.
 *
 * Auth: cron secret, service role, or a template-manager JWT. verify_jwt=false.
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

function phoneDigits(value: string | null | undefined): string {
  const d = (value || "").replace(/[^0-9]/g, "");
  if (d.length === 10) return `91${d}`;
  return d;
}

type DiscoveredPhone = {
  phoneNumberId: string;
  wabaId: string;
  isDefaultWaba: boolean;
  status: string | null;
  verifiedName: string | null;
};

async function listWabaPhones(wabaId: string, token: string): Promise<Array<{
  phoneNumberId: string;
  displayDigits: string;
  status: string | null;
  verifiedName: string | null;
}>> {
  const res = await fetchWithTimeout(
    `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
    15000,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body?.data)) return [];
  return body.data.map((p: { id?: string; display_phone_number?: string; status?: string; verified_name?: string }) => ({
    phoneNumberId: String(p.id || ""),
    displayDigits: phoneDigits(p.display_phone_number),
    status: p.status ? String(p.status).toUpperCase() : null,
    verifiedName: p.verified_name || null,
  })).filter((p) => p.phoneNumberId);
}

const TEMPLATE_MANAGER_ROLES = new Set(["super_admin", "admission_head"]);

async function isTemplateManagerCaller(req: Request, admin: any): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (jwt.length < 20) return false;
  const { data: authData, error } = await admin.auth.getUser(jwt);
  const userId = authData.user?.id || null;
  if (error || !userId) return false;
  const { data: userRole } = await admin.rpc("get_user_role", { _user_id: userId });
  return TEMPLATE_MANAGER_ROLES.has(String(userRole || ""));
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Re-host a template's example header media (Meta scontent handle) into the
 * public bucket so it's a valid send-time header link (Meta rejects the scontent
 * handle as a message header — 131053). Returns the public URL or null. */
async function rehostTemplateHeader(
  admin: any,
  supabaseUrl: string,
  name: string,
  sourceUrl: string,
  headerFormat: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(sourceUrl, {}, 20000);
    if (!res.ok) return null;
    const blob = await res.blob();
    const ext = EXT_BY_MIME[blob.type]
      || (headerFormat === "VIDEO" ? "mp4" : headerFormat === "DOCUMENT" ? "pdf" : "jpg");
    const path = `template-headers/${name}.${ext}`;
    const { error } = await admin.storage
      .from("whatsapp-media")
      .upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: true });
    if (error) return null;
    return `${supabaseUrl}/storage/v1/object/public/whatsapp-media/${path}`;
  } catch { return null; }
}

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

  if (!(await isServiceCaller(req, admin)) && !(await isTemplateManagerCaller(req, admin))) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Diagnostic/onboarding: list a WABA's phone numbers (id + display number) so a
  // stale meta_phone_number_id can be corrected or a new number (Seralis) wired.
  // { "action": "list_phone_numbers", "waba_id": "...", "token_env"?: "WHATSAPP_API_TOKEN" }
  const reqBody = await req.json().catch(() => ({}));
  if (reqBody?.action === "list_business_numbers") {
    const token = (Deno.env.get(reqBody.token_env || "WHATSAPP_API_TOKEN") || "").trim();
    if (!token || !reqBody.business_id) return json({ error: "business_id + valid token_env required" }, 400);
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${reqBody.business_id}/owned_whatsapp_business_accounts?fields=id,name,phone_numbers%7Bid,display_phone_number,verified_name%7D`,
      { headers: { Authorization: `Bearer ${token}` } },
      15000,
    );
    const body = await res.json().catch(() => ({}));
    return json({ ok: res.ok, status: res.status, wabas: body?.data || body?.error || body });
  }
  if (reqBody?.action === "list_phone_numbers") {
    const token = (Deno.env.get(reqBody.token_env || "WHATSAPP_API_TOKEN") || "").trim();
    const wabaId = reqBody.waba_id || (reqBody.waba_env ? Deno.env.get(reqBody.waba_env) : null);
    if (!token || !wabaId) return json({ error: "waba_id/waba_env and a valid token_env required" }, 400);
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } },
      15000,
    );
    const body = await res.json().catch(() => ({}));
    return json({ ok: res.ok, status: res.status, phone_numbers: body?.data || body?.error || body }, res.ok ? 200 : 200);
  }

  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("id, label, route, secret_token_name, meta_phone_number_id, business_number, provider, is_active, waba_id")
    .eq("is_active", true)
    .eq("provider", "meta")
    .not("meta_phone_number_id", "is", null);
  if (error) return json({ error: error.message }, 500);

  const defaultWabaId = (Deno.env.get("WHATSAPP_WABA_ID") || "").trim();
  const defaultToken = (Deno.env.get("WHATSAPP_API_TOKEN") || "").trim();
  const discoveredByDigits = new Map<string, DiscoveredPhone>();
  const discoveredByPnid = new Map<string, DiscoveredPhone>();
  const listedKeys = new Set<string>();
  const wabaTargets: Array<{ wabaId: string; token: string; isDefaultWaba: boolean }> = [];
  if (defaultWabaId && defaultToken) {
    wabaTargets.push({ wabaId: defaultWabaId, token: defaultToken, isDefaultWaba: true });
  }
  for (const ch of (channels || []) as any[]) {
    const waba = String(ch.waba_id || "").trim();
    const token = resolveToken(ch);
    if (!waba || !token) continue;
    wabaTargets.push({ wabaId: waba, token, isDefaultWaba: !!defaultWabaId && waba === defaultWabaId });
  }
  for (const target of wabaTargets) {
    const key = `${target.wabaId}:${target.token.slice(0, 8)}`;
    if (listedKeys.has(key)) continue;
    listedKeys.add(key);
    try {
      const phones = await listWabaPhones(target.wabaId, target.token);
      for (const p of phones) {
        const hit: DiscoveredPhone = {
          phoneNumberId: p.phoneNumberId,
          wabaId: target.wabaId,
          isDefaultWaba: target.isDefaultWaba,
          status: p.status,
          verifiedName: p.verifiedName,
        };
        if (p.displayDigits) discoveredByDigits.set(p.displayDigits, hit);
        discoveredByPnid.set(p.phoneNumberId, hit);
      }
    } catch { /* listing is best-effort */ }
  }

  const results: Array<Record<string, unknown>> = [];
  for (const ch of (channels || []) as any[]) {
    let pnid = ch.meta_phone_number_id as string;
    const token = resolveToken(ch);
    if (!token) {
      results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: "no token" });
      continue;
    }
    const listed = discoveredByDigits.get(phoneDigits(ch.business_number))
      || discoveredByPnid.get(pnid)
      || null;
    const authHdr = { Authorization: `Bearer ${token}` };
    try {
      // Verified name + display number + Cloud API connection status.
      // Status is what Marketing shows as Connected; 133010 on send means it
      // wasn't CONNECTED even when the number row existed in our registry.
      let identityRes = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/${pnid}?fields=verified_name,display_phone_number,status,code_verification_status`,
        { headers: authHdr },
        15000,
      );
      let identityBody = await identityRes.json().catch(() => ({}));
      if (!identityRes.ok && listed && listed.phoneNumberId !== pnid) {
        pnid = listed.phoneNumberId;
        identityRes = await fetchWithTimeout(
          `https://graph.facebook.com/v21.0/${pnid}?fields=verified_name,display_phone_number,status,code_verification_status`,
          { headers: authHdr },
          15000,
        );
        identityBody = await identityRes.json().catch(() => ({}));
      }
      if (!identityRes.ok && !listed) {
        const unreachableStatus = Number(identityBody?.error?.code) === 133010 ? "UNREGISTERED" : null;
        if (unreachableStatus) {
          await admin.from("whatsapp_channels").update({
            connection_status: unreachableStatus,
            profile_synced_at: new Date().toISOString(),
          }).eq("id", ch.id);
        }
        results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: `name ${identityRes.status}: ${identityBody?.error?.message || ""}`.trim(), connection_status: unreachableStatus });
        continue;
      }
      const verifiedName: string | null = identityBody?.verified_name || listed?.verifiedName || null;
      const connectionStatus: string | null = identityBody?.status
        ? String(identityBody.status).toUpperCase()
        : listed?.status || (identityRes.ok ? null : "UNREGISTERED");

      // Sending headroom: quality rating (GREEN/YELLOW/RED) and the 24h tier.
      // Requested separately from verified_name because these two fields 400 on
      // some numbers, and a health miss must not cost us the identity sync.
      // `messaging_limit_tier` is deprecated in favour of
      // `whatsapp_business_manager_messaging_limit`; ask for both and take
      // whichever the account still returns.
      let qualityRating: string | null = null;
      let messagingTier: string | null = null;
      try {
        const healthRes = await fetchWithTimeout(
          `https://graph.facebook.com/v21.0/${pnid}?fields=quality_rating,whatsapp_business_manager_messaging_limit,messaging_limit_tier`,
          { headers: authHdr },
          15000,
        );
        const healthBody = await healthRes.json().catch(() => ({}));
        if (healthRes.ok) {
          qualityRating = healthBody?.quality_rating || null;
          const limit = healthBody?.whatsapp_business_manager_messaging_limit;
          messagingTier = (typeof limit === "string" ? limit : limit?.max_daily_conversation_per_phone)
            || healthBody?.messaging_limit_tier
            || null;
          if (messagingTier != null) messagingTier = String(messagingTier);
        }
      } catch { /* health is best-effort */ }

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

      // Approved templates in this number's WABA (for the picker guard).
      // Resolve WABA from the channel, WABA listing (school numbers like Mirai
      // had none), or the main env for bulk/admissions. Reply-route numbers used
      // to skip this entirely, so they never showed as a connected account.
      let templateNames: string[] | null = null;
      const wabaId = ch.waba_id
        || (listed && !listed.isDefaultWaba ? listed.wabaId : null)
        || ((listed?.isDefaultWaba || ["bulk", "admissions"].includes(ch.route))
          ? (defaultWabaId || null)
          : null);
      if (wabaId) {
        try {
          const tplRes = await fetchWithTimeout(
            `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,status,category,language,components&limit=1000`,
            { headers: authHdr }, 20000,
          );
          const tplBody = await tplRes.json().catch(() => ({}));
          if (tplRes.ok && Array.isArray(tplBody?.data)) {
            const approved = tplBody.data.filter((t: any) => String(t?.status).toUpperCase() === "APPROVED");
            templateNames = [...new Set(approved.map((t: any) => String(t.name)))];
            // Mirror every WABA's templates into whatsapp_templates (+ a hidden
            // visibility row) so they appear in the picker/Template Visibility,
            // not just the main WABA's. Unique on (name, language).
            for (const t of approved) {
              const components = Array.isArray(t.components) ? t.components : [];
              const body = components.find((c: any) => String(c?.type).toUpperCase() === "BODY");
              const header = components.find((c: any) => String(c?.type).toUpperCase() === "HEADER");
              const placeholders = [...String(body?.text || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
              const placeholderCount = placeholders.length ? Math.max(...placeholders) : 0;
              const headerFormat = header?.format ? String(header.format).toUpperCase() : null;
              await admin.from("whatsapp_templates").upsert({
                name: t.name,
                language: t.language || "en",
                status: "APPROVED",
                category: t.category || null,
                components,
                header_format: headerFormat,
                has_media: !!headerFormat && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat),
                placeholder_count: placeholderCount,
                // Default WABA stays NULL so senderCanSendTemplate keeps matching MAIN.
                waba_id: defaultWabaId && wabaId === defaultWabaId ? null : wabaId,
                status_updated_at: new Date().toISOString(),
              }, { onConflict: "name,language" });
              // Marketing-category templates surface in the picker by default;
              // utility/auth stay hidden (curate in Template Visibility).
              await admin.from("whatsapp_template_settings").upsert({
                template_key: t.name,
                display_name: String(t.name).replace(/_/g, " "),
                category: String(t.category || "general").toLowerCase(),
                visibility: String(t.category || "").toUpperCase() === "MARKETING" ? "marketing_only" : "hidden",
              }, { onConflict: "template_key", ignoreDuplicates: true });

              // Media-header templates: re-host the example image/video/doc so
              // they're sendable (the campaign path falls back to media_url).
              // Only when media_url isn't already set — one rehost per template.
              const exampleHandle = header?.example?.header_handle?.[0];
              if (headerFormat && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && exampleHandle) {
                const { data: curSetting } = await admin
                  .from("whatsapp_template_settings").select("media_url").eq("template_key", t.name).maybeSingle();
                if (!(curSetting as any)?.media_url) {
                  const hostedUrl = await rehostTemplateHeader(admin, supabaseUrl, t.name, exampleHandle, headerFormat);
                  if (hostedUrl) {
                    await admin.from("whatsapp_template_settings").update({ media_url: hostedUrl }).eq("template_key", t.name);
                  }
                }
              }
            }
          }
        } catch { /* leave null — unverified */ }
      }

      const patch: Record<string, unknown> = { profile_synced_at: new Date().toISOString() };
      if (verifiedName) patch.verified_name = verifiedName;
      if (connectionStatus) patch.connection_status = connectionStatus;
      if (pnid !== ch.meta_phone_number_id) patch.meta_phone_number_id = pnid;
      if (qualityRating || messagingTier) {
        patch.quality_rating = qualityRating;
        patch.messaging_limit_tier = messagingTier;
        patch.health_synced_at = new Date().toISOString();
      }
      if (avatarUrl) patch.profile_picture_url = avatarUrl;
      if (templateNames) {
        patch.available_templates = templateNames;
        patch.templates_synced_at = new Date().toISOString();
      }
      // Never stamp the default WABA id — MAIN senders must stay NULL.
      if (wabaId && !ch.waba_id && wabaId !== defaultWabaId) patch.waba_id = wabaId;
      await admin.from("whatsapp_channels").update(patch).eq("id", ch.id);

      results.push({ id: ch.id, phone_number_id: pnid, ok: true, verified_name: verifiedName, avatar: !!avatarUrl, templates: templateNames?.length ?? null, quality_rating: qualityRating, messaging_limit_tier: messagingTier, connection_status: connectionStatus });
    } catch (err: any) {
      results.push({ id: ch.id, phone_number_id: pnid, ok: false, reason: err?.message || "fetch error" });
    }
  }

  const synced = results.filter((r) => r.ok).length;
  return json({ ok: true, channels: results.length, synced, results });
});
