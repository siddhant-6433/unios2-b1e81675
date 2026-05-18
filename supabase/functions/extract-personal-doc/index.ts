// Extract structured fields from a personal document (insurance policy,
// vehicle PUC, RC, etc.) using Gemini Vision. Returns a typed JSON envelope
// the frontend can drop straight into the personal_documents table.
//
// Auth: requires a logged-in user whose email is in personal_dashboard_users.
// Service-role calls are also accepted (used by the whatsapp-webhook path).
//
// Request: { file_path: string, doc_type_hint?: string }
//   file_path is a path inside the `personal-documents` storage bucket.
// Response: { doc_type, label, issuer, policy_number, vehicle_reg,
//             insured_name, issued_on, expires_on, raw, confidence }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You extract structured data from personal Indian documents:
health insurance policies, life insurance policies, motor insurance policies,
vehicle pollution-under-control (PUC) certificates, vehicle RCs, driving
licenses, passports, Aadhaar, PAN, etc.

Return ONLY a single JSON object, no prose, no markdown fences. Schema:

{
  "doc_type": "health_insurance" | "life_insurance" | "vehicle_insurance" |
              "vehicle_pollution" | "vehicle_rc" | "driving_license" |
              "passport" | "aadhaar" | "pan" | "other",
  "label": string,            // short human label, e.g. "HDFC Ergo - Honda Activa PUC"
  "issuer": string | null,    // insurer / authority name
  "policy_number": string | null,
  "vehicle_reg": string | null,   // e.g. "DL3SCJ1234" — strip spaces, uppercase
  "insured_name": string | null,  // name of policyholder / vehicle owner / cardholder
  "issued_on": "YYYY-MM-DD" | null,
  "expires_on": "YYYY-MM-DD" | null,
  "confidence": number          // 0..1, your confidence in the extraction
}

Rules:
- Dates MUST be ISO YYYY-MM-DD. Convert DD/MM/YYYY or DD-MMM-YYYY accordingly.
- For PUC certificates the expiry is the "Valid Upto" / "Valid Till" date.
- For insurance the expiry is the policy end date / "Period of Insurance" end.
- If the document shows multiple dates pick the latest one as expires_on.
- Vehicle reg: remove all whitespace; keep dashes only if present in image.
- insured_name MUST be filled whenever a policyholder / cardholder / owner
  name is on the document. For health policies covering a family, join the
  members with commas (e.g. "Ekta Sethi, Siddhant Singh").
- Label conventions (at most 60 chars, no insurer name unless nothing else
  identifies the doc):
  * vehicle_insurance / vehicle_rc / vehicle_pollution → the vehicle's
    make and model, e.g. "Kia Seltos", "Honda Activa 6G".
  * health_insurance → "₹<sum_insured> <plan_name>" or just the plan
    name, e.g. "₹7 Lakhs Care policy", "Optima Restore Family".
  * life_insurance → plan name and sum assured.
  * passport / aadhaar / pan / driving_license → "<doc_type> – <name>".
- If a field is illegible or absent, use null. Do not guess.
- Confidence should drop below 0.6 if image is blurry, partially visible, or you are unsure of the doc type.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey      = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");

    if (!geminiKey) {
      return json({ error: "GEMINI_API_KEY not configured" }, 503);
    }

    // ── Auth: user JWT OR service-role ──────────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice(7);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    let isServiceRole = token === serviceRoleKey;
    let userEmail: string | null = null;

    if (!isServiceRole) {
      try {
        const [, payloadB64] = token.split(".");
        if (payloadB64) {
          const payload = JSON.parse(
            atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
          );
          if (payload?.role === "service_role") isServiceRole = true;
        }
      } catch { /* fall through */ }
    }

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user?.email) return json({ error: "Unauthorized" }, 401);
      userEmail = userData.user.email;

      // Enforce role: only super_admins may use this endpoint
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .eq("role", "super_admin")
        .maybeSingle();
      if (!roleRow) return json({ error: "Forbidden" }, 403);
    }

    const { file_path, doc_type_hint } = await req.json();
    if (!file_path || typeof file_path !== "string") {
      return json({ error: "file_path required" }, 400);
    }

    // If a user is calling, enforce that they own the path (first segment).
    if (userEmail) {
      const firstSeg = file_path.split("/")[0]?.toLowerCase();
      if (firstSeg !== userEmail.toLowerCase()) {
        return json({ error: "Forbidden: path does not belong to caller" }, 403);
      }
    }

    // ── Download file from storage ──────────────────────────────────────
    const { data: blob, error: dlErr } = await admin.storage
      .from("personal-documents")
      .download(file_path);
    if (dlErr || !blob) return json({ error: `download failed: ${dlErr?.message}` }, 404);

    const mime = blob.type || "application/octet-stream";
    if (!mime.startsWith("image/") && mime !== "application/pdf") {
      return json({ error: `unsupported mime: ${mime}` }, 415);
    }

    const buf = new Uint8Array(await blob.arrayBuffer());
    // base64 in 32KB chunks to avoid call-stack overflow on large PDFs
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
    }
    const b64 = btoa(bin);

    // ── Call Gemini ─────────────────────────────────────────────────────
    const userText = doc_type_hint
      ? `Hint: the user said this is a "${doc_type_hint}" document. Use this only as a tiebreaker; trust the image content.`
      : "Identify the document type from the image.";

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{
            role: "user",
            parts: [
              { text: userText },
              { inline_data: { mime_type: mime, data: b64 } },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            // Bumped from 800 → 4096 and thinkingBudget=0 because Gemini 2.5
            // burns the budget on internal "thinking" before emitting output;
            // a small cap leaves the JSON truncated mid-string. Document
            // extraction doesn't benefit from chain-of-thought reasoning.
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", errText);
      return json({ error: "extraction failed", detail: errText.slice(0, 500) }, 502);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Last-ditch: strip any code fence wrapping.
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* leave null */ }
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return json({ error: "could not parse extraction", raw: rawText.slice(0, 500) }, 502);
    }

    // Normalise
    const ALLOWED_TYPES = new Set([
      "health_insurance","life_insurance","vehicle_insurance","vehicle_pollution",
      "vehicle_rc","driving_license","passport","aadhaar","pan","other",
    ]);
    const doc_type = ALLOWED_TYPES.has(parsed.doc_type) ? parsed.doc_type : "other";
    const result = {
      doc_type,
      label:         (parsed.label || "Untitled document").toString().slice(0, 60),
      issuer:        parsed.issuer ?? null,
      policy_number: parsed.policy_number ?? null,
      vehicle_reg:   parsed.vehicle_reg ? String(parsed.vehicle_reg).replace(/\s+/g, "").toUpperCase() : null,
      insured_name:  parsed.insured_name ?? null,
      issued_on:     isIsoDate(parsed.issued_on) ? parsed.issued_on : null,
      expires_on:    isIsoDate(parsed.expires_on) ? parsed.expires_on : null,
      confidence:    typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      raw:           parsed,
    };

    return json(result, 200);
  } catch (err: any) {
    console.error("extract-personal-doc error:", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});

function json(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
