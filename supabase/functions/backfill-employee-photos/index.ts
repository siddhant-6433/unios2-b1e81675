/**
 * One-time catch-up: give existing employee photos the same pure-white background
 * students get, so the ID card can cut them out over the wave rings.
 *
 * New employee uploads already run process-passport-photo in EmployeeProfileDialog,
 * so this only exists to fix the pre-existing fleet. It reprocesses ONLY the photos
 * that aren't already white-bg — it samples each photo's border ring and skips the
 * ones that are already predominantly near-white, so already-processed photos cost
 * no Gemini spend and the run is idempotent (no schema flag to drift).
 *
 * Auth: super_admin JWT, or the x-backfill-token env token. Dry-run by default.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import {
  base64ToBytes,
  bytesToBase64,
  processPassportPhoto,
} from "../_shared/passportPhoto.ts";
import { downscaleForDisplay } from "../_shared/resizeImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backfill-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "employee-photos";
// Border-ring near-white fraction above which a photo is treated as already white-bg.
const ALREADY_WHITE_BORDER_FRACTION = 0.5;

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Same neutral-white rule as the client cutout (src/lib/whiteBgCutout.ts). */
function isNeutralWhite(r: number, g: number, b: number): boolean {
  return r > 235 && g > 235 && b > 235 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
}

/** Fraction of the border ring that is neutral near-white — our "already white-bg?" signal. */
function borderNearWhiteFraction(img: any): number {
  const w = img.width, h = img.height;
  let total = 0, white = 0;
  const sample = (x: number, y: number) => {
    const [r, g, b] = Image.colorToRGBA(img.getPixelAt(x, y)); // imagescript is 1-indexed
    total++;
    if (isNeutralWhite(r, g, b)) white++;
  };
  for (let x = 1; x <= w; x++) { sample(x, 1); sample(x, h); }
  for (let y = 1; y <= h; y++) { sample(1, y); sample(w, y); }
  return total ? white / total : 0;
}

/** Parse the storage object path out of a stored public URL, or null if it isn't in our bucket. */
function objectPathFromUrl(url: string): string | null {
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length).split("?")[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    if (!serviceKey || !supabaseUrl) return json({ error: "Supabase service configuration missing" }, 500);
    if (!apiKey) return json({ error: "Gemini key missing" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const configuredToken = Deno.env.get("BACKFILL_EMPLOYEE_PHOTOS_TOKEN");
    const requestToken = req.headers.get("x-backfill-token");
    const tokenAuthorized = !!configuredToken && requestToken === configuredToken;

    if (!tokenAuthorized) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) return json({ error: "Missing authorization" }, 401);
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
      const claims = decodeJwt(token);
      if (!claims?.sub) return json({ error: "Invalid token" }, 401);
      if (claims.exp && claims.exp < Date.now() / 1000) return json({ error: "Token expired" }, 401);

      const { data: callerRole, error: roleError } = await admin.rpc("get_user_role", { _user_id: claims.sub });
      if (roleError) return json({ error: "Unable to verify role" }, 500);
      if (callerRole !== "super_admin") return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const limit = Math.max(1, Math.min(Number(body.limit || 10), 50));
    const offset = Math.max(0, Number(body.offset || 0));
    const throttleMs = Math.max(0, Math.min(Number(body.throttle_ms ?? 500), 5000));
    const onlyEmployeeId = typeof body.employee_id === "string" ? body.employee_id : null;

    // Order by id (stable): re-runs and photo_url updates never reshuffle the page window.
    let query = admin
      .from("employee_profiles")
      .select("id, user_id, display_name, photo_url")
      .not("photo_url", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (onlyEmployeeId) query = query.eq("id", onlyEmployeeId);

    const { data: employees, error: employeesError } = await query;
    if (employeesError) return json({ error: employeesError.message }, 500);

    const results: any[] = [];
    for (const emp of employees || []) {
      const label = { employee_id: emp.id, name: emp.display_name };
      const objectPath = objectPathFromUrl(emp.photo_url || "");
      if (!objectPath) {
        results.push({ ...label, status: "skipped", reason: "photo not in employee-photos bucket" });
        continue;
      }

      const download = await admin.storage.from(BUCKET).download(objectPath);
      if (download.error || !download.data) {
        results.push({ ...label, status: "failed", reason: download.error?.message || "download failed" });
        continue;
      }
      const inputBytes = new Uint8Array(await download.data.arrayBuffer());

      // Already white-bg? Skip — no Gemini spend, keeps the run idempotent.
      let img: any;
      try {
        img = await Image.decode(inputBytes);
      } catch (err) {
        results.push({ ...label, status: "failed", reason: `decode failed: ${err instanceof Error ? err.message : err}` });
        continue;
      }
      const borderWhite = borderNearWhiteFraction(img);
      if (borderWhite >= ALREADY_WHITE_BORDER_FRACTION) {
        results.push({ ...label, status: "skipped", reason: "already white-bg", border_white: Number(borderWhite.toFixed(2)) });
        continue;
      }

      if (dryRun) {
        results.push({ ...label, status: "would_process", border_white: Number(borderWhite.toFixed(2)), object_path: objectPath });
        continue;
      }

      const inputMime = download.data.type || "image/jpeg";
      const processed = await processPassportPhoto(apiKey, inputMime, bytesToBase64(inputBytes));
      if (!processed.ok) {
        results.push({ ...label, status: "failed", reason: `gemini ${processed.status}: ${processed.body}` });
        if (throttleMs) await sleep(throttleMs);
        continue;
      }

      const display = await downscaleForDisplay(base64ToBytes(processed.base64), processed.mimeType);
      // Re-upload to the SAME path so the stable public URL is preserved.
      const upload = await admin.storage
        .from(BUCKET)
        .upload(objectPath, display.bytes, { contentType: display.mimeType, upsert: true });
      if (upload.error) {
        results.push({ ...label, status: "failed", reason: upload.error.message });
        if (throttleMs) await sleep(throttleMs);
        continue;
      }

      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
      const newUrl = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust: path is stable
      const update = await admin.from("employee_profiles").update({ photo_url: newUrl }).eq("id", emp.id);
      if (update.error) {
        results.push({ ...label, status: "failed", reason: update.error.message });
        if (throttleMs) await sleep(throttleMs);
        continue;
      }

      results.push({ ...label, status: "processed", object_path: objectPath, model: processed.model });
      if (throttleMs) await sleep(throttleMs);
    }

    return json({
      ok: true,
      dry_run: dryRun,
      limit,
      offset,
      seen: results.length,
      processed: results.filter((r) => r.status === "processed").length,
      would_process: results.filter((r) => r.status === "would_process").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (err) {
    console.error("[backfill-employee-photos] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
