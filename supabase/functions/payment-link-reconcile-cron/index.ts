// payment-link-reconcile-cron
//
// Runs every 10 minutes. Safety net for payment_links whose settlement was
// missed — the user closed the browser before the callback/surl, or the webhook
// failed/isn't configured. Covers BOTH gateways:
//   • Razorpay: check the payment_links API.
//   • EaseBuzz: single-txn retrieve by our txnid (gateway_link_id `PL…`).
// Any that the gateway reports as paid are settled via the shared
// settlePaymentLink — the same at-most-once path the webhook/surl use, so a
// lead-less (imported) student books correctly and nothing is stranded.
//
// It also re-drives PARTIAL strands: status='paid' with lead_payment_id IS NULL
// (a settlement that claimed the link but died before booking). settlePaymentLink
// is idempotent (unique confirmed transaction_ref), so re-driving is safe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { settlePaymentLink } from "../_shared/gateway-settlement.ts";
import { easebuzzRetrieveHosts, easebuzzRetrieveTxn, isEasebuzzSuccess } from "../_shared/easebuzz.ts";
import { pickCapturedPaymentId } from "./razorpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Link = {
  id: string;
  gateway: string | null;
  gateway_link_id: string | null;
  lead_id: string | null;
  student_id: string | null;
  purpose: string;
  amount: number | string;
  note: string | null;
  allocations: any;
  status: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Links at risk: still active, OR claimed-but-unbooked (partial strand).
  const { data: links, error } = await admin
    .from("payment_links")
    .select("id, gateway, gateway_link_id, lead_id, student_id, purpose, amount, note, allocations, status")
    .not("gateway_link_id", "is", null)
    .in("gateway", ["razorpay", "easebuzz"])
    .or("status.eq.active,and(status.eq.paid,lead_payment_id.is.null)")
    .limit(100);

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

  // Razorpay creds (optional — skip razorpay links if absent).
  const rzpId = Deno.env.get("RAZORPAY_KEY_ID");
  const rzpSecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const rzpAuth = rzpId && rzpSecret ? `Basic ${btoa(`${rzpId}:${rzpSecret}`)}` : null;

  // EaseBuzz creds (optional — skip easebuzz links if absent).
  const ebKey = Deno.env.get("EASEBUZZ_KEY");
  const ebSalt = Deno.env.get("EASEBUZZ_SALT");
  const ebHosts = easebuzzRetrieveHosts(Deno.env.get("EASEBUZZ_ENV") || "production");

  let settled = 0;
  const errors: string[] = [];

  for (const link of links as Link[]) {
    try {
      // Resolve the real gateway payment id if the gateway says this is paid.
      const paymentRef = link.gateway === "razorpay"
        ? await razorpayPaidRef(link, rzpAuth, errors)
        : link.gateway === "easebuzz"
        ? await easebuzzPaidRef(link, ebKey, ebSalt, ebHosts, errors)
        : null;
      if (!paymentRef) continue;

      const res = await settlePaymentLink(
        admin,
        supabaseUrl,
        serviceKey,
        {
          id: link.id,
          purpose: link.purpose,
          amount: link.amount,
          note: link.note,
          lead_id: link.lead_id,
          student_id: link.student_id,
          allocations: link.allocations,
        },
        paymentRef,
        link.gateway as any,
        "reconcile",
      );
      if (res.ok && !res.already) {
        settled++;
        console.log(`[payment-link-reconcile] settled ${link.id} → ${paymentRef}`);
      } else if (!res.ok) {
        errors.push(`${link.id}: ${res.message}`);
      }
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

/** Returns the captured payment id if Razorpay reports the link paid, else null. */
async function razorpayPaidRef(
  link: Link,
  authHeader: string | null,
  errors: string[],
): Promise<string | null> {
  if (!authHeader) return null;
  // expand[]=payments so payments.items is populated — otherwise Razorpay returns
  // payments:null and we'd fall back to the LINK id (plink_…), which is NOT idempotent
  // against the webhook/manual path that records the real payment id (pay_…) →
  // duplicate lead_payments / double-counted revenue.
  const res = await fetch(
    `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(link.gateway_link_id!)}?expand[]=payments`,
    { headers: { Authorization: authHeader } },
  );
  if (!res.ok) { errors.push(`${link.id}: razorpay ${res.status}`); return null; }
  const rpLink = await res.json();
  if (rpLink.status !== "paid") return null;
  // Settle ONLY under the real captured payment id (pay_…). If we can't resolve it,
  // skip this pass rather than booking under the link id — the unique transaction_ref
  // index dedups pay_… against the webhook/manual record; a link id would not.
  const payId = pickCapturedPaymentId(rpLink);
  if (!payId) { errors.push(`${link.id}: razorpay paid but no captured payment id`); return null; }
  return payId;
}

/** Returns the easepayid if EaseBuzz reports the txn successful, else null. */
async function easebuzzPaidRef(
  link: Link,
  key: string | undefined,
  salt: string | undefined,
  hosts: string[],
  errors: string[],
): Promise<string | null> {
  if (!key || !salt) return null;
  const { txn, error } = await easebuzzRetrieveTxn(link.gateway_link_id!, {
    merchantKey: key,
    merchantSalt: salt,
    hosts,
  });
  if (!txn) { if (error && error !== "eb_no_data") errors.push(`${link.id}: eb ${error}`); return null; }
  if (!isEasebuzzSuccess(txn)) return null;
  // Prefer the gateway's own payment id (easepayid) so the gateway_settlements
  // claim + lead_payments.transaction_ref match the surl/webhook that may also fire.
  return String(txn.easepayid || link.gateway_link_id);
}
