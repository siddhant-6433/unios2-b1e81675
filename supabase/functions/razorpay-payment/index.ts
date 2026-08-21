import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronCaller } from "../_shared/service-auth.ts";

/**
 * Razorpay Standard Checkout settlement.
 *
 * Design rules:
 *  1. Double-marking is worse than a missed mark.
 *  2. One gateway payment id (pay_…) settles at most once (gateway_settlements).
 *  3. Webhook / verify-payment / reconcile-order / reconcile-stranded all share
 *     settleFromRazorpayCapture().
 *  4. Pay-links stay on pay-link + payment_link.paid — ignored here when notes
 *     have no Standard Checkout context.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-razorpay-signature, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient>;

type SettlementSource = "webhook" | "verify" | "reconcile" | "cron" | "manual" | "unknown";

type SettlementResult = {
  ok: boolean;
  already?: boolean;
  message?: string;
  context?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  payment_id?: string;
  order_id?: string | null;
};

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

function firstSettledRazorpayPayment(payments: unknown): Record<string, unknown> | null {
  const rows = Array.isArray(payments) ? payments : [];
  return (
    rows.find((payment: any) => payment?.status === "captured") ||
    rows.find((payment: any) => payment?.status === "authorized") ||
    null
  );
}

function notesFromUnknown(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const s = noteValue(v);
    if (s) out[k] = s;
  }
  return out;
}

/** Claim exclusive right to settle this gateway payment id. */
async function claimGatewayPayment(
  admin: AdminClient,
  paymentId: string,
  meta: {
    orderId?: string | null;
    context?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    amount?: number | null;
    source: SettlementSource;
  },
): Promise<{ claimed: boolean; already: boolean; error?: string }> {
  const { data, error } = await admin
    .from("gateway_settlements")
    .insert({
      gateway: "razorpay",
      gateway_payment_id: paymentId,
      gateway_order_id: meta.orderId || null,
      context: meta.context || null,
      entity_type: meta.entityType || null,
      entity_id: meta.entityId || null,
      amount: meta.amount ?? null,
      source: meta.source,
    } as any)
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique violation → already claimed by another path (webhook/verify/cron).
    if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
      return { claimed: false, already: true };
    }
    // Table may not exist yet in an environment that hasn't migrated — fail open
    // only for missing-relation so verify still works; log loudly.
    if (/gateway_settlements|does not exist|PGRST/i.test(error.message || "")) {
      console.error("[razorpay] gateway_settlements unavailable:", error.message);
      return { claimed: true, already: false, error: error.message };
    }
    return { claimed: false, already: false, error: error.message };
  }

  if (!data?.id) return { claimed: false, already: true };
  return { claimed: true, already: false };
}

async function getStudentFeeRows(admin: AdminClient, studentId: string, selection: string) {
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
  admin: AdminClient,
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

/**
 * Apply student fee ledger once. Caller must already own the gateway_settlements claim.
 * If a lead_payment with this transaction_ref already exists, we do NOT re-apply ledger.
 */
async function settleStudentFeePayment(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  studentId: string,
  paidAmount: number,
  paymentRef: string,
  selection: string,
  waiverAmount: number,
): Promise<{ ok: boolean; message?: string; already?: boolean; leadPaymentId?: string | null }> {
  const { data: existing } = await admin
    .from("lead_payments")
    .select("id, applied_to_ledger")
    .eq("transaction_ref", paymentRef)
    .maybeSingle();

  if (existing?.id) {
    // Never re-apply ledger for an existing gateway capture.
    return { ok: true, already: true, leadPaymentId: existing.id };
  }

  const rows = await getStudentFeeRows(admin, studentId, selection);
  if (!rows.length) return { ok: true, already: false, leadPaymentId: null };

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
      .eq("id", row.id)
      .in("status", ["due", "overdue"]); // claim only unpaid rows
    if (error) return { ok: false, message: error.message };

    ledgerSplits.push({ id: row.id, amount: paidPart, concession: concessionPart });
  }

  const { data: student } = await admin
    .from("students")
    .select("lead_id")
    .eq("id", studentId)
    .maybeSingle();

  let paymentId: string | null = null;
  if (student?.lead_id) {
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

    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
        const { data: again } = await admin
          .from("lead_payments")
          .select("id")
          .eq("transaction_ref", paymentRef)
          .maybeSingle();
        return { ok: true, already: true, leadPaymentId: again?.id || null };
      }
      return { ok: false, message: error.message };
    }
    paymentId = inserted?.id || null;

    if (paymentId && ledgerSplits.length) {
      // Ignore insert errors on link rows if a concurrent path already linked.
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

  return { ok: true, already: false, leadPaymentId: paymentId };
}

