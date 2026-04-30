// ICICI PG (TSP v2 / PhiCommerce) integration.
//
// Endpoints (UAT):
//   Initiate sale: https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale
//   Status/refund: https://pgpayuat.icicibank.com/tsp/pg/api/command
// Production:
//   Replace pgpayuat → pgpay
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
// internally inconsistent. We log full request/response on each call so the
// real algorithm can be confirmed on the first UAT round-trip.
//
// Secrets (set via `supabase secrets set`):
//   ICICI_MID, ICICI_AGG_ID, ICICI_API_KEY, ICICI_ENV (uat | production)

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
  console.log(`[${FN_NAME}] hashText:`, text);
  console.log(`[${FN_NAME}] secureHash:`, secureHash);
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

function returnPage(title: string, message: string, isSuccess: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
.card{background:white;border-radius:16px;padding:40px;text-align:center;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.icon{font-size:48px;margin-bottom:16px}
h2{margin:0 0 8px;font-size:18px;color:#0f172a}
p{margin:0 0 24px;font-size:14px;color:#64748b}
button{background:#6366f1;color:white;border:none;border-radius:10px;padding:10px 24px;font-size:14px;cursor:pointer}
</style></head><body>
<div class="card">
  <div class="icon">${isSuccess ? "✅" : "❌"}</div>
  <h2>${title}</h2>
  <p>${message}</p>
  <button onclick="window.close()">Close</button>
</div>
<script>try{window.opener&&window.opener.postMessage({icici_payment:"${isSuccess ? "success" : "failed"}"},"*")}catch(e){}</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── Format YYYYMMDDHHMMSS in IST ────────────────────────────────────────────

function istTxnDate(): string {
  const now = new Date();
  // IST = UTC+5:30
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}${pad(ist.getUTCSeconds())}`;
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
      ? "https://pgpay.icicibank.com"
      : "https://pgpayuat.icicibank.com";
    const initiateUrl = `${baseUrl}/tsp/pg/api/v2/initiateSale`;
    const commandUrl  = `${baseUrl}/tsp/pg/api/command`;
    const selfUrl     = `${supabaseUrl}/functions/v1/icici-payment`;

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
      console.log(`[${FN_NAME}] callback fields:`, JSON.stringify(fields));

      const sigCheck = await verifySignature(fields, apiKey);
      console.log(`[${FN_NAME}] callback signature:`, sigCheck);

      const merchantTxnNo = fields.merchantTxnNo || "";
      const responseCode  = fields.responseCode || "";
      const respDesc      = fields.respDescription || "";
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
          fetch(`${supabaseUrl}/functions/v1/generate-payment-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ lead_payment_id: addl1 }),
          }).catch((e) => console.error(`[${FN_NAME}] receipt invoke failed:`, e));
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess
            ? "Your payment has been received. The receipt has been emailed to you. You may close this window."
            : `Payment could not be completed (${responseCode || "unknown"}: ${respDesc}). Please try again.`,
          isSuccess,
        );
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
        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      if (!isSuccess) {
        return returnPage("Payment Failed", `Payment could not be completed (${responseCode || "unknown"}: ${respDesc}). Please go back and try again.`, false);
      }

      // Success but no addl* — log loudly so we can investigate.
      console.error(`[${FN_NAME}] success callback with no row identifier — fields:`, JSON.stringify(fields));
      return returnPage("Payment Received", `Payment received but could not be linked automatically. Contact support with txn: ${paymentRef}`, false);
    }

    // ── JSON actions from our frontend ───────────────────────────────────
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate APPLICATION-fee payment ─────────────────────────────────
    if (action === "initiate") {
      const { application_id, txnid, amount, productinfo: _pi, firstname, email, phone } = body;
      if (!txnid || !amount || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const payload: Record<string, string> = {
        merchantId:       mid,
        aggregatorID:     aggId,
        merchantTxnNo:    String(txnid),
        amount:           parseFloat(amount).toFixed(2),
        currencyCode:     "356",          // INR
        payType:          "0",            // 0 = all enabled, 1 = card, etc.
        customerEmailID:  email || "noreply@nimteducation.com",
        transactionType:  "SALE",
        returnURL:        selfUrl,
        txnDate:          istTxnDate(),
        customerMobileNo: String(phone).replace(/\D/g, "").slice(-10).padStart(10, "0"),
        customerName:     firstname,
        addlParam1:       "",                 // reserved for lead_payment_id (lead flow)
        addlParam2:       application_id || "", // application_id (app-fee flow)
      };
      const signed = await signPayload(payload, apiKey);

      console.log(`[${FN_NAME}] initiateSale request:`, JSON.stringify(signed));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiateSale response:`, JSON.stringify(data));

      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        return new Response(
          JSON.stringify({ error: data.respDescription || data.responseMessage || "Failed to initiate payment", raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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

      console.log(`[${FN_NAME}] initiate-lead-payment request:`, JSON.stringify(signed));
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(signed),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[${FN_NAME}] initiate-lead-payment response:`, JSON.stringify(data));

      if (data.responseCode !== "R1000" || !data.redirectURI || !data.tranCtx) {
        // Roll back the pending row so we don't leak intent rows.
        await admin.from("lead_payments").delete().eq("id", lp.id);
        return new Response(
          JSON.stringify({ error: data.respDescription || data.responseMessage || "Failed to initiate payment", raw: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const payUrl = `${data.redirectURI}?tranCtx=${encodeURIComponent(data.tranCtx)}`;
      return new Response(JSON.stringify({ txnid, lead_payment_id: lp.id, pay_url: payUrl, tranCtx: data.tranCtx }),
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
      console.log(`[${FN_NAME}] /command(${payload.transactionType}) form:`, form.toString());
      const res = await fetch(commandUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
      });
      const text = await res.text();
      console.log(`[${FN_NAME}] /command(${payload.transactionType}) response:`, text);
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* leave as raw */ }
      return { ok: res.ok, data, raw: text };
    };

    // ── Status check (post-payment verify) ───────────────────────────────
    if (action === "verify-payment") {
      const { txnid, original_txn_no } = body;
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
        const addl1 = data?.addlParam1 || "";
        const addl2 = data?.addlParam2 || "";
        if (addl1 && /^[0-9a-f-]{36}$/i.test(addl1)) {
          await admin.from("lead_payments").update({ status: "confirmed", transaction_ref: paymentRef }).eq("id", addl1);
        } else if (addl2) {
          await admin.from("applications").update({ payment_status: "paid", payment_ref: paymentRef }).eq("application_id", addl2);
        }
      }

      return new Response(JSON.stringify({ status: txnStatus || respCode, raw: data, raw_text: ok ? undefined : raw }),
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
      return new Response(JSON.stringify({ raw: data, raw_text: ok ? undefined : raw }),
        { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[${FN_NAME}] error:`, err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
