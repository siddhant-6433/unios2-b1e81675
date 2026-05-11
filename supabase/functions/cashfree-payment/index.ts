const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

async function getAdmin() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

async function markFeeLedgerPaid(admin: any, studentId: string, paidAmount?: number) {
  const { data: rows } = await admin
    .from("fee_ledger")
    .select("id, total_amount, balance")
    .eq("student_id", studentId)
    .in("status", ["due", "overdue"]);

  if (!rows?.length) return 0;

  // SECURITY: validate paid amount matches outstanding balance (tolerance ₹1)
  if (paidAmount !== undefined) {
    const expectedTotal = rows.reduce((s: number, r: any) => s + Number(r.balance ?? r.total_amount), 0);
    if (Math.abs(paidAmount - expectedTotal) > 1) {
      console.error("[cashfree] markFeeLedgerPaid: amount mismatch — paid", paidAmount, "expected", expectedTotal, "student", studentId);
      return -1; // signal mismatch to caller
    }
  }

  for (const row of rows) {
    await admin
      .from("fee_ledger")
      .update({ paid_amount: row.total_amount, balance: 0, status: "paid" })
      .eq("id", row.id);
  }

  console.log("[cashfree] markFeeLedgerPaid: updated", rows.length, "entries for student", studentId);
  return rows.length;
}

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

    // ── Create Order (apply portal — application fee) ─────────────
    if (action === "create-order") {
      const { application_id, amount, customer_name, customer_phone, customer_email } = body;

      if (!application_id || !amount || !customer_phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
        JSON.stringify({ order_id: data.order_id, payment_session_id: data.payment_session_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create Fee Order (student portal — fee ledger payment) ─────
    if (action === "create-fee-order") {
      const { student_id, amount, customer_name, customer_phone, customer_email } = body;

      if (!student_id || !amount || !customer_phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Order ID: FEE_ + first 12 chars of student_id (no dashes) + timestamp
      const studentShort = student_id.replace(/-/g, "").substring(0, 12);
      const orderId = `FEE_${studentShort}_${Date.now()}`;

      const payload = {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: student_id,
          customer_phone: customer_phone.replace(/\D/g, "").slice(-10),
          customer_name: customer_name || "Student",
          customer_email: customer_email || "noreply@nimteducation.com",
        },
        order_tags: {
          type: "fee_payment",
          student_id,
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
        console.error("[cashfree] create-fee-order error:", data);
        return new Response(
          JSON.stringify({ error: data.message || "Failed to create fee order" }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[cashfree] create-fee-order: created order", orderId, "for student", student_id, "amount", amount);

      return new Response(
        JSON.stringify({ order_id: data.order_id, payment_session_id: data.payment_session_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify Payment ─────────────────────────────────────────────
    if (action === "verify-payment") {
      const { order_id, student_id } = body;

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

      if (data.order_status === "PAID") {
        const admin = await getAdmin();
        const paymentRef = order_id;

        // Application fee payment
        if (order_id.startsWith("APP_")) {
          const match = order_id.match(/^APP_(.+)_\d+$/);
          const applicationId = match ? match[1].replace(/_/g, "-") : "";
          if (applicationId) {
            await admin
              .from("applications")
              .update({ payment_status: "paid", payment_ref: paymentRef })
              .eq("application_id", applicationId);
            console.log("[cashfree] verify-payment: updated application", applicationId);
          }
        }

        // Student fee payment — derive student only from Cashfree's order metadata, never from caller
        if (order_id.startsWith("FEE_")) {
          const sid = data.order_tags?.student_id; // intentionally ignores caller-supplied student_id
          if (sid) {
            const result = await markFeeLedgerPaid(admin, sid, Number(data.order_amount));
            if (result === -1) {
              console.error("[cashfree] verify-payment: amount mismatch for student", sid, "order", order_id);
            } else {
              console.log("[cashfree] verify-payment: fee ledger updated for student", sid);
            }
          } else {
            console.error("[cashfree] verify-payment: no student_id in order_tags for", order_id);
          }
        }
      }

      return new Response(
        JSON.stringify({
          order_id: data.order_id,
          order_status: data.order_status,
          order_amount: data.order_amount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Cashfree Webhook ───────────────────────────────────────────
    if (action === undefined && req.method === "POST") {
      console.log("[cashfree] webhook:", rawBody);

      try {
        const webhook = JSON.parse(rawBody);
        const orderData = webhook?.data?.order;
        const paymentData = webhook?.data?.payment;

        if (orderData && orderData.order_status === "PAID") {
          const orderId = orderData.order_id || "";
          const paymentRef = paymentData?.cf_payment_id || orderId;
          const admin = await getAdmin();

          // Application fee payment
          if (orderId.startsWith("APP_")) {
            const match = orderId.match(/^APP_(.+)_\d+$/);
            const applicationId = match ? match[1].replace(/_/g, "-") : "";
            if (applicationId) {
              const { data: updated, error: dbErr } = await admin
                .from("applications")
                .update({ payment_status: "paid", payment_ref: paymentRef })
                .eq("application_id", applicationId)
                .select("application_id, payment_status");
              console.log("[cashfree] webhook APP update:", JSON.stringify({ updated, dbErr }));
            }
          }

          // Student fee payment — use only order_tags.student_id from Cashfree's data
          if (orderId.startsWith("FEE_")) {
            const studentId = orderData.order_tags?.student_id;
            if (studentId) {
              const count = await markFeeLedgerPaid(admin, studentId, Number(orderData.order_amount));
              if (count === -1) {
                console.error("[cashfree] webhook FEE: amount mismatch for student", studentId, "order", orderId);
              } else {
                console.log("[cashfree] webhook FEE: marked", count, "entries paid for student", studentId);
              }
            } else {
              console.error("[cashfree] webhook FEE: no student_id in order_tags for", orderId);
            }
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
