/**
 * Collegehai Lead Ingest
 * ─────────────────────────────────────────────────────────────
 * Dedicated endpoint for receiving leads from Collegehai.com.
 * All leads ingested here are automatically tagged source=collegehai.
 *
 * Auth: x-api-key header must match COLLEGEHAI_API_KEY secret.
 *
 * Typical Collegehai webhook payload:
 * {
 *   "lead_id":      "CH-12345",
 *   "name":         "Rahul Sharma",
 *   "mobile":       "9876543210",
 *   "email":        "rahul@example.com",
 *   "course":       "BCA",
 *   "college":      "NIMT Institute of Technology",
 *   "city":         "Greater Noida",
 *   "state":        "Uttar Pradesh",
 *   "medium":       "organic",
 *   "message":      "..."
 * }
 *
 * Also accepts generic aliases: student_name, phone, course_name,
 * college_name, campus, program, notes, remarks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

function parseCollegehai(body: any) {
  // Name — Collegehai typically sends "name"; fallback to Collegedunia-style aliases
  const name =
    body.name || body.student_name || body.full_name || body.applicant_name || "";

  // Phone — "mobile" is most common
  const phone = (
    body.mobile || body.phone || body.phone_number || body.contact || ""
  ).replace(/[\s\-]/g, "");

  const email =
    body.email || body.email_id || body.email_address || undefined;

  // Course — "course" is primary; fallback to Collegedunia aliases
  const courseName =
    body.course || body.course_name || body.course_interested ||
    body.program || body.programme || undefined;

  // Campus — "college" is primary for Collegehai
  const campusName =
    body.college || body.college_name || body.campus ||
    body.campus_name || body.institute || undefined;

  const city  = body.city  || undefined;
  const state = body.state || undefined;

  // Collegehai lead ID for dedup tracking
  const sourceLeadId = body.lead_id ? String(body.lead_id) : undefined;

  // Medium (dynamic per campaign), source is always "collegehai"
  const medium = body.medium || body.utm_medium || undefined;

  const notesParts = [
    state  ? `State: ${state}`  : "",
    city   ? `City: ${city}`    : "",
    medium ? `Medium: ${medium}` : "",
    body.message || body.notes || body.remarks || "",
  ].filter(Boolean);

  return {
    name,
    phone,
    email,
    courseName,
    campusName,
    city,
    sourceLeadId,
    medium,
    notes: notesParts.join(" | ") || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ────────────────────────────────────────────────────────────
    const apiKey     = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("COLLEGEHAI_API_KEY");

    if (!expectedKey) {
      console.error("COLLEGEHAI_API_KEY secret is not configured");
      return json({ error: "Server configuration error" }, 500);
    }
    if (!apiKey || apiKey !== expectedKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { name, phone, email, courseName, campusName, city, sourceLeadId, medium, notes } =
      parseCollegehai(body);

    if (!name?.trim()) {
      return json({ error: "Missing required field: name" }, 400);
    }
    if (!phone?.trim()) {
      return json({ error: "Missing required field: mobile / phone" }, 400);
    }

    const normPhone = normalisePhone(phone);

    // ── DB client ────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Duplicate check by phone ─────────────────────────────────────────
    const { data: existing } = await supabase
      .from("leads")
      .select("id, name, stage, source")
      .eq("phone", normPhone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return json({
        status: "duplicate",
        message: `Lead already exists: ${existing.name} (${existing.stage})`,
        lead_id: existing.id,
      });
    }

    // ── Resolve course_id ────────────────────────────────────────────────
    let course_id: string | null = null;
    if (courseName) {
      const { data: course } = await supabase
        .from("courses")
        .select("id, name")
        .ilike("name", `%${courseName}%`)
        .limit(1)
        .maybeSingle();
      if (course) course_id = course.id;
    }

    // ── Resolve campus_id ────────────────────────────────────────────────
    let campus_id: string | null = null;
    const searchTerm = campusName || city;
    if (searchTerm) {
      const { data: campus } = await supabase
        .from("campuses")
        .select("id, name")
        .or(`name.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%`)
        .limit(1)
        .maybeSingle();
      if (campus) campus_id = campus.id;
    }

    // ── Generate application ID ──────────────────────────────────────────
    const appId = `APP-${new Date().getFullYear().toString().slice(-2)}-${
      String(Math.floor(Math.random() * 9000) + 1000)
    }`;

    // ── Insert lead ──────────────────────────────────────────────────────
    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name:             name.trim().slice(0, 200),
        phone:            normPhone,
        email:            email?.trim().slice(0, 255) || null,
        source:           "collegehai",
        source_lead_id:   sourceLeadId || null,
        course_id,
        campus_id,
        city:             city || null,
        state:            body.state || null,
        notes:            notes?.slice(0, 1000) || null,
        stage:            "new_lead",
        application_id:   appId,
        application_progress: {
          personal_details:     false,
          education_details:    false,
          application_fee_paid: false,
          documents_uploaded:   false,
        },
      })
      .select("id, name, phone, source, stage, application_id")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return json({ error: error.message }, 500);
    }

    // ── Log activity ─────────────────────────────────────────────────────
    await supabase.from("lead_activities").insert({
      lead_id:     lead.id,
      type:        "lead_created",
      description: "Lead captured via Collegehai API",
    });

    return json({ status: "created", lead }, 201);

  } catch (err: any) {
    console.error("Unhandled error:", err);
    return json({ error: err.message }, 500);
  }
});