async function settleApplicationFee(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  applicationId: string,
  paymentId: string,
  orderId: string | null,
): Promise<SettlementResult> {
  const { data: current, error: readErr } = await admin
    .from("applications")
    .select("application_id, payment_status, payment_ref")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message, context: "application_fee" };
  if (!current) return { ok: false, message: "Application not found", context: "application_fee" };

  if (current.payment_status === "paid") {
    if (!current.payment_ref || current.payment_ref === paymentId) {
      // Align ref if empty; never overwrite a different ref.
      if (!current.payment_ref) {
        await admin
          .from("applications")
          .update({ payment_ref: paymentId, pending_txnid: orderId || undefined })
          .eq("application_id", applicationId)
          .eq("payment_status", "paid")
          .is("payment_ref", null);
      }
      return {
        ok: true,
        already: true,
        context: "application_fee",
        entity_type: "application",
        entity_id: applicationId,
        payment_id: paymentId,
        order_id: orderId,
      };
    }
    return {
      ok: false,
      message: `Application already paid with a different reference (${current.payment_ref})`,
      context: "application_fee",
      entity_type: "application",
      entity_id: applicationId,
      payment_id: paymentId,
    };
  }

  // Cross-app collision: same pay_ already on another paid application.
  const { data: other } = await admin
    .from("applications")
    .select("application_id, full_name")
    .eq("payment_status", "paid")
    .eq("payment_ref", paymentId)
    .neq("application_id", applicationId)
    .limit(1)
    .maybeSingle();
  if (other?.application_id) {
    return {
      ok: false,
      message: `Payment already attached to ${other.application_id}`,
      context: "application_fee",
      payment_id: paymentId,
    };
  }

  const { data: claimed, error: claimErr } = await admin
    .from("applications")
    .update({
      payment_status: "paid",
      payment_ref: paymentId,
      pending_txnid: orderId || undefined,
    })
    .eq("application_id", applicationId)
    .neq("payment_status", "paid")
    .select("application_id")
    .maybeSingle();

  if (claimErr) {
    // Unique on payment_ref lost the race to another app.
    if (claimErr.code === "23505" || /duplicate|unique/i.test(claimErr.message || "")) {
      return { ok: false, message: claimErr.message, context: "application_fee", payment_id: paymentId };
    }
    return { ok: false, message: claimErr.message, context: "application_fee" };
  }

  if (!claimed) {
    // Concurrent winner — re-read.
    const { data: again } = await admin
      .from("applications")
      .select("payment_status, payment_ref")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (again?.payment_status === "paid" && (!again.payment_ref || again.payment_ref === paymentId)) {
      return {
        ok: true,
        already: true,
        context: "application_fee",
        entity_type: "application",
        entity_id: applicationId,
        payment_id: paymentId,
        order_id: orderId,
      };
    }
    return { ok: false, message: "Could not claim application payment row", context: "application_fee" };
  }

  // Receipt is best-effort; mirror trigger creates lead_payments.
  fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ application_id: applicationId }),
  }).catch((error) => console.error("[razorpay] receipt invoke failed:", error));

  return {
    ok: true,
    already: false,
    context: "application_fee",
    entity_type: "application",
    entity_id: applicationId,
    payment_id: paymentId,
    order_id: orderId,
  };
}

