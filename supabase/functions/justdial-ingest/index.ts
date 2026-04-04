/**
 * JustDial Lead Ingest
 * ─────────────────────────────────────────────────────────────
 * Receives leads pushed by JustDial to our endpoint.
 * Supports GET, POST form-encoded, and POST JSON.
 *
 * Auth: token query parameter must match JUSTDIAL_API_KEY secret.
 * URL: /functions/v1/justdial-ingest?token=<JUSTDIAL_API_KEY>
 *
 * IMPORTANT: JustDial requires plain-text "RECEIVED" response (not JSON).
 *
 * Category resolution (JD `category` is a contract keyword, not a course name):
 *  1. Check jd_category_mappings table (DB, admin-managed).
 *  2. If not found, fall back to built-in BOOTSTRAP_MAP.
 *  3. If still unknown → insert as status='pending' in DB so super admin
 *     is prompted to map it from the lead dashboard.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

// ── Bootstrap map (hardcoded fallback) ───────────────────────────────────────
// Used ONLY when a category is not yet in the DB.
// null  = school/pre-school type — course cannot be determined from category.
// string = course name keyword to fuzzy-search in courses table.
// Entries get auto-saved to DB as 'resolved' on first encounter.
const BOOTSTRAP_MAP: Record<string, string | null> = {
  // Schools
  "cbse schools":              null,
  "cbse school":               null,
  "icse schools":              null,
  "boarding schools":          null,
  "boarding school":           null,
  "residential schools":       null,
  "pre schools":               null,
  "play schools":              null,
  "nursery schools":           null,
  "day care":                  null,
  // Colleges
  "mba institutes":            "MBA",
  "mba colleges":              "MBA",
  "pgdm institutes":           "PGDM",
  "bba colleges":              "BBA",
  "bca colleges":              "BCA",
  "bca institutes":            "BCA",
  "mca colleges":              "MCA",
  "b.tech colleges":           "B.Tech",
  "engineering colleges":      "B.Tech",
  "polytechnic":               "Polytechnic",
  "law colleges":              "LLB",
  "llb colleges":              "LLB",
  "b.com colleges":            "B.Com",
  "b.sc colleges":             "B.Sc",
  "m.sc colleges":             "M.Sc",
  "hotel management":          "Hotel Management",
  "hotel management colleges": "Hotel Management",
  "pharmacy colleges":         "B.Pharm",
  "nursing colleges":          "B.Sc Nursing",
};

type BootstrapResult =
  | { found: true;  isSchool: true;  courseKeyword: null }
  | { found: true;  isSchool: false; courseKeyword: string }
  | { found: false; isSchool: false; courseKeyword: null };

function lookupBootstrap(category: string): BootstrapResult {
  const key = category.toLowerCase().trim();
  const exactVal = BOOTSTRAP_MAP[key];
  if (exactVal !== undefined) {
    return exactVal === null
      ? { found: true, isSchool: true,  courseKeyword: null }
      : { found: true, isSchool: false, courseKeyword: exactVal };
  }
  // Partial match
  for (const [mapKey, val] of Object.entries(BOOTSTRAP_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) {
      return val === null
        ? { found: true, isSchool: true,  courseKeyword: null }
        : { found: true, isSchool: false, courseKeyword: val };
    }
  }
  return { found: false, isSchool: false, courseKeyword: null };
}

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

async function parseRequest(req: Request): Promise<Record<string, string>> {
  const url    = new URL(req.url);
  const params: Record<string, string> = {};
  if (req.method === "GET") {
    url.searchParams.forEach((v, k) => { params[k] = v; });
    return params;
  }
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    for (const [k, v] of Object.entries(body)) params[k] = String(v ?? "");
  } else {
    const text = await req.text().catch(() => "");
    new URLSearchParams(text).forEach((v, k) => { params[k] = v; });
  }
  return params;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const received = () =>
    new Response("RECEIVED", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });

  const errResp = (msg: string, status = 400) =>
    new Response(msg, {
      status,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });

  try {
    // ── Auth ─────────────────────────────────────────────────────────────
    const url         = new URL(req.url);
    const token       = url.searchParams.get("token");
    const expectedKey = Deno.env.get("JUSTDIAL_API_KEY");

    if (!expectedKey) {
      console.error("JUSTDIAL_API_KEY secret is not configured");
      return errResp("Server configuration error", 500);
    }
    if (!token || token !== expectedKey) return errResp("Unauthorized", 401);

    // ── Parse ─────────────────────────────────────────────────────────────
    const p = await parseRequest(req);

    const name         = (p.name || p.full_name || "").trim();
    const mobile       = (p.mobile || p.phone || "").replace(/[\s\-]/g, "");
    const email        = p.email?.trim() || undefined;
    const category     = p.category?.trim() || undefined;
    const branchArea   = p.brancharea?.trim() || undefined;
    const city         = p.city?.trim() || undefined;
    const area         = p.area?.trim() || undefined;
    const sourceLeadId = p.leadid?.trim() || undefined;
    const prefix       = p.prefix?.trim() || undefined;

    const fullName = prefix ? `${prefix} ${name}`.trim() : name;
    if (!fullName) return errResp("Missing required field: name");
    if (!mobile)   return errResp("Missing required field: mobile");

    const normPhone = normalisePhone(mobile);

    const notesParts = [
      category    ? `JD Category: ${category}`    : "",
      city        ? `City: ${city}`               : "",
      area        ? `Area: ${area}`               : "",
      p.dncmobile === "1" ? "DNC Mobile: Yes"     : "",
      p.dncphone  === "1" ? "DNC Phone: Yes"      : "",
      p.parentid  ? `JD Parent ID: ${p.parentid}` : "",
    ].filter(Boolean);

    // ── DB client ─────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Duplicate check ───────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("leads")
      .select("id, name, stage")
      .eq("phone", normPhone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log(`Duplicate: ${existing.name} (${existing.stage})`);
      return received();
    }

    // ── Category → course resolution ──────────────────────────────────────
    // Priority: DB mapping (admin-managed) → bootstrap fallback → pending
    let course_id: string | null = null;

    if (category) {
      // 1. Check DB mapping table
      const { data: dbMap } = await supabase
        .from("jd_category_mappings")
        .select("id, course_id, is_school, status")
        .ilike("category", category)
        .maybeSingle();

      if (dbMap) {
        // Existing DB entry — use if resolved
        if (dbMap.status === "resolved" && !dbMap.is_school && dbMap.course_id) {
          course_id = dbMap.course_id;
        }
        // pending / ignored / school → course_id stays null
        console.log(`DB map: "${category}" → status=${dbMap.status}, course_id=${dbMap.course_id ?? "null"}`);

      } else {
        // 2. Not in DB — try bootstrap map
        const boot = lookupBootstrap(category);

        if (boot.found && !boot.isSchool && boot.courseKeyword) {
          // Known college category — resolve course and auto-save as resolved
          const { data: course } = await supabase
            .from("courses")
            .select("id, name")
            .ilike("name", `%${boot.courseKeyword}%`)
            .limit(1)
            .maybeSingle();

          course_id = course?.id ?? null;

          await supabase.from("jd_category_mappings").upsert({
            category,
            course_id,
            is_school: false,
            status: "resolved",
            resolved_at: new Date().toISOString(),
          }, { onConflict: "category", ignoreDuplicates: false });

          console.log(`Bootstrap resolved: "${category}" → course_id=${course_id ?? "null"}`);

        } else if (boot.found && boot.isSchool) {
          // Known school category — auto-save as resolved (no course)
          await supabase.from("jd_category_mappings").upsert({
            category,
            course_id: null,
            is_school: true,
            status: "resolved",
            resolved_at: new Date().toISOString(),
          }, { onConflict: "category", ignoreDuplicates: false });

          console.log(`Bootstrap resolved as school: "${category}"`);

        } else {
          // 3. Completely unknown — insert as pending for super admin review
          await supabase.from("jd_category_mappings").upsert({
            category,
            course_id: null,
            is_school: false,
            status: "pending",
          }, { onConflict: "category", ignoreDuplicates: true }); // don't overwrite if already pending

          console.log(`Unknown category inserted as pending: "${category}"`);
        }
      }
    }

    // ── Campus resolution via brancharea (our branch) → city fallback ────
    let campus_id: string | null = null;
    const campusSearch = branchArea || city;
    if (campusSearch) {
      const { data: campus } = await supabase
        .from("campuses")
        .select("id, name")
        .or(`name.ilike.%${campusSearch}%,city.ilike.%${campusSearch}%`)
        .limit(1)
        .maybeSingle();
      if (campus) campus_id = campus.id;
    }

    // ── Insert lead ───────────────────────────────────────────────────────
    const appId = `APP-${new Date().getFullYear().toString().slice(-2)}-${
      String(Math.floor(Math.random() * 9000) + 1000)
    }`;

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name:           fullName.slice(0, 200),
        phone:          normPhone,
        email:          email?.slice(0, 255) || null,
        source:         "justdial",
        source_lead_id: sourceLeadId || null,
        course_id,
        campus_id,
        city:           city || null,
        area:           area || null,
        jd_category:    category || null,
        notes:          notesParts.join(" | ").slice(0, 1000) || null,
        stage:          "new_lead",
        application_id: appId,
        application_progress: {
          personal_details:     false,
          education_details:    false,
          application_fee_paid: false,
          documents_uploaded:   false,
        },
      })
      .select("id, name, phone, source, stage")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return errResp(error.message, 500);
    }

    await supabase.from("lead_activities").insert({
      lead_id:     lead.id,
      type:        "lead_created",
      description: `Lead captured via JustDial API${category ? ` (${category})` : ""}`,
    });

    console.log(`Created: ${lead.name} | category: ${category ?? "—"} | course_id: ${course_id ?? "null"}`);
    return received();

  } catch (err_: any) {
    console.error("Unhandled error:", err_);
    return errResp(err_.message, 500);
  }
});
