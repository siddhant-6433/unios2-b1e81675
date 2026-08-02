// zoho-books-poll (service-role only; run on a schedule via pg_cron)
//
// Zoho webhooks require a paid plan, so instead of the webhook we poll: for every
// consultant payout that has a Zoho bill but isn't paid in UniOs yet, check the
// bill in Zoho and, if it's paid there, mark the UniOs payout paid and capture the
// payment txn details. Idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zohoConfigured, zohoAccessToken, zohoApi } from "../_shared/zoho.ts";

const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { "Content-Type": "application/json" } });

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
    if ((req.headers.get("Authorization") || "") !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);
    if (!zohoConfigured()) return json({ error: "Zoho not configured" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
    const { data: pending } = await admin.from("consultant_payouts")
      .select("id, zoho_bill_id")
      .not("zoho_bill_id", "is", null)
      .neq("status", "paid")
      .limit(200);
    if (!pending?.length) return json({ ok: true, checked: 0, marked: 0 });

    const token = await zohoAccessToken();
    let marked = 0;
    let logged = false;
    for (const p of pending) {
      const res = await zohoApi(token, "GET", `/bills/${p.zoho_bill_id}`);
      const bill = res.data?.bill;
      if (!bill) continue;
      const isPaid = bill.status === "paid" || (Number(bill.total) > 0 && Number(bill.balance) === 0);
      if (!isPaid) continue;
      if (!logged) { console.log("zoho paid bill sample", JSON.stringify(bill).slice(0, 3000)); logged = true; }
      const pay = extractPayment(bill);
      await admin.from("consultant_payouts").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_mode: pay.mode || "zoho",
        payment_date: pay.date || bill.last_payment_date || new Date().toISOString().slice(0, 10),
        payment_reference: pay.reference || bill.reference_number || "Zoho Books",
        zoho_payment_id: pay.payment_id,
      }).eq("id", p.id);
      marked++;
    }
    return json({ ok: true, checked: pending.length, marked });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