async function settleLeadPaymentRow(
  admin: AdminClient,
  leadPaymentId: string,
  paymentId: string,
  context: string,
): Promise<SettlementResult> {
  const { data: current, error: readErr } = await admin
    .from("lead_payments")
    .select("id, status, transaction_ref, lead_id, type, amount")
    .eq("id", leadPaymentId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message, context };
  if (!current) return { ok: false, message: "lead_payment not found", context };

  if (current.status === "confirmed") {
    if (!current.transaction_ref || current.transaction_ref === paymentId || String(current.transaction_ref).startsWith("order_")) {
      // Upgrade order_ placeholder → pay_ if needed.
      if (current.transaction_ref !== paymentId) {
        await admin
          .from("lead_payments")
          .update({ transaction_ref: paymentId, gateway: "razorpay" } as any)
          .eq("id", leadPaymentId)
          .eq("status", "confirmed");
      }
      return {
        ok: true,
        already: true,
        context,
        entity_type: "lead_payment",
        entity_id: leadPaymentId,
        payment_id: paymentId,
      };
    }
    if (current.transaction_ref === paymentId) {
      return {
        ok: true,
        already: true,
        context,
        entity_type: "lead_payment",
        entity_id: leadPaymentId,
        payment_id: paymentId,
      };
    }
    return {
      ok: false,
      message: `lead_payment already confirmed with different ref (${current.transaction_ref})`,
      context,
      payment_id: paymentId,
    };
  }

  const { data: claimed, error: claimErr } = await admin
    .from("lead_payments")
    .update({
      status: "confirmed",
      transaction_ref: paymentId,
      gateway: "razorpay",
    } as any)
    .eq("id", leadPaymentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    if (claimErr.code === "23505" || /duplicate|unique/i.test(claimErr.message || "")) {
      // This pay_ already confirmed on another row — treat as already settled globally.
      return {
        ok: true,
        already: true,
        context,
        entity_type: "lead_payment",
        entity_id: leadPaymentId,
        payment_id: paymentId,
        message: claimErr.message,
      };
    }
    return { ok: false, message: claimErr.message, context };
  }

  if (!claimed) {
    const { data: again } = await admin
      .from("lead_payments")
      .select("status, transaction_ref")
      .eq("id", leadPaymentId)
      .maybeSingle();
    if (again?.status === "confirmed" && (!again.transaction_ref || again.transaction_ref === paymentId || String(again.transaction_ref).startsWith("order_"))) {
      return {
        ok: true,
        already: true,
        context,
        entity_type: "lead_payment",
        entity_id: leadPaymentId,
        payment_id: paymentId,
      };
    }
    return { ok: false, message: "Could not claim pending lead_payment", context };
  }

  return {
    ok: true,
    already: false,
    context,
    entity_type: "lead_payment",
    entity_id: leadPaymentId,
    payment_id: paymentId,
  };
}

/**
 * Shared multi-context settler. Safe under webhook + verify + cron concurrency.
 * Never applies side effects twice for the same pay_ id.
 */
