import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function returnPage(title: string, message: string, isSuccess: boolean): Response {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}
.card{background:white;border-radius:16px;padding:40px;text-align:center;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.icon{font-size:48px;margin-bottom:16px;}h2{margin:0 0 8px;font-size:18px;color:#0f172a;}
p{margin:0 0 24px;font-size:14px;color:#64748b;}button{background:#6366f1;color:white;border:none;border-radius:10px;padding:10px 24px;font-size:14px;cursor:pointer;}</style></head>
<body><div class="card"><div class="icon">${isSuccess ? "✅" : "❌"}</div><h2>${title}</h2><p>${message}</p><button onclick="window.close()">Close</button></div>
<script>try{window.opener&&window.opener.postMessage({alumni_payment:"${isSuccess ? "success" : "failed"}"},"*");}catch(e){}</script></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const merchantKey = Deno.env.get("EASEBUZZ_KEY");
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT");
    const ebEnv = Deno.env.get("EASEBUZZ_ENV") || "production";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!merchantKey || !merchantSalt) {
      return new Response(JSON.stringify({ error: "Payment gateway not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = ebEnv === "test" ? "https://testpay.easebuzz.in" : "https://pay.easebuzz.in";
    const rawBody = await req.text();
    const contentType = req.headers.get("content-type") || "";

    // ── EaseBuzz Return POST (surl / furl) ──
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      const status = params.get("status") || "";
      const txnid = params.get("txnid") || "";
      const requestId = params.get("udf1") || "";
      const easepayid = params.get("easepayid") || params.get("mihpayid") || "";
      const amount = params.get("amount") || "";

      const isSuccess = status.toLowerCase() === "success";
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      // Log transaction
      await admin.from("pg_transactions").insert({
        txn_id: txnid,
        context: "alumni_service",
        context_id: requestId,
        amount: parseFloat(amount) || 0,
        status: isSuccess ? "success" : "failed",
        gateway: "easebuzz",
        gateway_ref: easepayid || txnid,
        product_info: params.get("productinfo") || "",
        payer_name: params.get("firstname") || "",
        payer_email: params.get("email") || "",
        payer_phone: params.get("phone") || "",
        raw_response: Object.fromEntries(params.entries()),
      }).single();

      if (isSuccess && requestId) {
        await admin.from("alumni_verification_requests")
          .update({
            status: "paid",
            payment_ref: easepayid || txnid,
            payment_method: "easebuzz",
            paid_at: new Date().toISOString(),
          })
          .eq("id", requestId);

        // Send WhatsApp receipt notification
        try {
          const { data: reqData } = await admin.from("alumni_verification_requests")
            .select("request_number, alumni_name, course, requestor_phone, contact_email, fee_amount, request_type")
            .eq("id", requestId).single();

          if (reqData) {
            // WhatsApp to requestor
            await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({
                template_key: "application_received",
                phone: reqData.requestor_phone,
                params: [reqData.alumni_name || "Applicant", reqData.request_number],
              }),
            });
          }
        } catch (e) {
          console.error("[alumni-payment] WhatsApp notification error:", e);
        }

        return returnPage("Payment Successful", `Your payment of ₹${amount} has been received. Request ${requestId ? "is now under review." : ""}`, true);
      }

      return returnPage("Payment Failed", `Payment could not be completed (status: ${status}). Please try again.`, false);
    }

    // ── JSON actions ──
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate Payment ──
    if (action === "initiate") {
      const { request_id, amount, firstname, email, phone, productinfo } = body;

      if (!request_id || !amount || !firstname || !phone) {
        return new Response(JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txnid = `AVR${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const amountStr = parseFloat(amount).toFixed(2);
      const emailStr = email || "noreply@nimteducation.com";
      const productStr = productinfo || "Alumni Service Fee";

      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|${request_id}||||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const selfUrl = `${supabaseUrl}/functions/v1/alumni-payment`;

      const formData = new URLSearchParams({
        key: merchantKey, txnid, amount: amountStr, productinfo: productStr,
        firstname, email: emailStr, phone: phone.replace(/\D/g, "").slice(-10),
        hash, udf1: request_id, udf2: "", udf3: "", udf4: "", udf5: "",
        surl: selfUrl, furl: selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();
      if (data.status !== 1) {
        return new Response(JSON.stringify({ error: data.error_desc || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Log initiated transaction
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      await admin.from("pg_transactions").insert({
        txn_id: txnid, context: "alumni_service", context_id: request_id,
        amount: parseFloat(amountStr), status: "initiated", gateway: "easebuzz",
        payer_name: firstname, payer_email: emailStr, payer_phone: phone,
        product_info: productStr,
      });

      return new Response(JSON.stringify({ txnid, pay_url: `${baseUrl}/pay/${data.data}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Verify Payment ──
    if (action === "verify-payment") {
      const { txnid } = body;
      if (!txnid) return new Response(JSON.stringify({ error: "txnid required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const hashInput = `${merchantKey}|${txnid}|${merchantSalt}`;
      const hash = await sha512(hashInput);

      const res = await fetch(`${baseUrl}/transaction/v2/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: merchantKey, txnid, hash }).toString(),
      });

      const data = await res.json();
      if (!res.ok || data.status !== 1) {
        return new Response(JSON.stringify({ error: data.error_desc || "Verification failed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const txn = Array.isArray(data.data) ? data.data[0] : data.data;
      return new Response(JSON.stringify({
        txnid: txn?.txnid, status: txn?.status, amount: txn?.amount, easepayid: txn?.easepayid,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[alumni-payment] error:", err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
