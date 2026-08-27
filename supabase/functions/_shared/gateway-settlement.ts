/**
 * Shared at-most-once payment settlement for Razorpay / Easebuzz / ICICI / etc.
 *
 * Principle: double-marking is worse than a missed mark.
 *
 * 1. claimGatewayPayment(gateway, paymentId) — unique on gateway_settlements
 * 2. Claim entity rows with status transitions (unpaid→paid / pending→confirmed)
 * 3. Student fee: never re-apply ledger if transaction_ref already exists
 */

// Loose typing so both esm.sh and npm supabase-js clients work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any;

export type GatewayName = "razorpay" | "easebuzz" | "icici" | "cashfree" | "offline" | "other";
export type SettlementSource = "webhook" | "verify" | "reconcile" | "cron" | "manual" | "surl" | "callback" | "unknown";

export type SettlementResult = {
  ok: boolean;
  already?: boolean;
  message?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  payment_id?: string | null;
};

function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function normalizeFeeSelection(selection?: string | null): string {
  const cleaned = String(selection || "due").trim();
  if (cleaned === "all" || cleaned === "due") return cleaned;
  const ids = cleaned
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return ids.length ? ids.join(",") : "due";
}

/** Claim exclusive right to settle this gateway payment id. */
export async function claimGatewayPayment(
  admin: AdminClient,
  gateway: GatewayName,
  paymentId: string | null | undefined,
  meta: {
    orderId?: string | null;
    context?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    amount?: number | null;
    source?: SettlementSource;
  } = {},
): Promise<{ claimed: boolean; already: boolean; error?: string }> {
  const id = String(paymentId || "").trim();
  if (!id) return { claimed: false, already: false, error: "Missing gateway payment id" };

  const { data, error } = await admin
    .from("gateway_settlements")
    .insert({
      gateway,
      gateway_payment_id: id,
      gateway_order_id: meta.orderId || null,
      context: meta.context || null,
      entity_type: meta.entityType || null,
      entity_id: meta.entityId || null,
      amount: meta.amount ?? null,
      source: meta.source || "unknown",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
      return { claimed: false, already: true };
    }
    // Fail CLOSED. This used to fail open when the ledger table errored, which
    // is how a `source` CHECK violation silently disabled at-most-once for two
    // weeks. A refused settle leaves the row pending and the reconcile sweep
    // picks it up; a double settle mints a second receipt for the same rupee.
    console.error("[gateway-settlement] claim failed:", error.code, error.message);
    return { claimed: false, already: false, error: error.message };
  }

  if (!data?.id) return { claimed: false, already: true };
  return { claimed: true, already: false };
}

/**
 * Mark application fee paid at most once.
 * Uses unpaid→paid claim; refuses different payment_ref on already-paid apps.
 */
