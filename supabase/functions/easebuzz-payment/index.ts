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
      const status      = params.get("status") || "";
      const txnid       = params.get("txnid") || "";
      const applicationId = params.get("udf1") || "";
      const easepayid   = params.get("easepayid") || "";
      const email       = params.get("email") || "";
      const firstname   = params.get("firstname") || "";
      const productinfo = params.get("productinfo") || "";
      const amount      = params.get("amount") || "";
      const returnedHash = params.get("hash") || "";

      // Verify reverse hash: SHA512(salt|status|udf10|udf9|...|udf1|email|firstname|productinfo|amount|txnid|key)
      // With udf2-udf10 empty and udf1=applicationId
      const reverseInput = `${merchantSalt}|${status}|||||||||${applicationId}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${merchantKey}`;
      const expectedHash = await sha512(reverseInput);
      const hashValid = expectedHash === returnedHash;

      console.log("[easebuzz] return:", { status, txnid, applicationId, easepayid, hashValid });

      if (status === "success" && hashValid && applicationId) {
        // Update application in DB
        await fetch(
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
        return returnPage("Payment Successful", "Your payment has been received. You may close this window.", true);
      }

      if (status === "failure" || status === "userCancelled") {
        return returnPage("Payment Failed", "Your payment was not completed. Please go back and try again.", false);
      }

      // Unexpected status — still show a message
      return returnPage("Payment Pending", "Your payment status is being verified. Please wait.", false);
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
