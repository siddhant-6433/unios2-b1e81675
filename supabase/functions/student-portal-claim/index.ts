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
 *   4. Returns a Supabase session so the SPA can enter /student immediately.
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

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function studentEmail(studentId: string, phone: string | null, email: string | null | undefined): string {
  const trimmed = (email || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed;
  if (phone) return `${phone}@student.unios.local`;
  return `student.${studentId}@student.unios.local`;
}

async function findUserByEmailOrPhone(db: any, email: string, phone: string | null) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (data?.users || []).find((u: any) =>
    u.email?.toLowerCase() === email.toLowerCase() ||
    (phone && u.phone?.replace(/\D/g, "") === phone)
  ) || null;
}

async function createSession(db: any, userId: string) {
  const { data: userData } = await db.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) return null;

  const { data: magicLink, error: magicError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (magicError || !magicLink?.properties?.hashed_token) return null;

  const { data: sessionData, error: verifyError } = await db.auth.verifyOtp({
    token_hash: magicLink.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !sessionData?.session) return null;

  return {
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  };
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
    .select("id, name, phone, whatsapp_no, email, user_id, admission_no")
    .eq("id", row.student_id)
    .single();
  if (studentErr || !student) return json({ error: "Student record not found" }, 404);

  const phone = normalizePhone(student.phone || student.whatsapp_no || row.phone);
  const email = studentEmail(student.id, phone, student.email || row.email);

  let userId = student.user_id;
  if (!userId) {
    const existing = await findUserByEmailOrPhone(db, email, phone);
    if (existing?.id) {
      userId = existing.id;
    } else {
      const createPayload: Record<string, unknown> = {
        email,
        email_confirm: true,
        user_metadata: {
          provisioned_by: "student_portal_claim",
          role: "student",
          student_id: student.id,
          phone,
          full_name: student.name,
          display_name: student.name,
        },
      };
      if (phone) {
        createPayload.phone = `+${phone}`;
        createPayload.phone_confirm = true;
      }

      const { data: created, error: createErr } = await db.auth.admin.createUser(createPayload as any);
      if (createErr || !created?.user?.id) {
        const fallback = await findUserByEmailOrPhone(db, email, phone);
        if (!fallback?.id) return json({ error: createErr?.message || "Could not create student account" }, 500);
        userId = fallback.id;
      } else {
        userId = created.user.id;
      }
    }

    const { error: linkErr } = await db
      .from("students")
      .update({ user_id: userId })
      .eq("id", student.id);
    if (linkErr) return json({ error: linkErr.message }, 500);
  }

  await db.from("user_roles").upsert(
    { user_id: userId, role: "student" },
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );

  await db.from("profiles").upsert(
    { user_id: userId, display_name: student.name, ...(phone ? { phone: `+${phone}` } : {}) },
    { onConflict: "user_id" },
  );

  const session = await createSession(db, userId);
  if (!session) return json({ error: "Could not create student session" }, 500);

  const { error: claimErr } = await db
    .from("student_magic_tokens")
    .update({ claimed_at: new Date().toISOString(), claimed_user_id: userId })
    .eq("id", row.id);
  if (claimErr) return json({ error: claimErr.message }, 500);

  if (row.lead_id) {
    await db.from("lead_activities").insert({
      lead_id: row.lead_id,
      type: "system",
      description: `Student claimed StudentPortal access (AN: ${student.admission_no || "—"})`,
    });
  }

  return json({
    ok: true,
    session,
    student_id: student.id,
    name: student.name,
    phone: student.phone,
    email: student.email,
    admission_no: student.admission_no,
  });
});