export async function settleApplicationFee(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  applicationId: string,
  paymentId: string,
  opts: {
    gateway: GatewayName;
    orderId?: string | null;
    /**
     * Key to claim in gateway_settlements. Defaults to `paymentId`, but callers
     * that decorate payment_ref for provenance (RECON_UDF1_…, MANUAL_…) must
     * pass the BARE gateway id here — otherwise the unique
     * (gateway, gateway_payment_id) index can't dedupe a reconcile against the
     * surl/webhook that already settled the same money.
     */
    claimId?: string | null;
    source?: SettlementSource;
    fireReceipt?: boolean;
  },
): Promise<SettlementResult> {
  const appId = String(applicationId || "").trim();
  const payId = String(paymentId || "").trim();
  if (!appId || !payId) return { ok: false, message: "application_id and payment id required" };

  const claim = await claimGatewayPayment(admin, opts.gateway, opts.claimId || payId, {
    orderId: opts.orderId || null,
    context: "application_fee",
    entityType: "application",
    entityId: appId,
    source: opts.source || "unknown",
  });
  if (claim.error && !claim.claimed && !claim.already) {
    return { ok: false, message: claim.error, payment_id: payId };
  }

  const { data: current, error: readErr } = await admin
    .from("applications")
    .select("application_id, payment_status, payment_ref")
    .eq("application_id", appId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!current) return { ok: false, message: "Application not found" };

  if (current.payment_status === "paid") {
    if (!current.payment_ref || current.payment_ref === payId) {
      if (!current.payment_ref) {
        await admin
          .from("applications")
          .update({ payment_ref: payId, pending_txnid: opts.orderId || undefined })
          .eq("application_id", appId)
          .eq("payment_status", "paid")
          .is("payment_ref", null);
      }
      return {
        ok: true,
        already: true,
        entity_type: "application",
        entity_id: appId,
        payment_id: payId,
      };
    }
    return {
      ok: false,
      message: `Application already paid with different ref (${current.payment_ref})`,
      entity_type: "application",
      entity_id: appId,
      payment_id: payId,
    };
  }

  // Same pay_ already on another paid application.
  const { data: other } = await admin
    .from("applications")
    .select("application_id")
    .eq("payment_status", "paid")
    .eq("payment_ref", payId)
    .neq("application_id", appId)
    .limit(1)
    .maybeSingle();
  if (other?.application_id) {
    return {
      ok: false,
      message: `Payment already attached to ${other.application_id}`,
      payment_id: payId,
    };
  }

  const { data: claimed, error: claimErr } = await admin
    .from("applications")
    .update({
      payment_status: "paid",
      payment_ref: payId,
      pending_txnid: opts.orderId || undefined,
    })
    .eq("application_id", appId)
    .neq("payment_status", "paid")
    .select("application_id")
    .maybeSingle();

  if (claimErr) {
    if (claimErr.code === "23505" || /duplicate|unique/i.test(claimErr.message || "")) {
      return { ok: false, message: claimErr.message, payment_id: payId };
    }
    return { ok: false, message: claimErr.message };
  }

  if (!claimed) {
    const { data: again } = await admin
      .from("applications")
      .select("payment_status, payment_ref")
      .eq("application_id", appId)
      .maybeSingle();
    if (again?.payment_status === "paid" && (!again.payment_ref || again.payment_ref === payId)) {
      return {
        ok: true,
        already: true,
        entity_type: "application",
        entity_id: appId,
        payment_id: payId,
      };
    }
    return { ok: false, message: "Could not claim application payment row" };
  }

  if (opts.fireReceipt !== false) {
    fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ application_id: appId }),
    }).catch((e) => console.error("[gateway-settlement] receipt invoke failed:", e));
  }

  return {
    ok: true,
    already: claim.already || false,
    entity_type: "application",
    entity_id: appId,
    payment_id: payId,
  };
}

/**
 * Confirm a pending lead_payments row at most once.
 * Does not insert a second row — only pending→confirmed claim.
 */
export async function settleLeadPaymentRow(
  admin: AdminClient,
  leadPaymentId: string,
  paymentId: string,
  opts: {
    gateway: GatewayName;
    /** Bare gateway id to claim; see settleApplicationFee.claimId. */
    claimId?: string | null;
    /** Bank/UPI RRN — the reference a human reads off their statement. */
    bankRefNum?: string | null;
    source?: SettlementSource;
    notify?: boolean;
    supabaseUrl?: string;
    serviceKey?: string;
  },
): Promise<SettlementResult> {
  const lpId = String(leadPaymentId || "").trim();
  const payId = String(paymentId || "").trim();
  if (!lpId || !payId) return { ok: false, message: "lead_payment_id and payment id required" };

  const bankRef = String(opts.bankRefNum || "").trim();
  const bankRefPatch = bankRef && bankRef.toUpperCase() !== "NA" ? { bank_ref_num: bankRef } : {};

  const claim = await claimGatewayPayment(admin, opts.gateway, opts.claimId || payId, {
    context: "lead_payment",
    entityType: "lead_payment",
    entityId: lpId,
    source: opts.source || "unknown",
  });
  if (claim.error && !claim.claimed && !claim.already) {
    return { ok: false, message: claim.error, payment_id: payId };
  }

  const { data: current, error: readErr } = await admin
    .from("lead_payments")
    .select("id, status, transaction_ref, lead_id, type")
    .eq("id", lpId)
    .maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  if (!current) return { ok: false, message: "lead_payment not found" };

  if (current.status === "confirmed") {
    if (!current.transaction_ref || current.transaction_ref === payId) {
      return {
        ok: true,
        already: true,
        entity_type: "lead_payment",
        entity_id: lpId,
        payment_id: payId,
      };
    }
    // Allow upgrading merchant txn placeholder → bank ref if same row
    if (String(current.transaction_ref).startsWith("IC") || String(current.transaction_ref).startsWith("LP") || String(current.transaction_ref).startsWith("EB") || String(current.transaction_ref).startsWith("order_")) {
      await admin
        .from("lead_payments")
        .update({ transaction_ref: payId, gateway: opts.gateway, ...bankRefPatch })
        .eq("id", lpId)
        .eq("status", "confirmed");
      return {
        ok: true,
        already: true,
        entity_type: "lead_payment",
        entity_id: lpId,
        payment_id: payId,
      };
    }
    return {
      ok: false,
      message: `lead_payment already confirmed with different ref (${current.transaction_ref})`,
      payment_id: payId,
    };
  }

  const { data: claimed, error: claimErr } = await admin
    .from("lead_payments")
    .update({
      status: "confirmed",
      transaction_ref: payId,
      gateway: opts.gateway,
      ...bankRefPatch,
    })
    .eq("id", lpId)
    .eq("status", "pending")
    .select("id, lead_id, type")
    .maybeSingle();

  if (claimErr) {
    if (claimErr.code === "23505" || /duplicate|unique/i.test(claimErr.message || "")) {
      return {
        ok: true,
        already: true,
        entity_type: "lead_payment",
        entity_id: lpId,
        payment_id: payId,
        message: claimErr.message,
      };
    }
    return { ok: false, message: claimErr.message };
  }

  if (!claimed) {
    const { data: again } = await admin
      .from("lead_payments")
      .select("status, transaction_ref")
      .eq("id", lpId)
      .maybeSingle();
    if (again?.status === "confirmed") {
      return {
        ok: true,
        already: true,
        entity_type: "lead_payment",
        entity_id: lpId,
        payment_id: payId,
      };
    }
    return { ok: false, message: "Could not claim pending lead_payment" };
  }

  if (opts.notify !== false && claimed.lead_id && opts.supabaseUrl && opts.serviceKey) {
    const evt = claimed.type === "application_fee" ? "app_fee_paid" : "payment_received";
    fetch(`${opts.supabaseUrl}/functions/v1/notify-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.serviceKey}` },
      body: JSON.stringify({ event: evt, lead_id: claimed.lead_id, context: { payment_id: lpId } }),
    }).catch((e) => console.error("[gateway-settlement] notify-event failed:", e));
  }

  return {
    ok: true,
    already: claim.already || false,
    entity_type: "lead_payment",
    entity_id: lpId,
    payment_id: payId,
  };
}

