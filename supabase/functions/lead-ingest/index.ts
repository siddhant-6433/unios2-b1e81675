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
  state?: string;
  area?: string;
  jd_category?: string;
  // Meta Lead Ads attribution — populated by parseMetaAds, persisted on
  // the leads row so per-campaign / per-form analytics work without
  // re-querying Meta. Other parsers leave these undefined.
  meta_leadgen_id?: string;
  meta_form_id?: string;
  meta_form_name?: string;
  meta_ad_id?: string;
  meta_ad_name?: string;
  meta_adset_id?: string;
  meta_adset_name?: string;
  meta_campaign_id?: string;
  meta_campaign_name?: string;
  meta_page_id?: string;
  meta_platform?: string;
  raw_form_data?: any;
}

function parseJustDial(body: any): ParsedLead {
  // JustDial sends: leadid, name, phone, email, city, area, category, date
  const prefix = body.prefix ? `${body.prefix} ` : "";
  return {
    name: (prefix + (body.name || body.leadname || "")).trim(),
    phone: (body.phone || body.mobile || "").replace(/[\s\-]/g, ""),
    email: body.email || undefined,
    source: "justdial",
    source_lead_id: body.leadid ? String(body.leadid) : undefined,
    city: body.city || undefined,
    area: body.area || undefined,
    jd_category: body.category || undefined,
    notes: [
      body.category ? `JD Category: ${body.category}` : "",
      body.city     ? `City: ${body.city}`             : "",
      body.area     ? `Area: ${body.area}`             : "",
      body.date     ? `Date: ${body.date}`             : "",
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
    state: body.state || undefined,
    notes: [
      body.qualification ? `Qualification: ${body.qualification}` : "",
    ].filter(Boolean).join(" | ") || undefined,
  };
}

function parseMetaAds(body: any): ParsedLead {
  // Meta (Facebook / Instagram) Lead Ads webhook payload.
  // The webhook function (`meta-leads-webhook`) fetches the full lead via
  // Graph API and forwards it here as { field_data, leadgen_id, form_id,
  // form_name, ad_id, ad_name, adset_id, adset_name, campaign_id,
  // campaign_name, page_id, platform, ... }.
  //
  // Strategy:
  //   1. Map known field names to standard columns (case-insensitive,
  //      multiple aliases per column to cover form-builder variation).
  //   2. Anything not mapped goes into `notes` as "Label: Value" lines.
  //   3. Full original field_data is preserved in raw_form_data so a
  //      future schema can promote anything we missed.
  const fieldData = Array.isArray(body.field_data) ? body.field_data : [];

  const findField = (...aliases: string[]): string => {
    for (const alias of aliases) {
      const target = alias.toLowerCase();
      const f = fieldData.find((f: any) => (f?.name || "").toLowerCase() === target);
      const v = f?.values?.[0];
      if (v) return String(v).trim();
    }
    return "";
  };

  // Aliases collected from common Meta lead-form templates + custom fields
  // we've seen in the wild. Lowercased for case-insensitive match.
  const NAME_KEYS    = ["full_name", "name", "your_name", "candidate_name", "applicant_name"];
  const FIRST_KEYS   = ["first_name", "given_name"];
  const LAST_KEYS    = ["last_name", "family_name", "surname"];
  const EMAIL_KEYS   = ["email", "email_address", "your_email", "candidate_email"];
  const PHONE_KEYS   = ["phone_number", "phone", "mobile", "mobile_number", "contact", "contact_number", "whatsapp_number", "your_phone_number"];
  const COURSE_KEYS  = ["course", "program", "programme", "course_interested_in", "interested_in", "preferred_course", "select_course", "which_course", "course_name"];
  const CITY_KEYS    = ["city", "town", "your_city", "current_city"];
  const STATE_KEYS   = ["state", "region", "current_state"];
  const KNOWN: Set<string> = new Set([
    ...NAME_KEYS, ...FIRST_KEYS, ...LAST_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS,
    ...COURSE_KEYS, ...CITY_KEYS, ...STATE_KEYS,
  ].map(s => s.toLowerCase()));

  // Resolve name (full first, else first+last)
  const fullName = findField(...NAME_KEYS) ||
    [findField(...FIRST_KEYS), findField(...LAST_KEYS)].filter(Boolean).join(" ").trim();

  // Build "unmapped" lines for the notes field
  const unmapped: string[] = [];
  for (const f of fieldData) {
    const fname = (f?.name || "").toLowerCase();
    if (!fname || KNOWN.has(fname)) continue;
    const val = (f?.values || []).filter(Boolean).join(", ");
    if (val) {
      // Prettify the field name (snake_case → Title Case) for the note
      const label = String(f.name).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      unmapped.push(`${label}: ${val}`);
    }
  }

  const noteParts: string[] = [];
  if (body.campaign_name) noteParts.push(`Campaign: ${body.campaign_name}`);
  if (body.adset_name)    noteParts.push(`Adset: ${body.adset_name}`);
  if (body.ad_name)       noteParts.push(`Ad: ${body.ad_name}`);
  if (body.form_name)     noteParts.push(`Form: ${body.form_name}`);
  if (body.platform)      noteParts.push(`Platform: ${String(body.platform).toUpperCase()}`);
  if (unmapped.length)    noteParts.push(...unmapped);

  return {
    name:        fullName || body.full_name || body.name || "",
    phone:       (findField(...PHONE_KEYS) || body.phone || "").replace(/[\s\-()]/g, ""),
    email:       findField(...EMAIL_KEYS) || body.email || undefined,
    source:      "meta_ads",
    source_lead_id: body.leadgen_id ? String(body.leadgen_id) : undefined,
    course_name: findField(...COURSE_KEYS) || body.course || undefined,
    city:        findField(...CITY_KEYS)   || body.city  || undefined,
    state:       findField(...STATE_KEYS)  || body.state || undefined,
    notes:       noteParts.length ? noteParts.join(" | ") : undefined,

    // Attribution — preserved verbatim so reports can join to Meta Ads Insights
    meta_leadgen_id:    body.leadgen_id     ? String(body.leadgen_id)     : undefined,
    meta_form_id:       body.form_id        ? String(body.form_id)        : undefined,
    meta_form_name:     body.form_name      || undefined,
    meta_ad_id:         body.ad_id          ? String(body.ad_id)          : undefined,
    meta_ad_name:       body.ad_name        || undefined,
    meta_adset_id:      body.adset_id       ? String(body.adset_id)       : undefined,
    meta_adset_name:    body.adset_name     || undefined,
    meta_campaign_id:   body.campaign_id    ? String(body.campaign_id)    : undefined,
    meta_campaign_name: body.campaign_name  || undefined,
    meta_page_id:       body.page_id        ? String(body.page_id)        : undefined,
    meta_platform:      body.platform       || undefined,
    raw_form_data:      fieldData.length ? fieldData : undefined,
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

interface MiraiParsedLead extends ParsedLead {
  course_code?: string; // internal: used for exact course code matching
}

function parseMirai(body: any): MiraiParsedLead {
  // Mirai school waitlist form: parent_name, mobile_number, email, child_name, child_dob, looking_for
  const childAge = body.child_dob
    ? (Date.now() - new Date(body.child_dob).getTime()) / (365.25 * 24 * 3600 * 1000)
    : null;

  // Suggest course code from age (matches MES-* course codes)
  let courseCode = "";
  let gradeLabel = "";
  if (childAge !== null) {
    if (childAge < 2)        { courseCode = "MES-TOD";  gradeLabel = "Toddlers"; }
    else if (childAge < 3)   { courseCode = "MES-MON";  gradeLabel = "Montessori"; }
    else if (childAge < 4)   { courseCode = "MES-EYP1"; gradeLabel = "EYP 1 (Nursery)"; }
    else if (childAge < 5)   { courseCode = "MES-EYP2"; gradeLabel = "EYP 2 (LKG)"; }
    else if (childAge < 6)   { courseCode = "MES-EYP3"; gradeLabel = "EYP 3 (UKG)"; }
    else if (childAge < 7)   { courseCode = "MES-PYP1"; gradeLabel = "PYP 1 (Grade I)"; }
    else if (childAge < 8)   { courseCode = "MES-PYP2"; gradeLabel = "PYP 2 (Grade II)"; }
    else if (childAge < 9)   { courseCode = "MES-PYP3"; gradeLabel = "PYP 3 (Grade III)"; }
    else if (childAge < 10)  { courseCode = "MES-PYP4"; gradeLabel = "PYP 4 (Grade IV)"; }
    else if (childAge < 11)  { courseCode = "MES-PYP5"; gradeLabel = "PYP 5 (Grade V)"; }
    else if (childAge < 12)  { courseCode = "MES-MYP1"; gradeLabel = "MYP 1 (Grade VI)"; }
    else if (childAge < 13)  { courseCode = "MES-MYP2"; gradeLabel = "MYP 2 (Grade VII)"; }
    else                     { courseCode = "MES-MYP3"; gradeLabel = "MYP 3 (Grade VIII)"; }
  }

  const intentLabels: Record<string, string> = {
    exploring: "Exploring options",
    comparing: "Comparing schools",
    immediate: "Looking for immediate admission",
    next_year: "Planning for next academic year",
  };

  return {
    name: (body.child_name || "").trim(),
    phone: (body.mobile_number || body.mobile || body.phone || "").replace(/[\s\-]/g, ""),
    email: body.email?.trim() || undefined,
    guardian_name: body.parent_name?.trim() || undefined,
    guardian_phone: (body.mobile_number || body.mobile || body.phone || "").replace(/[\s\-]/g, "") || undefined,
    source: "mirai_website",
    course_code: courseCode || undefined,
    course_name: gradeLabel || undefined,
    campus_name: "Mirai",
    notes: [
      "Source: Mirai waitlist form",
      body.child_dob ? `Child DOB: ${body.child_dob}` : "",
      childAge !== null ? `Age: ${childAge.toFixed(1)} years (suggested: ${gradeLabel})` : "",
      body.looking_for ? `Looking for: ${intentLabels[body.looking_for] || body.looking_for}` : "",
      body.whatsapp_consent === false ? "WhatsApp opt-out" : "WhatsApp consent: yes",
    ].filter(Boolean).join(" | "),
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
    city: body.city || undefined,
    state: body.state || undefined,
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
  website_chat: parseWebsite,
  mirai: parseMirai,
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

    // GA4 attribution context — passed by all 3 marketing sites and the
    // apply portal in the request body. Independent of source-specific
    // parsers since these fields are universal. The ga-conversions DB
    // trigger reads them later to fire generate_lead / purchase /
    // admission_confirmed events into the right GA4 property.
    //
    // Meta CAPI attribution (fbc/fbp/portal_brand) follows the same path:
    // captured by the marketing-site analytics module from the _fbp cookie
    // + fbclid URL param, persisted on the lead row, then read by
    // meta-capi-events to lift Match Quality and route to the right pixel.
    // origin_domain → portal_brand fallback covers marketing-site posts
    // that don't pass portal_brand explicitly.
    const originDomain = (body.origin_domain || "").toLowerCase();
    const brandFromOrigin =
      originDomain.endsWith("miraischool.in")    ? "mirai"  :
      originDomain.endsWith("school.nimt.ac.in") ? "beacon" :
      originDomain.endsWith("nimt.ac.in")        ? "nimt"   :
      null;
    const attribution = {
      ga_client_id:  body.ga_client_id  || null,
      ga_session_id: body.ga_session_id || null,
      gclid:         body.gclid         || null,
      utm_source:    body.utm_source    || null,
      utm_medium:    body.utm_medium    || null,
      utm_campaign:  body.utm_campaign  || null,
      utm_term:      body.utm_term      || null,
      utm_content:   body.utm_content   || null,
      landing_page:  body.landing_page  || null,
      referrer:      body.referrer      || null,
      origin_domain: body.origin_domain || null,
      fbc:           body.fbc           || null,
      fbp:           body.fbp           || null,
      portal_brand:  body.portal_brand  || brandFromOrigin,
    };

    // Supabase client (service role for inserts)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve lead source early (needed for duplicate tracking)
    const validSources = [
      "website", "website_chat", "mirai_website", "meta_ads", "google_ads", "shiksha", "walk_in",
      "consultant", "justdial", "referral", "education_fair", "collegedunia", "collegehai", "salahlo", "other",
    ];
    // Sources that should NOT trigger an AI call (user is already chatting)
    const skipAiCallSources = ["website_chat"];
    const leadSource = validSources.includes(parsed.source) ? parsed.source : "other";

    // ── Idempotency: same Meta leadgen_id from a webhook retry ─────────
    // Meta resends the webhook if our endpoint is slow/timed-out; the
    // unique index on meta_leadgen_id would block the insert anyway, but
    // surfacing this as a clean "duplicate" response avoids 500s.
    if (parsed.meta_leadgen_id) {
      const { data: existingMeta } = await supabase
        .from("leads")
        .select("id, name, stage")
        .eq("meta_leadgen_id", parsed.meta_leadgen_id)
        .maybeSingle();
      if (existingMeta) {
        return new Response(
          JSON.stringify({
            status: "duplicate",
            message: `Lead already ingested from this Meta leadgen_id`,
            lead_id: existingMeta.id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Duplicate detection by phone ──
    const { data: existing } = await supabase
      .from("leads")
      .select("id, name, stage, source, secondary_source, tertiary_source, source_history")
      .eq("phone", normPhone)
      .eq("is_mirror", false)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const newSource = leadSource;
      const currentSource = existing.source;
      const currentSecondary = existing.secondary_source;

      // Only update if the new source is different from existing sources
      if (newSource !== currentSource && newSource !== currentSecondary && newSource !== existing.tertiary_source) {
        const updates: Record<string, any> = {};

        // Add to source_history
        const history = Array.isArray(existing.source_history) ? existing.source_history : [];
        history.push({ source: newSource, timestamp: new Date().toISOString(), data: parsed.notes || null });
        updates.source_history = history;

        // Fill secondary, then tertiary
        if (!currentSecondary) {
          updates.secondary_source = newSource;
        } else if (!existing.tertiary_source) {
          updates.tertiary_source = newSource;
        }
        // else: already has 3 sources, just log to history

        await supabase.from("leads").update(updates).eq("id", existing.id);

        // Log activity
        await supabase.from("lead_activities").insert({
          lead_id: existing.id,
          type: "system",
          description: `Lead re-inquired from ${newSource}. Primary: ${currentSource}, Secondary: ${currentSecondary || newSource}${existing.tertiary_source || updates.tertiary_source ? ', Tertiary: ' + (existing.tertiary_source || updates.tertiary_source) : ''}`,
        });
      }

      return new Response(
        JSON.stringify({
          status: "duplicate",
          message: `Lead already exists: ${existing.name} (${existing.stage}). Source ${newSource} tracked.`,
          lead_id: existing.id,
          sources: {
            primary: currentSource,
            secondary: currentSecondary || (newSource !== currentSource ? newSource : null),
            tertiary: existing.tertiary_source,
          },
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

    // Mirai source: lock to Mirai institution courses + campus
    const isMirai = source === "mirai";

    // For Mirai, prefer exact course code match (e.g. MES-EYP3)
    const parsedAny = parsed as any;
    if (isMirai && parsedAny.course_code) {
      const { data: course } = await supabase
        .from("courses")
        .select("id")
        .eq("code", parsedAny.course_code)
        .maybeSingle();
      if (course) course_id = course.id;
    } else if (parsed.course_name) {
      let courseQuery = supabase.from("courses").select("id, name, code");
      if (isMirai) {
        courseQuery = courseQuery.like("code", "MES-%");
      }
      const { data: courses } = await courseQuery
        .ilike("name", `%${parsed.course_name}%`)
        .limit(1)
        .maybeSingle();
      if (courses) course_id = courses.id;
    }

    if (isMirai) {
      // Always assign to Mirai's campus (where institution GZ1-MES sits)
      const { data: miraiInst } = await supabase
        .from("institutions")
        .select("campus_id")
        .eq("code", "GZ1-MES")
        .single();
      if (miraiInst) campus_id = miraiInst.campus_id;
    } else if (source === "meta_ads" && parsed.meta_page_id) {
      // Meta lead forms don't carry campus/course fields, so derive the
      // campus from the page the ad runs on. Page → campus mapping is
      // authoritative because each Meta Page maps 1:1 to a NIMT campus.
      // Pages not listed here (e.g. the NIMT Educational Institutions
      // umbrella page) keep campus_id NULL — the bucket classifier will
      // place them under 'college' by default.
      const META_PAGE_TO_CAMPUS: Record<string, string> = {
        "111711207848445":  "c0000001-0000-0000-0000-000000000002", // NIMT School → Ghaziabad Campus 1 (Arthala)
        "1016687728205021": "c0000002-0000-0000-0000-000000000001", // Mirai Experiential School → Ghaziabad Campus 2 (Avantika)
      };
      const mapped = META_PAGE_TO_CAMPUS[parsed.meta_page_id];
      if (mapped) campus_id = mapped;
    } else if (parsed.campus_name || parsed.city) {
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

    // Generate application ID

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
        city:        parsed.city        || null,
        state:       parsed.state       || null,
        area:        parsed.area        || null,
        jd_category: parsed.jd_category || null,
        notes: parsed.notes?.slice(0, 4000) || null,
        stage: "new_lead",
        skip_ai_call: skipAiCallSources.includes(leadSource),
        // Meta Lead Ads attribution (set only when source='meta_ads')
        meta_leadgen_id:    parsed.meta_leadgen_id    || null,
        meta_form_id:       parsed.meta_form_id       || null,
        meta_form_name:     parsed.meta_form_name     || null,
        meta_ad_id:         parsed.meta_ad_id         || null,
        meta_ad_name:       parsed.meta_ad_name       || null,
        meta_adset_id:      parsed.meta_adset_id      || null,
        meta_adset_name:    parsed.meta_adset_name    || null,
        meta_campaign_id:   parsed.meta_campaign_id   || null,
        meta_campaign_name: parsed.meta_campaign_name || null,
        meta_page_id:       parsed.meta_page_id       || null,
        meta_platform:      parsed.meta_platform      || null,
        raw_form_data:      parsed.raw_form_data      || null,
        ...attribution,
      })
      .select("id, name, phone, source, stage")
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

    // For chat widget leads: schedule AI call after 10 minutes (after chat likely ends)
    if (skipAiCallSources.includes(leadSource)) {
      const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from("ai_call_queue" as any).insert({
        lead_id: lead.id,
        status: "pending",
        scheduled_at: scheduledAt,
      }).catch(() => {}); // non-blocking
    }

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
