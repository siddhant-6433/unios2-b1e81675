// apply-job — public careers application intake (anon; the careers portal calls
// it). Validates the opening is live, uploads the resume to R2, and creates a
// `job_applicants` row. No anon INSERT policy is needed because this runs as the
// service role.
//
// POST multipart/form-data:
//   opening_slug, name*, email*, phone*, experience_years?, cover_note?, resume?
// (* required)

import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sanitize = (n: string) =>
  n.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const form = await req.formData();
    const slug = String(form.get("opening_slug") || "").trim();
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const rawPhone = String(form.get("phone") || "").trim();
    const phone = rawPhone.replace(/\D/g, "");
    const experience = form.get("experience_years");
    const cover = String(form.get("cover_note") || "").trim() || null;
    const resume = form.get("resume") as File | null;

    if (!slug || !name || !email || !phone) return json({ error: "Name, email and phone are required." }, 400);

    const { data: opening } = await admin
      .from("job_openings")
      .select("id, title, status, closes_at")
      .eq("slug", slug)
      .maybeSingle();
    if (!opening || opening.status !== "open") return json({ error: "This job is no longer accepting applications." }, 404);
    if (opening.closes_at && new Date(opening.closes_at) < new Date()) {
      return json({ error: "This job has closed." }, 410);
    }

    // Dedupe: same phone for this opening.
    const { data: existing } = await admin
      .from("job_applicants")
      .select("id")
      .eq("source_phone", phone)
      .eq("job_opening_id", opening.id)
      .maybeSingle();
    if (existing) return json({ ok: true, already_applied: true });

    // Upload resume (optional).
    let resumeUrl: string | null = null;
    if (resume && resume.size > 0) {
      const accountId = Deno.env.get("R2_ACCOUNT_ID");
      const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
      const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
      const bucket = Deno.env.get("R2_BUCKET");
      const publicBase = (Deno.env.get("R2_PUBLIC_BASE_URL") || "").replace(/\/+$/, "");
      if (accountId && accessKeyId && secretAccessKey && bucket && publicBase) {
        try {
          const s3 = new S3Client({
            region: "auto",
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId, secretAccessKey },
          });
          const key = `resumes/careers/${Date.now().toString(36)}-${sanitize(resume.name || "resume")}`;
          await s3.send(new PutObjectCommand({
            Bucket: bucket, Key: key,
            Body: new Uint8Array(await resume.arrayBuffer()),
            ContentType: resume.type || "application/octet-stream",
          }));
          resumeUrl = `${publicBase}/${key}`;
        } catch (e) {
          console.error("[apply-job] resume upload failed", e);
        }
      }
    }

    const { error: insErr } = await admin.from("job_applicants").insert({
      lead_id: null,
      source_channel: "careers_portal",
      classification_source: "careers_portal",
      source_phone: phone,
      name,
      email,
      desired_role: opening.title,
      experience_years: experience ? Number(experience) : null,
      resume_url: resumeUrl,
      applied_via: "careers_portal",
      cover_note: cover,
      job_opening_id: opening.id,
      status: "new",
      first_message_at: new Date().toISOString(),
    });
    if (insErr) {
      // Unique dedupe raced — treat as success.
      if ((insErr as { code?: string }).code === "23505") return json({ ok: true });
      console.error("[apply-job] insert failed", insErr);
      return json({ error: "Could not submit your application. Please try again." }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
