/**
 * Photo Day fast capture path.
 * Stores the original immediately, sets students.photo_url = original,
 * enqueues AI background-removal, returns without waiting for Gemini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  base64ToBytes,
  extForMime,
  parseDataUrl,
} from "../_shared/passportPhoto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "student-profile-photos";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwt(token: string): Record<string, unknown> | null {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const claims = decodeJwt(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) return json({ error: "Invalid token" }, 401);
    if (typeof claims?.exp === "number" && claims.exp < Date.now() / 1000) {
      return json({ error: "Token expired" }, 401);
    }

    const body = await req.json();
    const studentId = body?.student_id;
    const image = body?.image;
    if (!studentId || typeof studentId !== "string") return json({ error: "student_id is required" }, 400);
    if (!image || typeof image !== "string") return json({ error: "image data URL is required" }, 400);

    const parsed = parseDataUrl(image);
    if (!parsed) return json({ error: "image must be a base64 data URL" }, 400);
    if (!ALLOWED_MIME.has(parsed.mimeType)) return json({ error: `Unsupported image type: ${parsed.mimeType}` }, 415);

    const inputBytes = base64ToBytes(parsed.base64);
    if (inputBytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image exceeds 5MB" }, 413);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { data: canCapture, error: canErr } = await admin.rpc("can_capture_student_photos", {
      _user_id: callerId,
    });
    if (canErr) {
      console.error("[student-photo-capture] can_capture check failed:", canErr);
      return json({ error: "Unable to verify photo permissions" }, 500);
    }
    if (!canCapture) return json({ error: "Photo Day capture not assigned to this user" }, 403);

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id, name, campus_id")
      .eq("id", studentId)
      .maybeSingle();
    if (studentError) {
      console.error("[student-photo-capture] student lookup failed:", studentError);
      return json({ error: "Unable to load student" }, 500);
    }
    if (!student) return json({ error: "Student not found" }, 404);

    const { data: role } = await admin.rpc("get_user_role", { _user_id: callerId });
    const isSuperAdmin = role === "super_admin";
    if (!isSuperAdmin) {
      if (!student.campus_id) return json({ error: "Student has no campus" }, 400);
      const { data: campusOk, error: campusErr } = await admin.rpc("user_can_access_assigned_campus", {
        _user_id: callerId,
        _campus_id: student.campus_id,
      });
      if (campusErr) {
        console.error("[student-photo-capture] campus check failed:", campusErr);
        return json({ error: "Unable to verify campus access" }, 500);
      }
      if (!campusOk) return json({ error: "Student is outside your campus" }, 403);
    }

    const ext = extForMime(parsed.mimeType);
    const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const path = `${student.campus_id || "unassigned"}/${student.id}/original-${version}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, inputBytes, { contentType: parsed.mimeType, upsert: true });
    if (uploadError) {
      console.error("[student-photo-capture] upload failed:", uploadError);
      return json({ error: uploadError.message }, 500);
    }

    const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path);
    const originalUrl = publicUrl?.publicUrl;
    if (!originalUrl) return json({ error: "Unable to resolve uploaded photo URL" }, 500);

    // Supersede any in-flight AI jobs for this student
    await admin.rpc("cancel_pending_student_photo_jobs", { _student_id: student.id });

    const { error: updateError } = await admin
      .from("students")
      .update({
        photo_original_url: originalUrl,
        photo_url: originalUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", student.id);
    if (updateError) {
      console.error("[student-photo-capture] student update failed:", updateError);
      return json({ error: "Photo uploaded but student update failed" }, 500);
    }

    const { data: job, error: jobError } = await admin
      .from("student_photo_jobs")
      .insert({
        student_id: student.id,
        original_path: path,
        original_url: originalUrl,
        status: "pending",
        requested_by: callerId,
        campus_id: student.campus_id,
        next_attempt_at: new Date().toISOString(),
      })
      .select("id, status")
      .single();
    if (jobError) {
      console.error("[student-photo-capture] job insert failed:", jobError);
      // Original is already live — report soft failure for queue only
      return json({
        ok: true,
        student_id: student.id,
        photo_url: originalUrl,
        photo_original_url: originalUrl,
        job_id: null,
        ai_status: "queue_failed",
        warning: jobError.message,
      });
    }

    // Best-effort kick so AI often starts before the next cron minute
    const workerUrl = `${supabaseUrl}/functions/v1/process-student-photo-jobs`;
    // Fire-and-forget; do not await long AI work here
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ limit: 2, job_id: job.id }),
    }).catch((err) => console.warn("[student-photo-capture] worker kick failed:", err));

    return json({
      ok: true,
      student_id: student.id,
      photo_url: originalUrl,
      photo_original_url: originalUrl,
      job_id: job.id,
      ai_status: "pending",
    });
  } catch (err) {
    console.error("[student-photo-capture] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
