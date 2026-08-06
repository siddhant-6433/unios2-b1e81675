import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { downscaleForDisplay } from "../_shared/resizeImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "student-profile-photos";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const STAFF_ROLES_WITH_ASSIGNED_BRANCH_ACCESS = new Set(["office_admin", "office_assistant"]);
const ADMIN_ROLES = new Set(["super_admin"]);
const GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
];

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

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function extForMime(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

type ProcessResult =
  | { ok: true; mimeType: string; base64: string; model: string }
  | { ok: false; status: number; body: string; model: string };

async function processPhoto(model: string, apiKey: string, mimeType: string, base64: string): Promise<ProcessResult> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          {
            text:
              "Create an official student ID/passport style photo from this image. " +
              "Remove the current background and replace it with a plain pure-white (#FFFFFF) background. " +
              "Correct exposure, white balance, shadows, and color cast so the image looks natural and evenly lit. " +
              "Preserve the student's real identity exactly: do not change facial features, face shape, age, skin tone, expression, hair, clothing, marks, or accessories. " +
              "Do not beautify, retouch the face, smooth skin, add makeup, change gaze, change hairstyle, add text, add borders, or add decorative elements. " +
              "Frame the student front-facing from bust level upward, with the head centered and eyes near the upper third. " +
              "Return only the regenerated image.",
          },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[student-profile-photo-upload] ${model} -> ${response.status}: ${body.slice(0, 400)}`);
    return { ok: false, status: response.status, body: body.slice(0, 400), model };
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part?.inline_data || part?.inlineData;
    if (inline?.data) {
      return {
        ok: true,
        mimeType: inline.mime_type || inline.mimeType || "image/png",
        base64: inline.data,
        model,
      };
    }
  }

  const finishReason = data?.candidates?.[0]?.finishReason;
  const text = parts.map((part: any) => part?.text).filter(Boolean).join(" ").slice(0, 400);
  return {
    ok: false,
    status: 200,
    body: `No image part returned. finishReason=${finishReason}. ${text}`,
    model,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const claims = decodeJwt(token);
    if (!claims?.sub) return json({ error: "Invalid token" }, 401);
    if (claims.exp && claims.exp < Date.now() / 1000) return json({ error: "Token expired" }, 401);

    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

    const { student_id, image } = await req.json();
    if (!student_id || typeof student_id !== "string") return json({ error: "student_id is required" }, 400);
    if (!image || typeof image !== "string") return json({ error: "image data URL is required" }, 400);

    const parsed = parseDataUrl(image);
    if (!parsed) return json({ error: "image must be a base64 data URL" }, 400);
    if (!ALLOWED_MIME.has(parsed.mimeType)) return json({ error: `Unsupported image type: ${parsed.mimeType}` }, 415);

    const inputBytes = base64ToBytes(parsed.base64);
    if (inputBytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image exceeds 5MB" }, 413);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const callerId = claims.sub as string;
    const { data: callerRole, error: roleError } = await admin.rpc("get_user_role", { _user_id: callerId });
    if (roleError) {
      console.error("[student-profile-photo-upload] role lookup failed:", roleError);
      return json({ error: "Unable to verify role" }, 500);
    }

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id, name, campus_id")
      .eq("id", student_id)
      .maybeSingle();
    if (studentError) {
      console.error("[student-profile-photo-upload] student lookup failed:", studentError);
      return json({ error: "Unable to load student" }, 500);
    }
    if (!student) return json({ error: "Student not found" }, 404);

    let allowed = ADMIN_ROLES.has(callerRole);
    if (!allowed && STAFF_ROLES_WITH_ASSIGNED_BRANCH_ACCESS.has(callerRole)) {
      const { data: branchAllowed, error: branchError } = await admin.rpc("user_can_access_assigned_campus", {
        _user_id: callerId,
        _campus_id: student.campus_id,
      });
      if (branchError) {
        console.error("[student-profile-photo-upload] branch access check failed:", branchError);
        return json({ error: "Unable to verify branch access" }, 500);
      }
      allowed = Boolean(branchAllowed);
    }
    if (!allowed) return json({ error: "Forbidden for this student branch" }, 403);

    const attempts: Array<{ model: string; status: number; body: string }> = [];
    let processed: Extract<ProcessResult, { ok: true }> | null = null;
    for (const model of GEMINI_MODELS) {
      const result = await processPhoto(model, apiKey, parsed.mimeType, parsed.base64);
      if (result.ok) {
        processed = result;
        break;
      }
      attempts.push({ model: result.model, status: result.status, body: result.body });
      if (result.status !== 404 && !result.body.toLowerCase().includes("not found") && !result.body.toLowerCase().includes("does not exist")) {
        break;
      }
    }
    if (!processed) {
      const last = attempts[attempts.length - 1];
      return json({ error: `AI photo processing failed (${last.model}, ${last.status})`, attempts }, 502);
    }

    const rawOutputBytes = base64ToBytes(processed.base64);
    if (rawOutputBytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Processed image exceeds 5MB" }, 413);
    const display = await downscaleForDisplay(rawOutputBytes, processed.mimeType);

    const ext = extForMime(display.mimeType);
    const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const path = `${student.campus_id || "unassigned"}/${student.id}/profile-${version}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, display.bytes, { contentType: display.mimeType, upsert: true });
    if (uploadError) {
      console.error("[student-profile-photo-upload] upload failed:", uploadError);
      return json({ error: uploadError.message }, 500);
    }

    const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path);
    const photoUrl = publicUrl?.publicUrl;
    if (!photoUrl) return json({ error: "Unable to resolve uploaded photo URL" }, 500);

    const { error: updateError } = await admin
      .from("students")
      .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
      .eq("id", student.id);
    if (updateError) {
      console.error("[student-profile-photo-upload] update failed:", updateError);
      return json({ error: "Photo uploaded but student update failed" }, 500);
    }

    return json({ ok: true, student_id: student.id, photo_url: photoUrl, path, model: processed.model });
  } catch (err) {
    console.error("[student-profile-photo-upload] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
