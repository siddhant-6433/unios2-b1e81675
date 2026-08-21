import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  settleApplicationFee,
  settleLeadPaymentRow,
  settlePaymentLink,
  settleStudentFeePayment,
} from "../_shared/gateway-settlement.ts";
import { isServiceCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function easebuzzAmount(txn: any): number {
  return Number(txn?.amount ?? txn?.total_debit_amount ?? txn?.net_debit_amount ?? 0);
}

/**
 * Pull EaseBuzz's own transaction list for the last N days.
 *
 * Endpoint contract (verified against EaseBuzz Java SDK, and the only
 * EaseBuzz read API observed working in production):
 *   POST https://dashboard.easebuzz.in/transaction/v2/retrieve/date
 *   Body: { key, merchant_email, hash, date_range:{start_date,end_date} }
 *   Hash: SHA512(merchant_key|merchant_email|start_date|end_date|salt)
 *   Response: { status, data: [ {txnid, easepayid, amount, status, udf1..}, ], next }
 *
 * The date format EaseBuzz accepts is inconsistent across SDK versions, so we
 * try each candidate shape until one returns rows. Pagination is ~20 rows per
 * page via a top-level base64 `next` cursor — following it is mandatory or a
 * success sitting on page 2 is invisible while a userCancelled retry on page 1
 * gets reported instead.
 */
async function fetchEasebuzzTxnsByDate(opts: {
  merchantKey: string;
  merchantSalt: string;
  merchantEmail: string;
  dashboardBase: string;
  daysBack: number;
  maxPages?: number;
}): Promise<{ rows: any[]; attempts: any[]; chosen: string | null; firstParsed: any; window: { start_iso: string; end_iso: string; days_back: number } }> {
  const fmtIso = (d: Date) => d.toISOString().slice(0, 10);                       // YYYY-MM-DD
  const fmtDmy = (d: Date) => { const s = d.toISOString().slice(0, 10).split("-"); return `${s[2]}-${s[1]}-${s[0]}`; }; // DD-MM-YYYY
  const now = new Date();
  const from = new Date(Date.now() - opts.daysBack * 86400000);
  const endIso = fmtIso(now), startIso = fmtIso(from);
  const endDmy = fmtDmy(now), startDmy = fmtDmy(from);
  const { merchantKey, merchantSalt, merchantEmail, dashboardBase } = opts;
  const maxPages = opts.maxPages ?? 50;

  const candidates: Array<{ label: string; startDate: string; endDate: string; body: any }> = [
    { label: "v2_iso_daterange", startDate: startIso, endDate: endIso,
      body: { key: merchantKey, merchant_email: merchantEmail, date_range: { start_date: startIso, end_date: endIso } } },
    { label: "v2_dmy_daterange", startDate: startDmy, endDate: endDmy,
      body: { key: merchantKey, merchant_email: merchantEmail, date_range: { start_date: startDmy, end_date: endDmy } } },
    { label: "v2_iso_flat", startDate: startIso, endDate: endIso,
      body: { key: merchantKey, merchant_email: merchantEmail, start_date: startIso, end_date: endIso } },
  ];

  const attempts: any[] = [];
  const allRows: any[] = [];
  let chosen: string | null = null;
  let anyParsed: any = null;

  for (const c of candidates) {
    // Hash sequence per Java SDK: merchant_key|merchant_email|start_date|end_date|salt
    const reqHash = await sha512(`${merchantKey}|${merchantEmail}|${c.startDate}|${c.endDate}|${merchantSalt}`);
    let cursor: string | null = null;
    let pageNum = 0;
    let firstParsed: any = null;
    let totalRows = 0;
    let stopReason = "ok";
    while (pageNum < maxPages) {
      pageNum++;
      const payload: any = { ...c.body, hash: reqHash };
      if (cursor) payload.cursor = cursor;
      let httpStatus = 0; let raw = "";
      try {
        const ebRes = await fetch(`${dashboardBase}/transaction/v2/retrieve/date`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        httpStatus = ebRes.status;
        raw = await ebRes.text();
      } catch (e) {
        stopReason = `fetch_error:${String(e)}`;
        break;
      }
      let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = { _unparsed: raw.slice(0, 500) }; }
      if (pageNum === 1) firstParsed = parsed;
      if (httpStatus !== 200 || parsed?.status === false) { stopReason = `http_${httpStatus}_ebStatus_${parsed?.status}`; break; }
      const pageRows: any[] = Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.data?.transaction_details) ? parsed.data.transaction_details : [];
      totalRows += pageRows.length;
      allRows.push(...pageRows);
      cursor = parsed?.next || null;
      console.log(`[easebuzz] date-sweep attempt=${c.label} page=${pageNum} rows=${pageRows.length} next=${cursor ? "yes" : "no"}`);
      if (!cursor) { stopReason = "exhausted"; break; }
    }
    attempts.push({ label: c.label, pages: pageNum, total_rows: totalRows, stop: stopReason, sample: firstParsed });
    if (!anyParsed && firstParsed) anyParsed = firstParsed;
    if (totalRows > 0) { chosen = c.label; break; }
  }

  return {
    rows: allRows, attempts, chosen, firstParsed: anyParsed,
    window: { start_iso: startIso, end_iso: endIso, days_back: opts.daysBack },
  };
}

/**
 * Single-transaction lookup: POST /transaction/v2/retrieve, hash SHA512(key|txnid|salt).
 *
 * Which host serves this differs between EaseBuzz plans — `pay.easebuzz.in`
 * has been returning an HTML page (`<!DOCTYPE …`), which blew up as
 * "Unexpected token '<'" on every verify-payment call. Rather than guess,
 * try each host and take the first that answers with JSON.
 */
