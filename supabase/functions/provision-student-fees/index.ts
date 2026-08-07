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

/** Stetho Batch stores semester rows as year_1..year_5 for compatibility. */
function stethoSemesterDueDate(term: string, year: number, day: number): string | null {
  const safeDay = Math.min(Math.max(day || 10, 1), 28);
  const map: Record<string, { yearOffset: number; month: string }> = {
    year_1: { yearOffset: 0, month: "04" },
    year_2: { yearOffset: 0, month: "10" },
    year_3: { yearOffset: 1, month: "04" },
    year_4: { yearOffset: 1, month: "10" },
    year_5: { yearOffset: 2, month: "04" },
  };
  const spec = map[term];
  if (!spec) return null;
  return `${year + spec.yearOffset}-${spec.month}-${String(safeDay).padStart(2, "0")}`;
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
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, "");

    // Accept service-role tokens directly (used by the
    // trg_auto_provision_fees_on_admission trigger via pg_net). Decode the
    // JWT payload — string equality covers both legacy + sb_secret formats.
    let isServiceRole = token === serviceRoleKey;
    if (!isServiceRole) {
      try {
        const [, payloadB64] = token.split(".");
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") isServiceRole = true;
        }
      } catch { /* not a JWT, fall through */ }
    }

    if (!isServiceRole) {
      const { data: { user }, error: authError } = await db.auth.getUser(token);
      if (authError || !user) {
        return json({ error: `Auth failed: ${authError?.message || "no user"}` }, 401);
      }
      const { data: roleRows } = await db
        .from("user_roles").select("role").eq("user_id", user.id).limit(1);
      const callerRole = roleRows?.[0]?.role;
      const allowed = ["super_admin", "campus_admin", "principal", "accountant", "admission_head", "counsellor"];
      if (!callerRole || !allowed.includes(String(callerRole))) {
        return json({ error: `Forbidden: your role is "${callerRole || "unknown"}"` }, 403);
      }
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
    .select("id, lead_id, course_id, student_type, transport_required, transport_zone, hostel_type, fee_structure_version, session_id, admission_date")
    .eq("id", studentId)
    .single();

  if (sErr || !student) throw new Error(`Student not found: ${studentId}`);
  if (!student.course_id) throw new Error("Student has no course_id");

  // Resolve a missing academic session instead of throwing. session_id is copied
  // verbatim from leads.session_id, which stays null unless an offer letter was
  // approved carrying a session — so higher-ed students reach PAN/AN with a null
  // session and their ledger never provisions (and the 25% admission-number chain
  // silently stalls). Fall back to the admission_session whose date range covers
  // the student's admission date (today if unset), and persist it so downstream
  // consumers (late-fee recompute joins, UI) also see a real session.
  if (!student.session_id) {
    const anchor = student.admission_date || new Date().toISOString().slice(0, 10);
    const { data: sess } = await db
      .from("admission_sessions")
      .select("id")
      .lte("start_date", anchor)
      .gte("end_date", anchor)
      .order("is_active", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sess) {
      throw new Error(`Student has no session_id and no admission_session covers ${anchor}`);
    }
    await db.from("students").update({ session_id: sess.id }).eq("id", studentId);
    student.session_id = sess.id;
  }

  const version = student.fee_structure_version || "new_admission";

  // 2. Find matching fee_structure. Try exact-version match first; fall back
  // to any active structure for the course+session if no version match
  // exists (institutions that seeded a single "standard" fee_structure
  // shouldn't error on students whose version is null/new_admission).
  const { data: fsRows, error: fsErr } = await db
    .from("fee_structures")
    .select("id, version")
    .eq("course_id", student.course_id)
    .eq("session_id", student.session_id)
    .eq("is_active", true);

  if (fsErr) throw new Error(`Failed to look up fee_structure: ${fsErr.message}`);
  if (!fsRows || fsRows.length === 0) {
    throw new Error(`No active fee structure for course=${student.course_id}, session=${student.session_id}`);
  }

  const feeStructure =
    fsRows.find((r: any) => r.version === version) ||
    fsRows.find((r: any) => r.version === "standard") ||
    fsRows[0];
  const appliedVersion = feeStructure.version || version;

  // 3. Fetch fee_structure_items with fee_codes
  const { data: items } = await db
    .from("fee_structure_items")
    .select("id, fee_code_id, term, amount, due_day, due_month, due_year_offset, due_date, late_fee_config, fee_codes:fee_code_id(code, name, category)")
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

    // Enrollment (registration, admission/seat-block fees) → only for new admissions
    // or explicit batch structures that include their own enrollment component.
    if (category === "enrollment") {
      return appliedVersion === "new_admission" || appliedVersion === "stetho_batch";
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
    const dueDay = Math.min(Math.max(Number(item.due_day || 10), 1), 28);
    let dueDate: string | null = null;

    // 0. Absolute per-head due date (precise dd-mm-yyyy) wins — late fines run on this.
    if (item.due_date) {
      dueDate = String(item.due_date).slice(0, 10);
    }
    // 1. Explicit per-head config (course-wise due date): month + year offset.
    if (!dueDate && item.due_month) {
      const y = academicYear + Number(item.due_year_offset || 0);
      dueDate = `${y}-${String(item.due_month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
    }
    // 2. Stetho semester / quarter maps.
    if (!dueDate) {
      dueDate = feeStructure.version === "stetho_batch"
        ? stethoSemesterDueDate(term, academicYear, dueDay)
        : quarterDueDate(term, academicYear);
    }
    // 3. year_N stagger (year_1 = admission year, year_2 = +1yr…) — matches the SQL path
    //    so multi-year heads never collide on one date.
    if (!dueDate) {
      const ym = term.match(/^year_([1-9])$/);
      if (ym) dueDate = `${academicYear + (Number(ym[1]) - 1)}-04-${String(dueDay).padStart(2, "0")}`;
    }
    // 4. Fallback: due at session start.
    if (!dueDate) {
      dueDate = `${academicYear}-04-01`;
    }

    return {
      student_id: studentId,
      fee_code_id: item.fee_code_id,
      fee_structure_item_id: item.id,
      fee_code_code: item.fee_codes?.code || "",
      fee_code_name: item.fee_codes?.name || "",
      term: term,
      total_amount: Number(item.amount),
      paid_amount: 0,
      concession: 0,
      due_date: dueDate,
      status: "due",
      late_fee_config: item.late_fee_config ?? null,
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
        let matching = rows.filter((r: any) => r.term === term && r.total_amount > 0);
        // ponytail: alias for known term mismatches between offer waivers and fee structures
        if (matching.length === 0 && term === "security_deposit") {
          matching = rows.filter((r: any) => /^NB-SEC$/i.test(r.fee_code_code || "") && r.total_amount > 0);
        }
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
  // Every rupee credited here is attributed to the payment that funded it and
  // written to fee_ledger_payments after the insert. Without that link the
  // credit is invisible to any reconciliation: it was exactly this blind spot
  // that let one token payment get counted twice (once here at insert, once by
  // the then-unguarded SQL provisioner) and sit undetected for months.
  const creditLinks: { rowKey: string; lead_payment_id: string; amount: number }[] = [];
  const rowKeyOf = (r: any) => `${r.fee_code_id}::${r.term}`;

  // Draws `amount` from the payment queue, recording who funded what.
  const drawFrom = (
    queue: { id: string; remaining: number }[],
    row: any,
    amount: number,
  ) => {
    let left = amount;
    for (const p of queue) {
      if (left <= 0) break;
      if (p.remaining <= 0) continue;
      const take = Math.min(p.remaining, left);
      p.remaining -= take;
      left -= take;
      creditLinks.push({ rowKey: rowKeyOf(row), lead_payment_id: p.id, amount: take });
    }
  };

  if (student.lead_id && newRows.length > 0) {
    const { data: appPayments } = await db
      .from("lead_payments")
      .select("id, amount")
      .eq("lead_id", student.lead_id)
      .eq("type", "application_fee")
      .eq("status", "confirmed")
      .order("created_at");

    const appQueue = (appPayments || []).map((p: any) => ({ id: p.id, remaining: Number(p.amount || 0) }));
    let remainingApplicationCredit = appQueue.reduce((s, p) => s + p.remaining, 0);

    if (remainingApplicationCredit > 0) {
      const newSeatRows = newRows
        .filter((r: any) => r.term === "year_1" && /SEAT|BLOCK/i.test(`${r.fee_code_code || ""} ${r.fee_code_name || ""}`))
        .sort((a: any, b: any) => String(a.fee_code_code || "").localeCompare(String(b.fee_code_code || "")));

      for (const row of newSeatRows) {
        if (remainingApplicationCredit <= 0) break;
        const netDue = Math.max(
          0,
          Number(row.total_amount) - Number(row.concession || 0) - Number(row.paid_amount || 0),
        );
        if (netDue <= 0) continue;
        const credit = Math.min(remainingApplicationCredit, netDue);
        row.paid_amount = Number(row.paid_amount || 0) + credit;
        if (row.paid_amount >= Number(row.total_amount) - Number(row.concession || 0)) row.status = "paid";
        remainingApplicationCredit -= credit;
        drawFrom(appQueue, row, credit);
      }
    }

    const { data: toks } = await db
      .from("lead_payments")
      .select("id, amount")
      .eq("lead_id", student.lead_id)
      .eq("type", "token_fee")
      .eq("status", "confirmed")
      .order("created_at");

    const tokenQueue = (toks || []).map((p: any) => ({ id: p.id, remaining: Number(p.amount || 0) }));
    const totalToken = tokenQueue.reduce((s, p) => s + p.remaining, 0);

    if (totalToken > 0) {
      // Sum paid_amount already in existing year_N rows so we don't double-credit
      // when this is a partial provision run (adding later years to an existing student).
      const alreadyCredited = (existingFull || [])
        .filter((r: any) => /^year_\d+$/.test(r.term))
        .reduce((s: number, r: any) => s + Number(r.paid_amount || 0), 0);

      let remaining = Math.max(0, totalToken - alreadyCredited);

      // Token already credited on an earlier run belongs to the head of the
      // queue, so drain it (no links — those were written then) and attribute
      // only what this run actually places.
      let toDrain = Math.min(alreadyCredited, totalToken);
      for (const p of tokenQueue) {
        if (toDrain <= 0) break;
        const take = Math.min(p.remaining, toDrain);
        p.remaining -= take;
        toDrain -= take;
      }

      // Apply to the new year_N rows in ascending term order.
      const newYearRows = newRows
        .filter((r: any) => /^year_\d+$/.test(r.term))
        .sort((a: any, b: any) => a.term.localeCompare(b.term));

      for (const row of newYearRows) {
        if (remaining <= 0) break;
        const netDue = Math.max(
          0,
          Number(row.total_amount) - Number(row.concession || 0) - Number(row.paid_amount || 0),
        );
        if (netDue <= 0) continue;
        const credit = Math.min(remaining, netDue);
        row.paid_amount = Number(row.paid_amount || 0) + credit;
        if (row.paid_amount >= Number(row.total_amount) - Number(row.concession || 0)) row.status = "paid";
        remaining -= credit;
        drawFrom(tokenQueue, row, credit);
      }
    }
  }

  if (newRows.length === 0) return 0;

  // Try insert with fee_structure_item_id; if column doesn't exist yet, retry without it
  const insertRows = newRows.map(({ fee_code_code, fee_code_name, ...row }: any) => row);
  const LINK_COLS = "id, fee_code_id, term";
  let { data: inserted, error: insertErr } = await db
    .from("fee_ledger").insert(insertRows).select(LINK_COLS);
  if (insertErr && insertErr.message?.includes("fee_structure_item_id")) {
    console.warn("fee_structure_item_id column not found, retrying without it");
    const fallbackRows = insertRows.map(({ fee_structure_item_id, ...rest }: any) => rest);
    const res = await db.from("fee_ledger").insert(fallbackRows).select(LINK_COLS);
    inserted = res.data;
    insertErr = res.error;
  }
  if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

  // Receipts for the credit applied above. paid_amount without a link row is
  // money the ledger cannot account for, so this is not optional bookkeeping —
  // it is what makes over-crediting detectable.
  if (creditLinks.length > 0) {
    const idByKey = new Map<string, string>(
      (inserted || []).map((r: any) => [`${r.fee_code_id}::${r.term}`, r.id]),
    );
    const linkRows: Record<string, unknown>[] = [];
    for (const l of creditLinks) {
      const ledgerId = idByKey.get(l.rowKey);
      if (!ledgerId || l.amount <= 0) continue;
      linkRows.push({
        fee_ledger_id: ledgerId,
        lead_payment_id: l.lead_payment_id,
        amount: l.amount,
        concession_amount: 0,
      });
    }

    if (linkRows.length > 0) {
      const { error: linkErr } = await db.from("fee_ledger_payments").insert(linkRows as never);
      // Never fail provisioning over the audit row, but make the gap loud:
      // the reconciliation view will show it as unlinked credit.
      if (linkErr) console.error("[provision] fee_ledger_payments link insert failed:", linkErr.message);
    }
  }

  // Canonical reconciliation: the SQL function sync_fee_ledger_concessions is
  // the single source of truth for how approved offer waivers (and manual
  // concessions) map onto the ledger. The inline waiver pass above set an
  // initial concession so token-credit could compute a post-waiver net; this
  // call then re-derives the exact concessions from the approved waivers so
  // provisioning and later waiver edits (via the offer_waivers trigger) always
  // agree — no need to re-provision to pick up a waiver.
  const { error: syncErr } = await db.rpc("sync_fee_ledger_concessions", { p_student_id: studentId });
  if (syncErr) console.warn(`[provision-student-fees] concession sync failed for ${studentId}: ${syncErr.message}`);

  return newRows.length;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
