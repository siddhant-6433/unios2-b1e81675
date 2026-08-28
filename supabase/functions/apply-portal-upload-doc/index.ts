// Service-role document uploader for the apply portal. Anonymous applicants
// can't be granted broad write access to storage.objects without re-introducing
// the enumeration / overwrite exposure the security advisor flagged, so this
// function is the single chokepoint: validate the (application_id, phone)
// pair, then upload as service_role.
//
// Pairs with migration 20260516180000_lock_anon_application_docs.sql which
// drops the open anon INSERT/SELECT/UPDATE policies on application-documents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteFromR2, uploadToR2 } from "../_shared/r2.ts";
import { nameMatchScore } from "../_shared/razorpayx.ts";

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
  "father_aadhaar", "mother_aadhaar", "guardian_aadhaar",
  "parent_aadhaar", "caste_certificate",
  "migration_certificate", "school_transfer_certificate",
  // Photo
  "passport_photo", "applicant_photo",
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
const PHOTO_DOC_KEYS = new Set(["passport_photo", "student_photo", "applicant_photo"]);
const GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
];

function isAllowedDocKey(key: string): boolean {
  if (ALLOWED_DOC_KEYS.has(key)) return true;
  return ALLOWED_DOC_KEY_PREFIXES.some((p) => key.startsWith(p));
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function extForMime(mimeType: string) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function base64ToBytes(base64: string) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
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

async function canUseSupabaseStorageTarget(req: Request, admin: any): Promise<boolean> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (!token) return false;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return false;

  const { data: role } = await admin.rpc("get_user_role", { _user_id: data.user.id });
  return ["super_admin", "principal", "counsellor"].includes(String(role || ""));
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
    const photoAlreadyProcessed = String(form.get("photo_processed") || "").toLowerCase() === "true";
    const requestedStorageTarget = String(form.get("storage_target") || "r2").toLowerCase();
    const storageTarget = requestedStorageTarget === "supabase" ? "supabase" : "r2";

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
      .select("application_id, phone, full_name, flags")
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
    if (storageTarget === "supabase" && !(await canUseSupabaseStorageTarget(req, admin))) {
      return new Response(JSON.stringify({ error: "Supabase storage uploads are restricted to staff" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let contentType = file.type || "application/octet-stream";
    let buf = new Uint8Array(await file.arrayBuffer());

    if (PHOTO_DOC_KEYS.has(docKey) && !photoAlreadyProcessed) {
      if (!file.type.startsWith("image/")) {
        return new Response(JSON.stringify({ error: "Student photo must be an image file" }), {
          status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Photo processing is not configured. GEMINI_API_KEY is required before photo upload." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const processed = await processPhoto(apiKey, file.type, buf);
        buf = processed.bytes;
        contentType = processed.mimeType;
      } catch (photoErr) {
        console.error("[apply-portal-upload-doc] photo processing failed, uploading original:", (photoErr as Error).message);
      }
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadId = new Date().toISOString().replace(/[^0-9]/g, "");
    const extension = PHOTO_DOC_KEYS.has(docKey)
      ? extForMime(contentType)
      : safeName.split(".").pop() || "bin";
    const fileName = docKey === "passport_photo"
      ? `passport_photo.${uploadId}.${extension}`
      : `${docKey}-${uploadId}-${PHOTO_DOC_KEYS.has(docKey) ? `processed.${extension}` : safeName}`;
    const legacyPath = `${applicationId}/${fileName}`;
    const { data: existingFiles } = await admin.storage
      .from("application-documents")
      .list(applicationId, { limit: 100 });
    const oldPaths = (existingFiles || [])
      .filter((f: any) => {
        if (!f?.name || f.name.startsWith(".")) return false;
        if (docKey === "passport_photo") return f.name.startsWith("passport_photo.");
        return f.name.startsWith(`${docKey}-`);
      })
      .map((f: any) => `${applicationId}/${f.name}`);

    const { data: existingDocRows, error: existingDocErr } = await admin
      .from("application_documents")
      .select("file_path, storage_provider")
      .eq("application_id", applicationId)
      .eq("doc_key", docKey);
    if (existingDocErr) {
      console.error("[apply-portal-upload-doc] metadata lookup error:", existingDocErr);
      return new Response(JSON.stringify({ error: "Document metadata lookup failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let uploadedPath: string;
    let uploadedUrl: string;
    let storageProvider: "r2" | "supabase";

    if (storageTarget === "supabase") {
      const { error: upErr } = await admin.storage
        .from("application-documents")
        .upload(legacyPath, buf, { contentType, upsert: true, cacheControl: "no-cache, max-age=0" });
      if (upErr) {
        console.error("[apply-portal-upload-doc] supabase upload error:", upErr);
        return new Response(JSON.stringify({ error: upErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: pub } = admin.storage.from("application-documents").getPublicUrl(legacyPath);
      uploadedPath = legacyPath;
      uploadedUrl = pub?.publicUrl || legacyPath;
      storageProvider = "supabase";
    } else {
      const r2Key = `application-portal/${legacyPath}`;
      const uploaded = await uploadToR2({ key: r2Key, body: buf, contentType, cacheControl: "no-cache, max-age=0" });
      uploadedPath = uploaded.key;
      uploadedUrl = uploaded.url;
      storageProvider = "r2";
    }

    const { error: metaErr } = await admin
      .from("application_documents")
      .upsert({
        application_id: applicationId,
        doc_key: docKey,
        file_path: uploadedPath,
        file_url: uploadedUrl,
        file_name: fileName,
        original_file_name: file.name,
        mime_type: contentType,
        file_size: buf.byteLength,
        storage_provider: storageProvider,
        uploaded_source: storageProvider === "supabase" ? "admin" : "apply_portal",
        uploaded_at: new Date().toISOString(),
      }, { onConflict: "application_id,doc_key" });
    if (metaErr) {
      console.error("[apply-portal-upload-doc] metadata upsert error:", metaErr);
      return new Response(JSON.stringify({ error: metaErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── OCR name extraction for Class 10 marksheet ──────────────
    // ponytail: best-effort Gemini Vision; upload never fails on OCR error
    let responseExtra: Record<string, unknown> = {};
    if (docKey === "class_10_marksheet") {
      try {
        const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
        if (geminiKey) {
          const b64 = bytesToBase64(buf);
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { inline_data: { mime_type: contentType, data: b64 } },
                    { text: "Extract the student's full name from this Class 10 marksheet. Return ONLY the full name as it appears on the document, nothing else." },
                  ],
                }],
              }),
            },
          );
          const geminiData = await geminiRes.json();
          const extractedName = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (extractedName && extractedName.length > 1 && extractedName.length < 200) {
            await admin.from("application_documents")
              .update({ extracted_name: extractedName })
              .eq("application_id", applicationId)
              .eq("doc_key", "class_10_marksheet");

            const score = nameMatchScore(app.full_name || "", extractedName);
            const flags: string[] = Array.isArray(app.flags) ? app.flags : [];
            const withoutMismatch = flags.filter((f: string) => f !== "name_mismatch");
            const newFlags = score < 70 ? [...withoutMismatch, "name_mismatch"] : withoutMismatch;
            if (JSON.stringify(newFlags) !== JSON.stringify(flags)) {
              await admin.from("applications")
                .update({ flags: newFlags })
                .eq("application_id", applicationId);
            }
            responseExtra = { extracted_name: extractedName, name_match_score: score };
          }
        }
      } catch (e) {
        console.error("[apply-portal-upload-doc] OCR name extraction failed:", (e as Error).message);
      }
    }

    const staleObjectPaths = storageProvider === "supabase"
      ? oldPaths.filter((oldPath: string) => oldPath !== legacyPath)
      : oldPaths;
    if (staleObjectPaths.length > 0) {
      const { error: rmErr } = await admin.storage
        .from("application-documents")
        .remove(staleObjectPaths);
      if (rmErr) console.error("[apply-portal-upload-doc] stale file cleanup error:", rmErr);
    }
    await deleteFromR2((existingDocRows || [])
      .filter((row: any) => row.storage_provider === "r2" && row.file_path !== uploadedPath)
      .map((row: any) => row.file_path))
      .catch((err: Error) => console.error("[apply-portal-upload-doc] stale R2 cleanup error:", err.message));

    const reviewPathsToReset = Array.from(new Set([
      ...oldPaths,
      ...(existingDocRows || []).map((row: any) => row.file_path),
      uploadedPath,
    ]));
    if (reviewPathsToReset.length > 0) {
      const { error: reviewErr } = await admin
        .from("application_doc_reviews")
        .delete()
        .eq("application_id", applicationId)
        .in("file_path", reviewPathsToReset);
      if (reviewErr) console.error("[apply-portal-upload-doc] review reset error:", reviewErr);
    }

    // Recompute admission document-completeness (and re-run the AN engine).
    // Best-effort: the upload already succeeded, so a sync hiccup must not fail it.
    try {
      await fetch(`${supabaseUrl}/functions/v1/sync-admission-doc-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id: applicationId }),
      });
    } catch (e) {
      console.error("[apply-portal-upload-doc] doc-status sync failed:", (e as Error).message);
    }

    return new Response(JSON.stringify({ ok: true, path: uploadedPath, url: uploadedUrl, storage_provider: storageProvider, ...responseExtra }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[apply-portal-upload-doc] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
