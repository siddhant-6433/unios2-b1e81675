import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { downscaleForDisplay } from "../_shared/resizeImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PHOTO_PATTERN = /^(applicant|student)_photo|passport_photo|^photo[-_]/i;
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

function extForMime(mimeType: string) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function base64ToBytes(base64: string) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileTime(file: any) {
  const raw = file?.updated_at || file?.created_at || file?.last_accessed_at || "";
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

async function processPhoto(apiKey: string, mimeType: string, bytes: Uint8Array) {
  const base64 = bytesToBase64(bytes);
  const prompt =
    "Create an official student ID/passport style photo from this image. " +
    "Remove the current background and replace it with a plain pure-white (#FFFFFF) background. " +
    "Correct exposure, white balance, shadows, and color cast so the image looks natural and evenly lit. " +
    "Preserve the student's real identity exactly: do not change facial features, face shape, age, skin tone, expression, hair, clothing, marks, or accessories. " +
    "Do not beautify, retouch the face, smooth skin, add makeup, change gaze, change hairstyle, add text, add borders, or add decorative elements. " +
    "Frame bust level upward, head centered, eyes near the upper third. Return only the regenerated image.";

  const attempts: Array<{ model: string; status: number; body: string }> = [];
  for (const model of GEMINI_MODELS) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      attempts.push({ model, status: response.status, body: body.slice(0, 400) });
      if (response.status !== 404 && !body.toLowerCase().includes("not found") && !body.toLowerCase().includes("does not exist")) break;
      continue;
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const inline = part?.inline_data || part?.inlineData;
      if (inline?.data) {
        const outputMime = inline.mime_type || inline.mimeType || "image/png";
        return { bytes: base64ToBytes(inline.data), mimeType: outputMime, model };
      }
    }

    const text = parts.map((part: any) => part?.text).filter(Boolean).join(" ").slice(0, 400);
    attempts.push({ model, status: 200, body: `No image returned. ${text}` });
    break;
  }

  const last = attempts[attempts.length - 1];
  throw new Error(last ? `Photo processing failed (${last.model}, ${last.status}): ${last.body}` : "Photo processing failed");
}

async function findApplicationPhoto(admin: any, applicationId: string) {
  const bucket = "application-documents";
  const prefixes = [applicationId, applicationId.toUpperCase(), applicationId.toLowerCase()];
  for (const prefix of prefixes) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error || !data?.length) continue;
    const file = data
      .filter((item: any) => item?.name && PHOTO_PATTERN.test(item.name))
      .sort((a: any, b: any) => fileTime(b) - fileTime(a))[0];
    if (!file) continue;
    return { bucket, path: `${prefix}/${file.name}`, file };
  }
  return null;
}

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
    const configuredBackfillToken = Deno.env.get("BACKFILL_STUDENT_PHOTOS_TOKEN");
    const requestBackfillToken = req.headers.get("x-backfill-token");
    const tokenAuthorized = !!configuredBackfillToken && requestBackfillToken === configuredBackfillToken;

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
    const onlyStudentId = typeof body.student_id === "string" ? body.student_id : null;

    let query = admin
      .from("students")
      .select("id, lead_id, name, photo_url")
      .not("lead_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (onlyStudentId) query = query.eq("id", onlyStudentId);
    else query = query.is("photo_url", null);

    const { data: students, error: studentsError } = await query;
    if (studentsError) return json({ error: studentsError.message }, 500);

    const leadIds = Array.from(new Set((students || []).map((student: any) => student.lead_id).filter(Boolean)));
    const latestApplicationByLead = new Map<string, { application_id: string; created_at: string | null }>();
    if (leadIds.length > 0) {
      const { data: applications, error: applicationsError } = await admin
        .from("applications")
        .select("lead_id, application_id, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false });
      if (applicationsError) return json({ error: applicationsError.message }, 500);
      (applications || []).forEach((application: any) => {
        if (application.lead_id && application.application_id && !latestApplicationByLead.has(application.lead_id)) {
          latestApplicationByLead.set(application.lead_id, {
            application_id: application.application_id,
            created_at: application.created_at || null,
          });
        }
      });
    }

    const results = [];
    for (const student of students || []) {
      const application = latestApplicationByLead.get(student.lead_id);
      if (!application?.application_id) {
        results.push({ student_id: student.id, name: student.name, status: "skipped", reason: "no application" });
        continue;
      }

      const source = await findApplicationPhoto(admin, application.application_id);
      if (!source) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "skipped", reason: "no application photo" });
        continue;
      }

      if (dryRun) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "would_process", source_path: source.path });
        continue;
      }

      const download = await admin.storage.from(source.bucket).download(source.path);
      if (download.error || !download.data) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "failed", reason: download.error?.message || "download failed" });
        continue;
      }

      const inputBytes = new Uint8Array(await download.data.arrayBuffer());
      const mimeType = source.file?.metadata?.mimetype || download.data.type || "image/png";
      const processed = await processPhoto(apiKey, mimeType, inputBytes);
      const display = await downscaleForDisplay(processed.bytes, processed.mimeType);
      const extension = extForMime(display.mimeType);
      const path = `${student.id}/backfilled-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.${extension}`;
      const upload = await admin.storage
        .from("student-profile-photos")
        .upload(path, display.bytes, { contentType: display.mimeType, upsert: true });
      if (upload.error) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "failed", reason: upload.error.message });
        continue;
      }

      const { data: pub } = admin.storage.from("student-profile-photos").getPublicUrl(path);
      const photoUrl = pub?.publicUrl;
      if (!photoUrl) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "failed", reason: "public URL missing" });
        continue;
      }

      const update = await admin.from("students").update({ photo_url: photoUrl, updated_at: new Date().toISOString() }).eq("id", student.id);
      if (update.error) {
        results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "failed", reason: update.error.message });
        continue;
      }

      await admin.from("student_audit_log").insert({
        student_id: student.id,
        event_type: "photo_backfill",
        field_name: "photo_url",
        old_value: student.photo_url || null,
        new_value: photoUrl,
        metadata: { application_id: application.application_id, source_path: source.path, processed_path: path, model: processed.model },
      });

      results.push({ student_id: student.id, name: student.name, application_id: application.application_id, status: "processed", source_path: source.path, processed_path: path });
    }

    return json({
      ok: true,
      dry_run: dryRun,
      limit,
      processed: results.filter((result) => result.status === "processed").length,
      would_process: results.filter((result) => result.status === "would_process").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  } catch (err) {
    console.error("[backfill-student-photos] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
