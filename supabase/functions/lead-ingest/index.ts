import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Source-specific payload parsers ────────────────────────────────
// Each parser normalises vendor-specific JSON into our lead schema.

interface ParsedLead {
  name: string;
  phone: string;
  email?: string;
  guardian_name?: string;
  guardian_phone?: string;
  source: string;
  source_lead_id?: string; // external lead ID from the originating platform
  notes?: string;
  course_name?: string;   // we'll try to match to course_id
  campus_name?: string;   // we'll try to match to campus_id
  city?: string;
}

function parseJustDial(body: any): ParsedLead {
  // JustDial sends: leadid, name, phone, email, city, area, category, date
  return {
    name: body.name || body.leadname || body.prefix + " " + (body.name || ""),
    phone: (body.phone || body.mobile || "").replace(/[\s\-]/g, ""),
    email: body.email || undefined,
    source: "justdial",
    source_lead_id: body.leadid ? String(body.leadid) : undefined,
    city: body.city || body.area || undefined,
    notes: [
      body.category ? `Category: ${body.category}` : "",
      body.area ? `Area: ${body.area}` : "",
      body.date ? `Date: ${body.date}` : "",
    ].filter(Boolean).join(" | "),
  };
}

function parseShiksha(body: any): ParsedLead {
  // Shiksha sends: student_name, mobile, email_id, course_interested, city, state
  return {
    name: body.student_name || body.name || "",
    phone: (body.mobile || body.phone || "").replace(/[\s\-]/g, ""),
    email: body.email_id || body.email || undefined,
    source: "shiksha",
    source_lead_id: body.lead_id ? String(body.lead_id) : undefined,
    course_name: body.course_interested || body.course || undefined,
    city: body.city || undefined,
    notes: [
      body.state ? `State: ${body.state}` : "",
      body.qualification ? `Qualification: ${body.qualification}` : "",
    ].filter(Boolean).join(" | "),
  };
}

function parseMetaAds(body: any): ParsedLead {
  // Facebook/Meta Lead Ads webhook (simplified)
  const fieldData = body.field_data || [];
  const getField = (name: string) =>
    fieldData.find((f: any) => f.name === name)?.values?.[0] || "";

  return {
    name: getField("full_name") || body.full_name || body.name || "",
    phone: (getField("phone_number") || body.phone || "").replace(/[\s\-]/g, ""),
    email: getField("email") || body.email || undefined,
    source: "meta_ads",
    course_name: getField("course") || body.course || undefined,
    notes: body.ad_name ? `Ad: ${body.ad_name}` : undefined,
  };
}

function parseGoogleAds(body: any): ParsedLead {
  // Google Ads lead form extensions
  const columnData = body.user_column_data || [];
  const getCol = (id: string) =>
    columnData.find((c: any) => c.column_id === id)?.string_value || "";

  return {
    name: getCol("FULL_NAME") || body.name || "",
    phone: (getCol("PHONE_NUMBER") || body.phone || "").replace(/[\s\-]/g, ""),
    email: getCol("EMAIL") || body.email || undefined,
    source: "google_ads",
    notes: body.campaign_id ? `Campaign: ${body.campaign_id}` : undefined,
  };
}

function parseWebsite(body: any): ParsedLead {
  return {
    name: body.name || "",
    phone: (body.phone || body.mobile || "").replace(/[\s\-]/g, ""),
    email: body.email || undefined,
    guardian_name: body.guardian_name || body.parent_name || undefined,
    guardian_phone: (body.guardian_phone || body.parent_phone || "")?.replace(/[\s\-]/g, "") || undefined,
    source: "website",
    course_name: body.course || body.course_name || body.program || undefined,
    campus_name: body.campus || body.campus_name || undefined,
    notes: body.message || body.notes || undefined,
  };
}

function parseGeneric(body: any, source: string): ParsedLead {
  return {
    name: body.name || body.student_name || body.full_name || "",
    phone: (body.phone || body.mobile || body.phone_number || "").replace(/[\s\-]/g, ""),
    email: body.email || body.email_id || undefined,
    guardian_name: body.guardian_name || body.parent_name || undefined,
    guardian_phone: (body.guardian_phone || body.parent_phone || "")?.replace(/[\s\-]/g, "") || undefined,
    source: source || "other",
    course_name: body.course || body.course_name || body.program || undefined,
    campus_name: body.campus || body.campus_name || undefined,
    notes: body.notes || body.message || body.remarks || undefined,
  };
}