async function settleFromRazorpayCapture(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  args: {
    paymentId: string;
    orderId?: string | null;
    notes: Record<string, string>;
    paidAmount: number;
    source: SettlementSource;
    contextOverride?: string | null;
  },
): Promise<SettlementResult> {
  const paymentId = String(args.paymentId || "");
  if (!paymentId.startsWith("pay_")) {
    return { ok: false, message: "Invalid Razorpay payment id" };
  }

  const notes = args.notes || {};
  const context = String(args.contextOverride || notes.context || "generic");
  const orderId = args.orderId || null;
  const paidAmount = Number(args.paidAmount || 0);

  let entityType: string | null = null;
  let entityId: string | null = null;
  if (context === "application_fee" && notes.application_id) {
    entityType = "application";
    entityId = notes.application_id;
  } else if ((context === "token_fee" || context === "lead_payment") && notes.lead_payment_id) {
    entityType = "lead_payment";
    entityId = notes.lead_payment_id;
  } else if (context === "student_fee" && notes.student_id) {
    entityType = "student";
    entityId = notes.student_id;
  }

  // Refuse to claim the global payment id without a known entity — incomplete
  // notes must not permanently burn a pay_ id.
  if (!entityType || !entityId) {
    console.warn("[razorpay] capture missing entity context:", {
      paymentId, orderId, context, notes, source: args.source,
    });
    return {
      ok: false,
      message: "Missing settlement context (application_id / lead_payment_id / student_id)",
      context,
      payment_id: paymentId,
      order_id: orderId,
    };
  }

  // Global at-most-once claim for this capture.
  const claim = await claimGatewayPayment(admin, paymentId, {
    orderId,
    context,
    entityType,
    entityId,
    amount: paidAmount || null,
    source: args.source,
  });

  if (claim.error && !claim.claimed && !claim.already) {
    return { ok: false, message: claim.error, context, payment_id: paymentId, order_id: orderId };
  }

  // Whether we just claimed or another path already claimed: entity settlement
  // is itself claim-based. Re-running heals orphaned claims.
  const alreadyClaimed = claim.already;

  if (context === "application_fee" && notes.application_id) {
    const result = await settleApplicationFee(
      admin, supabaseUrl, serviceKey, notes.application_id, paymentId, orderId,
    );
    return { ...result, already: alreadyClaimed || result.already };
  }

  if ((context === "token_fee" || context === "lead_payment") && notes.lead_payment_id) {
    const result = await settleLeadPaymentRow(admin, notes.lead_payment_id, paymentId, context);
    return { ...result, already: alreadyClaimed || result.already };
  }

  if (context === "student_fee" && notes.student_id) {
    const settled = await settleStudentFeePayment(
      admin,
      supabaseUrl,
      serviceKey,
      notes.student_id,
      paidAmount,
      paymentId,
      normalizeFeeSelection(notes.fee_selection),
      Number(notes.waiver_amount || 0),
    );
    if (!settled.ok) return { ok: false, message: settled.message, context, payment_id: paymentId };
    return {
      ok: true,
      already: alreadyClaimed || settled.already,
      context,
      entity_type: "student",
      entity_id: notes.student_id,
      payment_id: paymentId,
      order_id: orderId,
    };
  }

  return {
    ok: false,
    message: "Unsupported settlement context",
    context,
    payment_id: paymentId,
    order_id: orderId,
  };
}

