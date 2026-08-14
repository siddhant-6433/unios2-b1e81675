import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_USERNAME = "razorpay_uat";
const DEFAULT_PASSWORD = "Nimt@Razorpay2026";
const DEFAULT_EMAIL = "razorpay_uat@student.unios.local";
const DEFAULT_PHONE = "+919999000026";
const DEFAULT_NAME = "Razorpay UAT Student";
const DEFAULT_ADMISSION_NO = "RAZORPAY-UAT-G5";
const DEFAULT_COURSE_CODE = "BSAV-G5";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (value.startsWith("+")) return value;
  return `+${digits}`;
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const max = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }
  await crypto.subtle.digest("SHA-256", leftBytes);
  return diff === 0;
}

async function findUserByEmail(db: any, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

async function ensureAuthUser(db: any, email: string, password: string, phone: string, name: string) {
  const metadata = {
    provisioned_by: "student_password_login",
    role: "student",
    full_name: name,
    display_name: name,
    phone,
  };

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone,
    phone_confirm: true,
    user_metadata: metadata,
  });

  let user = created?.user || null;
  if (!user) {
    const duplicate = /already|registered|exists/i.test(createError?.message || "");
    if (!duplicate) throw createError || new Error("Could not create student user");
    user = await findUserByEmail(db, email);
    if (!user?.id) throw createError || new Error("Student user exists but could not be found");
    await db.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      phone,
      phone_confirm: true,
      user_metadata: { ...(user.user_metadata || {}), ...metadata },
    });
  }

  return user.id;
}

async function createSession(db: any, userId: string) {
  // Minting a session here bypasses GoTrue's own grant, so a ban would not stop it.
  const { data: blocked } = await db.rpc("is_login_blocked", { _user_id: userId });
  if (blocked) return null;

  const { data: userData } = await db.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) return null;

  const { data: magicLink, error: magicError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (magicError || !magicLink?.properties?.hashed_token) return null;

  // verifyOtp REPLACES the calling client's auth state, demoting `db` from
  // service_role to this user. Harmless today only because nothing writes after
  // this call — burn a throwaway client so appending one later can't silently
  // match 0 rows under RLS.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: sessionData, error: verifyError } = await authClient.auth.verifyOtp({
    token_hash: magicLink.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !sessionData?.session) return null;

  return {
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  };
}

