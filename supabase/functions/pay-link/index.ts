// pay-link (public, service role)
//
// Powers the /pay/:token public page AND the Razorpay payment_link.paid webhook.
// The URL token is the only credential; there is no anon RLS on payment_links.
//
// Actions (POST body { action, token, ... }):
//   resolve       → { payer_name, amount, purpose, purpose_label, status }
//   create-order  → creates a Razorpay order for the DB amount (own-page flow)
//   verify        → verifies a Razorpay checkout signature then settles
//   (webhook)     → POST with X-Razorpay-Signature header + { event, payload }
//                   handles payment_link.paid; settles idempotently.
//
// Settlement is guarded: UPDATE payment_links SET status='paid'
//   WHERE id=? AND status='active' — only if that UPDATE affects a row do we
// insert the payment, so replayed webhooks cannot double-insert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanReceipt(value: unknown): string {
  const raw = String(value || `pl_${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, "_");
  return raw.slice(0, 40) || `pl_${Date.now()}`;
}

const PURPOSE_LABEL: Record<string, string> = {
  pre_admission_token: "Token fee prior to admission",
  fee_due: "Fee due",
  custom: "Payment",
};

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function razorpayRequest(path: string, init: RequestInit, keyId: string, keySecret: string) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Allocate a paid amount across a student's outstanding fee_ledger rows.
// Mirrors the settle logic in razorpay-payment's settleStudentFeePayment but
// pays exactly `paidAmount` (no waiver) against the oldest-due rows first.
async function settleStudentFeeLedger(
  admin: any,
  studentId: string,
  paidAmount: number,
  leadPaymentId: string,
): Promise<void> {
  const { data: rows } = await admin
    .from("fee_ledger")
    .select("id, total_amount, paid_amount, concession, balance, due_date, status")
    .eq("student_id", studentId)
    .in("status", ["due", "overdue"])
    .gt("balance", 0)
    .order("due_date", { ascending: true });

  let remaining = Math.round(paidAmount * 100) / 100;
  const splits: Array<{ id: string; amount: number }> = [];
  for (const row of rows || []) {
    if (remaining <= 0) break;
    const balance = Number(row.balance ?? 0);
    const apply = Math.min(balance, remaining);
    remaining = Math.round((remaining - apply) * 100) / 100;
    const newPaid = Number(row.paid_amount || 0) + apply;
    const fullyPaid = newPaid + Number(row.concession || 0) >= Number(row.total_amount) - 0.01;
    await admin
      .from("fee_ledger")
      .update({ paid_amount: newPaid, status: fullyPaid ? "paid" : row.status })
      .eq("id", row.id);
    splits.push({ id: row.id, amount: apply });
  }

  if (splits.length) {
    await admin.from("fee_ledger_payments").insert(
      splits.map((s) => ({
        fee_ledger_id: s.id,
        lead_payment_id: leadPaymentId,
        amount: s.amount,
        notes: "Payment link settlement",
      })),
    );
  }
}

// Receipt PDF + WhatsApp/email go out via notify-event. Required here because
// the DB trigger fn_notify_payment_received skips gateway='razorpay' (and
// other app-notified gateways) — the edge fn owns the notification path so
// we never double-send the receipt WhatsApp.
function notifyPaymentReceived(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
  leadPaymentId: string,
): void {
  fetch(`${supabaseUrl}/functions/v1/notify-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      event: "payment_received",
      lead_id: leadId,
      context: { payment_id: leadPaymentId },
    }),
  }).catch((e) => console.error("[pay-link] notify payment_received failed:", e));
}

