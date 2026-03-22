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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const merchantKey  = Deno.env.get("EASEBUZZ_KEY");
    const merchantSalt = Deno.env.get("EASEBUZZ_SALT");
    const ebEnv        = Deno.env.get("EASEBUZZ_ENV") || "production"; // 'test' | 'production'

    if (!merchantKey || !merchantSalt) {
      return new Response(
        JSON.stringify({ error: "EaseBuzz credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl =
      ebEnv === "test"
        ? "https://testpay.easebuzz.in"
        : "https://pay.easebuzz.in";

    const rawBody = await req.text();
    const parsed  = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Initiate Payment ───────────────────────────────────────────
    if (action === "initiate") {
      const { txnid, amount, productinfo, firstname, email, phone } = body;

      if (!txnid || !amount || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const amountStr   = parseFloat(amount).toFixed(2);
      const emailStr    = email || "noreply@nimteducation.com";
      const productStr  = productinfo || "Application Fee";

      // EaseBuzz hash: SHA512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|||||||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const formData = new URLSearchParams({
        key:         merchantKey,
        txnid:       txnid,
        amount:      amountStr,
        productinfo: productStr,
        firstname:   firstname,
        email:       emailStr,
        phone:       phone.replace(/\D/g, "").slice(-10),
        hash:        hash,
        udf1: "", udf2: "", udf3: "", udf4: "", udf5: "",
        surl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/easebuzz-payment?action=webhook`,
        furl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/easebuzz-payment?action=webhook`,
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
          access_key:   data.data,
          merchant_key: merchantKey,
          env:          ebEnv,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify Payment ─────────────────────────────────────────────
    if (action === "verify-payment") {
      const { txnid } = body;

      if (!txnid) {
        return new Response(
          JSON.stringify({ error: "txnid is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Retrieve hash: SHA512(key|txnid|salt)
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

      // EaseBuzz statuses: success | failed | pending | cancelled | bounced
      const txn = Array.isArray(data.data) ? data.data[0] : data.data;
      return new Response(
        JSON.stringify({
          txnid:   txn?.txnid,
          status:  txn?.status,   // 'success' means paid
          amount:  txn?.amount,
          easepayid: txn?.easepayid,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── EaseBuzz Webhook (surl / furl) ─────────────────────────────
    if (action === "webhook" || (action === undefined && req.method === "POST")) {
      console.log("[easebuzz] webhook:", rawBody);
      return new Response("ok", { status: 200, headers: corsHeaders });
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
