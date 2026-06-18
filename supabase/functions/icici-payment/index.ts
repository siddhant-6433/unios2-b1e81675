// ICICI PG (TSP v2 / PhiCommerce) integration.
//
// Endpoints:
//   Initiate sale: https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale
//   Status/refund: https://pgpayuat.icicibank.com/tsp/pg/api/command
//   Initiate sale: https://pgpay.icicibank.com/pg/api/v2/initiateSale
//   Status/refund: https://pgpay.icicibank.com/pg/api/command
//
// Hash convention per integration kit:
//   1. Take all request fields except `secureHash`.
//   2. Sort field names alphabetically (case-insensitive).
//   3. Concatenate VALUES (no separators) in that order  →  `hashText`.
//   4. secureHash = HMAC-SHA256(hashText, ICICI_API_KEY) → lowercase hex.
//
// NOTE: ICICI's worked example in the integration kit doesn't validate against
// any common SHA-256/HMAC scheme — the sample's hashText shows merchantId
// "T_S0001" while the payload shows "100000000006873", so the example is
// internally inconsistent. Keep production logs redacted; use UAT logs for
// request/response diagnostics.
//
// Secrets (set via `supabase secrets set`):
//   ICICI_MID, ICICI_AGG_ID, ICICI_API_KEY, ICICI_ENV (uat | production)
//   ICICI_RETURN_URL (optional; production should use a bank-whitelisted domain)
//   ICICI_RETURN_URLS (optional comma-list; picks a return URL by request Origin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

const FN_NAME = "icici-payment";

// ── Hash helpers ────────────────────────────────────────────────────────────

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Build canonical hashText per ICICI Hash Calc v1:
 *   1. Sort parameter names alphabetically (case-insensitive).
 *   2. Concatenate VALUES (no separators).
 *   3. Skip params that are null, undefined, OR empty string.
 *
 * Note 1 from spec: "Don't ignore any parameters which are part of a response
 * or request for hash calculation, even if the parameter is not part of
 * published spec." → callers should pass the FULL payload (including any
 * unknown fields ICICI adds in responses), not a documented subset. */
function canonicalHashText(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload)
    .filter(k => k !== "secureHash" && payload[k] !== null && payload[k] !== undefined && String(payload[k]) !== "")
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return keys.map(k => String(payload[k])).join("");
}

async function signPayload(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
  // hashText skips null / undefined / empty per spec, but the PAYLOAD itself
  // still ships the original fields (incl. empty addlParam1 etc.) — ICICI's
  // gateway is sensitive to the presence of expected fields even when
  // their values are empty.
  const text = canonicalHashText(payload);
  const secureHash = await hmacSha256Hex(apiKey, text);
  return { ...payload, secureHash };
}