/**
 * Best-effort direct receipt-PDF mint. The notify-event → ensureReceipt chain also
 * generates the PDF, but it is fire-and-forget over pg_net/cold-starts and production
 * has shown it silently dropping — leaving lead_payments.receipt_url null and the UI
 * stuck on "Generating…" forever (easebuzz/icici also skip the DB-trigger fallback).
 * Calling generate-payment-receipt directly here closes that gap, mirroring
 * OfflinePaymentDialog. receipt-pdf-backfill-cron is the second safety net.
 */
function fireReceiptPdf(supabaseUrl: string, serviceKey: string, paymentId: string) {
  fetch(`${supabaseUrl}/functions/v1/generate-payment-receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ payment_id: paymentId }),
  }).catch((e) => console.error("[gateway-settlement] receipt pdf mint failed:", e));
}

/**
 * Student fee ledger settlement — never re-applies ledger for an existing capture.
 */
export async function settleStudentFeePayment(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  studentId: string,
  paidAmount: number,
  paymentRef: string | null,
  selection: string,
  waiverAmount: number,
  gateway: GatewayName,
  source: SettlementSource = "unknown",
): Promise<SettlementResult> {
  const payId = String(paymentRef || "").trim();
  if (!payId) return { ok: false, message: "payment ref required for student fee settlement" };

  const claim = await claimGatewayPayment(admin, gateway, payId, {
    context: "student_fee",
    entityType: "student",
    entityId: studentId,
    amount: paidAmount,
    source,
  });
  if (claim.error && !claim.claimed && !claim.already) {
    return { ok: false, message: claim.error, payment_id: payId };
  }

  // Never re-apply ledger for an existing gateway capture.
  const { data: existing } = await admin
    .from("lead_payments")
    .select("id")
    .eq("transaction_ref", payId)
    .maybeSingle();
  if (existing?.id) {
    return {
      ok: true,
      already: true,
      entity_type: "student",
      entity_id: studentId,
      payment_id: payId,
    };
  }

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

  const { data: rows, error: feeErr } = await query.order("due_date", { ascending: true });
  if (feeErr) return { ok: false, message: feeErr.message };
  if (!rows?.length) {
    return { ok: true, already: claim.already, entity_type: "student", entity_id: studentId, payment_id: payId };
  }

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

    const { error: updateErr } = await admin
      .from("fee_ledger")
      .update({ concession: newConcession, paid_amount: newPaid, status: "paid" })
      .eq("id", row.id)
      .in("status", ["due", "overdue"]);
    if (updateErr) return { ok: false, message: updateErr.message };

    ledgerSplits.push({ id: row.id, amount: paidPart, concession: concessionPart });
  }

  const { data: student } = await admin
    .from("students")
    .select("lead_id")
    .eq("id", studentId)
    .maybeSingle();

  let paymentId: string | null = null;
  if (student?.lead_id) {
    const { data: inserted, error: lpErr } = await admin
      .from("lead_payments")
      .insert({
        lead_id: student.lead_id,
        type: "other",
        amount: paidAmount,
        concession_amount: waiver,
        payment_mode: "gateway",
        gateway,
        transaction_ref: payId,
        status: "confirmed",
        applied_to_ledger: true,
        notes: waiver > 0 ? "Course-fee payment with annual Pay All waiver" : "Course-fee instalment via gateway",
      })
      .select("id")
      .maybeSingle();

    if (lpErr) {
      if (lpErr.code === "23505" || /duplicate|unique/i.test(lpErr.message || "")) {
        return {
          ok: true,
          already: true,
          entity_type: "student",
          entity_id: studentId,
          payment_id: payId,
        };
      }
      return { ok: false, message: lpErr.message };
    }
    paymentId = inserted?.id || null;

    if (paymentId && ledgerSplits.length) {
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
        body: JSON.stringify({ event: "payment_received", lead_id: student.lead_id, context: { payment_id: paymentId } }),
      }).catch((e) => console.error("[gateway-settlement] student-fee notify failed:", e));
      fireReceiptPdf(supabaseUrl, serviceKey, paymentId);
    }
  }

  return {
    ok: true,
    already: claim.already || false,
    entity_type: "student",
    entity_id: studentId,
    payment_id: payId,
  };
}

/**
 * Settle a payment_links row at most once (active→paid), then create lead_payments.
 * Used by Razorpay pay-link, Easebuzz surl/webhook, and future gateways.
 */
export async function settlePaymentLink(
  admin: AdminClient,
  supabaseUrl: string,
  serviceKey: string,
  link: {
    id: string;
    purpose: string;
    amount: number | string;
    note?: string | null;
    lead_id?: string | null;
    student_id?: string | null;
    // fee_ledger_id, when present, pins the allocation to one exact ledger row.
    // Copied verbatim onto lead_payments.allocations below, where
    // provision_student_fees honours it.
    allocations?: Array<{ fee_code_id: string; fee_ledger_id?: string; amount: number; label?: string }> | null;
  },
  paymentRef: string,
  gateway: GatewayName,
  source: SettlementSource = "unknown",
): Promise<SettlementResult> {
  const payId = String(paymentRef || "").trim();
  if (!payId) return { ok: false, message: "payment ref required" };

  const claim = await claimGatewayPayment(admin, gateway, payId, {
    context: "payment_link",
    entityType: "payment_link",
    entityId: link.id,
    amount: Number(link.amount),
    source,
  });
  if (claim.error && !claim.claimed && !claim.already) {
    return { ok: false, message: claim.error, payment_id: payId };
  }

  // Idempotency comes from the unique (transaction_ref, type) index on confirmed
  // lead_payments below — NOT from flipping the link's status up front. The link
  // is marked paid only AFTER the payment is booked (finalizeLink), so a failure
  // between the claim and the booking never strands the link as paid-but-unbooked.
  // That used to be un-retryable: a stranded 'paid' link + the gateway_settlements
  // claim both blocked every re-drive, silently swallowing real payments (most
  // often for imported students, whose lead_id is null — see the student branch).
  const releaseClaim = async () => {
    if (claim.claimed) {
      await admin
        .from("gateway_settlements")
        .delete()
        .eq("gateway", gateway)
        .eq("gateway_payment_id", payId);
    }
  };

  const paidAmount = Number(link.amount);
  // When the link carries a per-head breakup, record it on the payment and let
  // provision_student_fees (fired by the lead_payments confirm trigger) map each
  // allocation to the matching fee_ledger heads — instead of the oldest-due sweep.
  const hasAllocations = Array.isArray(link.allocations) && link.allocations.length > 0;

  const notifyPaymentReceived = (leadId: string | null, leadPaymentId: string) => {
    // notify-event is lead-anchored (WhatsApp/email relay); skip it for lead-less
    // (imported) students, but always mint the receipt PDF — it is student-aware
    // and resolves branding off the student's own course→institution chain.
    if (leadId) {
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event: "payment_received",
          lead_id: leadId,
          context: { payment_id: leadPaymentId },
        }),
      }).catch((e) => console.error("[gateway-settlement] payment_link notify failed:", e));
    }
    fireReceiptPdf(supabaseUrl, serviceKey, leadPaymentId);
  };

  // Final step of every branch: back-link the payment and flip the link paid.
  const finalizeLink = async (leadPaymentId: string) => {
    await admin
      .from("payment_links")
      .update({ status: "paid", lead_payment_id: leadPaymentId })
      .eq("id", link.id);
  };

  // A confirmed payment with this transaction_ref already exists (concurrent
  // settle, or a re-drive of a previously-stranded link): heal the link and stop.
  const healFromExisting = async (): Promise<SettlementResult> => {
    const { data: existing } = await admin
      .from("lead_payments")
      .select("id")
      .eq("transaction_ref", payId)
      .eq("status", "confirmed")
      .maybeSingle();
    if (existing?.id) await finalizeLink(existing.id);
    return { ok: true, already: true, entity_type: "payment_link", entity_id: link.id, payment_id: payId };
  };

  if (link.purpose === "pre_admission_token") {
    if (!link.lead_id) {
      await releaseClaim();
      return { ok: false, message: "pre_admission_token link has no lead_id" };
    }
    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: link.lead_id,
        type: "pre_admission_token",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: payId,
        status: "confirmed",
        notes: link.note || "Pre-admission token via payment link",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
        return await healFromExisting();
      }
      await releaseClaim();
      return { ok: false, message: error.message };
    }
    if (lp?.id) {
      await finalizeLink(lp.id);
      notifyPaymentReceived(link.lead_id, lp.id);
    }
    return { ok: true, already: false, entity_type: "payment_link", entity_id: link.id, payment_id: payId };
  }

  if (link.student_id) {
    const { data: student } = await admin
      .from("students").select("lead_id").eq("id", link.student_id).maybeSingle();
    // Imported students have no lead — leadId stays null. lead_payments.lead_id is
    // nullable and the oldest-due sweep below keys on student_id, so the payment
    // books fine without a lead; the receipt PDF resolves branding off the
    // student's own course→institution chain. (Previously this returned early and
    // stranded the already-claimed link as paid-but-unbooked.)
    const leadId = student?.lead_id || link.lead_id || null;

    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: leadId,
        student_id: link.student_id,
        type: "other",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: payId,
        status: "confirmed",
        // With a breakup, leave unapplied so the provision trigger routes it to
        // the chosen heads; otherwise apply oldest-due below as before.
        applied_to_ledger: hasAllocations ? false : true,
        allocations: hasAllocations ? link.allocations : null,
        notes: link.note || "Fee payment via payment link",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
        return await healFromExisting();
      }
      await releaseClaim();
      return { ok: false, message: error.message };
    }
    if (lp?.id) {
      if (hasAllocations) {
        // Breakup routing is handled by provision_student_fees (confirm trigger).
        await finalizeLink(lp.id);
        notifyPaymentReceived(leadId, lp.id);
        return { ok: true, already: false, entity_type: "payment_link", entity_id: link.id, payment_id: payId };
      }
      // Apply amount to oldest due ledger rows (same as pay-link).
      const { data: rows } = await admin
        .from("fee_ledger")
        .select("id, total_amount, paid_amount, concession, balance, due_date, status")
        .eq("student_id", link.student_id)
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
            lead_payment_id: lp.id,
            amount: s.amount,
            notes: "Payment link settlement",
          })),
        );
      }
      await finalizeLink(lp.id);
      notifyPaymentReceived(leadId, lp.id);
    }
    return { ok: true, already: false, entity_type: "payment_link", entity_id: link.id, payment_id: payId };
  }

  if (link.lead_id) {
    const { data: lp, error } = await admin
      .from("lead_payments")
      .insert({
        lead_id: link.lead_id,
        type: "other",
        amount: paidAmount,
        payment_mode: "gateway",
        gateway,
        transaction_ref: payId,
        status: "confirmed",
        // Pre-admission (no student yet): breakup is held and mapped by
        // provision_student_fees once the student ledger is provisioned.
        allocations: hasAllocations ? link.allocations : null,
        notes: link.note || "Custom payment via payment link",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) {
        return await healFromExisting();
      }
      await releaseClaim();
      return { ok: false, message: error.message };
    }
    if (lp?.id) {
      await finalizeLink(lp.id);
      notifyPaymentReceived(link.lead_id, lp.id);
    }
    return { ok: true, already: false, entity_type: "payment_link", entity_id: link.id, payment_id: payId };
  }

  await releaseClaim();
  return { ok: false, message: "Link has no settlement target" };
}
