/**
 * Redeem Apply Magic Link
 *
 * Public endpoint. Student's browser sends the token; we validate it and return
 * { phone, name, lead_id } so the apply portal can authenticate the visitor as
 * the student WITHOUT needing a Supabase session — the portal mirrors the OTP
 * login flow which is also session-less (just sets local React state via
 * onAuthenticated(phone, name)).
 *
 * Phone+password flow was attempted earlier but the Supabase project has phone
 * provider disabled, so signInWithPassword would always fail. The OTP flow has
 * always worked without a real session, so the magic-link flow now follows the
 * same shape.
 *
 * Multi-use until expires_at; each redemption increments use_count for audit.
 *
 * Input:  { token: string }
 * Output: { phone, name, lead_id }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (p.startsWith("+")) return p;
  return `+${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { token } = await req.json();
    if (!token) return json({ error: "token required" }, 400);

    const { data: row, error } = await db.from("apply_magic_tokens")
      .select("token, lead_id, phone, expires_at, revoked_at, use_count")
      .eq("token", token)
      .maybeSingle();
    if (error || !row) return json({ error: "Invalid link" }, 404);
    if (row.revoked_at) return json({ error: "This link was revoked. Ask your counsellor for a new one." }, 410);
    if (new Date(row.expires_at) < new Date()) return json({ error: "This link has expired. Ask your counsellor for a new one." }, 410);

    const phone = normalizePhone(row.phone);

    // Pull the lead's display name so the apply portal can greet the student
    // without an extra round-trip.
    const { data: lead } = await db
      .from("leads")
      .select("name")
      .eq("id", row.lead_id)
      .maybeSingle();
    const name = lead?.name || "Applicant";

    await db.from("apply_magic_tokens").update({
      last_used_at: new Date().toISOString(),
      use_count: (row.use_count || 0) + 1,
    }).eq("token", row.token);

    return json({ phone, name, lead_id: row.lead_id });
  } catch (err: any) {
    console.error("[redeem-apply-link]", err);
    return json({ error: err.message }, 500);
  }
});
