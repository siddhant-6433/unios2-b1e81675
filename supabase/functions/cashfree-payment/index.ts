const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const appId = Deno.env.get("CASHFREE_APP_ID");
    const secretKey = Deno.env.get("CASHFREE_SECRET_KEY");
    const env = Deno.env.get("CASHFREE_ENV") || "production";

    if (!appId || !secretKey) {
      return new Response(
        JSON.stringify({ error: "Cashfree credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl =
      env === "sandbox"
        ? "https://sandbox.cashfree.com/pg"
        : "https://api.cashfree.com/pg";

    const rawBody = await req.text();
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const { action, ...body } = parsed;

    // ── Create Order ──────────────────────────────────────────────
    if (action === "create-order") {
      const { application_id, amount, customer_name, customer_phone, customer_email } = body;

      if (!application_id || !amount || !customer_phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cashfree order_id max 50 chars, alphanumeric + _ -
      const orderId = `APP_${application_id.replace(/-/g, "_")}_${Date.now()}`;

      const payload = {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: application_id,
          customer_phone: customer_phone.replace(/\D/g, "").slice(-10),
          customer_name: customer_name || "Applicant",
          customer_email: customer_email || "noreply@nimteducation.com",
        },
        order_meta: {
          notify_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/cashfree-payment`,
        },
      };

      const res = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: {
          "x-api-version": "2023-08-01",
          "x-client-id": appId,
          "x-client-secret": secretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[cashfree] create-order error:", data);
        return new Response(
          JSON.stringify({ error: data.message || "Failed to create order" }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          order_id: data.order_id,
          payment_session_id: data.payment_session_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify Payment ─────────────────────────────────────────────
    if (action === "verify-payment") {
      const { order_id } = body;

      if (!order_id) {
        return new Response(
          JSON.stringify({ error: "order_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await fetch(`${baseUrl}/orders/${order_id}`, {
        headers: {
          "x-api-version": "2023-08-01",
          "x-client-id": appId,
          "x-client-secret": secretKey,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: data.message || "Failed to verify payment" }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If paid, also update the application in DB (belt-and-suspenders with webhook)
      if (data.order_status === "PAID") {
        const match = order_id.match(/^APP_(.+)_\d+$/);
        const applicationId = match ? match[1].replace(/_/g, "-") : "";
        if (applicationId) {
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
          await admin
            .from("applications")
            .update({ payment_status: "paid", payment_ref: order_id })
            .eq("application_id", applicationId);
          console.log("[cashfree] verify-payment: updated application", applicationId, "to paid");
        }
      }

      return new Response(
        JSON.stringify({
          order_id: data.order_id,
          order_status: data.order_status, // PAID | ACTIVE | EXPIRED
          order_amount: data.order_amount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Cashfree Webhook ───────────────────────────────────────────
    // Cashfree POSTs payment notifications here (notify_url above)
    if (action === undefined && req.method === "POST") {
      console.log("[cashfree] webhook:", rawBody);

      try {
        const webhook = JSON.parse(rawBody);
        const orderData = webhook?.data?.order;
        const paymentData = webhook?.data?.payment;

        if (orderData && orderData.order_status === "PAID") {
          const orderId = orderData.order_id || "";
          // Extract application_id from order_id: APP_{application_id}_timestamp
          const match = orderId.match(/^APP_(.+)_\d+$/);
          const applicationId = match ? match[1].replace(/_/g, "-") : "";
          const paymentRef = paymentData?.cf_payment_id || orderId;

          if (applicationId) {
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

            const { data: updated, error: dbErr } = await admin
              .from("applications")
              .update({ payment_status: "paid", payment_ref: paymentRef })
              .eq("application_id", applicationId)
              .select("application_id, payment_status");

            console.log("[cashfree] webhook DB update:", JSON.stringify({ updated, dbErr, applicationId, paymentRef }));
          } else {
            console.error("[cashfree] webhook: could not extract application_id from order_id:", orderId);
          }
        }
      } catch (e) {
        console.error("[cashfree] webhook parse error:", e);
      }

      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[cashfree] error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
