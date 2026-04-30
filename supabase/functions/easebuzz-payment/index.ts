import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function returnPage(title: string, message: string, isSuccess: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: white; border-radius: 16px; padding: 40px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { margin: 0 0 8px; font-size: 18px; color: #0f172a; }
    p { margin: 0 0 24px; font-size: 14px; color: #64748b; }
    button { background: #6366f1; color: white; border: none; border-radius: 10px; padding: 10px 24px; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h2>${title}</h2>
    <p>${message}</p>
    <button onclick="window.close()">Close</button>
  </div>
  <script>
    // Notify parent window if same origin
    try { window.opener && window.opener.postMessage({ eb_payment: "${isSuccess ? "success" : "failed"}" }, "*"); } catch(e) {}
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const merchantKey  = Deno.env.get("EASEBUZZ_KEY");
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT");
    const ebEnv        = Deno.env.get("EASEBUZZ_ENV") || "production";
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!merchantKey || !merchantSalt) {
      return new Response(
        JSON.stringify({ error: "EaseBuzz credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = ebEnv === "test"
      ? "https://testpay.easebuzz.in"
      : "https://pay.easebuzz.in";

    const rawBody = await req.text();
    const contentType = req.headers.get("content-type") || "";

    // ── EaseBuzz Return POST (surl / furl) ─────────────────────────
    // EaseBuzz posts form-encoded data back to our surl/furl
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);

      // Log ALL fields EaseBuzz sends so we can debug
      const allFields: Record<string, string> = {};
      params.forEach((v, k) => { allFields[k] = v; });
      console.log("[easebuzz] surl POST fields:", JSON.stringify(allFields));

      const status       = params.get("status") || "";
      const txnid        = params.get("txnid") || "";
      const applicationId = params.get("udf1") || "";
      const easepayid    = params.get("easepayid") || params.get("mihpayid") || "";
      const email        = params.get("email") || "";
      const firstname    = params.get("firstname") || "";
      const productinfo  = params.get("productinfo") || "";
      const amount       = params.get("amount") || "";
      const returnedHash = params.get("hash") || "";

      // Collect all udf values as EaseBuzz sends them (for accurate hash verification)
      const udf1  = params.get("udf1")  || "";
      const udf2  = params.get("udf2")  || "";
      const udf3  = params.get("udf3")  || "";
      const udf4  = params.get("udf4")  || "";
      const udf5  = params.get("udf5")  || "";
      const udf6  = params.get("udf6")  || "";
      const udf7  = params.get("udf7")  || "";
      const udf8  = params.get("udf8")  || "";
      const udf9  = params.get("udf9")  || "";
      const udf10 = params.get("udf10") || "";

      // Verify hash for audit logging (not used as gate — EaseBuzz hash docs vary by plan)
      const reverseInput = `${merchantSalt}|${status}|${udf10}|${udf9}|${udf8}|${udf7}|${udf6}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${merchantKey}`;
      const expectedHash = await sha512(reverseInput);
      const hashValid = expectedHash === returnedHash;

      console.log("[easebuzz] return parsed:", { status, txnid, applicationId, easepayid, hashValid });

      const isSuccess = status.toLowerCase() === "success";
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const paymentRef = easepayid || txnid || null;

      // udf2 carries the pre-created lead_payments.id when this is a lead-side
      // payment (token_fee / application_fee for a lead). Update that row's
      // status — the AFTER trigger will then auto-advance the lead's stage and
      // issue PAN / AN as the threshold is crossed.
      if (udf2 && /^[0-9a-f-]{36}$/i.test(udf2)) {
        const newStatus = isSuccess ? "confirmed" : "pending"; // failed → leave pending so user can retry
        const { error: lpErr } = await admin
          .from("lead_payments")
          .update({ status: newStatus, transaction_ref: paymentRef })
          .eq("id", udf2);
        if (lpErr) {
          console.error("[easebuzz] lead_payments update error:", lpErr.message);
          return returnPage("Payment Received", "Payment confirmed but our records could not be updated. Please contact support. Txn: " + (easepayid || txnid), false);
        }
        // Fire receipt generator (PDF + WhatsApp + email). Don't block the user.
        if (isSuccess) {
          fetch(`${supabaseUrl}/functions/v1/generate-payment-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ lead_payment_id: udf2 }),
          }).catch((e) => console.error("[easebuzz] receipt invoke failed:", e));
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess ? "Your payment has been received. The receipt has been emailed to you. You may close this window." : `Payment could not be completed (status: ${status}). Please try again.`,
          isSuccess,
        );
      }

      if (isSuccess) {
        if (!applicationId) {
          console.error("[easebuzz] missing udf1 (application_id) in return POST — fields:", JSON.stringify(allFields));
          return returnPage("Payment Received", "Payment received but could not be linked automatically. Please contact support with transaction ID: " + (easepayid || txnid), false);
        }

        // Update application in DB — trust EaseBuzz's status=success from surl
        const { data: updated, error: dbErr } = await admin
          .from("applications")
          .update({ payment_status: "paid", payment_ref: paymentRef })
          .eq("application_id", applicationId)
          .select("application_id, payment_status");

        console.log("[easebuzz] DB update result:", JSON.stringify({ updated, dbErr, applicationId, paymentRef }));

        if (dbErr) {
          console.error("[easebuzz] DB update error:", dbErr.message, dbErr.code, dbErr.details);
          return returnPage("Payment Received", "Payment confirmed but could not update your application automatically. Please contact support. Transaction ID: " + (easepayid || txnid), false);
        }

        if (!updated || updated.length === 0) {
          console.error("[easebuzz] DB update matched 0 rows for application_id:", applicationId);
          return returnPage("Payment Received", "Payment confirmed but application not found. Please contact support. Transaction ID: " + (easepayid || txnid), false);
        }

        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      console.log("[easebuzz] non-success status received:", status);
      return returnPage("Payment Failed", `Payment could not be completed (status: ${status}). Please go back and try again.`, false);
    }

    // ── JSON actions (called from our frontend) ────────────────────
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate Payment ───────────────────────────────────────────
    if (action === "initiate") {
      const { application_id, txnid, amount, productinfo, firstname, email, phone } = body;

      if (!txnid || !amount || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const amountStr  = parseFloat(amount).toFixed(2);
      const emailStr   = email || "noreply@nimteducation.com";
      const productStr = productinfo || "Application Fee";
      const udf1       = application_id || "";

      // Hash: SHA512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      // udf1 = application_id, udf2-udf5 empty, then 6 more empty slots before salt
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|${udf1}||||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const selfUrl = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      const formData = new URLSearchParams({
        key:         merchantKey,
        txnid:       txnid,
        amount:      amountStr,
        productinfo: productStr,
        firstname:   firstname,
        email:       emailStr,
        phone:       phone.replace(/\D/g, "").slice(-10),
        hash:        hash,
        udf1:        udf1,
        udf2: "", udf3: "", udf4: "", udf5: "",
        surl:        selfUrl,
        furl:        selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate error:", data);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          txnid,
          pay_url: `${baseUrl}/pay/${data.data}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Initiate LEAD-side payment (token_fee / application_fee for a lead) ─
    // Pre-creates a pending lead_payments row so the surl handler has a precise
    // row to flip to status='confirmed'. The AFTER trigger on lead_payments
    // does the rest (stage advance, PAN/AN issuance).
    if (action === "initiate-lead-payment") {
      const { lead_id, payment_type, amount, productinfo, firstname, email, phone, payment_mode, concession_amount, waiver_reason, concession_breakdown } = body;

      if (!lead_id || !payment_type || !amount || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields (lead_id, payment_type, amount, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!["application_fee","token_fee","registration_fee","other"].includes(payment_type)) {
        return new Response(
          JSON.stringify({ error: "Invalid payment_type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      // Pre-insert pending lead_payments row.
      const { data: lp, error: lpErr } = await admin
        .from("lead_payments")
        .insert({
          lead_id,
          type: payment_type,
          amount: parseFloat(amount),
          payment_mode: payment_mode || "gateway",
          status: "pending",
          concession_amount: concession_amount ? parseFloat(concession_amount) : 0,
          waiver_reason: waiver_reason || null,
          concession_breakdown: concession_breakdown || null,
        } as any)
        .select("id")
        .single();
      if (lpErr || !lp?.id) {
        console.error("[easebuzz] lead_payments pre-insert error:", lpErr?.message);
        return new Response(
          JSON.stringify({ error: lpErr?.message || "Failed to record payment intent" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const txnid       = `LP-${lp.id.slice(0, 8)}-${Date.now()}`;
      const amountStr   = parseFloat(amount).toFixed(2);
      const emailStr    = email || "noreply@nimteducation.com";
      const productStr  = productinfo || (payment_type === "token_fee" ? "Token Fee" : "Fee Payment");
      const udf1        = lead_id;
      const udf2        = lp.id;
      const udf3        = payment_type;

      // Hash: SHA512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|${udf1}|${udf2}|${udf3}||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const selfUrl = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      const formData = new URLSearchParams({
        key: merchantKey, txnid, amount: amountStr, productinfo: productStr,
        firstname, email: emailStr, phone: phone.replace(/\D/g, "").slice(-10),
        hash, udf1, udf2, udf3, udf4: "", udf5: "",
        surl: selfUrl, furl: selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate-lead-payment error:", data);
        // Roll back the pending row so we don't leak intent rows.
        await admin.from("lead_payments").delete().eq("id", lp.id);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ txnid, lead_payment_id: lp.id, pay_url: `${baseUrl}/pay/${data.data}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify Payment (fallback manual check) ─────────────────────
    if (action === "verify-payment") {
      const { txnid, application_id } = body;
      if (!txnid) {
        return new Response(
          JSON.stringify({ error: "txnid is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const hashInput = `${merchantKey}|${txnid}|${merchantSalt}`;
      const hash = await sha512(hashInput);
      const formData = new URLSearchParams({ key: merchantKey, txnid, hash });

      const res = await fetch(`${baseUrl}/transaction/v2/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();
      if (!res.ok || data.status !== 1) {
        return new Response(
          JSON.stringify({ error: data.error_desc || "Failed to verify payment" }),
          { status: res.ok ? 400 : res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const txn = Array.isArray(data.data) ? data.data[0] : data.data;

      // If payment is confirmed as success, update the DB directly
      // (covers cases where surl callback was missed — popup closed early, etc.)
      if (txn?.status?.toLowerCase() === "success") {
        const appId = application_id || txn?.udf1 || "";
        const paymentRef = txn?.easepayid || txnid;
        if (appId) {
          const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
          const { error: dbErr } = await admin
            .from("applications")
            .update({ payment_status: "paid", payment_ref: paymentRef })
            .eq("application_id", appId);
          if (dbErr) {
            console.error("[easebuzz] verify-payment DB update error:", dbErr.message);
          } else {
            console.log("[easebuzz] verify-payment: updated application", appId, "to paid");
          }
        }
      }

      return new Response(
        JSON.stringify({ txnid: txn?.txnid, status: txn?.status, amount: txn?.amount, easepayid: txn?.easepayid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[easebuzz] error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
