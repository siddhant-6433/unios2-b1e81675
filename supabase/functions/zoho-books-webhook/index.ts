// zoho-books-webhook (public — verify_jwt = false)
//
// Called by a Zoho Books webhook when a bill is paid (Automation -> Webhooks,
// on "Payment for a Bill" or bill status change). Marks the matching UniOs
// consultant payout as paid. Idempotent: paying inside UniOs also fires this,
// which is then a no-op.
//
// Configure the Zoho webhook URL with the shared secret, e.g.:
//   https://<project>.functions.supabase.co/zoho-books-webhook?secret=<ZOHO_WEBHOOK_SECRET>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { "Content-Type": "application/json" } });

// Pull every plausible bill identifier out of an arbitrary Zoho payload.
function collectBillRefs(payload: any): { billIds: string[]; refs: string[] } {
  const billIds = new Set<string>();
  const refs = new Set<string>();
  const visit = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (o.bill_id) billIds.add(String(o.bill_id));
    if (o.reference_number) refs.add(String(o.reference_number));
    for (const v of Object.values(o)) if (v && typeof v === "object") visit(v);
  };
  visit(payload);
  return { billIds: [...billIds], refs: [...refs] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("ZOHO_WEBHOOK_SECRET");
    const provided = url.searchParams.get("secret") || req.headers.get("x-zoho-webhook-secret");
    if (!secret || provided !== secret) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const { billIds, refs } = collectBillRefs(payload);
    if (billIds.length === 0 && refs.length === 0) return json({ ok: true, note: "no bill refs in payload" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // Match by Zoho bill id, or by our reference_number (= payout id).
    const orParts: string[] = [];
    if (billIds.length) orParts.push(`zoho_bill_id.in.(${billIds.join(",")})`);
    if (refs.length) orParts.push(`id.in.(${refs.join(",")})`);
    const { data: payouts } = await admin.from("consultant_payouts").select("id, status").or(orParts.join(","));
    const toPay = (payouts || []).filter((p: { status: string }) => p.status !== "paid").map((p: { id: string }) => p.id);

    if (toPay.length) {
      await admin.from("consultant_payouts").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_mode: "zoho",
        payment_date: new Date().toISOString().slice(0, 10),
        payment_reference: "Zoho Books",
      }).in("id", toPay);
    }
    return json({ ok: true, marked_paid: toPay.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