// Core idempotent settlement: guard on status transition active→paid, then
// insert the payment row exactly once.
async function settleLink(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  link: any,
  paymentRef: string,
  gateway: string,
): Promise<{ ok: boolean; message?: string }> {
  // Guard: only the first caller flips active→paid.
  const { data: claimed, error: claimErr } = await admin
    .from("payment_links")
    .update({ status: "paid" })
    .eq("id", link.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (claimErr) return { ok: false, message: claimErr.message };
  if (!claimed) return { ok: true }; // already settled by an earlier (replayed) call

  const paidAmount = Number(link.amount);

  if (link.purpose === "pre_admission_token") {
    if (!link.lead_id) return { ok: false, message: "pre_admission_token link has no lead_id" };
    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: link.lead_id,
        type: "pre_admission_token",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: paymentRef,
        status: "confirmed",
        notes: link.note || "Pre-admission token via payment link",
      } as any)
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
    // Triggers assign receipt no + advance stage; receipt/WA/email via notify.
    notifyPaymentReceived(supabaseUrl, serviceKey, link.lead_id, lp.id);
    return { ok: true };
  }

  // fee_due / custom
  if (link.student_id) {
    const { data: student } = await admin
      .from("students").select("lead_id").eq("id", link.student_id).maybeSingle();
    const leadId = student?.lead_id || link.lead_id || null;
    if (!leadId) return { ok: false, message: "No lead linked to student for settlement" };

    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: leadId,
        type: "other",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: paymentRef,
        status: "confirmed",
        applied_to_ledger: true,
        notes: link.note || "Fee payment via payment link",
      } as any)
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
    await settleStudentFeeLedger(admin, link.student_id, paidAmount, lp.id);
    notifyPaymentReceived(supabaseUrl, serviceKey, leadId, lp.id);
    return { ok: true };
  }

  // custom link on a lead with no student yet → record as 'other' on the lead.
  if (link.lead_id) {
    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: link.lead_id,
        type: "other",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: paymentRef,
        status: "confirmed",
        notes: link.note || "Custom payment via payment link",
      } as any)
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message };
    await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
    notifyPaymentReceived(supabaseUrl, serviceKey, link.lead_id, lp.id);
    return { ok: true };
  }

  return { ok: false, message: "Link has no settlement target" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get("x-razorpay-signature");

    // --- Razorpay webhook path (payment_link.paid) ---------------------------
    if (sigHeader) {
      if (!webhookSecret) return json({ error: "Webhook secret not configured" }, 500);
      const expected = await hmacSha256Hex(webhookSecret, rawBody);
      if (!timingSafeHexEqual(expected, sigHeader)) {
        return json({ error: "Invalid webhook signature" }, 400);
      }
      const evt = JSON.parse(rawBody);
      if (evt.event !== "payment_link.paid") return json({ ok: true, ignored: evt.event });

      const plEntity = evt.payload?.payment_link?.entity || {};
      const paymentEntity = evt.payload?.payment?.entity || {};
      const ourLinkId = plEntity.notes?.payment_link_id || null;
      const paymentRef = String(paymentEntity.id || plEntity.id || `pl_${Date.now()}`);

      let link: any = null;
      if (ourLinkId) {
        const { data } = await admin.from("payment_links").select("*").eq("id", ourLinkId).maybeSingle();
        link = data;
      }
      if (!link && plEntity.id) {
        const { data } = await admin.from("payment_links").select("*").eq("gateway_link_id", plEntity.id).maybeSingle();
        link = data;
      }
      if (!link) return json({ ok: true, note: "No matching link" });

      const settled = await settleLink(admin, supabaseUrl, serviceKey, link, paymentRef, "razorpay");
      if (!settled.ok) return json({ error: settled.message || "Settlement failed" }, 500);
      return json({ ok: true });
    }

    // --- App/API actions -----------------------------------------------------
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const action = String(parsed.action || "");
    const token = String(parsed.token || "");
    if (!token) return json({ error: "token is required" }, 400);

    const { data: link, error: linkErr } = await admin
      .from("payment_links").select("*").eq("token", token).maybeSingle();
    if (linkErr) return json({ error: linkErr.message }, 500);
    if (!link) return json({ error: "Link not found" }, 404);

    // Expire lazily.
    const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
    if (isExpired && link.status === "active") {
      await admin.from("payment_links").update({ status: "expired" }).eq("id", link.id);
      link.status = "expired";
    }

    // Resolve payer name for display.
    let payerName = "Candidate";
    if (link.lead_id) {
      const { data } = await admin.from("leads").select("name").eq("id", link.lead_id).maybeSingle();
      payerName = data?.name || payerName;
    } else if (link.student_id) {
      const { data } = await admin.from("students").select("name").eq("id", link.student_id).maybeSingle();
      payerName = data?.name || payerName;
    }

    if (action === "resolve") {
      return json({
        payer_name: payerName,
        amount: Number(link.amount),
        purpose: link.purpose,
        purpose_label: PURPOSE_LABEL[link.purpose] || "Payment",
        note: link.note || null,
        status: link.status,
        gateway: link.gateway || null,
        short_url: link.short_url || null,
      });
    }

    if (link.status !== "active") {
      return json({ error: `This payment link is ${link.status}.` }, 409);
    }

    if (action === "create-order") {
      if (!keyId || !keySecret) return json({ error: "Razorpay not configured" }, 500);
      const amountPaise = Math.round(Number(link.amount) * 100);
      const { res, data } = await razorpayRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: cleanReceipt(`pl_${link.id}`),
          notes: { payment_link_id: link.id, purpose: link.purpose },
        }),
      }, keyId, keySecret);
      if (!res.ok) return json({ error: data?.error?.description || "Failed to create order" }, 500);
      return json({ order_id: data.id, amount: data.amount, currency: data.currency, key_id: keyId });
    }

    // Razorpay hosted Payment-Link callback (candidate lands back on
    // /pay/<token>?razorpay_payment_link_id=...&razorpay_signature=...).
    // Signature = HMAC_SHA256(link_id|reference_id|status|payment_id, key_secret).
    // This settles WITHOUT the webhook, which needs separate registration.
    if (action === "verify-link-callback") {
      if (!keySecret) return json({ error: "Razorpay not configured" }, 500);
      const plinkId = String(parsed.razorpay_payment_link_id || "");
      const refId = String(parsed.razorpay_payment_link_reference_id || "");
      const plStatus = String(parsed.razorpay_payment_link_status || "");
      const paymentId = String(parsed.razorpay_payment_id || "");
      const signature = String(parsed.razorpay_signature || "");
      if (!plinkId || !paymentId || !signature) {
        return json({ error: "payment_link_id, payment_id and signature are required" }, 400);
      }
      if (plStatus !== "paid") return json({ error: `Payment link status is ${plStatus || "unknown"}` }, 409);
      if (link.gateway_link_id && link.gateway_link_id !== plinkId) {
        return json({ error: "Payment link mismatch" }, 400);
      }
      const expected = await hmacSha256Hex(keySecret, `${plinkId}|${refId}|${plStatus}|${paymentId}`);
      if (!timingSafeHexEqual(expected, signature)) {
        return json({ error: "Invalid payment signature" }, 400);
      }
      const settled = await settleLink(admin, supabaseUrl, serviceKey, link, paymentId, "razorpay");
      if (!settled.ok) return json({ error: settled.message || "Settlement failed" }, 500);
      return json({ success: true });
    }

    if (action === "verify") {
      if (!keyId || !keySecret) return json({ error: "Razorpay not configured" }, 500);
      const orderId = String(parsed.razorpay_order_id || "");
      const paymentId = String(parsed.razorpay_payment_id || "");
      const signature = String(parsed.razorpay_signature || "");
      if (!orderId || !paymentId || !signature) {
        return json({ error: "order_id, payment_id and signature are required" }, 400);
      }
      const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
      if (!timingSafeHexEqual(expected, signature)) {
        return json({ error: "Invalid payment signature" }, 400);
      }
      const settled = await settleLink(admin, supabaseUrl, serviceKey, link, paymentId, "razorpay");
      if (!settled.ok) return json({ error: settled.message || "Settlement failed" }, 500);
      return json({ success: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("[pay-link] error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
