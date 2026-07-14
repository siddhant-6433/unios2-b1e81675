/**
 * Background worker: claim student_photo_jobs, Gemini white-BG process,
 * auto-flip students.photo_url to processed on success.
 *
 * Invoked by pg_cron (fn_process_student_photo_jobs) or kicked from capture.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  base64ToBytes,
  bytesToBase64,
  extForMime,
  processPassportPhoto,
} from "../_shared/passportPhoto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "student-profile-photos";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JobRow = {
  id: string;
  student_id: string;
  original_path: string;
  original_url: string;
  status: string;
  attempts: number;
  max_attempts: number;
  campus_id: string | null;
};

async function processOne(
  admin: ReturnType<typeof createClient>,
  apiKey: string,
  job: JobRow,
): Promise<{ id: string; ok: boolean; error?: string }> {
  try {
    const { data: file, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(job.original_path);
    if (downloadError || !file) {
      throw new Error(downloadError?.message || "Failed to download original");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Original image exceeds 5MB");
    }

    const mimeType = file.type || "image/jpeg";
    const base64 = bytesToBase64(bytes);
    const result = await processPassportPhoto(apiKey, mimeType, base64);

    if (!result.ok) {
      const err = `AI failed (${result.model}, ${result.status}): ${result.body}`;
      const attempts = job.attempts;
      const maxAttempts = job.max_attempts;
      if (attempts >= maxAttempts) {
        await admin
          .from("student_photo_jobs")
          .update({
            status: "failed",
            last_error: err,
            completed_at: new Date().toISOString(),
            model: result.model,
          })
          .eq("id", job.id);
      } else {
        const backoffMin = Math.min(attempts * 2, 15);
        await admin
          .from("student_photo_jobs")
          .update({
            status: "pending",
            last_error: err,
            model: result.model,
            next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          })
          .eq("id", job.id);
      }
      return { id: job.id, ok: false, error: err };
    }

    const outBytes = base64ToBytes(result.base64);
    if (outBytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Processed image exceeds 5MB");
    }

    const ext = extForMime(result.mimeType);
    const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const processedPath =
      `${job.campus_id || "unassigned"}/${job.student_id}/processed-${version}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(processedPath, outBytes, { contentType: result.mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(processedPath);
    const processedUrl = publicUrl?.publicUrl;
    if (!processedUrl) throw new Error("Unable to resolve processed URL");

    // Only flip photo_url if this original is still the student's current original
    // (avoids overwriting a newer retake)
    const { data: student } = await admin
      .from("students")
      .select("id, photo_original_url")
      .eq("id", job.student_id)
      .maybeSingle();

    const stillCurrent =
      !student?.photo_original_url || student.photo_original_url === job.original_url;

    if (stillCurrent) {
      const { error: studentErr } = await admin
        .from("students")
        .update({
          photo_processed_url: processedUrl,
          photo_url: processedUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.student_id);
      if (studentErr) throw new Error(studentErr.message);
    } else {
      // Store processed URL on job only; student already has a newer capture
      console.log(`[process-student-photo-jobs] skip flip for ${job.student_id}; original superseded`);
    }

    await admin
      .from("student_photo_jobs")
      .update({
        status: "completed",
        processed_path: processedPath,
        processed_url: processedUrl,
        model: result.model,
        completed_at: new Date().toISOString(),
        last_error: stillCurrent ? null : "Processed but student original was superseded",
      })
      .eq("id", job.id);

    return { id: job.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-student-photo-jobs] job ${job.id}:`, message);
    const attempts = job.attempts;
    const maxAttempts = job.max_attempts;
    if (attempts >= maxAttempts) {
      await admin
        .from("student_photo_jobs")
        .update({
          status: "failed",
          last_error: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    } else {
      const backoffMin = Math.min(Math.max(attempts, 1) * 2, 15);
      await admin
        .from("student_photo_jobs")
        .update({
          status: "pending",
          last_error: message,
          next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
        })
        .eq("id", job.id);
    }
    return { id: job.id, ok: false, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    let limit = 6;
    let preferJobId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body?.limit === "number") limit = body.limit;
        if (typeof body?.job_id === "string") preferJobId = body.job_id;
      } catch {
        // empty body ok (cron)
      }
    }

    const jobs: JobRow[] = [];

    if (preferJobId) {
      const { data: row } = await admin
        .from("student_photo_jobs")
        .select("*")
        .eq("id", preferJobId)
        .maybeSingle();

      if (row?.status === "pending") {
        const { data: claimed } = await admin
          .from("student_photo_jobs")
          .update({
            status: "processing",
            started_at: new Date().toISOString(),
            attempts: (row.attempts || 0) + 1,
          })
          .eq("id", preferJobId)
          .eq("status", "pending")
          .select("*")
          .maybeSingle();
        if (claimed) jobs.push(claimed as JobRow);
      } else if (row?.status === "processing") {
        jobs.push(row as JobRow);
      }
    }

    if (jobs.length < limit) {
      const { data: claimed, error: claimErr } = await admin.rpc("claim_student_photo_jobs", {
        _limit: limit - jobs.length,
      });
      if (claimErr) {
        console.error("[process-student-photo-jobs] claim failed:", claimErr);
        return json({ error: claimErr.message }, 500);
      }
      for (const row of claimed || []) {
        if (!jobs.some((j) => j.id === row.id)) jobs.push(row as JobRow);
      }
    }

    if (jobs.length === 0) {
      return json({ ok: true, processed: 0, results: [] });
    }

    // Sequential to stay gentle on Gemini rate limits
    const results = [];
    for (const job of jobs) {
      results.push(await processOne(admin, apiKey, job));
    }

    return json({
      ok: true,
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error("[process-student-photo-jobs] error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
