/**
 * WhatsApp Template Media Upload
 * ─────────────────────────────────────────────────────────────
 * Turns an uploaded file into a Meta `header_handle` via the Graph
 * Resumable Upload API, for use as the example media of an IMAGE / VIDEO /
 * DOCUMENT template header.
 *
 *   1. POST /{WHATSAPP_APP_ID}/uploads?file_length&file_type  → upload session id
 *   2. POST /{session_id}  (Authorization: OAuth <token>, file bytes)  → { h: handle }
 *
 * The returned handle is short-lived — the caller should submit the template
 * (via `whatsapp-templates` create) immediately after uploading.
 *
 * Auth: requires an authenticated user with the super_admin or admission_head role.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Meta media-header limits (bytes) by template header format.
const SIZE_LIMITS: Record<string, number> = {
  IMAGE: 5 * 1024 * 1024,
  VIDEO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
};

const ALLOWED_MIME: Record<string, Set<string>> = {
  IMAGE: new Set(["image/jpeg", "image/jpg", "image/png"]),
  VIDEO: new Set(["video/mp4", "video/3gpp"]),
  DOCUMENT: new Set(["application/pdf"]),
};

function formatForMime(mime: string): "IMAGE" | "VIDEO" | "DOCUMENT" | null {
  if (ALLOWED_MIME.IMAGE.has(mime)) return "IMAGE";
  if (ALLOWED_MIME.VIDEO.has(mime)) return "VIDEO";
  if (ALLOWED_MIME.DOCUMENT.has(mime)) return "DOCUMENT";
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unexpected error";
}

async function readMetaResponse(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}

function jwtRole(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const parsed = JSON.parse(decoded);
    return typeof parsed?.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

const TEMPLATE_MANAGER_ROLES = new Set(["super_admin", "admission_head"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appId = Deno.env.get("WHATSAPP_APP_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!appId || !waToken) {
      return json({ error: "WhatsApp app not configured (WHATSAPP_APP_ID / WHATSAPP_API_TOKEN missing)" }, 503);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth: verify JWT with Supabase Auth, then verify template-manager role ──
    // Service-role automation is allowed for deployment scripts that need to
    // upload Meta sample media before submitting templates.
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized: no auth header" }, 401);

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceRole = jwt === serviceRoleKey || jwtRole(jwt) === "service_role";
    if (!isServiceRole) {
      const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
      const userId = authData.user?.id;
      if (authError || !userId) {
        return json({ error: "Unauthorized: invalid token" }, 401);
      }

      const { data: role } = await adminClient.rpc("get_user_role", { _user_id: userId });
      if (!TEMPLATE_MANAGER_ROLES.has(String(role || ""))) {
        return json({ error: "Forbidden: super_admin or admission_head only" }, 403);
      }
    }

    // ── Parse the uploaded file ──
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "file is required (multipart/form-data)" }, 400);
    }

    const mime = file.type || "application/octet-stream";
    const fileName = file.name || `template-header-${Date.now()}`;
    const format = formatForMime(mime);
    if (!format) {
      return json({ error: `Unsupported media type: ${mime}. Allowed: jpeg, png, mp4, 3gpp, pdf.` }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return json({ error: "Empty file" }, 400);
    if (bytes.length > SIZE_LIMITS[format]) {
      const mb = (SIZE_LIMITS[format] / (1024 * 1024)).toFixed(0);
      return json({ error: `File exceeds the ${mb}MB limit for ${format} headers` }, 400);
    }

    // ── Per-WABA app + token resolution ──────────────────────────────────────
    // A Meta header_handle is scoped to the APP that uploaded it. Templates on a
    // non-default WABA (e.g. Seralis, a different Meta app) need the sample media
    // uploaded under THAT app. Resolve the WABA's token from its channel, then
    // derive its app id via /debug_token — so no per-WABA app id has to be
    // hardcoded. Falls back to the default app when no waba_id is given.
    let uploadAppId = appId;
    let uploadToken = waToken;
    const wabaId = String(form.get("waba_id") || "").trim();
    if (wabaId) {
      const { data: ch } = await adminClient
        .from("whatsapp_channels")
        .select("secret_token_name")
        .eq("waba_id", wabaId)
        .eq("is_active", true)
        .limit(1)
        .single();
      const wabaToken = ch?.secret_token_name ? Deno.env.get(ch.secret_token_name) : null;
      if (wabaToken && wabaToken !== waToken) {
        const dbg = await readMetaResponse(
          await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${wabaToken}&access_token=${wabaToken}`),
        );
        const resolvedAppId = dbg?.data?.app_id ? String(dbg.data.app_id) : null;
        if (!resolvedAppId) {
          return json({ error: `Could not resolve the Meta app for WABA ${wabaId} — its media can't be uploaded from here.` }, 400);
        }
        uploadAppId = resolvedAppId;
        uploadToken = wabaToken;
      }
    }

    // ── Step 1: create an upload session ──
    const sessionUrl =
      `https://graph.facebook.com/v21.0/${uploadAppId}/uploads` +
      `?file_name=${encodeURIComponent(fileName)}` +
      `&file_length=${bytes.length}` +
      `&file_type=${encodeURIComponent(mime)}` +
      `&access_token=${uploadToken}`;

    const sessionRes = await fetch(sessionUrl, { method: "POST" });
    const sessionData = await readMetaResponse(sessionRes);
    if (!sessionRes.ok || !sessionData?.id) {
      console.error("upload session error:", sessionData);
      return json({ error: sessionData?.error?.message || "Failed to create upload session" }, 502);
    }

    // ── Step 2: upload the bytes, receive the header handle ──
    const uploadRes = await fetch(`https://graph.facebook.com/v21.0/${sessionData.id}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${uploadToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });
    const uploadData = await readMetaResponse(uploadRes);
    if (!uploadRes.ok || !uploadData?.h) {
      console.error("upload bytes error:", uploadData);
      return json({ error: uploadData?.error?.message || "Media upload failed" }, 502);
    }

    return json({ handle: uploadData.h, format, mime, size: bytes.length });
  } catch (err: unknown) {
    console.error("template media upload error:", err);
    return json({ error: errorMessage(err) }, 500);
  }
});
