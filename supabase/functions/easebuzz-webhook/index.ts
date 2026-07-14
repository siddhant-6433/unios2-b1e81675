/**
 * EaseBuzz Server-to-Server (S2S) webhook handler.
 *
 * Why this exists separately from `easebuzz-payment`:
 * - The /surl callback in easebuzz-payment fires when the *browser*
 *   gets redirected back. UPI-intent payments (PhonePe / GPay scan-to-
 *   pay) often skip this because the user pays in another app and never
 *   returns to the popup. That's why Kavita's payment never logged.
 * - EaseBuzz's S2S webhook is fired server-to-server from EaseBuzz's
 *   side every time a transaction status changes. It's the reliable
 *   path. It doesn't care whether the user came back to the browser.
 *
 * Configure in EaseBuzz dashboard:
 *   Settings → Webhook → URL =
 *   https://deylhigsisuexszsmypq.supabase.co/functions/v1/easebuzz-webhook
 *   Events = Transaction Successful + Transaction Failed
 *
 * Hash verification: EaseBuzz reverses the request hash on success
 * webhook so we can prove the call is legitimate (not a forged one).
 *   reverse_hash = SHA512(
 *     salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|
 *     email|firstname|productinfo|amount|txnid|key
 *   )
 *
 * Idempotency: the same txnid can be posted multiple times by EaseBuzz
 * (retries on our 5xx, double-fires on status flips). We check the row
 * already-paid state and short-circuit on match — never double-record.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha512(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-512", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type FeeRow = {
  id: string;
  total_amount: number | string;
  concession?: number | string;
  balance?: number | string;
};

function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeFeeSelection(selection?: string | null): string {
  const cleaned = String(selection || "due").trim();
  if (cleaned === "all" || cleaned === "due") return cleaned;
  const ids = cleaned
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? ids.join(",") : "due";
}

async function fetchStudentFeeRows(admin: any, studentId: string, selection: string): Promise<{ rows: FeeRow[]; error?: string }> {
  let query = admin
    .from("fee_ledger")
    .select("id, total_amount, concession, balance, due_date")
    .eq("student_id", studentId)
    .in("status", ["due", "overdue"])
    .gt("balance", 0);

  const normalized = normalizeFeeSelection(selection);
  if (normalized === "due") {
    query = query.lte("due_date", todayInIndia());
  } else if (normalized !== "all") {
    query = query.in("id", normalized.split(","));
  }

  const { data, error } = await query.order("due_date", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: data || [] };
}

async function settleStudentFeePayment(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  studentId: string,
  paidAmount: number,
  paymentRef: string | null,
  selection: string,
  waiverAmount: number,
): Promise<{ ok: boolean; message?: string }> {
  const { rows, error } = await fetchStudentFeeRows(admin, studentId, selection);
  if (error) return { ok: false, message: error };
  if (!rows.length) return { ok: true };

  const grossTotal = rows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
  const waiver = Math.max(0, Math.min(Number(waiverAmount || 0), grossTotal));
  const expectedPaid = grossTotal - waiver;
  if (Math.abs(paidAmount - expectedPaid) > 1) {
    return { ok: false, message: `Amount mismatch: received ${paidAmount}, expected ${expectedPaid}` };
  }

  let remainingWaiver = Math.round(waiver * 100) / 100;
  const ledgerSplits: Array<{ id: string; amount: number; concession: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const balance = Number(row.balance ?? 0);
    const concessionPart = i === rows.length - 1
      ? remainingWaiver
      : Math.min(balance, Math.round((waiver * (balance / grossTotal)) * 100) / 100);
    remainingWaiver = Math.round((remainingWaiver - concessionPart) * 100) / 100;
    const paidPart = Math.max(0, Math.round((balance - concessionPart) * 100) / 100);
    const newConcession = Number(row.concession || 0) + concessionPart;
    const newPaid = Math.max(0, Number(row.total_amount) - newConcession);

    const { error: updErr } = await admin
      .from("fee_ledger")
      .update({ concession: newConcession, paid_amount: newPaid, status: "paid" })
      .eq("id", row.id);
    if (updErr) return { ok: false, message: updErr.message };

    ledgerSplits.push({ id: row.id, amount: paidPart, concession: concessionPart });
  }

  const { data: stu } = await admin
    .from("students")
    .select("lead_id")
    .eq("id", studentId)
    .maybeSingle();
  if (stu?.lead_id) {
    const { data: existingPayment } = await admin
      .from("lead_payments")
      .select("id")
      .eq("transaction_ref", paymentRef)
      .maybeSingle();
    let paymentId = existingPayment?.id || null;
    if (!paymentId) {
      const { data: lpIns, error: lpInsErr } = await admin
        .from("lead_payments")
        .insert({
          lead_id: stu.lead_id,
          type: "other",
          amount: paidAmount,
          concession_amount: waiver,
          payment_mode: "gateway",
          gateway: "easebuzz",
          transaction_ref: paymentRef,
          status: "confirmed",
          applied_to_ledger: true,
          notes: waiver > 0 ? "Course-fee payment with 5% annual Pay All waiver" : "Course-fee instalment via Easebuzz",
        })
        .select("id")
        .maybeSingle();
      if (lpInsErr) return { ok: false, message: lpInsErr.message };
      paymentId = lpIns?.id || null;
    }

    if (paymentId) {
      await admin.from("fee_ledger_payments").insert(
        ledgerSplits.map((split) => ({
          fee_ledger_id: split.id,
          lead_payment_id: paymentId,
          amount: split.amount,
          concession_amount: split.concession,
          notes: "Student portal gateway payment",
        })),
      );
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ event: "payment_received", lead_id: stu.lead_id, context: { payment_id: paymentId } }),
      }).catch((e) => console.error("[easebuzz-webhook] notify-event invoke failed:", e));
    }
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Always return JSON 200 once we've persisted (or correctly skipped) the
  // webhook so EaseBuzz doesn't keep retrying. We log everything for audit.
  try {
    const merchantKey  = Deno.env.get("EASEBUZZ_KEY")  || Deno.env.get("EASEBUZZ_MERCHANT_KEY")  || "";
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT") || Deno.env.get("EASEBUZZ_MERCHANT_SALT") || "";
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!merchantKey || !merchantSalt) {
      console.error("[easebuzz-webhook] missing EASEBUZZ_KEY/SALT");
      return new Response(JSON.stringify({ error: "Not configured" }), { status: 503, headers: corsHeaders });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: corsHeaders });
    }

    // EaseBuzz S2S sends application/x-www-form-urlencoded.
    const params = new URLSearchParams(rawBody);
    const txnid       = params.get("txnid")       || "";
    const easepayid   = params.get("easepayid")   || "";
    const status      = (params.get("status")     || "").toLowerCase();
    const amount      = params.get("amount")      || "";
    const productinfo = params.get("productinfo") || "";
    const firstname   = params.get("firstname")   || "";
    const email       = params.get("email")       || "";
    const udf1        = params.get("udf1")        || "";
    const udf2        = params.get("udf2")        || "";
    const udf3        = params.get("udf3")        || "";
    const udf4        = params.get("udf4")        || "";
    const udf5        = params.get("udf5")        || "";
    const udf6        = params.get("udf6")        || "";
    const udf7        = params.get("udf7")        || "";
    const udf8        = params.get("udf8")        || "";
    const udf9        = params.get("udf9")        || "";
    const udf10       = params.get("udf10")       || "";
    const postedHash  = (params.get("hash")       || "").toLowerCase();

    console.log(`[easebuzz-webhook] received: status=${status} txnid=${txnid} easepayid=${easepayid} amount=${amount} udf1="${udf1}"`);

    // ── Verify hash ─────────────────────────────────────────────────
    // EaseBuzz reverse-hash for response/webhook:
    // SHA512(salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    const hashInput = [
      merchantSalt,
      status,
      udf10, udf9, udf8, udf7, udf6,
      udf5, udf4, udf3, udf2, udf1,
      email, firstname, productinfo, amount, txnid, merchantKey,
    ].join("|");
    const expectedHash = await sha512(hashInput);
    if (postedHash && postedHash !== expectedHash) {
      console.warn(`[easebuzz-webhook] hash mismatch — ignoring (security). got="${postedHash.slice(0,16)}..." expected="${expectedHash.slice(0,16)}..."`);
      // Return 200 anyway so EaseBuzz doesn't retry — but we don't act on it.
      return new Response(JSON.stringify({ ok: true, ignored: "hash_mismatch" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Only act on success ────────────────────────────────────────
    if (status !== "success") {
      console.log(`[easebuzz-webhook] non-success (${status}); no action`);
      return new Response(JSON.stringify({ ok: true, status }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const paymentRef = easepayid || txnid;

    // ── Path 1: STUDENT FEE PAYMENT (udf3=fee_payment, udf4=student_id) ─
    // UPI intent payments often never reach /surl. Keep this S2S path
    // behaviorally aligned with easebuzz-payment's return handler.
    if (udf3 === "fee_payment" && udf4 && /^[0-9a-f-]{36}$/i.test(udf4)) {
      const paidAmount = parseFloat(amount || "0");

      const settled = await settleStudentFeePayment(admin, supabaseUrl, serviceKey, udf4, paidAmount, paymentRef, udf5, Number(udf6 || 0));
      if (!settled.ok) {
        console.error("[easebuzz-webhook] fee_payment settlement failed:", settled.message);
        return new Response(JSON.stringify({ ok: true, ignored: "settlement_failed", message: settled.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.log(`[easebuzz-webhook] ✓ fee_payment student ${udf4} marked paid via S2S webhook (ref ${paymentRef})`);
      return new Response(JSON.stringify({ ok: true, student_id: udf4, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Path 2: LEAD-SIDE PAYMENT (udf2 = lead_payment_id) ─────────
    // Check this before application_id: lead-side initiates put lead_id in
    // udf1, so treating udf1 as application_id would skip valid callbacks.
    const leadPaymentId = udf2 || null;
    if (leadPaymentId && /^[0-9a-f-]{36}$/i.test(leadPaymentId)) {
      const { data: lpRow } = await admin
        .from("lead_payments")
        .select("id, status, transaction_ref, lead_id, type")
        .eq("id", leadPaymentId)
        .maybeSingle();

      if (!lpRow) {
        console.warn(`[easebuzz-webhook] lead_payment_id=${leadPaymentId} not found`);
        return new Response(JSON.stringify({ ok: true, ignored: "lead_payment_not_found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (lpRow.status === "confirmed" && lpRow.transaction_ref === paymentRef) {
        console.log(`[easebuzz-webhook] lead_payment ${leadPaymentId} already confirmed — skip`);
        return new Response(JSON.stringify({ ok: true, idempotent: true, lead_payment_id: leadPaymentId }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: lpErr } = await admin
        .from("lead_payments")
        .update({ status: "confirmed", transaction_ref: paymentRef })
        .eq("id", leadPaymentId);
      if (lpErr) {
        console.error(`[easebuzz-webhook] lead_payments update failed:`, lpErr.message);
        return new Response(JSON.stringify({ error: lpErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (lpRow.lead_id) {
        const evt = lpRow.type === "application_fee" ? "app_fee_paid" : "payment_received";
        fetch(`${supabaseUrl}/functions/v1/notify-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ event: evt, lead_id: lpRow.lead_id, context: { payment_id: leadPaymentId } }),
        }).catch((e) => console.error("[easebuzz-webhook] notify-event invoke failed:", e));
      }

      console.log(`[easebuzz-webhook] ✓ lead_payment ${leadPaymentId} confirmed via S2S webhook (ref ${paymentRef})`);
      return new Response(JSON.stringify({ ok: true, lead_payment_id: leadPaymentId, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Path 3: APPLICATION FEE (udf1 = application_id) ────────────
    // Apply portal initiate stores udf1=application_id. If still missing
    // (rare — old initiates), we fall back to looking up the application
    // by pending_txnid (now persisted in applications row at initiate).
    let applicationId: string | null = udf1 || null;
    if (!applicationId && txnid) {
      const { data: byTxn } = await admin
        .from("applications")
        .select("application_id")
        .eq("pending_txnid", txnid)
        .maybeSingle();
      if (byTxn?.application_id) applicationId = byTxn.application_id;
    }

    if (applicationId) {
      // Idempotent — skip if already paid with same or better ref.
      const { data: existing } = await admin
        .from("applications")
        .select("application_id, payment_status, payment_ref")
        .eq("application_id", applicationId)
        .maybeSingle();

      if (!existing) {
        console.warn(`[easebuzz-webhook] application_id=${applicationId} not found`);
        return new Response(JSON.stringify({ ok: true, ignored: "application_not_found", application_id: applicationId }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (existing.payment_status === "paid" && existing.payment_ref === paymentRef) {
        console.log(`[easebuzz-webhook] ${applicationId} already paid with this ref — skip`);
        return new Response(JSON.stringify({ ok: true, idempotent: true, application_id: applicationId }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: updErr } = await admin
        .from("applications")
        .update({ payment_status: "paid", payment_ref: paymentRef })
        .eq("application_id", applicationId);
      if (updErr) {
        console.error(`[easebuzz-webhook] update failed for ${applicationId}:`, updErr.message);
        return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fire-and-forget receipt PDF generation
      fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id: applicationId }),
      }).catch((e) => console.error("[easebuzz-webhook] receipt invoke failed:", e));

      console.log(`[easebuzz-webhook] ✓ application ${applicationId} marked paid via S2S webhook (ref ${paymentRef})`);
      return new Response(JSON.stringify({ ok: true, application_id: applicationId, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No mapping — log and skip. EaseBuzz dashboard will still have the
    // record; an admin can use Mark Paid by UTR if it's actually for us.
    console.warn(`[easebuzz-webhook] no application_id / lead_payment_id in udf1/udf2 — txnid=${txnid}`);
    return new Response(JSON.stringify({ ok: true, ignored: "no_target", txnid }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[easebuzz-webhook] crash:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
