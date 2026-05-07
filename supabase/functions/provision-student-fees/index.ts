import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Map transport zone value → fee code */
const TRANSPORT_ZONE_CODE: Record<string, string> = {
  zone_1: "NB-TR1",
  zone_2: "NB-TR2",
  zone_3: "NB-TR3",
};

/** Map hostel_type → fee code for BOARDER students */
const HOSTEL_TYPE_CODE: Record<string, string> = {
  non_ac: "NB-NAC",
  ac_central: "NB-CBA",
  ac_individual: "NB-IBA",
};

/** Day boarding fee code */
const DAY_BOARDING_CODE = "NB-DBA";

/** Security deposit code (boarders only) */
const SECURITY_DEPOSIT_CODE = "NB-SEC";

/** Quarter due dates: q1→Apr 10, q2→Jul 10, q3→Oct 10, q4→Jan 10 */
function quarterDueDate(term: string, year: number): string | null {
  const map: Record<string, string> = {
    q1: `${year}-04-10`,
    q2: `${year}-07-10`,
    q3: `${year}-10-10`,
    q4: `${year + 1}-01-10`,
  };
  return map[term] || null;
}

interface ProvisionRequest {
  student_id?: string;
  student_ids?: string[];
  force_reprovision?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    console.log("provision-student-fees: auth header present:", !!authHeader);

    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    // Use service role client to validate user via admin API
    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      console.error("provision-student-fees: auth failed:", authError?.message);
      return json({ error: `Auth failed: ${authError?.message || "no user"}` }, 401);
    }
    console.log("provision-student-fees: user:", user.id);

    // Auth check: must be super_admin, campus_admin, principal, or accountant
    const { data: roleRows, error: roleErr } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .limit(1);
    const callerRole = roleRows?.[0]?.role;
    console.log("provision-student-fees: role:", callerRole, "roleErr:", roleErr?.message);
    const allowed = ["super_admin", "campus_admin", "principal", "accountant", "admission_head", "counsellor"];
    if (!callerRole || !allowed.includes(String(callerRole))) {
      return json({ error: `Forbidden: your role is "${callerRole || "unknown"}"` }, 403);
    }

    let body: ProvisionRequest;
    try {
      body = await req.json();
    } catch (parseErr: any) {
      console.error("provision-student-fees: body parse error:", parseErr.message);
      return json({ error: `Invalid request body: ${parseErr.message}` }, 400);
    }
    console.log("provision-student-fees: body:", JSON.stringify(body));
    const ids = body.student_ids || (body.student_id ? [body.student_id] : []);
    const forceReprovision = body.force_reprovision || false;

    if (ids.length === 0) {
      return json({ error: "student_id or student_ids required" }, 400);
    }

    const results: { student_id: string; status: string; items_created: number; error?: string }[] = [];

    for (const studentId of ids) {
      try {
        const count = await provisionStudent(db, studentId, forceReprovision);
        results.push({ student_id: studentId, status: "ok", items_created: count });
      } catch (e: any) {
        results.push({ student_id: studentId, status: "error", items_created: 0, error: e.message });
      }
    }

    return json({ success: true, results });
  } catch (err: any) {
    console.error("provision-student-fees error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
});

