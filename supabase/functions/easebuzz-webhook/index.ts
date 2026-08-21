/**
 * EaseBuzz Server-to-Server (S2S) webhook handler.
 *
 * Settlement is at-most-once via ../_shared/gateway-settlement.ts
 * (gateway_settlements unique claim + entity status transitions).
 *
 * Configure in EaseBuzz dashboard:
 *   Settings → Webhook → URL =
 *   https://deylhigsisuexszsmypq.supabase.co/functions/v1/easebuzz-webhook
 *   Events = Transaction Successful + Transaction Failed
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  settleApplicationFee,
  settleLeadPaymentRow,
  settlePaymentLink,
  settleStudentFeePayment,
} from "../_shared/gateway-settlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha512(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-512", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const merchantKey  = Deno.env.get("EASEBUZZ_KEY")  || Deno.env.get("EASEBUZZ_MERCHANT_KEY")  || "";
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT") || Deno.env.get("EASEBUZZ_MERCHANT_SALT") || "";
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!merchantKey || !merchantSalt) {
      console.error("[easebuzz-webhook] missing EASEBUZZ_KEY/SALT");
      return new Response(JSON.stringify({ error: "Not configured" }), { status: 503, headers: corsHeaders });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: corsHeaders });
    }

    const params = new URLSearchParams(rawBody);
    const txnid       = params.get("txnid")       || "";
    const easepayid   = params.get("easepayid")   || "";
    const status      = (params.get("status")     || "").toLowerCase();
    const amount      = params.get("amount")      || "";
    const productinfo = params.get("productinfo") || "";
    const firstname   = params.get("firstname")   || "";
    const email       = params.get("email")       || "";
    const udf1        = params.get("udf1")        || "";
    const udf2        = params.get("udf2")        || "";
    const udf3        = params.get("udf3")        || "";
    const udf4        = params.get("udf4")        || "";
    const udf5        = params.get("udf5")        || "";
    const udf6        = params.get("udf6")        || "";
    const udf7        = params.get("udf7")        || "";
    const udf8        = params.get("udf8")        || "";
    const udf9        = params.get("udf9")        || "";
    const udf10       = params.get("udf10")       || "";
    const postedHash  = (params.get("hash")       || "").toLowerCase();

    console.log(`[easebuzz-webhook] received: status=${status} txnid=${txnid} easepayid=${easepayid} amount=${amount} udf1="${udf1}"`);

    const hashInput = [
      merchantSalt,
      status,
      udf10, udf9, udf8, udf7, udf6,
      udf5, udf4, udf3, udf2, udf1,
      email, firstname, productinfo, amount, txnid, merchantKey,
    ].join("|");
    const expectedHash = await sha512(hashInput);
    if (postedHash && postedHash !== expectedHash) {
      console.warn(`[easebuzz-webhook] hash mismatch — ignoring`);
      return new Response(JSON.stringify({ ok: true, ignored: "hash_mismatch" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (status !== "success") {
      console.log(`[easebuzz-webhook] non-success (${status}); no action`);
      return new Response(JSON.stringify({ ok: true, status }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const paymentRef = easepayid || txnid;
    if (!paymentRef) {
      return new Response(JSON.stringify({ ok: true, ignored: "no_payment_ref" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Path 0: payment link (udf3=payment_link, udf1=payment_links.id)
    if (udf3 === "payment_link" && udf1 && /^[0-9a-f-]{36}$/i.test(udf1)) {
      const { data: plink } = await admin.from("payment_links").select("*").eq("id", udf1).maybeSingle();
      if (!plink) {
        return new Response(JSON.stringify({ ok: true, ignored: "payment_link_not_found" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const settled = await settlePaymentLink(
        admin, supabaseUrl, serviceKey, plink, paymentRef, "easebuzz", "webhook",
      );
      if (!settled.ok) {
        console.error("[easebuzz-webhook] payment_link settle failed:", settled.message);
        return new Response(JSON.stringify({ error: settled.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[easebuzz-webhook] payment_link ${udf1} settled (already=${!!settled.already})`);
      return new Response(JSON.stringify({ ok: true, already: settled.already, payment_link_id: udf1, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Path 1: student fee
    if (udf3 === "fee_payment" && udf4 && /^[0-9a-f-]{36}$/i.test(udf4)) {
      const paidAmount = parseFloat(amount || "0");
      const settled = await settleStudentFeePayment(
        admin, supabaseUrl, serviceKey, udf4, paidAmount, paymentRef, udf5, Number(udf6 || 0), "easebuzz", "webhook",
      );
      if (!settled.ok) {
        console.error("[easebuzz-webhook] fee_payment settlement failed:", settled.message);
        return new Response(JSON.stringify({ ok: true, ignored: "settlement_failed", message: settled.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[easebuzz-webhook] fee_payment student ${udf4} settled (already=${!!settled.already}) ref ${paymentRef}`);
      return new Response(JSON.stringify({ ok: true, already: settled.already, student_id: udf4, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Path 2: lead payment
    const leadPaymentId = udf2 || null;
    if (leadPaymentId && /^[0-9a-f-]{36}$/i.test(leadPaymentId)) {
      const settled = await settleLeadPaymentRow(admin, leadPaymentId, paymentRef, {
        gateway: "easebuzz",
        bankRefNum: params.get("bank_ref_num"),
        source: "webhook",
        notify: true,
        supabaseUrl,
        serviceKey,
      });
      if (!settled.ok) {
        console.error(`[easebuzz-webhook] lead_payment settle failed:`, settled.message);
        return new Response(JSON.stringify({ error: settled.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[easebuzz-webhook] lead_payment ${leadPaymentId} settled (already=${!!settled.already})`);
      return new Response(JSON.stringify({ ok: true, already: settled.already, lead_payment_id: leadPaymentId, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Path 3: application fee
    let applicationId: string | null = udf1 || null;
    if (!applicationId && txnid) {
      const { data: byTxn } = await admin
        .from("applications")
        .select("application_id")
        .eq("pending_txnid", txnid)
        .maybeSingle();
      if (byTxn?.application_id) applicationId = byTxn.application_id;
    }

    if (applicationId) {
      const settled = await settleApplicationFee(admin, supabaseUrl, serviceKey, applicationId, paymentRef, {
        gateway: "easebuzz",
        orderId: txnid || null,
        source: "webhook",
        fireReceipt: true,
      });
      if (!settled.ok) {
        console.error(`[easebuzz-webhook] application settle failed:`, settled.message);
        return new Response(JSON.stringify({ error: settled.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log(`[easebuzz-webhook] application ${applicationId} settled (already=${!!settled.already})`);
      return new Response(JSON.stringify({ ok: true, already: settled.already, application_id: applicationId, payment_ref: paymentRef }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.warn(`[easebuzz-webhook] no application_id / lead_payment_id — txnid=${txnid}`);
    return new Response(JSON.stringify({ ok: true, ignored: "no_target", txnid }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[easebuzz-webhook] crash:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