// Map source string to parser
const PARSERS: Record<string, (body: any) => ParsedLead> = {
  justdial: parseJustDial,
  shiksha: parseShiksha,
  meta_ads: parseMetaAds,
  google_ads: parseGoogleAds,
  website: parseWebsite,
};

// Normalise phone: ensure it has country code
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

// ─── Main handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept x-api-key OR the Supabase anon key (for website/frontend calls)
    const apiKey = req.headers.get("x-api-key");
    const anonKeyHeader = req.headers.get("apikey");
    const expectedKey = Deno.env.get("LEAD_INGEST_API_KEY");
    const expectedAnon = Deno.env.get("SUPABASE_ANON_KEY");

    const isValidApiKey = expectedKey && apiKey === expectedKey;
    const isValidAnonKey = expectedAnon && anonKeyHeader === expectedAnon;

    if (!isValidApiKey && !isValidAnonKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine source from URL param or body
    const url = new URL(req.url);
    const sourceParam = url.searchParams.get("source")?.toLowerCase() || "";

    const body = await req.json().catch(() => ({}));
    const source = sourceParam || body.source || "other";

    // Parse using source-specific parser or generic
    const parser = PARSERS[source] || ((b: any) => parseGeneric(b, source));
    const parsed = parser(body);

    // Validate required fields
    if (!parsed.name?.trim()) {
      return new Response(JSON.stringify({ error: "Missing required field: name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!parsed.phone?.trim()) {
      return new Response(JSON.stringify({ error: "Missing required field: phone" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normPhone = normalisePhone(parsed.phone);

    // Supabase client (service role for inserts)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Duplicate detection by phone ──
    const { data: existing } = await supabase
      .from("leads")
      .select("id, name, stage")
      .eq("phone", normPhone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          status: "duplicate",
          message: `Lead already exists: ${existing.name} (${existing.stage})`,
          lead_id: existing.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Resolve course_id and campus_id by name (fuzzy) ──
    let course_id: string | null = null;
    let campus_id: string | null = null;

    if (parsed.course_name) {
      const { data: courses } = await supabase
        .from("courses")
        .select("id, name")
        .ilike("name", `%${parsed.course_name}%`)
        .limit(1)
        .maybeSingle();
      if (courses) course_id = courses.id;
    }

    if (parsed.campus_name || parsed.city) {
      const searchTerm = parsed.campus_name || parsed.city || "";
      const { data: campus } = await supabase
        .from("campuses")
        .select("id, name")
        .or(`name.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%`)
        .limit(1)
        .maybeSingle();
      if (campus) campus_id = campus.id;
    }

    // ── Insert lead ──
    const validSources = [
      "website", "meta_ads", "google_ads", "shiksha", "walk_in",
      "consultant", "justdial", "referral", "education_fair", "collegedunia", "other",
    ];
    const leadSource = validSources.includes(parsed.source) ? parsed.source : "other";

    // Generate application ID
    const appId = `APP-${new Date().getFullYear().toString().slice(-2)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    const { data: lead, error } = await supabase
      .from("leads")
      .insert({
        name: parsed.name.trim().slice(0, 200),
        phone: normPhone,
        email: parsed.email?.trim().slice(0, 255) || null,
        guardian_name: parsed.guardian_name?.trim().slice(0, 200) || null,
        guardian_phone: parsed.guardian_phone ? normalisePhone(parsed.guardian_phone) : null,
        source: leadSource,
        source_lead_id: parsed.source_lead_id || null,
        course_id,
        campus_id,
        notes: parsed.notes?.slice(0, 1000) || null,
        stage: "new_lead",
        application_id: appId,
        application_progress: {
          personal_details: false,
          education_details: false,
          application_fee_paid: false,
          documents_uploaded: false,
        },
      })
      .select("id, name, phone, source, stage, application_id")
      .single();

    if (error) {
      console.error("Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: lead.id,
      type: "lead_created",
      description: `Lead captured via ${leadSource} API`,
    });

    return new Response(
      JSON.stringify({ status: "created", lead }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
