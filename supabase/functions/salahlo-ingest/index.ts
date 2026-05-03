/**
 * Salahlo Lead Ingest
 * ─────────────────────────────────────────────────────────────
 * Dedicated endpoint for receiving leads from Salahlo (lead aggregator).
 * All leads ingested here are automatically tagged source=salahlo.
 *
 * Auth: x-api-key header must match SALAHLO_API_KEY secret.
 *
 * Typical Salahlo webhook payload:
 * {
 *   "lead_id":      "SL-12345",
 *   "name":         "Priya Verma",
 *   "mobile":       "9876543210",
 *   "email":        "priya@example.com",
 *   "course":       "MBA",
 *   "college":      "NIMT Institute of Management",
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

function parseSalahlo(body: any) {
  // Name
  const name =
    body.name || body.student_name || body.full_name || body.applicant_name || "";

  // Phone — "mobile" is most common; also accept phone / contact
  const phone = (
    body.mobile || body.phone || body.phone_number || body.contact || ""
  ).replace(/[\s\-]/g, "");

  const email =
    body.email || body.email_id || body.email_address || undefined;

  // Course
  const courseName =
    body.course || body.course_name || body.course_interested ||
    body.program || body.programme || undefined;

  // Campus / college
  const campusName =
    body.college || body.college_name || body.campus ||
    body.campus_name || body.institute || undefined;

  const city  = body.city  || undefined;
  const state = body.state || undefined;

  // Salahlo's own lead ID for dedup tracking
  const sourceLeadId = body.lead_id ? String(body.lead_id) : undefined;

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
    state,
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
    const apiKey      = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("SALAHLO_API_KEY");

    if (!expectedKey) {
      console.error("SALAHLO_API_KEY secret is not configured");
      return json({ error: "Server configuration error" }, 500);
    }
    if (!apiKey || apiKey !== expectedKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { name, phone, email, courseName, campusName, city, state, sourceLeadId, medium, notes } =
      parseSalahlo(body);

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
      .select("id, name, stage, source, secondary_source, tertiary_source, source_history")
      .eq("phone", normPhone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Track salahlo as secondary/tertiary source
      if (existing.source !== "salahlo") {
        const updates: Record<string, any> = {};
        const history = Array.isArray((existing as any).source_history)
          ? (existing as any).source_history
          : [];
        history.push({ source: "salahlo", timestamp: new Date().toISOString() });
        updates.source_history = history;
        if (!(existing as any).secondary_source) updates.secondary_source = "salahlo";
        else if (!(existing as any).tertiary_source) updates.tertiary_source = "salahlo";
        await supabase.from("leads").update(updates).eq("id", existing.id);
        await supabase.from("lead_activities").insert({
          lead_id: existing.id, type: "system",
          description: `Lead re-inquired from Salahlo. Primary source: ${existing.source}`,
        });
      }
      return json({
        status: "duplicate",
        message: `Lead already exists: ${existing.name} (${existing.stage}). Salahlo source tracked.`,
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
      (() => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; })()
    }`;

    // ── Insert lead ──────────────────────────────────────────────────────
    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name:             name.trim().slice(0, 200),
        phone:            normPhone,
        email:            email?.trim().slice(0, 255) || null,
        source:           "salahlo",
        source_lead_id:   sourceLeadId || null,
        course_id,
        campus_id,
        city:             city || null,
        state:            state || null,
        notes:            notes?.slice(0, 1000) || null,
        stage:            "new_lead",
        },
      })
      .select("id, name, phone, source, stage")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return json({ error: error.message }, 500);
    }

    // ── Log activity ─────────────────────────────────────────────────────
    await supabase.from("lead_activities").insert({
      lead_id:     lead.id,
      type:        "lead_created",
      description: "Lead captured via Salahlo API",
    });

    return json({ status: "created", lead }, 201);

  } catch (err: any) {
    console.error("Unhandled error:", err);
    return json({ error: err.message }, 500);
  }
});