async function provisionStudent(
  db: ReturnType<typeof createClient>,
  studentId: string,
  forceReprovision: boolean,
): Promise<number> {
  // 1. Fetch student (incl. lead_id so we can look up approved offer waivers).
  const { data: student, error: sErr } = await db
    .from("students")
    .select("id, lead_id, course_id, student_type, transport_required, transport_zone, hostel_type, fee_structure_version, session_id")
    .eq("id", studentId)
    .single();

  if (sErr || !student) throw new Error(`Student not found: ${studentId}`);
  if (!student.course_id) throw new Error("Student has no course_id");
  if (!student.session_id) throw new Error("Student has no session_id");

  const version = student.fee_structure_version || "new_admission";

  // 2. Find matching fee_structure
  const { data: fsRows, error: fsErr } = await db
    .from("fee_structures")
    .select("id")
    .eq("course_id", student.course_id)
    .eq("session_id", student.session_id)
    .eq("version", version)
    .eq("is_active", true)
    .limit(1);

  const feeStructure = fsRows?.[0];
  if (fsErr || !feeStructure) throw new Error(`No active fee structure for course=${student.course_id}, session=${student.session_id}, version=${version}, err=${fsErr?.message || "none"}`);

  // 3. Fetch fee_structure_items with fee_codes
  const { data: items } = await db
    .from("fee_structure_items")
    .select("id, fee_code_id, term, amount, due_day, fee_codes:fee_code_id(code, category)")
    .eq("fee_structure_id", feeStructure.id);

  if (!items || items.length === 0) throw new Error("Fee structure has no items");

  // 4. Filter items by student profile
  const studentType = (student.student_type || "day_scholar").toLowerCase();
  const transportRequired = student.transport_required === true;
  const transportZone = student.transport_zone || null;
  const hostelType = student.hostel_type || null;

  const filtered = items.filter((item: any) => {
    const code: string = item.fee_codes?.code || "";
    const category: string = item.fee_codes?.category || "";

    // Tuition → always include
    if (category === "tuition") return true;

    // Enrollment (registration, admission fees) → only for new admissions
    if (category === "enrollment") {
      return version === "new_admission";
    }

    // Transport → only if transport_required AND matching zone
    if (category === "transport") {
      if (!transportRequired) return false;
      if (!transportZone) return false;
      const expectedCode = TRANSPORT_ZONE_CODE[transportZone];
      return code === expectedCode;
    }

    // Hostel / boarding
    if (category === "hostel") {
      if (studentType === "day_scholar") return false;

      // Day boarder → only NB-DBA
      if (studentType === "day_boarder" || studentType === "day boarder") {
        return code === DAY_BOARDING_CODE;
      }

      // Boarder → matching hostel code OR security deposit
      if (studentType === "boarder") {
        if (code === SECURITY_DEPOSIT_CODE) return true;
        if (!hostelType) return false;
        const expectedCode = HOSTEL_TYPE_CODE[hostelType];
        return code === expectedCode;
      }

      return false;
    }

    // Other categories (lab, library, other) → always include
    return true;
  });

  // 5. Compute due dates
  // Determine the academic year from session or default to current year
  const now = new Date();
  const academicYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  // 6. If force_reprovision, delete existing unpaid entries
  if (forceReprovision) {
    await db
      .from("fee_ledger")
      .delete()
      .eq("student_id", studentId)
      .eq("paid_amount", 0);
  }

  // 7. Build ledger rows
  const rows = filtered.map((item: any) => {
    const term = item.term;
    let dueDate = quarterDueDate(term, academicYear);

    // For non-quarter terms (registration, admission), due immediately
    if (!dueDate) {
      dueDate = `${academicYear}-04-01`;
    }

    return {
      student_id: studentId,
      fee_code_id: item.fee_code_id,
      fee_structure_item_id: item.id,
      term: term,
      total_amount: Number(item.amount),
      paid_amount: 0,
      concession: 0,
      due_date: dueDate,
      status: "due",
    };
  });

  if (rows.length === 0) return 0;

  // 7a. Apply approved offer waivers (year-wise) to matching ledger rows.
  // Each waiver is keyed by term ('year_1', 'year_2', ...). If the fee
  // structure has a row with the exact same term, the waiver lands there.
  // If multiple rows share the term, the waiver is distributed proportionally
  // by total_amount so no single line item ends up with a negative balance.
  if (student.lead_id) {
    const { data: latestOffer } = await db
      .from("offer_letters")
      .select("id")
      .eq("lead_id", student.lead_id)
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestOffer?.id) {
      const { data: waiverRows } = await db
        .from("offer_waivers")
        .select("term, amount")
        .eq("offer_letter_id", latestOffer.id)
        .eq("status", "approved");

      const waivers = (waiverRows || []) as { term: string; amount: number }[];
      // Sum waivers per term in case there are multiple approved waivers for the same year.
      const waiverByTerm = new Map<string, number>();
      for (const w of waivers) {
        waiverByTerm.set(w.term, (waiverByTerm.get(w.term) || 0) + Number(w.amount || 0));
      }

      for (const [term, totalWaiver] of waiverByTerm) {
        const matching = rows.filter((r: any) => r.term === term && r.total_amount > 0);
        if (matching.length === 0) {
          console.warn(`[provision-student-fees] Waiver for term '${term}' (₹${totalWaiver}) has no matching ledger rows for student ${studentId}; skipping.`);
          continue;
        }
        const sumTotal = matching.reduce((s: number, r: any) => s + Number(r.total_amount), 0);
        if (sumTotal <= 0) continue;

        // Cap the waiver at the matching rows' combined total so concession
        // never exceeds total_amount on any row.
        const cappedWaiver = Math.min(totalWaiver, sumTotal);

        let allocated = 0;
        for (let i = 0; i < matching.length; i++) {
          const isLast = i === matching.length - 1;
          // Round per-row, then put any rounding remainder onto the last row
          // so concession sums match cappedWaiver exactly.
          const share = isLast
            ? cappedWaiver - allocated
            : Math.round((Number(matching[i].total_amount) / sumTotal) * cappedWaiver);
          matching[i].concession = (matching[i].concession || 0) + share;
          allocated += share;
        }
      }
    }
  }

  // 8. Insert, skipping duplicates (same student + fee_code + term)
  // Fetch existing entries with paid_amount so we can compute how much token
  // credit is already applied when doing a partial provision (e.g. adding year_3
  // after year_1 and year_2 already exist).
  const { data: existingFull } = await db
    .from("fee_ledger")
    .select("fee_code_id, term, paid_amount")
    .eq("student_id", studentId);

  const existingSet = new Set(
    (existingFull || []).map((e: any) => `${e.fee_code_id}::${e.term}`)
  );

  const newRows = rows.filter(
    (r: any) => !existingSet.has(`${r.fee_code_id}::${r.term}`)
  );

  // 8a. Credit confirmed token payments to new year_N rows sequentially.
  // Rule: apply token to Year-1 first; any remainder goes to Year-2, then Year-3, etc.
  // This handles the case where the token floor (₹5,000) exceeds the net Year-1
  // balance after waivers — excess rolls forward rather than sitting unallocated.
  if (student.lead_id && newRows.length > 0) {
    const { data: toks } = await db
      .from("lead_payments")
      .select("amount")
      .eq("lead_id", student.lead_id)
      .eq("type", "token_fee")
      .eq("status", "confirmed");

    const totalToken = (toks || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

    if (totalToken > 0) {
      // Sum paid_amount already in existing year_N rows so we don't double-credit
      // when this is a partial provision run (adding later years to an existing student).
      const alreadyCredited = (existingFull || [])
        .filter((r: any) => /^year_\d+$/.test(r.term))
        .reduce((s: number, r: any) => s + Number(r.paid_amount || 0), 0);

      let remaining = Math.max(0, totalToken - alreadyCredited);

      // Apply to the new year_N rows in ascending term order.
      const newYearRows = newRows
        .filter((r: any) => /^year_\d+$/.test(r.term))
        .sort((a: any, b: any) => a.term.localeCompare(b.term));

      for (const row of newYearRows) {
        if (remaining <= 0) break;
        const netDue = Math.max(0, Number(row.total_amount) - Number(row.concession || 0));
        if (netDue <= 0) continue;
        const credit = Math.min(remaining, netDue);
        row.paid_amount = credit;
        if (credit >= netDue) row.status = "paid";
        remaining -= credit;
      }
    }
  }

  if (newRows.length === 0) return 0;

  // Try insert with fee_structure_item_id; if column doesn't exist yet, retry without it
  let { error: insertErr } = await db.from("fee_ledger").insert(newRows);
  if (insertErr && insertErr.message?.includes("fee_structure_item_id")) {
    console.warn("fee_structure_item_id column not found, retrying without it");
    const fallbackRows = newRows.map(({ fee_structure_item_id, ...rest }: any) => rest);
    const res = await db.from("fee_ledger").insert(fallbackRows);
    insertErr = res.error;
  }
  if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

  return newRows.length;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
