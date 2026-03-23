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

      // Reverse hash: SHA512(salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
      const reverseInput = `${merchantSalt}|${status}|${udf10}|${udf9}|${udf8}|${udf7}|${udf6}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${merchantKey}`;
      const expectedHash = await sha512(reverseInput);
      const hashValid = expectedHash === returnedHash;

      console.log("[easebuzz] return parsed:", { status, txnid, applicationId, easepayid, hashValid, returnedHash, expectedHash });

      const isSuccess = status.toLowerCase() === "success";

      if (isSuccess && applicationId) {
        if (!hashValid) {
          // Hash mismatch — use verify API as fallback to confirm payment
          console.warn("[easebuzz] hash mismatch on return, verifying via API...");
          const verifyHash = await sha512(`${merchantKey}|${txnid}|${merchantSalt}`);
          const verifyForm = new URLSearchParams({ key: merchantKey, txnid, hash: verifyHash });
          const verifyRes  = await fetch(`${baseUrl}/transaction/v2/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: verifyForm.toString(),
          });
          const verifyData = await verifyRes.json();
          console.log("[easebuzz] verify response:", JSON.stringify(verifyData));

          const txn = Array.isArray(verifyData.data) ? verifyData.data[0] : verifyData.data;
          if (verifyData.status !== 1 || txn?.status?.toLowerCase() !== "success") {
            return returnPage("Payment Pending", "Payment received but verification is pending. Our team will confirm shortly.", false);
          }
        }

        // Update application in DB
        const patchRes = await fetch(
          `${supabaseUrl}/rest/v1/applications?application_id=eq.${encodeURIComponent(applicationId)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({
              payment_status: "paid",
              payment_ref: easepayid || txnid,
            }),
          }
        );
        console.log("[easebuzz] DB patch status:", patchRes.status);
        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      if (!isSuccess) {
        console.log("[easebuzz] non-success status:", status);
        return returnPage("Payment Failed", `Payment could not be completed (${status}). Please go back and try again.`, false);
      }

      // applicationId missing — cannot update DB, but payment may have succeeded
      console.error("[easebuzz] missing applicationId (udf1) in return POST");
      return returnPage("Payment Received", "Payment received but could not be linked to your application. Please contact support with your transaction ID: " + (easepayid || txnid), false);
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

    // ── Verify Payment (fallback manual check) ─────────────────────
    if (action === "verify-payment") {
      const { txnid } = body;
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
