// zoho-books-poll (service-role only; run on a schedule via pg_cron)
//
// Zoho webhooks require a paid plan, so instead of the webhook we poll: for every
// consultant payout that has a Zoho bill but isn't paid in UniOs yet, check the
// bill in Zoho and, if it's paid there, mark the UniOs payout paid, capture the
// payment txn reference/date/mode + the vendor-payment PDF, and WhatsApp the
// consultant that the payout was disbursed. Idempotent.
//
// Optional POST body: { payout_id } to (re)process one payout even if already
// paid (backfill txn/PDF); { notify: false } to skip the WhatsApp;
// { force_notify: true } to WhatsApp even for an already-paid payout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zohoConfigured, zohoAccessToken, zohoApi, zohoGetPdf } from "../_shared/zoho.ts";
import { isCronCaller } from "../_shared/service-auth.ts";

const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { "Content-Type": "application/json" } });

const fmtDate = (d: string | null): string => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// Best-effort txn detail extraction from a Zoho bill / payment payload.
function extractPayment(o: any): { payment_id: string | null; reference: string | null; date: string | null; mode: string | null } {
  const out = { payment_id: null as string | null, reference: null as string | null, date: null as string | null, mode: null as string | null };
  const visit = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n.payment_id && !out.payment_id) out.payment_id = String(n.payment_id);
    if ((n.reference_number || n.payment_number) && !out.reference) out.reference = String(n.reference_number || n.payment_number);
    if ((n.date || n.payment_date || n.last_payment_date) && !out.date) out.date = String(n.date || n.payment_date || n.last_payment_date);
    if (n.payment_mode && !out.mode) out.mode = String(n.payment_mode);
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  };
  visit(o);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    // Accept the runtime env key OR the key pg_cron sends (stored in _app_config)
    // OR the x-cron-secret header.
    const authHeader = req.headers.get("Authorization") || "";
    const { data: cfg } = await admin.from("_app_config").select("value").eq("key", "service_role_key").maybeSingle();
    const allowed = [`Bearer ${serviceKey}`];
    if (cfg?.value) allowed.push(`Bearer ${cfg.value}`);
    if (!isCronCaller(req) && !allowed.includes(authHeader)) return json({ error: "Unauthorized" }, 401);
    if (!zohoConfigured()) return json({ error: "Zoho not configured" }, 400);

    const body = await req.json().catch(() => ({}));
    const onlyPayoutId: string | null = body.payout_id || null;
    const notify: boolean = body.notify !== false;
    const forceNotify: boolean = body.force_notify === true;

    let query = admin.from("consultant_payouts")
      .select("id, zoho_bill_id, consultant_id, lead_id, payout_amount, status")
      .not("zoho_bill_id", "is", null);
    query = onlyPayoutId ? query.eq("id", onlyPayoutId) : query.neq("status", "paid").limit(200);
    const { data: pending } = await query;

    const token = await zohoAccessToken();
    let marked = 0;
    let checked = 0;
    for (const p of (pending || [])) {
      checked++;
      const billRes = await zohoApi(token, "GET", `/bills/${p.zoho_bill_id}`);
      const bill = billRes.data?.bill;
      if (!bill) continue;
      const isPaid = bill.status === "paid" || (Number(bill.total) > 0 && Number(bill.balance) === 0);
      if (!isPaid) continue;

      const pay = extractPayment(bill);
      let reference = pay.reference || bill.reference_number || "Zoho Books";
      let mode = pay.mode || "zoho";
      let date = pay.date || bill.last_payment_date || new Date().toISOString().slice(0, 10);
      let proofPath: string | null = null;

      // Real UTR + payment PDF come from the vendor payment itself.
      if (pay.payment_id) {
        const vp = (await zohoApi(token, "GET", `/vendorpayments/${pay.payment_id}`)).data?.vendorpayment;
        if (vp?.reference_number) reference = vp.reference_number;
        if (vp?.payment_mode) mode = vp.payment_mode;
        if (vp?.date) date = vp.date;
        const pdf = await zohoGetPdf(token, `/vendorpayments/${pay.payment_id}`);
        if (pdf) {
          const path = `payouts/${p.id}/zoho-payment-${pay.payment_id}.pdf`;
          const up = await admin.storage.from("consultant-documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
          if (!up.error) proofPath = path;
        }
      }

      const wasPaid = p.status === "paid";
      await admin.from("consultant_payouts").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_mode: mode,
        payment_date: date,
        payment_reference: reference,
        zoho_payment_id: pay.payment_id,
        ...(proofPath ? { payment_proof_path: proofPath } : {}),
      }).eq("id", p.id);
      marked++;

      // Notify the consultant on WhatsApp (newly paid, or forced).
      if (notify && (!wasPaid || forceNotify)) {
        try {
          const { data: c } = await admin.from("consultants").select("name, phone").eq("id", p.consultant_id).maybeSingle();
          const { data: l } = await admin.from("leads").select("name").eq("id", p.lead_id).maybeSingle();
          if (c?.phone) {
            await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({
                template_key: "consultant_payout_disbursed",
                phone: c.phone,
                params: [
                  c.name || "Consultant",
                  Number(p.payout_amount).toLocaleString("en-IN"),
                  l?.name || "candidate",
                  reference,
                  fmtDate(date),
                ],
              }),
            });
          }
        } catch (e) { console.error("payout whatsapp failed", String(e)); }
      }
    }

    // ---- Video bills (same pattern, simpler — no WhatsApp, no PDF) -----------
    if (!onlyPayoutId) {
      const { data: videoBills } = await admin.from("video_bills")
        .select("id, zoho_bill_id, total_amount, status")
        .not("zoho_bill_id", "is", null)
        .neq("status", "paid")
        .limit(200);
      for (const vb of (videoBills || [])) {
        checked++;
        const billRes = await zohoApi(token, "GET", `/bills/${vb.zoho_bill_id}`);
        const bill = billRes.data?.bill;
        if (!bill) continue;
        const isPaid = bill.status === "paid" || (Number(bill.total) > 0 && Number(bill.balance) === 0);
        if (!isPaid) continue;

        const pay = extractPayment(bill);
        await admin.from("video_bills").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          zoho_payment_id: pay.payment_id,
        }).eq("id", vb.id);
        marked++;
      }
    }

    // ---- Fee refunds (same pattern; paid flips the ledger via DB trigger) -----
    if (!onlyPayoutId) {
      const { data: refunds } = await admin.from("fee_refunds")
        .select("id, zoho_bill_id, total_amount, status")
        .not("zoho_bill_id", "is", null)
        .eq("status", "approved")
        .limit(200);
      for (const fr of (refunds || [])) {
        checked++;
        const billRes = await zohoApi(token, "GET", `/bills/${fr.zoho_bill_id}`);
        const bill = billRes.data?.bill;
        if (!bill) continue;
        const isPaid = bill.status === "paid" || (Number(bill.total) > 0 && Number(bill.balance) === 0);
        if (!isPaid) continue;

        const pay = extractPayment(bill);
        await admin.from("fee_refunds").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          zoho_payment_id: pay.payment_id,
          zoho_synced_at: new Date().toISOString(),
        }).eq("id", fr.id);
        marked++;
      }
    }

    return json({ ok: true, checked, marked });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