async function settlePaidOrder(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  keyId: string,
  keySecret: string,
  orderId: string,
  source: SettlementSource,
  contextOverride?: string | null,
): Promise<SettlementResult & { amount?: number; amount_paid?: number; status?: string | null }> {
  const { res: orderRes, data: order } = await razorpayRequest(
    `/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" },
    keyId,
    keySecret,
  );
  if (!orderRes.ok) {
    return { ok: false, message: order?.error?.description || "Failed to fetch Razorpay order", order_id: orderId };
  }

  const notes = notesFromUnknown(order.notes);
  const amount = Number(order.amount || 0);
  const amountPaid = Number(order.amount_paid || 0);
  const orderPaid = String(order.status || "").toLowerCase() === "paid" || (amount > 0 && amountPaid >= amount);
  if (!orderPaid) {
    return {
      ok: false,
      message: "Order not paid yet",
      order_id: orderId,
      context: notes.context || contextOverride || undefined,
      amount,
      amount_paid: amountPaid,
      status: order.status || null,
    } as SettlementResult & { amount?: number; amount_paid?: number; status?: string | null };
  }

  const { res: paymentsRes, data: paymentData } = await razorpayRequest(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    { method: "GET" },
    keyId,
    keySecret,
  );
  if (!paymentsRes.ok) {
    return { ok: false, message: paymentData?.error?.description || "Failed to fetch order payments", order_id: orderId };
  }

  const payment = firstSettledRazorpayPayment(paymentData?.items);
  const paymentId = String(payment?.id || "");
  if (!paymentId) {
    return { ok: false, message: "Order paid but no captured payment found", order_id: orderId };
  }

  // Prefer order notes; fall back to payment notes.
  const paymentNotes = notesFromUnknown(payment?.notes);
  const mergedNotes = { ...paymentNotes, ...notes };

  const result = await settleFromRazorpayCapture(admin, supabaseUrl, serviceKey, {
    paymentId,
    orderId,
    notes: mergedNotes,
    paidAmount: amount / 100,
    source,
    contextOverride: contextOverride || null,
  });

  return {
    ...result,
    amount,
    amount_paid: amountPaid,
    status: order.status || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!keyId || !keySecret) {
      return json({ error: "Razorpay credentials not configured" }, 500);
    }

    const url = new URL(req.url);
    const rawBody = await req.text();
    const sigHeader = req.headers.get("x-razorpay-signature");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ── Webhook path (payment.captured / payment.authorized) ──────────────
    if (sigHeader) {
      if (!webhookSecret) {
        console.error("[razorpay] webhook received but RAZORPAY_WEBHOOK_SECRET is not set");
        return json({ error: "Webhook secret not configured" }, 500);
      }
      const expected = await hmacSha256Hex(webhookSecret, rawBody);
      if (!timingSafeHexEqual(expected, sigHeader)) {
        return json({ error: "Invalid webhook signature" }, 400);
      }

      const evt = JSON.parse(rawBody || "{}");
      const eventName = String(evt.event || "");
      // payment_link.paid is handled by pay-link — ignore here.
      if (eventName === "payment_link.paid") {
        return json({ ok: true, ignored: eventName, reason: "handled_by_pay_link" });
      }
      if (eventName !== "payment.captured" && eventName !== "payment.authorized") {
        return json({ ok: true, ignored: eventName });
      }

      const paymentEntity = evt.payload?.payment?.entity || {};
      const paymentId = String(paymentEntity.id || "");
      const orderId = String(paymentEntity.order_id || "");
      if (!paymentId.startsWith("pay_")) {
        return json({ ok: true, ignored: true, reason: "no_payment_id" });
      }

      // Prefer order notes (create-order writes context there).
      let notes = notesFromUnknown(paymentEntity.notes);
      if (orderId.startsWith("order_")) {
        const { res, data: order } = await razorpayRequest(
          `/orders/${encodeURIComponent(orderId)}`,
          { method: "GET" },
          keyId,
          keySecret,
        );
        if (res.ok) {
          notes = { ...notes, ...notesFromUnknown(order.notes) };
        }
      }

      // No Standard Checkout context → not our product (or incomplete notes).
      const context = notes.context || "";
      if (!context || context === "generic") {
        // Still claim the payment id so a later incomplete path cannot double-apply
        // if notes are enriched later... Actually for empty context claiming blocks
        // future settlement if notes were missing. Prefer NOT claiming.
        return json({ ok: true, ignored: true, reason: "no_checkout_context", payment_id: paymentId });
      }

      const paidAmount = Number(paymentEntity.amount || 0) / 100;
      const result = await settleFromRazorpayCapture(admin, supabaseUrl, serviceKey, {
        paymentId,
        orderId: orderId || null,
        notes,
        paidAmount,
        source: "webhook",
      });

      if (!result.ok) {
        console.error("[razorpay] webhook settle failed:", result);
        return json({ error: result.message || "Settlement failed", ...result }, 500);
      }
      return json({ ok: true, ...result });
    }

    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const action = parsed.action || url.searchParams.get("action");

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
          .select("fee_amount, payment_status")
          .eq("application_id", parsed.application_id)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (app?.payment_status === "paid") {
          return json({ error: "Application fee is already paid" }, 409);
        }
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

      const notes = compactNotes({
        ...parsed,
        context,
        fee_selection: feeSelection,
        lead_payment_id: leadPaymentId,
        waiver_amount: waiverAmount || undefined,
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
          .eq("application_id", parsed.application_id)
          .neq("payment_status", "paid");
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

      const notes = notesFromUnknown(order.notes);
      const paidAmount = Number(order.amount || parsed.amount || 0) / 100;

      const result = await settleFromRazorpayCapture(admin, supabaseUrl, serviceKey, {
        paymentId,
        orderId: serverOrderId,
        notes,
        paidAmount,
        source: "verify",
        contextOverride: parsed.context ? String(parsed.context) : null,
      });

      if (!result.ok) return json({ error: result.message || "Settlement failed", ...result }, 500);

      return json({
        success: true,
        order_id: serverOrderId,
        payment_id: paymentId,
        already: result.already || false,
        context: result.context,
        entity_type: result.entity_type || null,
        entity_id: result.entity_id || null,
      });
    }

    if (action === "reconcile-order") {
      const requestedOrderId = String(parsed.order_id || parsed.razorpay_order_id || "");
      const requestedApplicationId = String(parsed.application_id || "");
      let orderId = requestedOrderId;

      if (!orderId && requestedApplicationId) {
        const { data: appRow, error: appErr } = await admin
          .from("applications")
          .select("pending_txnid")
          .eq("application_id", requestedApplicationId)
          .maybeSingle();
        if (appErr) return json({ error: appErr.message }, 500);
        orderId = String(appRow?.pending_txnid || "");
      }

      if (!orderId || !orderId.startsWith("order_")) {
        return json({ error: "A Razorpay order_id is required" }, 400);
      }

      // Optional guard when caller passes application_id.
      if (requestedApplicationId) {
        const { res: peekRes, data: peekOrder } = await razorpayRequest(
          `/orders/${encodeURIComponent(orderId)}`,
          { method: "GET" },
          keyId,
          keySecret,
        );
        if (peekRes.ok) {
          const peekNotes = notesFromUnknown(peekOrder.notes);
          if (peekNotes.application_id && peekNotes.application_id !== requestedApplicationId) {
            return json({
              error: "Razorpay order belongs to a different application",
              order_id: orderId,
              order_application_id: peekNotes.application_id,
              requested_application_id: requestedApplicationId,
            }, 409);
          }
        }
      }

      const result = await settlePaidOrder(
        admin,
        supabaseUrl,
        serviceKey,
        keyId,
        keySecret,
        orderId,
        parsed.source === "cron" ? "cron" : "reconcile",
        parsed.context ? String(parsed.context) : null,
      );

      if (!result.ok && result.message === "Order not paid yet") {
        return json({
          success: false,
          order_id: orderId,
          status: result.status || null,
          amount: result.amount,
          amount_paid: result.amount_paid,
          context: result.context || null,
        });
      }
      if (!result.ok) return json({ error: result.message || "Reconcile failed", ...result }, result.message?.includes("different") ? 409 : 500);

      return json({
        success: true,
        already: result.already || false,
        order_id: orderId,
        payment_id: result.payment_id || null,
        context: result.context || null,
        entity_type: result.entity_type || null,
        entity_id: result.entity_id || null,
        status: result.status || null,
        amount: result.amount,
        amount_paid: result.amount_paid,
      });
    }

    // Cron: find unpaid apps with Razorpay pending_txnid + pending lead_payments with order_ refs.
    if (action === "reconcile-stranded") {
      if (!isCronCaller(req)) {
        return json({ error: "Unauthorized" }, 401);
      }
      const settled: any[] = [];
      const skipped: any[] = [];
      const errors: any[] = [];

      const { data: apps } = await admin
        .from("applications")
        .select("application_id, pending_txnid, payment_status")
        .neq("payment_status", "paid")
        .like("pending_txnid", "order_%")
        .order("updated_at", { ascending: false })
        .limit(40);

      for (const app of apps || []) {
        const orderId = String(app.pending_txnid || "");
        if (!orderId.startsWith("order_")) continue;
        try {
          const result = await settlePaidOrder(
            admin, supabaseUrl, serviceKey, keyId, keySecret, orderId, "cron",
          );
          if (result.ok) settled.push({ application_id: app.application_id, payment_id: result.payment_id, already: result.already });
          else if (result.message === "Order not paid yet") skipped.push({ application_id: app.application_id, status: result.status });
          else errors.push({ application_id: app.application_id, error: result.message });
        } catch (e) {
          errors.push({ application_id: app.application_id, error: e instanceof Error ? e.message : String(e) });
        }
      }

      const { data: pendingLp } = await admin
        .from("lead_payments")
        .select("id, transaction_ref, type")
        .eq("status", "pending")
        .eq("gateway", "razorpay")
        .like("transaction_ref", "order_%")
        .order("created_at", { ascending: false })
        .limit(40);

      for (const lp of pendingLp || []) {
        const orderId = String(lp.transaction_ref || "");
        if (!orderId.startsWith("order_")) continue;
        try {
          const result = await settlePaidOrder(
            admin, supabaseUrl, serviceKey, keyId, keySecret, orderId, "cron",
          );
          if (result.ok) settled.push({ lead_payment_id: lp.id, payment_id: result.payment_id, already: result.already });
          else if (result.message === "Order not paid yet") skipped.push({ lead_payment_id: lp.id, status: result.status });
          else errors.push({ lead_payment_id: lp.id, error: result.message });
        } catch (e) {
          errors.push({ lead_payment_id: lp.id, error: e instanceof Error ? e.message : String(e) });
        }
      }

      return json({
        ok: true,
        settled_count: settled.length,
        skipped_count: skipped.length,
        error_count: errors.length,
        settled,
        skipped: skipped.slice(0, 20),
        errors: errors.slice(0, 20),
      });
    }

    // Ops: sign + self-POST a payment.captured webhook using RAZORPAY_WEBHOOK_SECRET.
    // Proves secret is set, HMAC path works, and settlement is at-most-once.
    // Guarded by CRON_SECRET (header x-cron-secret or body.cron_secret).
    if (action === "webhook-smoke-test") {
      const cronSecret = Deno.env.get("CRON_SECRET") || "";
      const provided =
        req.headers.get("x-cron-secret") ||
        String(parsed.cron_secret || "");
      if (!isCronCaller(req) && (!cronSecret || provided !== cronSecret)) {
        return json({ error: "Unauthorized" }, 401);
      }
      if (!webhookSecret) {
        return json({ error: "RAZORPAY_WEBHOOK_SECRET not configured" }, 500);
      }

      // Prefer replaying a real already-settled payment so we exercise full settle path.
      const { data: prior } = await admin
        .from("gateway_settlements")
        .select("gateway_payment_id, gateway_order_id, entity_id, amount, context")
        .eq("gateway", "razorpay")
        .eq("entity_type", "application")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const paymentId = prior?.gateway_payment_id || "pay_smoke_test_only";
      const orderId = prior?.gateway_order_id || "";
      const amountPaise = prior?.amount != null
        ? Math.round(Number(prior.amount) * 100)
        : 100;
      const applicationId = prior?.entity_id || "";
      const context = prior?.context || "application_fee";

      const bodyObj = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              amount: amountPaise,
              currency: "INR",
              order_id: orderId,
              notes: {
                context,
                application_id: applicationId,
              },
            },
          },
        },
      };
      const body = JSON.stringify(bodyObj);
      const signature = await hmacSha256Hex(webhookSecret, body);

      const selfRes = await fetch(`${supabaseUrl}/functions/v1/razorpay-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": signature,
        },
        body,
      });
      const selfText = await selfRes.text();
      let selfJson: unknown = null;
      try {
        selfJson = JSON.parse(selfText);
      } catch {
        selfJson = { raw: selfText.slice(0, 500) };
      }

      return json({
        ok: selfRes.status >= 200 && selfRes.status < 300,
        http_status: selfRes.status,
        replayed_payment_id: paymentId,
        replayed_order_id: orderId || null,
        application_id: applicationId || null,
        response: selfJson,
        note:
          "Signed with RAZORPAY_WEBHOOK_SECRET in Supabase and POSTed to this function. " +
          "If already settled, expect already=true. Does not prove Razorpay dashboard secret matches — only that Supabase secret verifies correctly end-to-end.",
      });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("[razorpay] function error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected Razorpay error" }, 500);
  }
});
