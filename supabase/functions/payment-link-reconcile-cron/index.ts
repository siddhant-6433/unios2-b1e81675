// payment-link-reconcile-cron
//
// Runs every 10 minutes. Finds payment_links with status='active' that have a
// Razorpay gateway_link_id, checks the Razorpay API, and settles any that are
// actually paid. Catches payments missed when the user closes the browser
// before the callback redirect, or when the webhook fails/isn't configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

  if (!keyId || !keySecret) {
    return new Response(JSON.stringify({ error: "Razorpay not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const authHeader = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  // Active links with a Razorpay gateway_link_id — these are the ones at risk.
  const { data: links, error } = await admin
    .from("payment_links")
    .select("id, gateway_link_id, lead_id, student_id, purpose, amount, note")
    .eq("status", "active")
    .eq("gateway", "razorpay")
    .not("gateway_link_id", "is", null)
    .limit(50);

  if (error) {
    console.error("[payment-link-reconcile] query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!links?.length) {
    return new Response(JSON.stringify({ ok: true, checked: 0, settled: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let settled = 0;
  const errors: string[] = [];

  for (const link of links) {
    try {
      const res = await fetch(
        `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(link.gateway_link_id)}`,
        { headers: { Authorization: authHeader } },
      );
      if (!res.ok) {
        errors.push(`${link.id}: razorpay ${res.status}`);
        continue;
      }
      const rpLink = await res.json();
      if (rpLink.status !== "paid") continue;

      // Find the payment ID from the razorpay link's payments array or use the link id.
      const payments = rpLink.payments || {};
      const paymentItems = payments.items || [];
      const capturedPayment =
        paymentItems.find((p: any) => p?.status === "captured") ||
        paymentItems.find((p: any) => p?.status === "authorized");
      const paymentRef = String(capturedPayment?.id || rpLink.id || `plink_${link.id}`);

      // Guard: flip active→paid atomically (same idempotency as pay-link settleLink).
      const { data: claimed } = await admin
        .from("payment_links")
        .update({ status: "paid" })
        .eq("id", link.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (!claimed) continue; // already settled

      const paidAmount = Number(link.amount);
      if (link.purpose === "pre_admission_token") {
        if (!link.lead_id) { errors.push(`${link.id}: no lead_id`); continue; }
        const { data: lp, error: lpErr } = await admin
          .from("lead_payments")
          .insert({
            lead_id: link.lead_id,
            type: "pre_admission_token",
            amount: paidAmount,
            payment_mode: "gateway",
            gateway: "razorpay",
            transaction_ref: paymentRef,
            status: "confirmed",
            notes: "Pre-admission token via payment link (reconciled)",
          } as any)
          .select("id")
          .single();
        if (lpErr) { errors.push(`${link.id}: ${lpErr.message}`); continue; }
        await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
        fireNotify(supabaseUrl, serviceKey, link.lead_id, lp.id);
      } else if (link.student_id) {
        const { data: student } = await admin
          .from("students").select("lead_id").eq("id", link.student_id).maybeSingle();
        const leadId = student?.lead_id || link.lead_id;
        if (!leadId) { errors.push(`${link.id}: no lead for student`); continue; }
        const { data: lp, error: lpErr } = await admin
          .from("lead_payments")
          .insert({
            lead_id: leadId,
            type: "other",
            amount: paidAmount,
            payment_mode: "gateway",
            gateway: "razorpay",
            transaction_ref: paymentRef,
            status: "confirmed",
            applied_to_ledger: true,
            notes: "Fee payment via payment link (reconciled)",
          } as any)
          .select("id")
          .single();
        if (lpErr) { errors.push(`${link.id}: ${lpErr.message}`); continue; }
        await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
        await settleStudentFeeLedger(admin, link.student_id, paidAmount, lp.id);
        fireNotify(supabaseUrl, serviceKey, leadId, lp.id);
      } else if (link.lead_id) {
        const { data: lp, error: lpErr } = await admin
          .from("lead_payments")
          .insert({
            lead_id: link.lead_id,
            type: "other",
            amount: paidAmount,
            payment_mode: "gateway",
            gateway: "razorpay",
            transaction_ref: paymentRef,
            status: "confirmed",
            notes: "Custom payment via payment link (reconciled)",
          } as any)
          .select("id")
          .single();
        if (lpErr) { errors.push(`${link.id}: ${lpErr.message}`); continue; }
        await admin.from("payment_links").update({ lead_payment_id: lp.id } as any).eq("id", link.id);
        fireNotify(supabaseUrl, serviceKey, link.lead_id, lp.id);
      }

      settled++;
      console.log(`[payment-link-reconcile] settled ${link.id} → payment ${paymentRef}`);
    } catch (e) {
      errors.push(`${link.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length) console.error("[payment-link-reconcile] errors:", errors);

  return new Response(
    JSON.stringify({ ok: true, checked: links.length, settled, errors: errors.length ? errors : undefined }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// Fire-and-forget notify for receipt + WhatsApp/email.
function fireNotify(supabaseUrl: string, serviceKey: string, leadId: string, paymentId: string) {
  fetch(`${supabaseUrl}/functions/v1/notify-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      event: "payment_received",
      lead_id: leadId,
      context: { payment_id: paymentId },
    }),
  }).catch((e) => console.error("[payment-link-reconcile] notify failed:", e));
}

// Copied from pay-link: allocate paid amount across student's outstanding fee_ledger rows.
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
        notes: "Payment link settlement (reconciled)",
      })),
    );
  }
}
