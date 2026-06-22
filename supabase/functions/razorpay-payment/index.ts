import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
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
  const raw = String(value || `rzp_${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, "_");
  return raw.slice(0, 40) || `rzp_${Date.now()}`;
}

function noteValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 256);
  return JSON.stringify(value).slice(0, 256);
}

function compactNotes(input: JsonRecord): Record<string, string> {
  const allowed = [
    "context",
    "application_id",
    "lead_id",
    "lead_payment_id",
    "payment_type",
    "student_id",
    "request_id",
    "fee_selection",
    "waiver_amount",
    "customer_name",
    "customer_phone",
    "productinfo",
  ];
  const notes: Record<string, string> = {};
  for (const key of allowed) {
    const value = noteValue(input[key]);
    if (value) notes[key] = value;
  }
  return notes;
}

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
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

async function getStudentFeeRows(admin: any, studentId: string, selection: string) {
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
  if (error) throw new Error(error.message);
  return data || [];
}

async function expectedStudentFeeAmount(
  admin: any,
  studentId: string,
  selection: string,
  waiverAmount: number,
): Promise<{ payable: number; waiver: number }> {
  const rows = await getStudentFeeRows(admin, studentId, selection);
  if (!rows.length) throw new Error("No outstanding fees found for this student");
  const grossTotal = rows.reduce((sum: number, row: any) => sum + Number(row.balance ?? 0), 0);
  const waiver = Math.max(0, Math.min(Number(waiverAmount || 0), grossTotal));
  return {
    payable: Math.max(0, Math.round((grossTotal - waiver) * 100) / 100),
    waiver: Math.round(waiver * 100) / 100,
  };
}

async function settleStudentFeePayment(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
  studentId: string,
  paidAmount: number,
  paymentRef: string,
  selection: string,
  waiverAmount: number,
): Promise<{ ok: boolean; message?: string }> {
  const rows = await getStudentFeeRows(admin, studentId, selection);
  if (!rows.length) return { ok: true };

  const grossTotal = rows.reduce((sum: number, row: any) => sum + Number(row.balance ?? 0), 0);
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

    const { error } = await admin
      .from("fee_ledger")
      .update({ concession: newConcession, paid_amount: newPaid, status: "paid" })
      .eq("id", row.id);
    if (error) return { ok: false, message: error.message };

    ledgerSplits.push({ id: row.id, amount: paidPart, concession: concessionPart });
  }

  const { data: student } = await admin
    .from("students")
    .select("lead_id")
    .eq("id", studentId)
    .maybeSingle();

  if (student?.lead_id) {
    let paymentId: string | null = null;
    const { data: existing } = await admin
      .from("lead_payments")
      .select("id")
      .eq("transaction_ref", paymentRef)
      .maybeSingle();
    paymentId = existing?.id || null;

    if (!paymentId) {
      const { data: inserted, error } = await admin
        .from("lead_payments")
        .insert({
          lead_id: student.lead_id,
          type: "other",
          amount: paidAmount,
          concession_amount: waiver,
          payment_mode: "gateway",
          gateway: "razorpay",
          transaction_ref: paymentRef,
          status: "confirmed",
          applied_to_ledger: true,
          notes: waiver > 0 ? "Course-fee payment with annual Pay All waiver" : "Course-fee instalment via Razorpay",
        })
        .select("id")
        .maybeSingle();
      if (error) return { ok: false, message: error.message };
      paymentId = inserted?.id || null;
    }

    if (paymentId) {
      await admin.from("fee_ledger_payments").insert(
        ledgerSplits.map((split) => ({
          fee_ledger_id: split.id,
          lead_payment_id: paymentId,
          amount: split.amount,
          concession_amount: split.concession,
          notes: "Student portal Razorpay payment",
        })),
      );
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ event: "payment_received", lead_id: student.lead_id, context: { payment_id: paymentId } }),
      }).catch((error) => console.error("[razorpay] notify-event invoke failed:", error));
    }
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!keyId || !keySecret) {
      return json({ error: "Razorpay credentials not configured" }, 500);
    }

    const url = new URL(req.url);
    const rawBody = await req.text();
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const action = parsed.action || url.searchParams.get("action");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (action === "create-order") {
      let amount = Math.round(Number(parsed.amount));
      const currency = String(parsed.currency || "INR").toUpperCase();
      const context = String(parsed.context || parsed.notes?.context || "generic");
      const receipt = cleanReceipt(parsed.receipt);
      const feeSelection = feeSelectionFromBody(parsed.payment_scope, parsed.fee_ids);
      const waiverAmount = Number(parsed.waiver_amount || 0);
      let leadPaymentId: string | null = null;

      if (!Number.isInteger(amount) || amount < 100) {
        return json({ error: "amount must be an integer of at least 100 paise" }, 400);
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        return json({ error: "currency must be a 3-letter ISO code" }, 400);
      }

      if (context === "application_fee" && parsed.application_id) {
        const { data: app, error } = await admin
          .from("applications")
          .select("fee_amount")
          .eq("application_id", parsed.application_id)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (app?.fee_amount != null && Math.abs(amount - Math.round(Number(app.fee_amount) * 100)) > 100) {
          return json({ error: "Amount does not match application fee" }, 400);
        }
      }

      if (context === "student_fee") {
        if (!parsed.student_id) return json({ error: "student_id is required for student_fee payments" }, 400);
        const expected = await expectedStudentFeeAmount(admin, String(parsed.student_id), feeSelection, waiverAmount);
        amount = Math.round(expected.payable * 100);
        if (amount < 100) return json({ error: "amount must be at least 100 paise" }, 400);
      }

      if (context === "token_fee" || context === "lead_payment") {
        const leadId = String(parsed.lead_id || "");
        const paymentType = String(parsed.payment_type || "token_fee");
        if (!/^[0-9a-f-]{36}$/i.test(leadId)) return json({ error: "lead_id is required" }, 400);
        if (!["application_fee", "token_fee", "registration_fee", "other"].includes(paymentType)) {
          return json({ error: "Invalid payment_type" }, 400);
        }

        const { data: lp, error } = await admin
          .from("lead_payments")
          .insert({
            lead_id: leadId,
            type: paymentType,
            amount: amount / 100,
            payment_mode: parsed.payment_mode || "gateway",
            status: "pending",
            gateway: "razorpay",
            concession_amount: parsed.concession_amount ? Number(parsed.concession_amount) : 0,
            waiver_reason: parsed.waiver_reason || null,
            concession_breakdown: parsed.concession_breakdown || null,
          } as any)
          .select("id")
          .single();
        if (error || !lp?.id) return json({ error: error?.message || "Failed to record payment intent" }, 500);
        leadPaymentId = lp.id;
      }

      if (context === "alumni_service" && !parsed.request_id) {
        return json({ error: "request_id is required for alumni service payments" }, 400);
      }

      const notes = compactNotes({
        ...parsed,
        context,
        fee_selection: feeSelection,
        lead_payment_id: leadPaymentId,
      });

      const { res, data } = await razorpayRequest("/orders", {
        method: "POST",
        body: JSON.stringify({ amount, currency, receipt, notes }),
      }, keyId, keySecret);

      if (!res.ok) {
        if (leadPaymentId) await admin.from("lead_payments").delete().eq("id", leadPaymentId);
        const status = res.status === 401 ? 401 : 500;
        return json({ error: data?.error?.description || data?.message || "Failed to create Razorpay order" }, status);
      }

      if (context === "application_fee" && parsed.application_id) {
        await admin
          .from("applications")
          .update({ pending_txnid: data.id })
          .eq("application_id", parsed.application_id);
      }
      if (leadPaymentId) {
        await admin.from("lead_payments").update({ transaction_ref: data.id } as any).eq("id", leadPaymentId);
      }

      return json({
        order_id: data.id,
        amount: data.amount,
        currency: data.currency,
        key_id: keyId,
      });
    }

    if (action === "verify-payment") {
      const serverOrderId = String(parsed.order_id || parsed.razorpay_order_id || "");
      const checkoutOrderId = String(parsed.razorpay_order_id || "");
      const paymentId = String(parsed.razorpay_payment_id || "");
      const signature = String(parsed.razorpay_signature || "");

      if (!serverOrderId || !paymentId || !signature) {
        return json({ error: "order_id, razorpay_payment_id and razorpay_signature are required" }, 400);
      }
      if (checkoutOrderId && checkoutOrderId !== serverOrderId) {
        return json({ error: "Order ID mismatch" }, 400);
      }

      const expected = await hmacSha256Hex(keySecret, `${serverOrderId}|${paymentId}`);
      if (!timingSafeHexEqual(expected, signature)) {
        return json({ error: "Invalid payment signature" }, 400);
      }

      const { res, data: order } = await razorpayRequest(`/orders/${encodeURIComponent(serverOrderId)}`, {
        method: "GET",
      }, keyId, keySecret);
      if (!res.ok) return json({ error: order?.error?.description || "Failed to fetch Razorpay order" }, 500);

      const notes = (order.notes && typeof order.notes === "object" && !Array.isArray(order.notes))
        ? order.notes as Record<string, string>
        : {};
      const context = notes.context || String(parsed.context || "generic");
      const paymentRef = paymentId || serverOrderId;
      const paidAmount = Number(order.amount || parsed.amount || 0) / 100;

      if (context === "application_fee" && notes.application_id) {
        const { error } = await admin
          .from("applications")
          .update({ payment_status: "paid", payment_ref: paymentRef })
          .eq("application_id", notes.application_id);
        if (error) return json({ error: error.message }, 500);
      }

      if ((context === "token_fee" || context === "lead_payment") && notes.lead_payment_id) {
        const { error } = await admin
          .from("lead_payments")
          .update({ status: "confirmed", transaction_ref: paymentRef, gateway: "razorpay" } as any)
          .eq("id", notes.lead_payment_id);
        if (error) return json({ error: error.message }, 500);
      }

      if (context === "student_fee" && notes.student_id) {
        const settled = await settleStudentFeePayment(
          admin,
          supabaseUrl,
          serviceKey,
          notes.student_id,
          paidAmount,
          paymentRef,
          normalizeFeeSelection(notes.fee_selection),
          Number(notes.waiver_amount || 0),
        );
        if (!settled.ok) return json({ error: settled.message || "Failed to settle fee ledger" }, 500);
      }

      if (context === "alumni_service" && notes.request_id) {
        const { error } = await admin
          .from("alumni_verification_requests")
          .update({ status: "paid", payment_ref: paymentRef } as any)
          .eq("id", notes.request_id);
        if (error) return json({ error: error.message }, 500);
      }

      return json({
        success: true,
        order_id: serverOrderId,
        payment_id: paymentId,
        context,
      });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("[razorpay] function error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Razorpay error" }, 500);
  }
});
