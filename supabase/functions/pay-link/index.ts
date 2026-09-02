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
import { settlePaymentLink } from "../_shared/gateway-settlement.ts";

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

async function settleLink(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  link: any,
  paymentRef: string,
  gateway: "razorpay" | "easebuzz" | "icici" | "cashfree" | "offline" | "other",
): Promise<{ ok: boolean; message?: string; already?: boolean }> {
  return settlePaymentLink(admin, supabaseUrl, serviceKey, link, paymentRef, gateway, "unknown");
}

async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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

    // Resolve payer name, ID, photo, institution/course for display.
    let payerName = "Candidate";
    let institutionName: string | null = null;
    let courseName: string | null = null;
    let feeDueDate: string | null = null;
    let displayId: string | null = null;
    let photoUrl: string | null = null;
    if (link.lead_id) {
      const { data } = await admin.from("leads").select("name, application_no, photo_url, courses:course_id(name, departments(institutions(name)))").eq("id", link.lead_id).maybeSingle();
      payerName = data?.name || payerName;
      displayId = data?.application_no || null;
      photoUrl = data?.photo_url || null;
      institutionName = (data?.courses as any)?.departments?.institutions?.name || null;
      courseName = (data?.courses as any)?.name || null;
    }
    if (link.student_id) {
      const { data } = await admin.from("students").select("name, admission_no, pre_admission_no, photo_url, lead_id, courses:course_id(name, departments(institutions(name)))").eq("id", link.student_id).maybeSingle();
      payerName = data?.name || payerName;
      // ponytail: admission_no > pre_admission_no > lead application_no
      displayId = data?.admission_no || data?.pre_admission_no || displayId || null;
      photoUrl = data?.photo_url || photoUrl || null;
      institutionName = (data?.courses as any)?.departments?.institutions?.name || institutionName || null;
      courseName = (data?.courses as any)?.name || courseName || null;
      // If no displayId yet and student has a linked lead, grab application_no
      if (!displayId && data?.lead_id && !link.lead_id) {
        const { data: ld } = await admin.from("leads").select("application_no").eq("id", data.lead_id).maybeSingle();
        displayId = ld?.application_no || null;
      }
      // Earliest unpaid fee due date for context
      const { data: dueFee } = await admin.from("fee_ledger").select("due_date").eq("student_id", link.student_id).in("status", ["due", "overdue"]).order("due_date", { ascending: true }).limit(1).maybeSingle();
      feeDueDate = dueFee?.due_date || null;
    }

    // Live fee links: the stored amount is a stale snapshot. Recompute the late
    // fine (freezes to today) and sum the term head + its late_<term> head so the
    // payer always owes exactly what the ledger says on the day they open the link.
    let effectiveAmount = Number(link.amount);
    if (link.live_fee && link.student_id) {
      try {
        await admin.rpc("fn_recompute_late_fees", { _student_id: link.student_id });
      } catch (e) {
        console.error("[pay-link] fn_recompute_late_fees failed:", e);
      }
      // fee_term set → scope to [term, late_term]. fee_term null (all-dues links
      // from the Fee Dues report) → sum every due/overdue head, i.e. full balance.
      let hq = admin
        .from("fee_ledger")
        .select("balance")
        .eq("student_id", link.student_id)
        .in("status", ["due", "overdue"]);
      if (link.fee_term) hq = hq.in("term", [link.fee_term, `late_${link.fee_term}`]);
      const { data: heads } = await hq;
      const live = (heads || []).reduce((s: number, r: any) => s + Number(r.balance || 0), 0);
      effectiveAmount = Math.round(live * 100) / 100;
    }

    if (action === "resolve") {
      // Gateways this function can actually start a checkout on. A link created
      // with gateway='choice' has no short_url, so the payer picks one here —
      // cheapest first (Easebuzz) instead of being locked into Razorpay's MDR.
      const easebuzzReady = !!(Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY"))
        && !!(Deno.env.get("EASEBUZZ_SALT") || Deno.env.get("EASEBUZZ_MERCHANT_SALT"));
      const gateways = [
        ...(easebuzzReady ? [{ gateway: "easebuzz", display_name: "UPI / Card (Easebuzz)" }] : []),
        ...(keyId && keySecret ? [{ gateway: "razorpay", display_name: "Razorpay" }] : []),
      ];
      return json({
        gateways,
        payer_name: payerName,
        amount: effectiveAmount,
        purpose: link.purpose,
        purpose_label: PURPOSE_LABEL[link.purpose] || "Payment",
        note: link.note || null,
        status: link.status,
        gateway: link.gateway || null,
        short_url: link.short_url || null,
        institution_name: institutionName,
        course_name: courseName,
        display_id: displayId,
        photo_url: photoUrl,
        fee_due_date: feeDueDate,
        expires_at: link.expires_at || null,
      });
    }

    if (link.status !== "active") {
      return json({ error: `This payment link is ${link.status}.` }, 409);
    }

    if (action === "create-order" || action === "create-easebuzz-order") {
      // Live link already fully paid/settled in the ledger → nothing to collect.
      if (link.live_fee && effectiveAmount <= 0) {
        return json({ error: "This fee is already paid in full." }, 409);
      }
      // Freeze the live amount onto the row: this is exactly what the gateway is
      // about to charge, and settlePaymentLink books Number(link.amount). Without
      // this, settlement would credit the stale send-time snapshot and orphan the
      // fine the payer actually paid.
      if (link.live_fee && Math.abs(effectiveAmount - Number(link.amount)) > 0.01) {
        await admin.from("payment_links").update({ amount: effectiveAmount }).eq("id", link.id);
        link.amount = effectiveAmount;
      }
      const preferredGateway = String(parsed.gateway || link.gateway || "").toLowerCase();
      const useEasebuzz = action === "create-easebuzz-order"
        || preferredGateway === "easebuzz"
        || (!keyId || !keySecret);

      // ── Easebuzz path (UniOs /pay page + initiate) ─────────────────────
      if (useEasebuzz) {
        const merchantKey = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY") || "";
        const merchantSalt = Deno.env.get("EASEBUZZ_SALT") || Deno.env.get("EASEBUZZ_MERCHANT_SALT") || "";
        const envMode = (Deno.env.get("EASEBUZZ_ENV") || "prod").toLowerCase();
        const baseUrl = envMode === "test" || envMode === "sandbox"
          ? "https://testpay.easebuzz.in"
          : "https://pay.easebuzz.in";
        if (!merchantKey || !merchantSalt) {
          return json({ error: "Easebuzz not configured" }, 500);
        }

        // Resolve payer contact for prefill
        let firstname = payerName.split(/\s+/)[0] || "Candidate";
        let phone = "";
        let email = "noreply@nimteducation.com";
        if (link.lead_id) {
          const { data: lead } = await admin.from("leads").select("name, phone, email").eq("id", link.lead_id).maybeSingle();
          if (lead?.name) firstname = String(lead.name).split(/\s+/)[0] || firstname;
          if (lead?.phone) phone = String(lead.phone).replace(/\D/g, "").slice(-10);
          if (lead?.email) email = lead.email;
        } else if (link.student_id) {
          const { data: student } = await admin.from("students").select("name, phone, email").eq("id", link.student_id).maybeSingle();
          if (student?.name) firstname = String(student.name).split(/\s+/)[0] || firstname;
          if (student?.phone) phone = String(student.phone).replace(/\D/g, "").slice(-10);
          if (student?.email) email = student.email;
        }
        if (!phone) phone = "9999999999";

        const amountStr = effectiveAmount.toFixed(2);
        const productStr = (PURPOSE_LABEL[link.purpose] || "Payment").slice(0, 100);
        // udf3=payment_link, udf1=payment_link uuid — surl/webhook settle via settlePaymentLink
        const txnid = `PL${link.id.replace(/-/g, "").slice(0, 12)}${Date.now()}`.slice(0, 40);
        const udf1 = link.id;
        const udf3 = "payment_link";
        // Hash: key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt
        const hashInput = [
          merchantKey, txnid, amountStr, productStr, firstname, email,
          udf1, "", udf3, "", "", "", "", "", "", "",
          merchantSalt,
        ].join("|");
        const hash = await sha512(hashInput);
        const selfUrl = `${supabaseUrl}/functions/v1/easebuzz-payment`;

        const formData = new URLSearchParams({
          key: merchantKey,
          txnid,
          amount: amountStr,
          productinfo: productStr,
          firstname,
          email,
          phone,
          hash,
          udf1,
          udf2: "",
          udf3,
          udf4: "",
          udf5: "",
          surl: selfUrl,
          furl: selfUrl,
        });

        const res = await fetch(`${baseUrl}/payment/initiateLink`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData.toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (data.status !== 1) {
          console.error("[pay-link] easebuzz initiate error:", data);
          return json({ error: data.error_desc || data.data || "Failed to initiate Easebuzz payment" }, 400);
        }

        // Persist txn for reconcile; stamp gateway on the link
        await admin.from("payment_links").update({
          gateway: "easebuzz",
          gateway_link_id: txnid,
        } as any).eq("id", link.id);

        return json({
          gateway: "easebuzz",
          txnid,
          pay_url: `${baseUrl}/pay/${data.data}`,
          amount: effectiveAmount,
        });
      }

      // ── Razorpay Standard Checkout path ────────────────────────────────
      if (!keyId || !keySecret) return json({ error: "Razorpay not configured" }, 500);
      const amountPaise = Math.round(effectiveAmount * 100);
      const { res, data } = await razorpayRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: cleanReceipt(`pl_${link.id}`),
          notes: { payment_link_id: link.id, purpose: link.purpose, context: "payment_link" },
        }),
      }, keyId, keySecret);
      if (!res.ok) return json({ error: data?.error?.description || "Failed to create order" }, 500);
      await admin.from("payment_links").update({ gateway: "razorpay" } as any).eq("id", link.id);
      return json({
        gateway: "razorpay",
        order_id: data.id,
        amount: data.amount,
        currency: data.currency,
        key_id: keyId,
      });
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