/** Verify a response's secureHash. Returns whether it matches. */
async function verifySignature(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<{ valid: boolean; expected: string; received: string }> {
  const received = String(payload.secureHash ?? "");
  const text = canonicalHashText(payload);
  const expected = await hmacSha256Hex(apiKey, text);
  return { valid: expected === received, expected, received };
}

// ── HTML status page (mirrors easebuzz-payment) ─────────────────────────────

/** ICICI sprays its description across half a dozen possible field names depending
 *  on which subsystem replied (PG core, BIN router, scheme rails). Pick the
 *  longest non-empty one so we always surface the most informative text. */
function bestDescription(fields: Record<string, any>): string {
  const candidates = [
    "respDescription", "responseDescription",
    "detailedDescription", "detailedDesc",
    "responseMessage", "respMessage",
    "errorDescription", "failureReason",
    "message",
  ];
  const found = candidates
    .map(k => (fields[k] == null ? "" : String(fields[k]).trim()))
    .filter(v => v.length > 0)
    // Prefer longer text — short codes get superseded by full sentences.
    .sort((a, b) => b.length - a.length);
  return found[0] || "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function returnPage(
  title: string,
  message: string,
  isSuccess: boolean,
  technicalDetails?: Record<string, any>,
): Response {
  const detailsBlock = technicalDetails && Object.keys(technicalDetails).length > 0
    ? `<details class="tech"><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(technicalDetails, null, 2))}</pre></details>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;padding:16px}
.card{background:white;border-radius:16px;padding:40px;text-align:center;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.08);box-sizing:border-box}
.icon{font-size:48px;margin-bottom:16px}
h2{margin:0 0 8px;font-size:18px;color:#0f172a}
p{margin:0 0 24px;font-size:14px;color:#64748b;white-space:pre-wrap}
button{background:#6366f1;color:white;border:none;border-radius:10px;padding:10px 24px;font-size:14px;cursor:pointer}
.tech{margin-top:20px;text-align:left;background:#f1f5f9;border-radius:8px;padding:12px;font-size:12px}
.tech summary{cursor:pointer;font-weight:500;color:#475569}
.tech pre{margin:8px 0 0;padding:8px;background:#0f172a;color:#e2e8f0;border-radius:6px;overflow-x:auto;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
</style></head><body>
<div class="card">
  <div class="icon">${isSuccess ? "✅" : "❌"}</div>
  <h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(message)}</p>
  <button onclick="window.close()">Close</button>
  ${detailsBlock}
</div>
<script>try{window.opener&&window.opener.postMessage({icici_payment:"${isSuccess ? "success" : "failed"}"},"*")}catch(e){}</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Build the full failure message from whatever ICICI returned, choosing the
 *  best available description and keeping the response code visible for support. */
function failureMessage(fields: Record<string, any>): string {
  const code = String(fields.responseCode || fields.respCode || "unknown");
  const desc = bestDescription(fields);
  return desc
    ? `Payment could not be completed (${code}: ${desc}). Please go back and try again.`
    : `Payment could not be completed (${code}). Please go back and try again.`;
}

// ── Format YYYYMMDDHHMMSS in IST ────────────────────────────────────────────

function istTxnDate(): string {
  const now = new Date();
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}${pad(ist.getUTCSeconds())}`;
}

function normalizeUrlHost(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function resolveReturnUrl(req: Request, fallback: string): string {
  const configured = (Deno.env.get("ICICI_RETURN_URLS") || Deno.env.get("ICICI_RETURN_URL") || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (configured.length === 0) return fallback;

  const originHost = normalizeUrlHost(req.headers.get("origin") || "");
  const byOrigin = originHost
    ? configured.find((url) => normalizeUrlHost(url) === originHost)
    : null;
  return byOrigin || configured[0];
}

function redactSecureHash(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  if ("secureHash" in copy) copy.secureHash = "[redacted]";
  return copy;
}

function redactRawSecureHash(value: string): string {
  return value
    .replace(/("secureHash"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2")
    .replace(/(secureHash=)[^&\s]*/gi, "$1[redacted]");
}

async function settleStudentFee(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  studentId: string,
  paidAmount: number,
  paymentRef: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const { data: rows, error: feeErr } = await admin
    .from("fee_ledger")
    .select("id, total_amount, balance")
    .eq("student_id", studentId)
    .in("status", ["due", "overdue"]);
  if (feeErr) return { ok: false, message: feeErr.message };
  if (!rows?.length) return { ok: true };

  const expectedTotal = rows.reduce((sum: number, row: any) => sum + Number(row.balance ?? row.total_amount), 0);
  if (Math.abs(paidAmount - expectedTotal) > 1) {
    return { ok: false, message: `Amount mismatch: received ${paidAmount}, expected ${expectedTotal}` };
  }

  for (const row of rows) {
    const { error: updateErr } = await admin
      .from("fee_ledger")
      .update({ paid_amount: row.total_amount, status: "paid" })
      .eq("id", row.id);
    if (updateErr) return { ok: false, message: updateErr.message };
  }

  const { data: student } = await admin
    .from("students")
    .select("lead_id")
    .eq("id", studentId)
    .maybeSingle();

  if (student?.lead_id) {
    let lp: { id: string } | null = null;
    if (paymentRef) {
      const { data: existing } = await admin
        .from("lead_payments")
        .select("id")
        .eq("lead_id", student.lead_id)
        .eq("gateway", "icici")
        .eq("transaction_ref", paymentRef)
        .maybeSingle();
      lp = existing;
    }
    if (!lp?.id) {
      const { data: inserted, error: lpErr } = await admin
        .from("lead_payments")
        .insert({
          lead_id: student.lead_id,
          type: "other",
          amount: paidAmount,
          payment_mode: "gateway",
          gateway: "icici",
          transaction_ref: paymentRef,
          status: "confirmed",
          applied_to_ledger: true,
          notes: "Course-fee instalment via ICICI",
        } as any)
        .select("id")
        .maybeSingle();
      if (lpErr) return { ok: false, message: lpErr.message };
      lp = inserted;
    }
    if (lp?.id) {
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event: "payment_received",
          lead_id: student.lead_id,
          context: { payment_id: lp.id },
        }),
      }).catch((e) => console.error(`[${FN_NAME}] student-fee notify-event failed:`, e));
    }
  }

  return { ok: true };
}

async function settleAlumniService(
  admin: any,
  requestId: string,
  amount: number,
  paymentRef: string | null,
  rawResponse: Record<string, any>,
): Promise<{ ok: boolean; message?: string }> {
  await admin.from("pg_transactions").insert({
    txn_id: rawResponse.merchantTxnNo || paymentRef || requestId,
    context: "alumni_service",
    context_id: requestId,
    amount,
    status: "success",
    gateway: "icici",
    gateway_ref: paymentRef,
    payer_name: rawResponse.customerName || "",
    payer_email: rawResponse.customerEmailID || "",
    payer_phone: rawResponse.customerMobileNo || "",
    product_info: "Alumni Service Fee",
    raw_response: rawResponse,
  });

  const { error } = await admin
    .from("alumni_verification_requests")
    .update({
      status: "paid",
      payment_ref: paymentRef,
      payment_method: "icici",
      paid_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const mid        = Deno.env.get("ICICI_MID");
    const aggId      = Deno.env.get("ICICI_AGG_ID") || "";
    const apiKey     = Deno.env.get("ICICI_API_KEY");
    const env        = Deno.env.get("ICICI_ENV") || "uat";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!mid || !apiKey) {
      return new Response(
        JSON.stringify({ error: "ICICI credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = env === "production"
      ? "https://pgpay.icicibank.com/pg/api"
      : "https://pgpayuat.icicibank.com/tsp/pg/api";
    const initiateUrl = `${baseUrl}/v2/initiateSale`;
    const commandUrl  = `${baseUrl}/command`;
    const selfUrl     = resolveReturnUrl(req, `${supabaseUrl}/functions/v1/icici-payment`);

    const rawBody = await req.text();
    const contentType = req.headers.get("content-type") || "";

    // ── ICICI return callback ─────────────────────────────────────────────
    // ICICI redirects the customer to `returnURL` (our edge function) with the
    // payment outcome. The exact wire format (form-encoded body vs JSON vs
    // query-string) is gateway-version dependent — we accept all three and let
    // the field set drive the rest. First UAT round-trip will lock the format.
    const isCallback =
      contentType.includes("application/x-www-form-urlencoded") ||
      (req.method === "GET" && new URL(req.url).searchParams.has("merchantTxnNo"));

    if (isCallback) {
      const fields: Record<string, string> = {};
      if (req.method === "GET") {
        new URL(req.url).searchParams.forEach((v, k) => { fields[k] = v; });
      } else if (contentType.includes("application/json")) {
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        for (const [k, v] of Object.entries(parsed)) fields[k] = String(v ?? "");
      } else {
        new URLSearchParams(rawBody).forEach((v, k) => { fields[k] = v; });
      }
      const redactedFields = redactSecureHash(fields);
      console.log(`[${FN_NAME}] callback fields:`, JSON.stringify(redactedFields));

      const sigCheck = await verifySignature(fields, apiKey);
      console.log(`[${FN_NAME}] callback signature valid:`, sigCheck.valid);
      if (!sigCheck.valid && env === "production") {
        console.error(`[${FN_NAME}] rejected callback with invalid signature`);
        return returnPage(
          "Payment Verification Failed",
          "We could not verify the payment response. Please contact support if money was deducted.",
          false,
        );
      } else if (!sigCheck.valid) {
        console.warn(`[${FN_NAME}] accepting UAT callback with invalid signature for gateway testing`);
      }

      const merchantTxnNo = fields.merchantTxnNo || "";
      const responseCode  = fields.responseCode || "";
      const respDesc      = bestDescription(fields);
      // ICICI's bank reference: `txnID` on payment response, `paymentID` on
      // some authorization variants. Use whichever's present.
      const pgTxnNo       = fields.txnID || fields.paymentID || "";
      // Per spec: 000 / 0000 = settled success. R1000 = "request initiated"
      // (used for UPI out-of-band where final status comes via Payment Advice
      // separately). Anything else = failure.
      const txnStatus = (fields.txnStatus || "").toUpperCase();
      const isSuccess = responseCode === "000" || responseCode === "0000"
        || txnStatus === "SUC" || txnStatus === "SUCCESS";

      // We pack our own row id in addlParam1 (lead_payment id) or addlParam2
      // (application_id) on initiate. Read them back here to know which row to
      // flip.
      const addl1 = fields.addlParam1 || "";
      const addl2 = fields.addlParam2 || "";

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const paymentRef = pgTxnNo || merchantTxnNo || null;

      // Lead-side payment (addl1 is the lead_payments.id)
      if (addl1 && /^[0-9a-f-]{36}$/i.test(addl1)) {
        const newStatus = isSuccess ? "confirmed" : "pending";
        const { error: lpErr } = await admin
          .from("lead_payments")
          .update({ status: newStatus, transaction_ref: paymentRef })
          .eq("id", addl1);
        if (lpErr) {
          console.error(`[${FN_NAME}] lead_payments update error:`, lpErr.message);
          return returnPage("Payment Received", `Payment confirmed but our records could not be updated. Please contact support. Txn: ${paymentRef}`, false);
        }
        if (isSuccess) {
          // notify-event handles PDF generation + WA + email. DB trigger now
          // skips gateway='icici' rows so this won't double-send.
          const { data: lpRow } = await admin
            .from("lead_payments")
            .select("lead_id, type")
            .eq("id", addl1)
            .maybeSingle();
          if (lpRow?.lead_id) {
            const evt = lpRow.type === "application_fee" ? "app_fee_paid" : "payment_received";
            fetch(`${supabaseUrl}/functions/v1/notify-event`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ event: evt, lead_id: lpRow.lead_id, context: { payment_id: addl1 } }),
            }).catch((e) => console.error(`[${FN_NAME}] notify-event invoke failed:`, e));
          }
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess
            ? "Your payment has been received. The receipt has been emailed to you. You may close this window."
            : failureMessage(fields),
          isSuccess,
          isSuccess ? undefined : redactedFields,
        );
      }

      // Student fee ledger payment (addl1=student_fee, addl2=student_id)
      if (addl1 === "student_fee" && addl2 && /^[0-9a-f-]{36}$/i.test(addl2)) {
        if (!isSuccess) {
          return returnPage("Payment Failed", failureMessage(fields), false, redactedFields);
        }
        const amount = parseFloat(fields.amount || "0");
        const settled = await settleStudentFee(admin, supabaseUrl, serviceKey, addl2, amount, paymentRef);
        if (!settled.ok) {
          console.error(`[${FN_NAME}] student fee settlement error:`, settled.message);
          return returnPage("Payment Received", `Payment confirmed but fee records could not be updated. Contact support. Txn: ${paymentRef}`, false);
        }
        return returnPage("Payment Successful", "Your fee payment has been received. You may close this window.", true);
      }

      // Alumni service payment (addl1=alumni_service, addl2=request_id)
      if (addl1 === "alumni_service" && addl2 && /^[0-9a-f-]{36}$/i.test(addl2)) {
        if (!isSuccess) {
          return returnPage("Payment Failed", failureMessage(fields), false, redactedFields);
        }
        const amount = parseFloat(fields.amount || "0");
        const settled = await settleAlumniService(admin, addl2, amount, paymentRef, redactedFields);
        if (!settled.ok) {
          console.error(`[${FN_NAME}] alumni settlement error:`, settled.message);
          return returnPage("Payment Received", `Payment confirmed but alumni request could not be updated. Contact support. Txn: ${paymentRef}`, false);
        }
        return returnPage("Payment Successful", "Your alumni service payment has been received. You may close this window.", true);
      }

      // Application-fee payment (addl2 is the application_id string)
      if (addl2 && isSuccess) {
        const { data: updated, error: dbErr } = await admin
          .from("applications")
          .update({ payment_status: "paid", payment_ref: paymentRef })
          .eq("application_id", addl2)
          .select("application_id");
        if (dbErr || !updated?.length) {
          console.error(`[${FN_NAME}] applications update error:`, dbErr?.message, "rows:", updated?.length);
          return returnPage("Payment Received", `Payment confirmed but could not link to application. Contact support. Txn: ${paymentRef}`, false);
        }
        // Fire-and-forget: generate the application-fee receipt PDF so it's
        // ready by the time the candidate lands back on their dashboard.
        fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ application_id: addl2 }),
        }).catch((e) => console.error(`[${FN_NAME}] receipt invoke failed:`, e));
        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      if (!isSuccess) {
        return returnPage("Payment Failed", failureMessage(fields), false, redactedFields);
      }

      // Success but no addl* — log loudly so we can investigate.
      console.error(`[${FN_NAME}] success callback with no row identifier — fields:`, JSON.stringify(redactedFields));
      return returnPage("Payment Received", `Payment received but could not be linked automatically. Contact support with txn: ${paymentRef}`, false);
    }

    // ── JSON actions from our frontend ───────────────────────────────────
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate APPLICATION-fee payment ─────────────────────────────────
    if (action === "initiate") {
      const { application_id, txnid, amount, productinfo: _pi, firstname, email, phone } = body;
      if (!application_id || !txnid || !amount || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: appRow, error: appErr } = await admin
        .from("applications")
        .select("application_id, fee_amount, payment_status")
        .eq("application_id", application_id)
        .maybeSingle();
      if (appErr || !appRow) {
        return new Response(JSON.stringify({ error: "Application not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (appRow.payment_status === "paid") {
        return new Response(JSON.stringify({ error: "Application fee is already paid" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const expectedAmount = Number(appRow.fee_amount || 0);
      const requestedAmount = Number(amount || 0);
      if (expectedAmount <= 0 || Math.abs(expectedAmount - requestedAmount) > 0.01) {
        return new Response(JSON.stringify({ error: "Amount does not match application fee" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const payload: Record<string, string> = {
        merchantId:       mid,
        aggregatorID:     aggId,
        merchantTxnNo:    String(txnid),
        amount:           expectedAmount.toFixed(2),
        currencyCode:     "356",          // INR
        payType:          "0",            // 0 = all enabled, 1 = card, etc.
        customerEmailID:  email || "noreply@nimteducation.com",
        transactionType:  "SALE",
        returnURL:        selfUrl,
        txnDate:          istTxnDate(),
        customerMobileNo: String(phone).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        customerName:     firstname,
        addlParam1:       "",                 // reserved for lead_payment_id (lead flow)
        addlParam2:       application_id, // application_id (app-fee flow)
      };
      const signed = await signPayload(payload, apiKey);

      console.log(`[${FN_NAME}] initiateSale request:`, JSON.stringify(redactSecureHash(signed)));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiateSale response:`, JSON.stringify(redactSecureHash(data)));

      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        const desc = bestDescription(data);
        const code = data.responseCode || data.respCode;
        const errorMsg = desc
          ? `${desc}${code ? ` (${code})` : ""}`
          : `ICICI rejected the request${code ? ` (${code})` : ""}`;
        return new Response(
          JSON.stringify({ error: errorMsg, raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await admin
        .from("applications")
        .update({ pending_txnid: String(txnid) })
        .eq("application_id", application_id);
      const payUrl = `${data.redirectURI}?tranCtx=${encodeURIComponent(data.tranCtx)}`;
      return new Response(JSON.stringify({ txnid, pay_url: payUrl, tranCtx: data.tranCtx }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Initiate LEAD-side payment (token / application / registration fee) ─
    if (action === "initiate-lead-payment") {
      const { lead_id, payment_type, amount, productinfo: _pi, firstname, email, phone, payment_mode, concession_amount, waiver_reason, concession_breakdown } = body;
      if (!lead_id || !payment_type || !amount || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields (lead_id, payment_type, amount, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!["application_fee","token_fee","registration_fee","other"].includes(payment_type)) {
        return new Response(JSON.stringify({ error: "Invalid payment_type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: lp, error: lpErr } = await admin
        .from("lead_payments")
        .insert({
          lead_id,
          type: payment_type,
          amount: parseFloat(amount),
          payment_mode: payment_mode || "gateway",
          status: "pending",
          gateway: "icici",
          concession_amount: concession_amount ? parseFloat(concession_amount) : 0,
          waiver_reason: waiver_reason || null,
          concession_breakdown: concession_breakdown || null,
        } as any)
        .select("id")
        .single();
      if (lpErr || !lp?.id) {
        console.error(`[${FN_NAME}] lead_payments pre-insert error:`, lpErr?.message);
        return new Response(JSON.stringify({ error: lpErr?.message || "Failed to record payment intent" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txnid = `LP-${lp.id.slice(0, 8)}-${Date.now()}`.slice(0, 35);
      const payload: Record<string, string> = {
        merchantId:       mid,
        aggregatorID:     aggId,
        merchantTxnNo:    txnid,
        amount:           parseFloat(amount).toFixed(2),
        currencyCode:     "356",
        payType:          "0",
        customerEmailID:  email || "noreply@nimteducation.com",
        transactionType:  "SALE",
        returnURL:        selfUrl,
        txnDate:          istTxnDate(),
        customerMobileNo: String(phone).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        customerName:     firstname,
        addlParam1:       lp.id,         // lead_payment row id (callback uses this)
        addlParam2:       lead_id,       // lead id, informational
      };
      const signed = await signPayload(payload, apiKey);

      console.log(`[${FN_NAME}] initiate-lead-payment request:`, JSON.stringify(redactSecureHash(signed)));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiate-lead-payment response:`, JSON.stringify(redactSecureHash(data)));

      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        // Mark the row as failed instead of deleting it. Keeping the row gives
        // us an audit trail of every initiate attempt — useful for support
        // ("did the user even try?") and for spotting MID/key issues that
        // produce repeated failures. The reconciliation cron is safe to skip
        // these (status='failed' is terminal).
        const desc = bestDescription(data);
        const code = data.responseCode || data.respCode;
        const errorMsg = desc
          ? `${desc}${code ? ` (${code})` : ""}`
          : `ICICI rejected the request${code ? ` (${code})` : ""}`;
        await admin.from("lead_payments").update({
          status: "failed",
          transaction_ref: txnid,
          notes: `ICICI initiate failed: ${errorMsg.slice(0, 400)}`,
        } as any).eq("id", lp.id);
        return new Response(
          JSON.stringify({ error: errorMsg, raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Initiate succeeded — record the txnid on the row so reconciliation can
      // re-query ICICI for this exact transaction later if the user never
      // returns from the gateway.
      await admin.from("lead_payments")
        .update({ transaction_ref: txnid } as any)
        .eq("id", lp.id);
      const payUrl = `${data.redirectURI}?tranCtx=${encodeURIComponent(data.tranCtx)}`;
      return new Response(JSON.stringify({ txnid, lead_payment_id: lp.id, pay_url: payUrl, tranCtx: data.tranCtx }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Initiate STUDENT fee-ledger payment ─────────────────────────────
    if (action === "initiate-fee-payment") {
      const { student_id, txnid, productinfo: _pi, firstname, email, phone } = body;
      if (!student_id || !txnid || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields (student_id, txnid, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: dueRows, error: dueErr } = await admin
        .from("fee_ledger")
        .select("balance")
        .eq("student_id", student_id)
        .in("status", ["due", "overdue"]);
      if (dueErr || !dueRows?.length) {
        return new Response(JSON.stringify({ error: "No outstanding fees found for this student" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const totalDue = dueRows.reduce((sum: number, row: any) => sum + Number(row.balance || 0), 0);
      const payload: Record<string, string> = {
        merchantId:       mid,
        aggregatorID:     aggId,
        merchantTxnNo:    String(txnid).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20),
        amount:           totalDue.toFixed(2),
        currencyCode:     "356",
        payType:          "0",
        customerEmailID:  email || "noreply@nimteducation.com",
        transactionType:  "SALE",
        returnURL:        selfUrl,
        txnDate:          istTxnDate(),
        customerMobileNo: String(phone).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        customerName:     firstname,
        addlParam1:       "student_fee",
        addlParam2:       student_id,
      };
      const signed = await signPayload(payload, apiKey);
      console.log(`[${FN_NAME}] initiate-fee-payment request:`, JSON.stringify(redactSecureHash(signed)));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiate-fee-payment response:`, JSON.stringify(redactSecureHash(data)));
      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        const desc = bestDescription(data);
        const code = data.responseCode || data.respCode;
        return new Response(
          JSON.stringify({ error: desc ? `${desc}${code ? ` (${code})` : ""}` : `ICICI rejected the request${code ? ` (${code})` : ""}`, raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const payUrl = `${data.redirectURI}?tranCtx=${encodeURIComponent(data.tranCtx)}`;
      return new Response(JSON.stringify({ txnid: payload.merchantTxnNo, pay_url: payUrl, tranCtx: data.tranCtx }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Initiate ALUMNI service payment ─────────────────────────────────
    if (action === "initiate-alumni-payment") {
      const { request_id, amount, firstname, email, phone, productinfo: _pi } = body;
      if (!request_id || !amount || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: requestRow, error: reqErr } = await admin
        .from("alumni_verification_requests")
        .select("id, fee_amount")
        .eq("id", request_id)
        .maybeSingle();
      if (reqErr || !requestRow) {
        return new Response(JSON.stringify({ error: "Alumni request not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const expectedAmount = Number(requestRow.fee_amount || 0);
      const requestedAmount = Number(amount || 0);
      if (Math.abs(expectedAmount - requestedAmount) > 0.01) {
        return new Response(JSON.stringify({ error: "Amount does not match alumni request fee" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txnid = `AL${String(request_id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}${Date.now()}`.slice(0, 20);
      await admin.from("pg_transactions").insert({
        txn_id: txnid,
        context: "alumni_service",
        context_id: request_id,
        amount: expectedAmount,
        status: "initiated",
        gateway: "icici",
        payer_name: firstname,
        payer_email: email || "noreply@nimteducation.com",
        payer_phone: phone,
        product_info: "Alumni Service Fee",
      });

      const payload: Record<string, string> = {
        merchantId:       mid,
        aggregatorID:     aggId,
        merchantTxnNo:    txnid,
        amount:           expectedAmount.toFixed(2),
        currencyCode:     "356",
        payType:          "0",
        customerEmailID:  email || "noreply@nimteducation.com",
        transactionType:  "SALE",
        returnURL:        selfUrl,
        txnDate:          istTxnDate(),
        customerMobileNo: String(phone).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        customerName:     firstname,
        addlParam1:       "alumni_service",
        addlParam2:       request_id,
      };
      const signed = await signPayload(payload, apiKey);
      console.log(`[${FN_NAME}] initiate-alumni-payment request:`, JSON.stringify(redactSecureHash(signed)));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiate-alumni-payment response:`, JSON.stringify(redactSecureHash(data)));
      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        const desc = bestDescription(data);
        const code = data.responseCode || data.respCode;
        await admin.from("pg_transactions").insert({
          txn_id: txnid,
          context: "alumni_service",
          context_id: request_id,
          amount: expectedAmount,
          status: "failed",
          gateway: "icici",
          gateway_ref: txnid,
          raw_response: data,
        });
        return new Response(
          JSON.stringify({ error: desc ? `${desc}${code ? ` (${code})` : ""}` : `ICICI rejected the request${code ? ` (${code})` : ""}`, raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const payUrl = `${data.redirectURI}?tranCtx=${encodeURIComponent(data.tranCtx)}`;
      return new Response(JSON.stringify({ txnid, pay_url: payUrl, tranCtx: data.tranCtx }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── /command endpoint helpers (status check + refund) ───────────────
    // Per spec, /command takes form-encoded body (not JSON) and discriminates
    // between operations via `transactionType` (STATUS, REFUND, AUTH, VOID...).
    const commandRequest = async (
      payload: Record<string, string>,
    ): Promise<{ ok: boolean; data: any; raw: string }> => {
      const signed = await signPayload(payload, apiKey);
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(signed)) {
        if (v !== "" && v !== null && v !== undefined) form.append(k, String(v));
      }
      const redactedForm = new URLSearchParams(form);
      if (redactedForm.has("secureHash")) redactedForm.set("secureHash", "[redacted]");
      console.log(`[${FN_NAME}] /command(${payload.transactionType}) form:`, redactedForm.toString());
      const res = await fetch(commandUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* leave as raw */ }
      const redactedResponse = data && typeof data === "object" && !Array.isArray(data)
        ? JSON.stringify(redactSecureHash(data))
        : redactRawSecureHash(text);
      console.log(`[${FN_NAME}] /command(${payload.transactionType}) response:`, redactedResponse);
      return { ok: res.ok, data, raw: text };
    };

    // ── Status check (post-payment verify) ───────────────────────────────
    if (action === "verify-payment") {
      const { txnid, original_txn_no, lead_payment_id, student_id, alumni_request_id, application_id } = body;
      if (!txnid) {
        return new Response(JSON.stringify({ error: "txnid is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const payload: Record<string, string> = {
        merchantId:      mid,
        aggregatorID:    aggId,
        merchantTxnNo:   String(txnid),
        // For STATUS, originalTxnNo is the merchantTxnNo of the txn we want to
        // check. If caller didn't pass one, default to txnid (same value, since
        // they're checking their own initiated txn).
        originalTxnNo:   String(original_txn_no || txnid),
        transactionType: "STATUS",
      };
      const { ok, data, raw } = await commandRequest(payload);

      // If success, opportunistically update the DB so we recover from missed
      // browser callbacks (popup closed early, network drop, etc.)
      const respCode  = data?.responseCode || "";
      const txnStatus = (data?.txnStatus || "").toUpperCase();
      const isSettled = respCode === "000" || respCode === "0000" || txnStatus === "SUC";
      if (isSettled) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const paymentRef = data?.txnID || data?.merchantTxnNo || txnid;
        const addl1 = data?.addlParam1 || (lead_payment_id ? String(lead_payment_id) : student_id ? "student_fee" : alumni_request_id ? "alumni_service" : "");
        const addl2 = data?.addlParam2 || String(student_id || alumni_request_id || application_id || "");
        if (addl1 && /^[0-9a-f-]{36}$/i.test(addl1)) {
          await admin.from("lead_payments").update({ status: "confirmed", transaction_ref: paymentRef }).eq("id", addl1);
          const { data: lpRow } = await admin
            .from("lead_payments")
            .select("lead_id, type")
            .eq("id", addl1)
            .maybeSingle();
          if (lpRow?.lead_id) {
            const evt = lpRow.type === "application_fee" ? "app_fee_paid" : "payment_received";
            fetch(`${supabaseUrl}/functions/v1/notify-event`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ event: evt, lead_id: lpRow.lead_id, context: { payment_id: addl1 } }),
            }).catch((e) => console.error(`[${FN_NAME}] verify notify-event failed:`, e));
          }
        } else if (addl1 === "student_fee" && addl2 && /^[0-9a-f-]{36}$/i.test(addl2)) {
          await settleStudentFee(admin, supabaseUrl, serviceKey, addl2, Number(data?.amount || 0), paymentRef);
        } else if (addl1 === "alumni_service" && addl2 && /^[0-9a-f-]{36}$/i.test(addl2)) {
          await settleAlumniService(admin, addl2, Number(data?.amount || 0), paymentRef, data);
        } else if (addl2) {
          await admin.from("applications").update({ payment_status: "paid", payment_ref: paymentRef }).eq("application_id", addl2);
          fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ application_id: addl2 }),
          }).catch((e) => console.error(`[${FN_NAME}] verify receipt invoke failed:`, e));
        }
      }

      return new Response(JSON.stringify({
        status: txnStatus || respCode,
        raw: data && typeof data === "object" && !Array.isArray(data) ? redactSecureHash(data) : data,
        raw_text: ok ? undefined : redactRawSecureHash(raw),
      }),
        { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Refund ───────────────────────────────────────────────────────────
    if (action === "refund") {
      const { txnid, original_txn_no, amount, reason } = body;
      if (!txnid || !original_txn_no || !amount) {
        return new Response(JSON.stringify({ error: "txnid, original_txn_no, and amount are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const payload: Record<string, string> = {
        merchantId:      mid,
        aggregatorID:    aggId,
        merchantTxnNo:   String(txnid),         // unique ref for THIS refund attempt
        originalTxnNo:   String(original_txn_no), // bank txnID of the original sale
        amount:          parseFloat(amount).toFixed(2),
        transactionType: "REFUND",
        addlParam1:      reason ? String(reason).slice(0, 64) : "",
      };
      const { ok, data, raw } = await commandRequest(payload);
      return new Response(JSON.stringify({
        raw: data && typeof data === "object" && !Array.isArray(data) ? redactSecureHash(data) : data,
        raw_text: ok ? undefined : redactRawSecureHash(raw),
      }),
        { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Reconcile pending rows ───────────────────────────────────────────
    // Cron-triggered. Sweeps lead_payments rows that have been stuck in
    // 'pending' for >10 min — happens when the user closes the popup before
    // ICICI's callback fires, when the network drops mid-redirect, or when
    // ICICI's UAT just times out. For each stale row we ask ICICI's STATUS
    // endpoint for the truth, then settle to confirmed / failed locally.
    // Idempotent: re-running on already-settled rows is a no-op.
    if (action === "reconcile-pending") {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const olderThan = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: stale, error: qErr } = await admin
        .from("lead_payments")
        .select("id, transaction_ref, lead_id, type, amount, created_at")
        .eq("gateway", "icici")
        .eq("status", "pending")
        .not("transaction_ref", "is", null)
        .lt("created_at", olderThan)
        .order("created_at", { ascending: true })
        .limit(50); // cap per-run blast radius
      if (qErr) {
        return new Response(JSON.stringify({ error: qErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const results: Array<{ id: string; status: string; respCode?: string }> = [];
      for (const row of stale || []) {
        const txnid = row.transaction_ref as string;
        if (!txnid) continue;

        let outcome: "confirmed" | "failed" | "still_pending" = "still_pending";
        let respCode = "";
        try {
          const { data } = await commandRequest({
            merchantId:      mid,
            aggregatorID:    aggId,
            merchantTxnNo:   txnid,
            originalTxnNo:   txnid,
            transactionType: "STATUS",
          });
          respCode = data?.responseCode || "";
          const txnStatus = (data?.txnStatus || "").toUpperCase();
          const isSettled = respCode === "000" || respCode === "0000" || txnStatus === "SUC";
          // ICICI returns specific failure codes for declined/aborted txns.
          // R1000 means "still in flight" — leave the row pending and let
          // the next cron run check again. Anything else terminal-ish we
          // mark failed so the user can retry.
          const isExplicitFail = !isSettled && respCode && respCode !== "R1000" && txnStatus !== "PENDING" && txnStatus !== "INI";

          if (isSettled) {
            const paymentRef = data?.txnID || data?.merchantTxnNo || txnid;
            await admin.from("lead_payments").update({ status: "confirmed", transaction_ref: paymentRef }).eq("id", row.id);
            outcome = "confirmed";
            // Fire notify-event directly — handles PDF + WA + email + finance CC.
            const evt = row.type === "application_fee" ? "app_fee_paid" : "payment_received";
            fetch(`${supabaseUrl}/functions/v1/notify-event`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ event: evt, lead_id: row.lead_id, context: { payment_id: row.id } }),
            }).catch((e) => console.error(`[${FN_NAME}] reconcile notify-event invoke failed:`, e));
          } else if (isExplicitFail) {
            await admin.from("lead_payments").update({
              status: "failed",
              notes: `Reconciled via STATUS: ${(data?.respDescription || respCode || "declined").toString().slice(0, 400)}`,
            } as any).eq("id", row.id);
            outcome = "failed";
          }
        } catch (e: any) {
          console.error(`[${FN_NAME}] reconcile error for ${row.id}:`, e?.message);
        }
        results.push({ id: row.id, status: outcome, respCode });
      }

      return new Response(JSON.stringify({
        scanned: stale?.length || 0,
        confirmed: results.filter(r => r.status === "confirmed").length,
        failed:    results.filter(r => r.status === "failed").length,
        still_pending: results.filter(r => r.status === "still_pending").length,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[${FN_NAME}] error:`, err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
