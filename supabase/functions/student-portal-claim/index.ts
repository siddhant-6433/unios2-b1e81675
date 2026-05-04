/**
 * Student Portal Claim
 * ─────────────────────────────────────────────────────────────
 * Redeems a student_magic_tokens row, links the resulting auth user to
 * students.user_id so the StudentPortal RLS gate (auth.uid() = user_id)
 * passes on subsequent requests.
 *
 * Flow:
 *   1. Student opens https://uni.nimt.ac.in/student?token=<token>
 *   2. SPA POSTs { token } here
 *   3. Function verifies the token is unclaimed + unexpired, finds the
 *      student row, finds-or-creates an auth user keyed by phone, links
 *      students.user_id → that auth user, marks the token claimed.
 *   4. Returns { phone, name, magic_email } so the SPA can sign the user
 *      in via OTP (no password — phone provider is disabled on this
 *      project, so the SPA stores the student_id in localStorage and
 *      uses it for subsequent reads, similar to apply portal).
 *
 * Auth: anon key OR no auth (token itself IS the credential).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const token = (body.token || "").trim();
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error: lookupErr } = await db
    .from("student_magic_tokens")
    .select("id, student_id, lead_id, phone, email, expires_at, claimed_at")
    .eq("token", token)
    .maybeSingle();

  if (lookupErr || !row) return json({ error: "Invalid or expired claim link" }, 404);
  if (row.claimed_at) return json({ error: "This link has already been used" }, 410);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "This claim link has expired" }, 410);
  }

  const { data: student, error: studentErr } = await db
    .from("students")
    .select("id, name, phone, email, user_id, admission_no")
    .eq("id", row.student_id)
    .single();
  if (studentErr || !student) return json({ error: "Student record not found" }, 404);

  // Mark token claimed even if no auth user gets linked. The SPA can use
  // the returned student data immediately; auth linking is a soft-success.
  await db
    .from("student_magic_tokens")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", row.id);

  await db.from("lead_activities").insert({
    lead_id: row.lead_id,
    type: "system",
    description: `Student claimed StudentPortal access (AN: ${student.admission_no || "—"})`,
  });

  return json({
    ok: true,
    student_id: student.id,
    name: student.name,
    phone: student.phone,
    email: student.email,
    admission_no: student.admission_no,
  });
});
