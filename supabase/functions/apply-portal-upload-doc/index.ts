// Service-role document uploader for the apply portal. Anonymous applicants
// can't be granted broad write access to storage.objects without re-introducing
// the enumeration / overwrite exposure the security advisor flagged, so this
// function is the single chokepoint: validate the (application_id, phone)
// pair, then upload as service_role.
//
// Pairs with migration 20260516180000_lock_anon_application_docs.sql which
// drops the open anon INSERT/SELECT/UPDATE policies on application-documents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_DOC_KEYS = new Set([
  // UG / PG academic documents
  "class_10_marksheet", "class_10_certificate",
  "class_12_marksheet", "class_12_certificate",
  "graduation_marksheet", "graduation_certificate",
  // School documents
  "birth_certificate", "report_card", "student_photo",
  "transfer_certificate", "aadhaar", "medical_record",
  // Identity / category / migration (UG + PG + K-12)
  "parent_aadhaar", "caste_certificate",
  "migration_certificate", "school_transfer_certificate",
  // Photo
  "passport_photo",
]);

const ALLOWED_DOC_KEY_PREFIXES = [
  "additional_qual_",
  "entrance_",
];

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp",
]);

const MAX_BYTES = 5 * 1024 * 1024;

function isAllowedDocKey(key: string): boolean {
  if (ALLOWED_DOC_KEYS.has(key)) return true;
  return ALLOWED_DOC_KEY_PREFIXES.some((p) => key.startsWith(p));
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const form = await req.formData();
    const applicationId = String(form.get("application_id") || "").trim().toUpperCase();
    const phone = String(form.get("phone") || "").trim();
    const docKey = String(form.get("doc_key") || "").trim();
    const file = form.get("file") as File | null;

    if (!applicationId || !phone || !docKey || !file) {
      return new Response(JSON.stringify({ error: "application_id, phone, doc_key, file required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isAllowedDocKey(docKey)) {
      return new Response(JSON.stringify({ error: `Unknown doc_key: ${docKey}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (file.size > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "File exceeds 5MB" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type}` }), {
        status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Identity check: the (application_id, phone) pair must match an existing
    // application. This is the same security stance as
    // lookup_application_for_otp — assumes the applicant has just verified
    // their phone via OTP.
    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("application_id, phone")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (appErr) {
      console.error("[apply-portal-upload-doc] lookup error:", appErr);
      return new Response(JSON.stringify({ error: "Lookup failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!app || normalizePhone(app.phone || "") !== normalizePhone(phone)) {
      return new Response(JSON.stringify({ error: "Application not found for this phone" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = docKey === "passport_photo"
      ? `${applicationId}/passport_photo.${safeName.split(".").pop() || "png"}`
      : `${applicationId}/${docKey}-${safeName}`;

    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (upErr) {
      console.error("[apply-portal-upload-doc] upload error:", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
    return new Response(JSON.stringify({ ok: true, path, url: pub?.publicUrl || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[apply-portal-upload-doc] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