async function easebuzzRetrieveTxn(
  txnid: string,
  cfg: { merchantKey: string; merchantSalt: string; hosts: string[] },
): Promise<{ txn: any | null; error?: string; nonJson?: string; raw?: any }> {
  const hash = await sha512(`${cfg.merchantKey}|${txnid}|${cfg.merchantSalt}`);
  let lastNonJson: string | undefined;
  let lastError: string | undefined;
  for (const host of cfg.hosts) {
    let raw = "";
    try {
      const res = await fetch(`${host}/transaction/v2/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: cfg.merchantKey, txnid, hash }).toString(),
      });
      raw = await res.text();
    } catch (e) {
      lastError = String(e);
      continue;
    }
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      lastNonJson = raw.slice(0, 200);
      console.error(`[easebuzz] retrieve ${host} returned non-JSON: ${lastNonJson}`);
      continue;
    }
    if (parsed?.status === 1 || parsed?.status === true) {
      // dashboard.easebuzz.in returns the txn under `msg`; the PHP SDK's wrapper
      // documents `data`. Accept either — reading only `data` made every
      // successful lookup look like "no such transaction".
      const payload = parsed.msg ?? parsed.data;
      const txn = Array.isArray(payload) ? payload[0] : payload;
      // status:1 with an empty payload means "we have no such txnid", not success.
      if (txn && typeof txn === "object") return { txn, raw: parsed };
      return { txn: null, error: "eb_no_data", raw: parsed };
    }
    return { txn: null, error: parsed?.error_desc || parsed?.message || `eb_status_${parsed?.status}`, raw: parsed };
  }
  return { txn: null, error: lastError || "EaseBuzz retrieve returned no JSON from any host", nonJson: lastNonJson };
}

/** EaseBuzz statuses that mean "the money is ours". */
function isEasebuzzSuccess(txn: any): boolean {
  const st = String(txn?.status || txn?.txn_status || "").toLowerCase();
  return st === "success" || st === "settled" || st === "captured";
}

/** Bank/UPI reference (RRN) — the one id a human also sees on their statement. */
function easebuzzBankRef(txn: any): string | null {
  const raw = String(txn?.bank_ref_num ?? txn?.bank_ref_no ?? "").trim();
  if (!raw || raw.toUpperCase() === "NA") return null;
  return raw;
}

/**
 * Settle pending `lead_payments` rows against an EaseBuzz date sweep.
 *
 * Matching is on `txnid` — the merchant reference WE generated at initiate
 * (`LP<lead_payment_id first 8><epoch ms>`) and persisted on the row. That's an
 * exact key, unlike udf1 (which for lead payments is the lead id, not an
 * application id, which is why the UDF1 sweep could never match these rows).
 */
async function settleLeadPaymentsFromSweep(
  admin: any,
  rows: any[],
  opts: {
    supabaseUrl: string;
    serviceKey: string;
    lookbackDays: number;
    dryRun?: boolean;
    leadPaymentId?: string;
    /**
     * Per-txn fallback. The listing API has been observed returning a window
     * that doesn't contain our txns at all, so never trust "not in the sweep"
     * as "did not pay" — ask EaseBuzz about the specific txnid before giving up.
     */
    retrieve?: { merchantKey: string; merchantSalt: string; hosts: string[] };
  },
): Promise<{ scanned: number; settled: any[]; skipped: any[]; would_settle: any[] }> {
  const byTxnid = new Map<string, any>();
  for (const t of rows) {
    if (!isEasebuzzSuccess(t)) continue;
    const txnid = String(t?.txnid || "").trim();
    if (!txnid) continue;
    const existing = byTxnid.get(txnid);
    if (!existing) { byTxnid.set(txnid, t); continue; }
    const prev = new Date(existing?.addedon || existing?.transaction_date || 0).getTime();
    const curr = new Date(t?.addedon || t?.transaction_date || 0).getTime();
    if (curr > prev) byTxnid.set(txnid, t);
  }

  // +2 days of slack over the EaseBuzz window: a txn initiated just before
  // midnight can settle on the next calendar day.
  const since = new Date(Date.now() - (opts.lookbackDays + 2) * 86400000).toISOString();
  let q = admin
    .from("lead_payments")
    .select("id, amount, transaction_ref, lead_id, type, created_at")
    .eq("gateway", "easebuzz")
    .eq("status", "pending")
    .like("transaction_ref", "LP%")
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts.leadPaymentId) q = q.eq("id", opts.leadPaymentId);
  else q = q.gte("created_at", since);

  const { data: pending, error } = await q;
  if (error) throw new Error(`lead_payments query failed: ${error.message}`);

  const settled: any[] = [];
  const would_settle: any[] = [];
  const skipped: any[] = [];

  for (const row of pending || []) {
    const txnid = String(row.transaction_ref);
    let match = byTxnid.get(txnid);
    let matchedVia = "date_sweep";
    if (!match && opts.retrieve) {
      const r = await easebuzzRetrieveTxn(txnid, opts.retrieve);
      if (r.txn && isEasebuzzSuccess(r.txn)) { match = r.txn; matchedVia = "per_txn_retrieve"; }
      else if (!match) {
        skipped.push({ id: row.id, txnid, reason: "no_success_txn", eb_status: r.txn?.status || r.error || "not_found", eb_raw: JSON.stringify(r.raw ?? r.nonJson ?? null).slice(0, 300) });
        continue;
      }
    }
    if (!match) { skipped.push({ id: row.id, txnid, reason: "no_success_txn_in_window" }); continue; }

    // Never settle for an amount that doesn't match what we asked for.
    const got = easebuzzAmount(match);
    const expected = Number(row.amount || 0);
    if (expected > 0 && Math.abs(expected - got) > 0.01) {
      skipped.push({ id: row.id, txnid, reason: "amount_mismatch", expected, got });
      continue;
    }

    const easepayid = String(match?.easepayid || match?.mihpayid || txnid).trim();
    const bankRef = easebuzzBankRef(match);

    // Duplicate guard: the same money may already have been keyed in by hand
    // as an offline payment. Flag it for a human instead of minting a second
    // receipt. `bank_ref_num` is the operator-visible RRN, so it's the field a
    // manual entry is most likely to carry.
    const dupOr = [
      `transaction_ref.eq.${easepayid}`,
      ...(bankRef ? [`bank_ref_num.eq.${bankRef}`, `transaction_ref.eq.${bankRef}`] : []),
    ].join(",");
    const { data: dup } = await admin
      .from("lead_payments")
      .select("id, receipt_no, gateway, transaction_ref")
      .eq("status", "confirmed")
      .neq("id", row.id)
      .or(dupOr)
      .limit(1)
      .maybeSingle();
    if (dup?.id) {
      skipped.push({ id: row.id, txnid, reason: "duplicate_of_existing_receipt", other_payment: dup.id, other_receipt: dup.receipt_no });
      continue;
    }

    if (opts.dryRun) {
      would_settle.push({ id: row.id, lead_id: row.lead_id, txnid, easepayid, bank_ref_num: bankRef, amount: got, matched_via: matchedVia });
      continue;
    }

    const result = await settleLeadPaymentRow(admin, row.id, easepayid, {
      gateway: "easebuzz",
      claimId: easepayid,
      bankRefNum: bankRef,
      source: "reconcile",
      notify: true,
      supabaseUrl: opts.supabaseUrl,
      serviceKey: opts.serviceKey,
    });
    if (!result.ok) { skipped.push({ id: row.id, txnid, reason: "settle_failed", detail: result.message }); continue; }
    if (result.already) { skipped.push({ id: row.id, txnid, reason: "already_settled" }); continue; }
    settled.push({ id: row.id, lead_id: row.lead_id, txnid, easepayid, bank_ref_num: bankRef, amount: got, matched_via: matchedVia });
  }

  return { scanned: pending?.length ?? 0, settled, skipped, would_settle };
}

function returnPage(title: string, message: string, isSuccess: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: white; border-radius: 16px; padding: 40px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { margin: 0 0 8px; font-size: 18px; color: #0f172a; }
    p { margin: 0 0 24px; font-size: 14px; color: #64748b; }
    button { background: #6366f1; color: white; border: none; border-radius: 10px; padding: 10px 24px; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h2>${title}</h2>
    <p>${message}</p>
    <button onclick="window.close()">Close</button>
  </div>
  <script>
    // Notify parent window if same origin
    try { window.opener && window.opener.postMessage({ eb_payment: "${isSuccess ? "success" : "failed"}" }, "*"); } catch(e) {}
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

type FeeRow = {
  id: string;
  total_amount: number | string;
  paid_amount?: number | string;
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

function feeSelectionFromBody(scope: unknown, feeIds: unknown): string {
  const ids = Array.isArray(feeIds)
    ? feeIds.map((id) => String(id)).filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    : [];
  if (ids.length > 0) return ids.join(",");
  return normalizeFeeSelection(scope === "all" ? "all" : "due");
}

async function fetchStudentFeeRows(admin: any, studentId: string, selection: string): Promise<{ rows: FeeRow[]; error?: string }> {
  let query = admin
    .from("fee_ledger")
    .select("id, total_amount, paid_amount, concession, balance, due_date")
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

// Student fee settlement: shared claim-once helper (../_shared/gateway-settlement.ts).
// Never re-applies ledger for an existing capture.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const merchantKey  = Deno.env.get("EASEBUZZ_KEY");
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT");
    const ebEnv        = Deno.env.get("EASEBUZZ_ENV") || "production";
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!merchantKey || !merchantSalt) {
      return new Response(
        JSON.stringify({ error: "EaseBuzz credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = ebEnv === "test"
      ? "https://testpay.easebuzz.in"
      : "https://pay.easebuzz.in";

    // Single-txn retrieve is served by dashboard.* on our plan; pay.* answers
    // with an HTML page. Keep both and let easebuzzRetrieveTxn pick.
    const retrieveHosts = ebEnv === "test"
      ? ["https://testdashboard.easebuzz.in", "https://testpay.easebuzz.in"]
      : ["https://dashboard.easebuzz.in", "https://pay.easebuzz.in"];

    const rawBody = await req.text();
    const contentType = req.headers.get("content-type") || "";

    // ── EaseBuzz Return POST (surl / furl) ─────────────────────────
    // EaseBuzz posts form-encoded data back to our surl/furl
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);

      // Log ALL fields EaseBuzz sends so we can debug
      const allFields: Record<string, string> = {};
      params.forEach((v, k) => { allFields[k] = v; });
      console.log("[easebuzz] surl POST fields:", JSON.stringify(allFields));

      const status       = params.get("status") || "";
      const txnid        = params.get("txnid") || "";
      const applicationId = params.get("udf1") || "";
      const easepayid    = params.get("easepayid") || params.get("mihpayid") || "";
      const email        = params.get("email") || "";
      const firstname    = params.get("firstname") || "";
      const productinfo  = params.get("productinfo") || "";
      const amount       = params.get("amount") || "";
      const returnedHash = params.get("hash") || "";

      // Collect all udf values as EaseBuzz sends them (for accurate hash verification)
      const udf1  = params.get("udf1")  || "";
      const udf2  = params.get("udf2")  || "";
      const udf3  = params.get("udf3")  || "";
      const udf4  = params.get("udf4")  || "";
      const udf5  = params.get("udf5")  || "";
      const udf6  = params.get("udf6")  || "";
      const udf7  = params.get("udf7")  || "";
      const udf8  = params.get("udf8")  || "";
      const udf9  = params.get("udf9")  || "";
      const udf10 = params.get("udf10") || "";

      // Verify hash for audit logging (not used as gate — EaseBuzz hash docs vary by plan)
      const reverseInput = `${merchantSalt}|${status}|${udf10}|${udf9}|${udf8}|${udf7}|${udf6}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${merchantKey}`;
      const expectedHash = await sha512(reverseInput);
      const hashValid = expectedHash === returnedHash;

      console.log("[easebuzz] return parsed:", { status, txnid, applicationId, easepayid, hashValid });

      const isSuccess = status.toLowerCase() === "success";
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const paymentRef = easepayid || txnid || null;

      // udf3=payment_link + udf1=payment_links.id → staff payment link settlement
      if (udf3 === "payment_link" && udf1 && /^[0-9a-f-]{36}$/i.test(udf1)) {
        if (isSuccess && paymentRef) {
          const { data: plink } = await admin.from("payment_links").select("*").eq("id", udf1).maybeSingle();
          if (!plink) {
            return returnPage("Payment Received", "Payment confirmed but link not found. Contact support. Txn: " + (easepayid || txnid), false);
          }
          const settled = await settlePaymentLink(
            admin, supabaseUrl, serviceKey, plink, paymentRef, "easebuzz", "surl",
          );
          if (!settled.ok) {
            console.error("[easebuzz] payment_link settle failed:", settled.message);
            return returnPage("Payment Received", "Payment confirmed but records could not be updated. Contact support. Txn: " + (easepayid || txnid), false);
          }
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess ? "Your payment has been received. You may close this window." : `Payment could not be completed (status: ${status}). Please try again.`,
          isSuccess,
        );
      }

      // udf3="fee_payment" + udf4=student_id → student fee ledger payment
      if (udf3 === "fee_payment" && udf4 && /^[0-9a-f-]{36}$/i.test(udf4)) {
        if (isSuccess) {
          // SECURITY: reject if EaseBuzz hash is invalid (tampered callback)
          if (!hashValid) {
            console.error("[easebuzz] fee_payment: hash mismatch — rejecting callback for student", udf4);
            return returnPage("Payment Error", "Payment verification failed. Please contact support.", false);
          }

          const paidAmount = parseFloat(amount || "0");
          const settled = await settleStudentFeePayment(
            admin, supabaseUrl, serviceKey, udf4, paidAmount, paymentRef, udf5, Number(udf6 || 0), "easebuzz", "surl",
          );
          if (!settled.ok) {
            console.error("[easebuzz] fee_payment settlement failed:", settled.message);
            return returnPage("Payment Error", `${settled.message}. Transaction ID: ${easepayid || txnid}. Please contact support.`, false);
          }
          console.log("[easebuzz] fee_payment: settled selected entries for student", udf4, settled.already ? "(already)" : "");
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess ? "Your fee payment has been received. You may close this window." : `Payment could not be completed (status: ${status}). Please try again.`,
          isSuccess,
        );
      }

      // udf2 carries the pre-created lead_payments.id when this is a lead-side
      // payment (token_fee / application_fee for a lead). Update that row's
      // status — the AFTER trigger will then auto-advance the lead's stage and
      // issue PAN / AN as the threshold is crossed.
      if (udf2 && /^[0-9a-f-]{36}$/i.test(udf2)) {
        if (isSuccess && paymentRef) {
          // Claim-once: pending→confirmed only; never inserts a second row.
          const settled = await settleLeadPaymentRow(admin, udf2, paymentRef, {
            gateway: "easebuzz",
            bankRefNum: params.get("bank_ref_num"),
            source: "surl",
            notify: true,
            supabaseUrl,
            serviceKey,
          });
          if (!settled.ok) {
            console.error("[easebuzz] lead_payments settle error:", settled.message);
            return returnPage("Payment Received", "Payment confirmed but our records could not be updated. Please contact support. Txn: " + (easepayid || txnid), false);
          }
        }
        // failed → leave pending so user can retry
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess ? "Your payment has been received. The receipt has been emailed to you. You may close this window." : `Payment could not be completed (status: ${status}). Please try again.`,
          isSuccess,
        );
      }

      if (isSuccess) {
        if (!applicationId) {
          console.error("[easebuzz] missing udf1 (application_id) in return POST — fields:", JSON.stringify(allFields));
          return returnPage("Payment Received", "Payment received but could not be linked automatically. Please contact support with transaction ID: " + (easepayid || txnid), false);
        }
        if (!paymentRef) {
          return returnPage("Payment Received", "Payment confirmed but missing gateway reference. Please contact support.", false);
        }

        // At-most-once application fee claim (gateway_settlements + unpaid→paid).
        const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, applicationId, paymentRef, {
          gateway: "easebuzz",
          orderId: txnid || null,
          source: "surl",
          fireReceipt: true,
        });
        console.log("[easebuzz] application settle:", JSON.stringify(settled));

        if (!settled.ok) {
          console.error("[easebuzz] application settle error:", settled.message);
          return returnPage("Payment Received", "Payment confirmed but could not update your application automatically. Please contact support. Transaction ID: " + (easepayid || txnid), false);
        }

        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      console.log("[easebuzz] non-success status received:", status);
      return returnPage("Payment Failed", `Payment could not be completed (status: ${status}). Please go back and try again.`, false);
    }

    // ── JSON actions (called from our frontend) ────────────────────
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate Payment ───────────────────────────────────────────
    if (action === "initiate") {
      const { application_id, txnid, amount, productinfo, firstname, email, phone } = body;

      if (!txnid || !amount || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const amountStr  = parseFloat(amount).toFixed(2);
      const emailStr   = email || "noreply@nimteducation.com";
      const productStr = productinfo || "Application Fee";
      const udf1       = application_id || "";

      // Persist the txnid so the manual reconcile button can find the
      // exact transaction later (the apply portal generates txnid with a
      // Date.now() suffix; the reconcile button used to reconstruct it
      // without that suffix and always 404'd against EaseBuzz).
      if (application_id) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const { error: persistErr } = await admin
          .from("applications")
          .update({ pending_txnid: txnid })
          .eq("application_id", application_id);
        if (persistErr) {
          console.warn("[easebuzz] persist pending_txnid failed:", persistErr.message);
          // Non-fatal — continue with payment initiation
        }
      }

      // Hash: SHA512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      // udf1 = application_id, udf2-udf5 empty, then 6 more empty slots before salt
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|${udf1}||||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const selfUrl = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      const formData = new URLSearchParams({
        key:         merchantKey,
        txnid:       txnid,
        amount:      amountStr,
        productinfo: productStr,
        firstname:   firstname,
        email:       emailStr,
        phone:       phone.replace(/\D/g, "").slice(-10),
        hash:        hash,
        udf1:        udf1,
        udf2: "", udf3: "", udf4: "", udf5: "",
        surl:        selfUrl,
        furl:        selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate error:", data);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          txnid,
          pay_url: `${baseUrl}/pay/${data.data}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Initiate student fee payment ──────────────────────────────────────────
    if (action === "initiate-fee-payment") {
      const { student_id, txnid, productinfo, firstname, email, phone, payment_scope, fee_ids, waiver_amount } = body;
      // amount is intentionally NOT taken from the client — computed from DB to prevent underpayment attacks

      if (!student_id || !txnid || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields (student_id, txnid, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch actual outstanding balance from DB — never trust client-supplied amount
      const adminInit = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const feeSelection = feeSelectionFromBody(payment_scope, fee_ids);
      const waiver = Math.max(0, Number(waiver_amount || 0));
      const { rows: dueRows, error: dueErr } = await fetchStudentFeeRows(adminInit, student_id, feeSelection);

      if (dueErr || !dueRows?.length) {
        return new Response(
          JSON.stringify({ error: "No outstanding fees found for this student" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalDue   = dueRows.reduce((s: number, r: any) => s + Number(r.balance), 0);
      const amountStr  = Math.max(totalDue - Math.min(waiver, totalDue), 0).toFixed(2);
      const waiverStr  = String(Math.min(waiver, totalDue).toFixed(2));
      const emailStr   = email || "noreply@nimteducation.com";
      const productStr = productinfo || "Fee Payment";
      const selfUrl    = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      // udf3=fee_payment, udf4=student_id, udf5=fee selection, udf6=waiver
      // Hash: key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt
      const hashInput = [merchantKey, txnid, amountStr, productStr, firstname, emailStr, "", "", "fee_payment", student_id, feeSelection, waiverStr, "", "", "", "", merchantSalt].join("|");
      const hash = await sha512(hashInput);

      const formData = new URLSearchParams({
        key:         merchantKey,
        txnid,
        amount:      amountStr,
        productinfo: productStr,
        firstname,
        email:       emailStr,
        phone:       phone.replace(/\D/g, "").slice(-10),
        hash,
        udf1: "", udf2: "", udf3: "fee_payment", udf4: student_id, udf5: feeSelection, udf6: waiverStr,
        surl: selfUrl,
        furl: selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate-fee-payment error:", data);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[easebuzz] initiate-fee-payment: txnid", txnid, "student", student_id, "amount", amountStr, "selection", feeSelection);

      return new Response(
        JSON.stringify({ txnid, pay_url: `${baseUrl}/pay/${data.data}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Initiate LEAD-side payment (token_fee / application_fee for a lead) ─
    // Pre-creates a pending lead_payments row so the surl handler has a precise
    // row to flip to status='confirmed'. The AFTER trigger on lead_payments
    // does the rest (stage advance, PAN/AN issuance).
    if (action === "initiate-lead-payment") {
      const { lead_id, payment_type, amount, productinfo, firstname, email, phone, payment_mode, concession_amount, waiver_reason, concession_breakdown } = body;

      if (!lead_id || !payment_type || !amount || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields (lead_id, payment_type, amount, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!["application_fee","token_fee","registration_fee","other"].includes(payment_type)) {
        return new Response(
          JSON.stringify({ error: "Invalid payment_type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      // Pre-insert pending lead_payments row.
      const { data: lp, error: lpErr } = await admin
        .from("lead_payments")
        .insert({
          lead_id,
          type: payment_type,
          amount: parseFloat(amount),
          payment_mode: payment_mode || "gateway",
          status: "pending",
          gateway: "easebuzz",
          concession_amount: concession_amount ? parseFloat(concession_amount) : 0,
          waiver_reason: waiver_reason || null,
          concession_breakdown: concession_breakdown || null,
        } as any)
        .select("id")
        .single();
      if (lpErr || !lp?.id) {
        console.error("[easebuzz] lead_payments pre-insert error:", lpErr?.message);
        return new Response(
          JSON.stringify({ error: lpErr?.message || "Failed to record payment intent" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // EaseBuzz requires alphanumeric-only txnid (no hyphens). Use the first
      // 8 hex chars of the UUID (no hyphens in this segment) + timestamp.
      const txnid       = `LP${lp.id.slice(0, 8)}${Date.now()}`.slice(0, 50);
      const amountStr   = parseFloat(amount).toFixed(2);
      const emailStr    = email || "noreply@nimteducation.com";
      // EaseBuzz productinfo must not contain special characters like %, (, )
      const rawProduct  = productinfo || (payment_type === "token_fee" ? "Token Fee" : "Fee Payment");
      const productStr  = rawProduct.replace(/[^a-zA-Z0-9 _\-]/g, "").trim() || "Fee Payment";
      const udf1        = lead_id;
      const udf2        = lp.id;
      const udf3        = payment_type;

      // Hash: SHA512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|${udf1}|${udf2}|${udf3}||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const selfUrl = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      const formData = new URLSearchParams({
        key: merchantKey, txnid, amount: amountStr, productinfo: productStr,
        firstname, email: emailStr, phone: phone.replace(/\D/g, "").slice(-10),
        hash, udf1, udf2, udf3, udf4: "", udf5: "",
        surl: selfUrl, furl: selfUrl,
      });

      // Persist the txnid on the pending row so reconcile-lead-payments can
      // look this transaction up later. Without it a payment that never
      // produced a surl POST (UPI app → user closes the tab) is unfindable.
      // settleLeadPaymentRow overwrites it with the real easepayid on settle.
      const { error: txnPersistErr } = await admin
        .from("lead_payments")
        .update({ transaction_ref: txnid })
        .eq("id", lp.id);
      if (txnPersistErr) {
        console.warn("[easebuzz] persist lead txnid failed:", txnPersistErr.message);
      }

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate-lead-payment error:", data);
        // Roll back the pending row so we don't leak intent rows.
        await admin.from("lead_payments").delete().eq("id", lp.id);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ txnid, lead_payment_id: lp.id, pay_url: `${baseUrl}/pay/${data.data}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify Payment (fallback manual check) ─────────────────────
    // Prefer the txnid persisted at initiate (applications.pending_txnid)
    // over a caller-supplied / reconstructed value, since the latter is
    // missing the Date.now() suffix and always 404s against EaseBuzz.
    if (action === "verify-payment") {
      const { txnid: callerTxnid, application_id, student_id, payment_scope, fee_ids, waiver_amount } = body;

      let txnid = callerTxnid;
      if (application_id) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const { data: appRow } = await admin
          .from("applications")
          .select("pending_txnid")
          .eq("application_id", application_id)
          .maybeSingle();
        if (appRow?.pending_txnid) {
          if (callerTxnid && callerTxnid !== appRow.pending_txnid) {
            console.log(`[easebuzz] verify-payment: overriding caller txnid "${callerTxnid}" with persisted "${appRow.pending_txnid}" for ${application_id}`);
          }
          txnid = appRow.pending_txnid;
        }
      }

      if (!txnid) {
        return new Response(
          JSON.stringify({ error: "txnid is required (and applications.pending_txnid is empty for this app — the original txnid was not persisted)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const retrieved = await easebuzzRetrieveTxn(txnid, { merchantKey, merchantSalt, hosts: retrieveHosts });
      if (!retrieved.txn) {
        return new Response(
          JSON.stringify({ error: retrieved.error || "Failed to verify payment", non_json: retrieved.nonJson }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const txn = retrieved.txn;

      // If payment is confirmed as success, update the DB directly
      // (covers cases where surl callback was missed — popup closed early, etc.)
      if (txn?.status?.toLowerCase() === "success") {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const paymentRef = txn?.easepayid || txnid;
        const feeStudentId = txn?.udf3 === "fee_payment" ? txn?.udf4 : student_id;
        if (feeStudentId && /^[0-9a-f-]{36}$/i.test(feeStudentId)) {
          const feeSelection = txn?.udf5 || feeSelectionFromBody(payment_scope, fee_ids);
          const feeWaiver = Number(txn?.udf6 || waiver_amount || 0);
          const settled = await settleStudentFeePayment(
            admin,
            supabaseUrl,
            serviceKey,
            feeStudentId,
            easebuzzAmount(txn),
            paymentRef,
            feeSelection,
            feeWaiver,
            "easebuzz",
            "verify",
          );
          if (!settled.ok) console.error("[easebuzz] verify-payment fee settlement failed:", settled.message);
        }
        const appId = application_id || txn?.udf1 || "";
        if (appId) {
          const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, appId, paymentRef, {
            gateway: "easebuzz",
            orderId: String(txnid || ""),
            source: "verify",
            fireReceipt: true,
          });
          if (!settled.ok) {
            console.error("[easebuzz] verify-payment app settle error:", settled.message);
          } else {
            console.log("[easebuzz] verify-payment: application", appId, settled.already ? "already paid" : "marked paid");
          }
        }
      }

      return new Response(
        JSON.stringify({ txnid: txn?.txnid, status: txn?.status, amount: easebuzzAmount(txn), easepayid: txn?.easepayid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Manual mark-paid by UTR/reference ───────────────────────────
    // Last-resort reconciliation: when EaseBuzz's own API can't return
    // the txn (UPI-intent payments often disappear from their dashboard
    // for a few hours, and sometimes never resurface), the admin can
    // paste the bank UTR / PhonePe txn id and we mark the application
    // paid directly. The reference goes into payment_ref so the audit
    // trail still has a real receipt link.
    if (action === "mark-paid-manual") {
      const { application_id, reference, note } = body;
      if (!application_id || !reference) {
        return new Response(
          JSON.stringify({ error: "application_id and reference are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      // Sanitise the reference so it's clear in the receipt that this was
      // a manual reconciliation, not a webhook-confirmed payment.
      const refTag = `MANUAL_${reference.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}${note ? "_" + note.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 40) : ""}`;

      // Duplicacy guard: refuse if this reference is already attached to a
      // DIFFERENT paid application. UNIQUE INDEX (uniq_applications_paid_payment_ref)
      // would block it anyway, but pre-check gives a clean error message.
      const { data: existingPaid } = await admin
        .from("applications")
        .select("application_id, full_name")
        .eq("payment_status", "paid")
        .ilike("payment_ref", `%${reference}%`)
        .neq("application_id", application_id)
        .limit(1)
        .maybeSingle();
      if (existingPaid?.application_id) {
        return new Response(
          JSON.stringify({
            error: `Reference "${reference}" is already attached to a different paid application (${existingPaid.application_id} · ${existingPaid.full_name || ""}). Refusing to duplicate.`,
            existing_application_id: existingPaid.application_id,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, application_id, refTag, {
        gateway: "easebuzz",
        source: "manual",
        fireReceipt: true,
      });
      if (!settled.ok) {
        const status = /not found/i.test(settled.message || "") ? 404 : /already paid with different/i.test(settled.message || "") ? 409 : 500;
        return new Response(
          JSON.stringify({ error: settled.message }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const updated = settled.ok ? { application_id, payment_status: "paid" } : null;
      if (!updated) {
        return new Response(
          JSON.stringify({ error: "application not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fire-and-forget receipt generation (matches the surl path).
      fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id }),
      }).catch((e) => console.error("[easebuzz] mark-paid-manual: receipt invoke failed:", e));

      return new Response(
        JSON.stringify({ success: true, application_id, payment_ref: refTag }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Reconcile by UDF1 (last-mile webhook recovery) ───────────────
    // UPI-Intent payments routinely miss EaseBuzz's S2S webhook → our
    // `applications.payment_status` stays 'pending' even though EaseBuzz
    // has Settled the money. The single-application `verify-payment`
    // action relies on `pending_txnid` matching what EaseBuzz settled,
    // which breaks on retries / re-initiates.
    //
    // This action bypasses that mismatch entirely: it pulls EaseBuzz's
    // own transaction list for the last N days via the dashboard
    // `/transaction/v2/retrieve/date` API, then matches each successful
    // txn back to our `applications` rows via UDF1 (which we always set
    // to `application_id` at initiate time). On a match — and amount
    // sanity check — we flip the row to paid using the EaseBuzz easepayid
    // as `payment_ref`. The mirror trigger handles lead_payments.
    //
    // Endpoint contract (verified against EaseBuzz Java SDK):
    //   POST https://dashboard.easebuzz.in/transaction/v2/retrieve/date
    //   Body: { key, merchant_email, hash, date_range:{start_date,end_date} }
    //   Hash: SHA512(merchant_key|merchant_email|start_date|end_date|salt)
    //   Dates: YYYY-MM-DD. Response: { status, data: [ {txnid, easepayid,
    //     amount, status, udf1, ...}, ... ] }
    if (action === "reconcile-by-udf1") {
      const merchantEmail = Deno.env.get("EASEBUZZ_MERCHANT_EMAIL");
      if (!merchantEmail) {
        return new Response(
          JSON.stringify({ error: "EASEBUZZ_MERCHANT_EMAIL env var not set" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Bounded window — wider means more EaseBuzz traffic; narrower
      // means recent settlements might miss the sweep. 7 days is enough
      // to cover even slow UPI-Intent settlement (~T+1) with safety.
      const daysBack = Math.min(Math.max(Number(body.days_back) || 7, 1), 30);
      const onlyAppId = (body.application_id as string | undefined)?.trim() || undefined;

      // EaseBuzz dashboard endpoints sit on dashboard.* not pay.*
      const dashboardBase = ebEnv === "test"
        ? "https://testdashboard.easebuzz.in"
        : "https://dashboard.easebuzz.in";

      const sweep = await fetchEasebuzzTxnsByDate({
        merchantKey, merchantSalt, merchantEmail, dashboardBase, daysBack,
      });
      const attempts = sweep.attempts;
      if (!sweep.firstParsed) {
        return new Response(
          JSON.stringify({ error: "EaseBuzz API: no usable response from any attempt", attempts }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const chosen = sweep.chosen ? { label: sweep.chosen } : null;

      const rows: any[] = sweep.rows;
      const byUdf1 = new Map<string, any>();
      for (const t of rows) {
        const st = String(t?.status || t?.txn_status || "").toLowerCase();
        const udf1 = String(t?.udf1 || "").trim();
        if (!udf1) continue;
        if (st !== "success" && st !== "settled" && st !== "captured") continue;
        // Keep the most recent successful txn per udf1 in case the
        // candidate paid twice (duplicate-charge edge case — flag both,
        // but only the first is needed for reconciliation).
        const existing = byUdf1.get(udf1);
        if (!existing) { byUdf1.set(udf1, t); continue; }
        const prev = new Date(existing?.addedon || existing?.transaction_date || 0).getTime();
        const curr = new Date(t?.addedon || t?.transaction_date || 0).getTime();
        if (curr > prev) byUdf1.set(udf1, t);
      }

      // Now pull our pending applications. Scoped to the same window so
      // we don't accidentally revive ancient rows the admin closed.
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      let pq = admin
        .from("applications")
        .select("application_id, fee_amount, payment_status, lead_id")
        .eq("payment_status", "pending")
        .not("application_id", "is", null);
      if (onlyAppId) pq = pq.eq("application_id", onlyAppId);
      else pq = pq.gt("created_at", new Date(Date.now() - (daysBack + 2) * 86400000).toISOString());
      const { data: pending, error: pErr } = await pq;
      if (pErr) {
        return new Response(
          JSON.stringify({ error: pErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const reconciled: any[] = [];
      const skipped: any[] = [];
      for (const app of pending || []) {
        const match = byUdf1.get(String(app.application_id));
        if (!match) { skipped.push({ application_id: app.application_id, reason: "no_match" }); continue; }
        const expected = Number(app.fee_amount || 0);
        const got      = easebuzzAmount(match);
        // 0.01 tolerance for paise rounding drift.
        if (expected > 0 && Math.abs(expected - got) > 0.01) {
          skipped.push({ application_id: app.application_id, reason: "amount_mismatch", expected, got });
          continue;
        }
        const easepayid  = String(match?.easepayid || match?.mihpayid || match?.txnid || "").trim();
        const refTag     = `RECON_UDF1_${easepayid.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}`;

        // Duplicacy guard: if this easepayid was already attached to a
        // DIFFERENT paid application, abort. The DB has a UNIQUE INDEX on
        // (payment_ref) WHERE payment_status='paid' that would also catch
        // this — but the pre-check gives us a clean skipped-reason instead
        // of a raw constraint violation in the response.
        const { data: existingPaid } = await admin
          .from("applications")
          .select("application_id")
          .eq("payment_status", "paid")
          .or(`payment_ref.ilike.%${easepayid}%`)
          .neq("application_id", app.application_id)
          .limit(1)
          .maybeSingle();
        if (existingPaid?.application_id) {
          skipped.push({
            application_id: app.application_id,
            reason: "payment_ref_already_used",
            other_app: existingPaid.application_id,
            easepayid,
          });
          continue;
        }

        const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, app.application_id, refTag, {
          gateway: "easebuzz",
          orderId: String(match?.txnid || ""),
          claimId: easepayid,
          source: "reconcile",
          fireReceipt: true,
        });
        if (!settled.ok) {
          skipped.push({ application_id: app.application_id, reason: "db_update_failed", detail: settled.message });
          continue;
        }
        if (settled.already) {
          skipped.push({ application_id: app.application_id, reason: "already_paid", detail: refTag });
          continue;
        }

        reconciled.push({ application_id: app.application_id, easepayid, amount: got, source: "udf1_date_range" });
      }

      // ── Pass 2: per-application fallback via /transaction/v2/retrieve ──
      // EaseBuzz's date-range API doesn't always surface every txn the
      // dashboard shows (Naaz Bano's case — settled txn visible in dashboard
      // but absent from /transaction/v2/retrieve/date). For each remaining
      // pending application with a stored pending_txnid, we hit the per-txn
      // retrieve endpoint — that endpoint powers the dashboard's "Transaction
      // Details" view and sees txns the listing API hides.
      const matchedAppIds = new Set(reconciled.map((r) => r.application_id));
      const stillPending = (pending || []).filter((p) =>
        !matchedAppIds.has(p.application_id),
      );
      const fallback_attempts: any[] = [];
      for (const app of stillPending) {
        // Need a txnid to look up. If pending_txnid is empty, candidate never
        // even reached EaseBuzz's initiate — nothing to verify.
        const txnid = (await admin
          .from("applications")
          .select("pending_txnid")
          .eq("application_id", app.application_id)
          .maybeSingle()).data?.pending_txnid;
        if (!txnid) {
          fallback_attempts.push({ application_id: app.application_id, skipped: "no_pending_txnid" });
          continue;
        }

        const retrieved = await easebuzzRetrieveTxn(txnid, { merchantKey, merchantSalt, hosts: retrieveHosts });
        const txn: any = retrieved.txn;
        if (!txn && retrieved.error) {
          fallback_attempts.push({ application_id: app.application_id, txnid, error: retrieved.error });
          continue;
        }

        if (!txn || String(txn.status || "").toLowerCase() !== "success") {
          fallback_attempts.push({
            application_id: app.application_id,
            txnid,
            eb_status: txn?.status || "not_found",
          });
          continue;
        }

        const got       = easebuzzAmount(txn);
        const expected  = Number(app.fee_amount || 0);
        if (expected > 0 && Math.abs(expected - got) > 0.01) {
          skipped.push({ application_id: app.application_id, reason: "amount_mismatch_fallback", expected, got });
          continue;
        }
        const easepayid = String(txn.easepayid || txn.mihpayid || txn.txnid || "").trim();
        const refTag    = `RECON_TXN_${easepayid.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}`;

        // Duplicacy pre-check (same as the UDF1 pass).
        const { data: existingPaid } = await admin
          .from("applications")
          .select("application_id")
          .eq("payment_status", "paid")
          .ilike("payment_ref", `%${easepayid}%`)
          .neq("application_id", app.application_id)
          .limit(1)
          .maybeSingle();
        if (existingPaid?.application_id) {
          skipped.push({
            application_id: app.application_id,
            reason: "payment_ref_already_used_fallback",
            other_app: existingPaid.application_id,
            easepayid,
          });
          continue;
        }

        const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, app.application_id, refTag, {
          gateway: "easebuzz",
          orderId: String(txnid || ""),
          claimId: easepayid,
          source: "reconcile",
          fireReceipt: true,
        });
        if (!settled.ok) {
          skipped.push({ application_id: app.application_id, reason: "db_update_failed_fallback", detail: settled.message });
          continue;
        }
        if (settled.already) {
          skipped.push({ application_id: app.application_id, reason: "already_paid_fallback", detail: refTag });
          continue;
        }

        reconciled.push({ application_id: app.application_id, easepayid, amount: got, source: "per_txn_retrieve" });
        fallback_attempts.push({ application_id: app.application_id, txnid, easepayid, status: "marked_paid" });
      }

      console.log(`[easebuzz] reconcile-by-udf1 done: scanned=${pending?.length ?? 0} matched=${reconciled.length} (udf1=${reconciled.filter(r => r.source === "udf1_date_range").length}, fallback=${reconciled.filter(r => r.source === "per_txn_retrieve").length}) skipped=${skipped.length}`);

      // Flat summary fields — one paste from DevTools tells us exactly
      // what UDF1 values EaseBuzz returned vs what's in our pending set,
      // without having to expand the deep response tree.
      const eb_udf1_values = [...byUdf1.entries()].map(([udf1, t]) => ({
        udf1,
        txnid: t?.txnid,
        easepayid: t?.easepayid || t?.mihpayid,
        amount: easebuzzAmount(t),
        status: t?.status,
        firstname: t?.firstname,
        email: t?.email,
        addedon: t?.addedon || t?.transaction_date,
      }));
      const pending_application_ids = (pending || []).map((p) => ({
        application_id: p.application_id,
        fee_amount: Number(p.fee_amount ?? 0),
      }));
      // Find near-matches (case-insensitive, trimmed, or substring) — helps
      // diagnose if it's a format issue rather than a true no-match.
      const ebSet = new Set(eb_udf1_values.map(x => String(x.udf1).toLowerCase().trim()));
      const near_matches = pending_application_ids.filter(p => {
        const lower = String(p.application_id).toLowerCase().trim();
        if (ebSet.has(lower)) return true;
        for (const ebVal of ebSet) {
          if (ebVal.includes(lower) || lower.includes(ebVal)) return true;
        }
        return false;
      });

      // ── Pass 3: lead payments in the same sweep ──────────────────
      // Same EaseBuzz rows, matched by txnid instead of udf1. Without this the
      // Finance button reports "matched: 0" on a candidate whose money is
      // sitting settled at EaseBuzz, because lead payments carry udf1=lead_id.
      const leadOut = await settleLeadPaymentsFromSweep(admin, rows, {
        supabaseUrl, serviceKey, lookbackDays: daysBack,
        retrieve: { merchantKey, merchantSalt, hosts: retrieveHosts },
        leadPaymentId: (body.lead_payment_id as string | undefined)?.trim() || undefined,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          window: sweep.window,
          chosen_attempt: chosen?.label || null,
          eb_txns_in_window: rows.length,
          eb_successful_with_udf1: byUdf1.size,
          pending_scanned: pending?.length ?? 0,
          lead_payments: {
            scanned: leadOut.scanned,
            settled: leadOut.settled,
            skipped_count: leadOut.skipped.length,
            skipped: leadOut.skipped.slice(0, 30),
          },
          reconciled,
          skipped_count: skipped.length,
          // Flat summary fields — these are what you'll inspect in DevTools
          eb_udf1_values,
          pending_application_ids: pending_application_ids.slice(0, 20),
          near_matches,
          fallback_attempts: fallback_attempts.slice(0, 30),
          // Full attempts kept for deep debugging if needed
          attempts,
          skipped: skipped.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Reconcile pending LEAD payments ───────────────────────────
    // The surl return POST is the only settlement path for lead payments and
    // it never fires when the candidate pays inside a UPI app and closes the
    // browser tab (the S2S webhook is the other fallback, but it depends on
    // EaseBuzz dashboard config we don't control from code). This pulls
    // EaseBuzz's own transaction list for the window and settles every pending
    // row whose txnid EaseBuzz reports as successful.
    //
    // Matching is by txnid, NOT udf1 — for lead payments udf1 is the lead id,
    // so the `reconcile-by-udf1` application matcher can never hit these rows.
    // Diagnostic: what does EaseBuzz actually say about one txnid? Used when a
    // candidate insists they paid and the row is still pending.
    if (action === "retrieve-txn") {
      const adminAuth = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      if (!(await isServiceCaller(req, adminAuth))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const t = String(body.txnid || "").trim();
      if (!t) return new Response(JSON.stringify({ error: "txnid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const out: any = {};
      for (const host of retrieveHosts) {
        const r = await easebuzzRetrieveTxn(t, { merchantKey, merchantSalt, hosts: [host] });
        out[host] = { txn: r.txn, error: r.error, non_json: r.nonJson, raw: r.raw };
      }
      return new Response(JSON.stringify({ ok: true, txnid: t, hosts: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "reconcile-lead-payments") {
      // This settles money: service-role callers only.
      const adminAuth = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      if (!(await isServiceCaller(req, adminAuth))) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = adminAuth;
      const lookbackDays = Math.min(Math.max(Number(body.lookback_days ?? 7), 1), 90);
      const dryRun = body.dry_run === true;

      // No date sweep here. EaseBuzz's /transaction/v2/retrieve/date returns
      // rows that don't carry a transaction date and never contained our
      // txnids — it paged to the cap (8,000 rows) and matched nothing. The
      // per-txn retrieve below is exact, and we only have tens of pending rows.
      const out = await settleLeadPaymentsFromSweep(admin, [], {
        supabaseUrl, serviceKey,
        lookbackDays,
        dryRun,
        retrieve: { merchantKey, merchantSalt, hosts: retrieveHosts },
        leadPaymentId: (body.lead_payment_id as string | undefined)?.trim() || undefined,
      });

      console.log(`[easebuzz] reconcile-lead-payments: scanned=${out.scanned} settled=${out.settled.length} would_settle=${out.would_settle.length} skipped=${out.skipped.length} dry_run=${dryRun}`);

      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: dryRun,
          lookback_days: lookbackDays,
          scanned: out.scanned,
          settled: out.settled,
          would_settle: out.would_settle,
          skipped_count: out.skipped.length,
          skipped: out.skipped.slice(0, 50),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[easebuzz] error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