function quarterDueDate(term: string): string {
  const academicYear = 2026;
  const dates: Record<string, string> = {
    q1: `${academicYear}-04-10`,
    q2: `${academicYear}-07-10`,
    q3: `${academicYear}-10-10`,
    q4: `${academicYear + 1}-01-10`,
  };
  return dates[term] || `${academicYear}-04-01`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const expectedUsername = Deno.env.get("STUDENT_PORTAL_UAT_USERNAME") || DEFAULT_USERNAME;
    const expectedPassword = Deno.env.get("STUDENT_PORTAL_UAT_PASSWORD") || DEFAULT_PASSWORD;
    const email = Deno.env.get("STUDENT_PORTAL_UAT_EMAIL") || DEFAULT_EMAIL;
    const phone = normalizePhone(Deno.env.get("STUDENT_PORTAL_UAT_PHONE") || DEFAULT_PHONE);
    const name = Deno.env.get("STUDENT_PORTAL_UAT_NAME") || DEFAULT_NAME;
    const admissionNo = Deno.env.get("STUDENT_PORTAL_UAT_ADMISSION_NO") || DEFAULT_ADMISSION_NO;
    const courseCode = Deno.env.get("STUDENT_PORTAL_UAT_COURSE_CODE") || DEFAULT_COURSE_CODE;

    const { username, password } = await req.json().catch(() => ({}));
    if (typeof username !== "string" || typeof password !== "string") {
      return json({ error: "username and password required" }, 400);
    }

    const usernameOk = await secureEqual(username.trim().toLowerCase(), expectedUsername.toLowerCase());
    const passwordOk = await secureEqual(password, expectedPassword);
    if (!usernameOk || !passwordOk) return json({ error: "Invalid username or password" }, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userId = await ensureAuthUser(db, email, expectedPassword, phone, name);

    const { data: course, error: courseError } = await db
      .from("courses")
      .select("id, name, departments!inner(institutions!inner(campus_id))")
      .eq("code", courseCode)
      .single();
    if (courseError || !course) return json({ error: `Course ${courseCode} not found` }, 500);

    const campusId = course.departments?.institutions?.campus_id || null;
    if (!campusId) return json({ error: `Campus not found for ${courseCode}` }, 500);

    const { data: sessionRow } = await db
      .from("admission_sessions")
      .select("id")
      .eq("is_active", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const preferredSessionId = sessionRow?.id || "f0000001-0000-0000-0000-000000000001";

    let { data: feeStructure } = await db
      .from("fee_structures")
      .select("id, session_id")
      .eq("course_id", course.id)
      .eq("session_id", preferredSessionId)
      .eq("is_active", true)
      .in("version", ["new_admission", "standard"])
      .order("version", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!feeStructure?.id) {
      const fallback = await db
        .from("fee_structures")
        .select("id, session_id")
        .eq("course_id", course.id)
        .eq("is_active", true)
        .in("version", ["new_admission", "standard"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      feeStructure = fallback.data;
    }

    if (!feeStructure?.id) return json({ error: "No active fee structure found for test student" }, 500);
    const sessionId = feeStructure.session_id || preferredSessionId;

    const studentPayload = {
      name,
      first_name: "Razorpay",
      last_name: "UAT Student",
      phone,
      whatsapp_no: phone,
      email,
      student_email: email,
      admission_no: admissionNo,
      school_admission_no: admissionNo,
      course_id: course.id,
      campus_id: campusId,
      session_id: sessionId,
      user_id: userId,
      joining_class: "Grade V",
      section: "A",
      student_type: "day_scholar",
      fee_structure_version: "new_admission",
      status: "active",
      admission_date: new Date().toISOString().slice(0, 10),
      date_of_admission: new Date().toISOString().slice(0, 10),
      guardian_name: "Razorpay UAT Guardian",
      guardian_phone: phone,
      father_name: "Razorpay UAT Guardian",
      father_phone: phone,
    };

    const { data: existingStudent } = await db
      .from("students")
      .select("id")
      .or(`admission_no.eq.${admissionNo},user_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();

    let studentId = existingStudent?.id || null;
    if (studentId) {
      const { error: updateError } = await db.from("students").update(studentPayload).eq("id", studentId);
      if (updateError) return json({ error: updateError.message }, 500);
    } else {
      const { data: inserted, error: insertError } = await db
        .from("students")
        .insert(studentPayload)
        .select("id")
        .single();
      if (insertError) return json({ error: insertError.message }, 500);
      studentId = inserted.id;
    }

    await db.from("user_roles").upsert(
      { user_id: userId, role: "student" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
    await db.from("profiles").upsert(
      { user_id: userId, display_name: name, phone },
      { onConflict: "user_id" },
    );

    const { data: existingLedger } = await db
      .from("fee_ledger")
      .select("id, paid_amount")
      .eq("student_id", studentId)
      .limit(50);

    const { data: securityCode } = await db
      .from("fee_codes")
      .select("id")
      .eq("code", "NB-SEC")
      .maybeSingle();
    if (securityCode?.id) {
      const { data: securityRows } = await db
        .from("fee_ledger")
        .select("id, total_amount")
        .eq("student_id", studentId)
        .eq("fee_code_id", securityCode.id)
        .eq("paid_amount", 0);
      for (const row of securityRows || []) {
        await db
          .from("fee_ledger")
          .update({ paid_amount: Number(row.total_amount || 0), status: "paid" })
          .eq("id", row.id);
      }
    }

    if (!existingLedger || existingLedger.length === 0) {
      const { data: items } = await db
        .from("fee_structure_items")
        .select("id, fee_code_id, term, amount, fee_codes:fee_code_id(code, category)")
        .eq("fee_structure_id", feeStructure.id);
      const rows = (items || [])
        .filter((item: any) => {
          const category = item.fee_codes?.category;
          const code = item.fee_codes?.code;
          if (code === "NB-SEC") return false;
          return category === "tuition" || category === "enrollment";
        })
        .map((item: any) => ({
          student_id: studentId,
          fee_code_id: item.fee_code_id,
          fee_structure_item_id: item.id,
          term: item.term,
          total_amount: Number(item.amount || 0),
          paid_amount: 0,
          concession: 0,
          due_date: quarterDueDate(item.term),
          status: "due",
        }));

      if (rows.length === 0) return json({ error: "Fee structure has no billable rows" }, 500);
      const { error: ledgerError } = await db.from("fee_ledger").insert(rows);
      if (ledgerError) return json({ error: ledgerError.message }, 500);
    }

    const session = await createSession(db, userId);
    if (!session) return json({ error: "Could not create student session" }, 500);

    return json({
      ok: true,
      session,
      student_id: studentId,
      user_id: userId,
      name,
      admission_no: admissionNo,
      course: course.name,
    });
  } catch (err) {
    console.error("[student-password-login]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
