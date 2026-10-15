import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * placement-report-send — WhatsApp delivery of the Clinical Training,
 * Internship & Placement Report (2025-26) to a website visitor.
 *
 * This is the "automation" half of the placement-report feature: the NIMT
 * marketing site (nimt.ac.in) captures the lead via `lead-ingest`, then calls
 * this endpoint to WhatsApp the report PDF.
 *
 * Why a dedicated function instead of letting the browser call whatsapp-send
 * directly: whatsapp-send can send ANY approved template to ANY number, so
 * exposing it to the public anon key is an abuse/spam vector. This function is
 * deliberately narrow — it can ONLY send the fixed placement-report document
 * to the supplied phone, with a hardcoded template + document URL. Nothing the
 * caller passes can change which template or file is sent.
 *
 * Auth mirrors lead-ingest: accepts the Supabase anon key (browser) or the
 * LEAD_INGEST_API_KEY (server-to-server). verify_jwt=false (see config.toml).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fixed report artefact. The PDF is served from the marketing site, so the
// same URL is both the public download and the WhatsApp DOCUMENT header link.
const REPORT_TEMPLATE_KEY = "placement_report";
const REPORT_DOCUMENT_URL =
  "https://www.nimt.ac.in/pdfs/nimt-medical-paramedical-placement-internship-report-2025-26.pdf";
const REPORT_DOCUMENT_FILENAME = "NIMT-Placement-Internship-Report-2025-26.pdf";

// Same normalisation as lead-ingest: bare 10-digit → +91, keep existing +CC.
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

function firstName(name: string): string {
  const n = (name || "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0].slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth (mirrors lead-ingest) ──
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

    const body = await req.json().catch(() => ({}));
    const rawPhone = String(body?.phone || "").trim();
    const name = String(body?.name || "").trim();
    if (!rawPhone) {
      return new Response(JSON.stringify({ error: "Missing required field: phone" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const phone = normalisePhone(rawPhone);
    // Guard against malformed numbers reaching the WhatsApp API.
    if (!/^\+\d{11,15}$/.test(phone)) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Best-effort: attach this send to the lead's timeline so counsellors see
    // the report went out. Non-blocking — never fails the delivery.
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: lead } = await admin
        .from("leads")
        .select("id")
        .eq("phone", phone)
        .eq("is_mirror", false)
        .limit(1)
        .maybeSingle();
      if (lead?.id) {
        await admin.from("lead_activities").insert({
          lead_id: lead.id,
          type: "system",
          description: "Placement & Internship Report (2025-26) sent via WhatsApp.",
        });
      }
    } catch (_) {
      // ignore — activity logging is not critical to delivery
    }

    // ── Send the report as a WhatsApp document (template + DOCUMENT header) ──
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        template_key: REPORT_TEMPLATE_KEY,
        phone,
        params: [firstName(name)],
        header_document_url: REPORT_DOCUMENT_URL,
        header_document_filename: REPORT_DOCUMENT_FILENAME,
      }),
    });

    const sendResult = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      console.error("[placement-report-send] whatsapp-send failed:", JSON.stringify(sendResult));
      return new Response(
        JSON.stringify({ status: "send_failed", detail: sendResult }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ status: "sent", phone }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[placement-report-send] error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Unhandled error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
