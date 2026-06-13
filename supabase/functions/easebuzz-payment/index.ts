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

      // udf3="fee_payment" + udf4=student_id → student fee ledger payment
      if (udf3 === "fee_payment" && udf4 && /^[0-9a-f-]{36}$/i.test(udf4)) {
        if (isSuccess) {
          // SECURITY: reject if EaseBuzz hash is invalid (tampered callback)
          if (!hashValid) {
            console.error("[easebuzz] fee_payment: hash mismatch — rejecting callback for student", udf4);
            return returnPage("Payment Error", "Payment verification failed. Please contact support.", false);
          }

          const paidAmount = parseFloat(amount || "0");

          const { data: ledgerRows } = await admin
            .from("fee_ledger")
            .select("id, total_amount, balance")
            .eq("student_id", udf4)
            .in("status", ["due", "overdue"]);

          const expectedTotal = (ledgerRows || []).reduce((s: number, r: any) => s + Number(r.balance ?? r.total_amount), 0);

          // SECURITY: reject if paid amount doesn't match outstanding balance (tolerance ₹1)
          if (Math.abs(paidAmount - expectedTotal) > 1) {
            console.error("[easebuzz] fee_payment amount mismatch: paid", paidAmount, "expected", expectedTotal, "student", udf4);
            return returnPage("Payment Error", `Amount mismatch (received ₹${paidAmount}, expected ₹${expectedTotal}). Transaction ID: ${easepayid || txnid}. Please contact support.`, false);
          }

          for (const row of ledgerRows || []) {
            await admin
              .from("fee_ledger")
              .update({ paid_amount: row.total_amount, balance: 0, status: "paid" })
              .eq("id", row.id);
          }
          console.log("[easebuzz] fee_payment: marked", ledgerRows?.length ?? 0, "entries paid for student", udf4);

          // Also write a lead_payments row so the receipt, audit trail, and
          // candidate notification all flow through the unified pipeline.
          // applied_to_ledger=true tells provision_student_fees to skip this
          // row (we already updated fee_ledger above).
          const { data: stu } = await admin
            .from("students")
            .select("lead_id")
            .eq("id", udf4)
            .maybeSingle();
          if (stu?.lead_id) {
            const { data: lpIns } = await admin
              .from("lead_payments")
              .insert({
                lead_id: stu.lead_id,
                type: "other",
                amount: paidAmount,
                payment_mode: "gateway",
                gateway: "easebuzz",
                transaction_ref: paymentRef,
                status: "confirmed",
                applied_to_ledger: true,
                notes: "Course-fee instalment via Easebuzz",
              })
              .select("id")
              .maybeSingle();
            if (lpIns?.id) {
              fetch(`${supabaseUrl}/functions/v1/notify-event`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
                body: JSON.stringify({
                  event: "payment_received",
                  lead_id: stu.lead_id,
                  context: { payment_id: lpIns.id },
                }),
              }).catch((e) => console.error("[easebuzz] notify-event invoke failed:", e));
            }
          }
        }
        return returnPage(
          isSuccess ? "Payment Successful" : "Payment Failed",
          isSuccess ? "Your fee payment has been received. You may close this window." : `Payment could not be completed (status: ${status}). Please try again.`,
          isSuccess,
        );
      }

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
        // Fire notify-event directly (it ensures the PDF, then sends WA + email).
        // The DB trigger now skips gateway='easebuzz' rows to avoid duplicates.
        if (isSuccess) {
          const { data: lpRow } = await admin
            .from("lead_payments")
            .select("lead_id, type")
            .eq("id", udf2)
            .maybeSingle();
          if (lpRow?.lead_id) {
            const evt = lpRow.type === "application_fee" ? "app_fee_paid" : "payment_received";
            fetch(`${supabaseUrl}/functions/v1/notify-event`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ event: evt, lead_id: lpRow.lead_id, context: { payment_id: udf2 } }),
            }).catch((e) => console.error("[easebuzz] notify-event invoke failed:", e));
          }
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

        // Fire-and-forget: generate the application-fee receipt PDF so it's
        // ready by the time the candidate lands back on their dashboard.
        fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ application_id: applicationId }),
        }).catch((e) => console.error("[easebuzz] receipt invoke failed:", e));

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

      // Persist the txnid so the manual reconcile button can find the
      // exact transaction later (the apply portal generates txnid with a
      // Date.now() suffix; the reconcile button used to reconstruct it
      // without that suffix and always 404'd against EaseBuzz).
      if (application_id) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const { error: persistErr } = await admin
          .from("applications")
          .update({ pending_txnid: txnid })
          .eq("application_id", application_id);
        if (persistErr) {
          console.warn("[easebuzz] persist pending_txnid failed:", persistErr.message);
          // Non-fatal — continue with payment initiation
        }
      }

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

    // ── Initiate student fee payment ──────────────────────────────────────────
    if (action === "initiate-fee-payment") {
      const { student_id, txnid, productinfo, firstname, email, phone } = body;
      // amount is intentionally NOT taken from the client — computed from DB to prevent underpayment attacks

      if (!student_id || !txnid || !firstname || !phone) {
        return new Response(
          JSON.stringify({ error: "Missing required fields (student_id, txnid, firstname, phone)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch actual outstanding balance from DB — never trust client-supplied amount
      const adminInit = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { data: dueRows, error: dueErr } = await adminInit
        .from("fee_ledger")
        .select("balance")
        .eq("student_id", student_id)
        .in("status", ["due", "overdue"]);

      if (dueErr || !dueRows?.length) {
        return new Response(
          JSON.stringify({ error: "No outstanding fees found for this student" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const totalDue   = dueRows.reduce((s: number, r: any) => s + Number(r.balance), 0);
      const amountStr  = totalDue.toFixed(2);
      const emailStr   = email || "noreply@nimteducation.com";
      const productStr = productinfo || "Fee Payment";
      const selfUrl    = `${supabaseUrl}/functions/v1/easebuzz-payment`;

      // udf3=fee_payment, udf4=student_id — surl handler routes on these
      // Hash: key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt
      const hashInput = `${merchantKey}|${txnid}|${amountStr}|${productStr}|${firstname}|${emailStr}|||fee_payment|${student_id}|||||||${merchantSalt}`;
      const hash = await sha512(hashInput);

      const formData = new URLSearchParams({
        key:         merchantKey,
        txnid,
        amount:      amountStr,
        productinfo: productStr,
        firstname,
        email:       emailStr,
        phone:       phone.replace(/\D/g, "").slice(-10),
        hash,
        udf1: "", udf2: "", udf3: "fee_payment", udf4: student_id, udf5: "",
        surl: selfUrl,
        furl: selfUrl,
      });

      const res = await fetch(`${baseUrl}/payment/initiateLink`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (data.status !== 1) {
        console.error("[easebuzz] initiate-fee-payment error:", data);
        return new Response(
          JSON.stringify({ error: data.error_desc || data.data || "Failed to initiate payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[easebuzz] initiate-fee-payment: txnid", txnid, "student", student_id, "amount", amountStr);

      return new Response(
        JSON.stringify({ txnid, pay_url: `${baseUrl}/pay/${data.data}` }),
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
          gateway: "easebuzz",
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

      // EaseBuzz requires alphanumeric-only txnid (no hyphens). Use the first
      // 8 hex chars of the UUID (no hyphens in this segment) + timestamp.
      const txnid       = `LP${lp.id.slice(0, 8)}${Date.now()}`.slice(0, 50);
      const amountStr   = parseFloat(amount).toFixed(2);
      const emailStr    = email || "noreply@nimteducation.com";
      // EaseBuzz productinfo must not contain special characters like %, (, )
      const rawProduct  = productinfo || (payment_type === "token_fee" ? "Token Fee" : "Fee Payment");
      const productStr  = rawProduct.replace(/[^a-zA-Z0-9 _\-]/g, "").trim() || "Fee Payment";
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
    // Prefer the txnid persisted at initiate (applications.pending_txnid)
    // over a caller-supplied / reconstructed value, since the latter is
    // missing the Date.now() suffix and always 404s against EaseBuzz.
    if (action === "verify-payment") {
      const { txnid: callerTxnid, application_id } = body;

      let txnid = callerTxnid;
      if (application_id) {
        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
        const { data: appRow } = await admin
          .from("applications")
          .select("pending_txnid")
          .eq("application_id", application_id)
          .maybeSingle();
        if (appRow?.pending_txnid) {
          if (callerTxnid && callerTxnid !== appRow.pending_txnid) {
            console.log(`[easebuzz] verify-payment: overriding caller txnid "${callerTxnid}" with persisted "${appRow.pending_txnid}" for ${application_id}`);
          }
          txnid = appRow.pending_txnid;
        }
      }

      if (!txnid) {
        return new Response(
          JSON.stringify({ error: "txnid is required (and applications.pending_txnid is empty for this app — the original txnid was not persisted)" }),
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
      let applicationUpdated = false;
      let applicationUpdateError: string | null = null;
      if (txn?.status?.toLowerCase() === "success") {
        const appId = application_id || txn?.udf1 || "";
        const paymentRef = txn?.easepayid || txnid;
        if (appId) {
          const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
          const { data: updated, error: dbErr } = await admin
            .from("applications")
            .update({ payment_status: "paid", payment_ref: paymentRef })
            .eq("application_id", appId)
            .select("application_id, payment_status");
          if (dbErr) {
            applicationUpdateError = dbErr.message;
            console.error("[easebuzz] verify-payment DB update error:", dbErr.message);
          } else if (!updated?.length) {
            applicationUpdateError = "application_not_found";
            console.error("[easebuzz] verify-payment DB update matched 0 rows for", appId);
          } else {
            applicationUpdated = true;
            console.log("[easebuzz] verify-payment: updated application", appId, "to paid");
          }
        } else {
          applicationUpdateError = "missing_application_id";
        }
      }

      return new Response(
        JSON.stringify({
          txnid: txn?.txnid,
          status: txn?.status,
          amount: txn?.amount,
          easepayid: txn?.easepayid,
          application_updated: applicationUpdated,
          application_update_error: applicationUpdateError,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Manual mark-paid by UTR/reference ───────────────────────────
    // Last-resort reconciliation: when EaseBuzz's own API can't return
    // the txn (UPI-intent payments often disappear from their dashboard
    // for a few hours, and sometimes never resurface), the admin can
    // paste the bank UTR / PhonePe txn id and we mark the application
    // paid directly. The reference goes into payment_ref so the audit
    // trail still has a real receipt link.
    if (action === "mark-paid-manual") {
      const { application_id, reference, note } = body;
      if (!application_id || !reference) {
        return new Response(
          JSON.stringify({ error: "application_id and reference are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      // Sanitise the reference so it's clear in the receipt that this was
      // a manual reconciliation, not a webhook-confirmed payment.
      const refTag = `MANUAL_${reference.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}${note ? "_" + note.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 40) : ""}`;

      // Duplicacy guard: refuse if this reference is already attached to a
      // DIFFERENT paid application. UNIQUE INDEX (uniq_applications_paid_payment_ref)
      // would block it anyway, but pre-check gives a clean error message.
      const { data: existingPaid } = await admin
        .from("applications")
        .select("application_id, full_name")
        .eq("payment_status", "paid")
        .ilike("payment_ref", `%${reference}%`)
        .neq("application_id", application_id)
        .limit(1)
        .maybeSingle();
      if (existingPaid?.application_id) {
        return new Response(
          JSON.stringify({
            error: `Reference "${reference}" is already attached to a different paid application (${existingPaid.application_id} · ${existingPaid.full_name || ""}). Refusing to duplicate.`,
            existing_application_id: existingPaid.application_id,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: updated, error: dbErr } = await admin
        .from("applications")
        .update({ payment_status: "paid", payment_ref: refTag })
        .eq("application_id", application_id)
        .select("application_id, payment_status")
        .maybeSingle();
      if (dbErr) {
        return new Response(
          JSON.stringify({ error: dbErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!updated) {
        return new Response(
          JSON.stringify({ error: "application not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fire-and-forget receipt generation (matches the surl path).
      fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ application_id }),
      }).catch((e) => console.error("[easebuzz] mark-paid-manual: receipt invoke failed:", e));

      return new Response(
        JSON.stringify({ success: true, application_id, payment_ref: refTag }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Reconcile by UDF1 (last-mile webhook recovery) ───────────────
    // UPI-Intent payments routinely miss EaseBuzz's S2S webhook → our
    // `applications.payment_status` stays 'pending' even though EaseBuzz
    // has Settled the money. The single-application `verify-payment`
    // action relies on `pending_txnid` matching what EaseBuzz settled,
    // which breaks on retries / re-initiates.
    //
    // This action bypasses that mismatch entirely: it pulls EaseBuzz's
    // own transaction list for the last N days via the dashboard
    // `/transaction/v2/retrieve/date` API, then matches each successful
    // txn back to our `applications` rows via UDF1 (which we always set
    // to `application_id` at initiate time). On a match — and amount
    // sanity check — we flip the row to paid using the EaseBuzz easepayid
    // as `payment_ref`. The mirror trigger handles lead_payments.
    //
    // Endpoint contract (verified against EaseBuzz Java SDK):
    //   POST https://dashboard.easebuzz.in/transaction/v2/retrieve/date
    //   Body: { key, merchant_email, hash, date_range:{start_date,end_date} }
    //   Hash: SHA512(merchant_key|merchant_email|start_date|end_date|salt)
    //   Dates: YYYY-MM-DD. Response: { status, data: [ {txnid, easepayid,
    //     amount, status, udf1, ...}, ... ] }
    if (action === "reconcile-by-udf1") {
      const merchantEmail = Deno.env.get("EASEBUZZ_MERCHANT_EMAIL");
      if (!merchantEmail) {
        return new Response(
          JSON.stringify({ error: "EASEBUZZ_MERCHANT_EMAIL env var not set" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Bounded window — wider means more EaseBuzz traffic; narrower
      // means recent settlements might miss the sweep. 7 days is enough
      // to cover even slow UPI-Intent settlement (~T+1) with safety.
      const daysBack = Math.min(Math.max(Number(body.days_back) || 7, 1), 30);
      const onlyAppId = (body.application_id as string | undefined)?.trim() || undefined;

      // ISO date format. We also try DD-MM-YYYY below if ISO returns empty —
      // EaseBuzz's docs are inconsistent across SDK versions on this.
      const fmtIso = (d: Date) => d.toISOString().slice(0, 10);                       // YYYY-MM-DD
      const fmtDmy = (d: Date) => { const s = d.toISOString().slice(0,10).split("-"); return `${s[2]}-${s[1]}-${s[0]}`; }; // DD-MM-YYYY
      const endIso   = fmtIso(new Date());
      const startIso = fmtIso(new Date(Date.now() - daysBack * 86400000));
      const endDmy   = fmtDmy(new Date());
      const startDmy = fmtDmy(new Date(Date.now() - daysBack * 86400000));

      // EaseBuzz dashboard endpoints sit on dashboard.* not pay.*
      const dashboardBase = ebEnv === "test"
        ? "https://testdashboard.easebuzz.in"
        : "https://dashboard.easebuzz.in";

      // Try each (date_format, payload_shape) candidate until one returns a
      // populated `data` array. Echo every attempt back in the response so
      // we can see exactly what EaseBuzz returned without grepping logs.
      const candidates: Array<{ label: string; startDate: string; endDate: string; body: any }> = [
        // 1. v2 JSON with ISO dates inside date_range (Java SDK style)
        { label: "v2_iso_daterange", startDate: startIso, endDate: endIso,
          body: { key: merchantKey, merchant_email: merchantEmail, date_range: { start_date: startIso, end_date: endIso } } },
        // 2. v2 JSON with DD-MM-YYYY dates inside date_range
        { label: "v2_dmy_daterange", startDate: startDmy, endDate: endDmy,
          body: { key: merchantKey, merchant_email: merchantEmail, date_range: { start_date: startDmy, end_date: endDmy } } },
        // 3. flat fields (some SDKs send start_date/end_date at top level)
        { label: "v2_iso_flat",      startDate: startIso, endDate: endIso,
          body: { key: merchantKey, merchant_email: merchantEmail, start_date: startIso, end_date: endIso } },
      ];

      const attempts: any[] = [];
      let ebData: any = null;
      let chosen: typeof candidates[number] | null = null;
      // EaseBuzz `/transaction/v2/retrieve/date` paginates at ~20 rows per
      // page. The first page returns a base64 `next` cursor. We MUST follow
      // pagination or we'll miss any successful txn that wasn't in the most
      // recent 20 (which is exactly the Naaz Bano case — her success was on
      // page 2; userCancelled retry was on page 1 and got reported instead).
      const allRows: any[] = [];
      for (const c of candidates) {
        // Hash sequence per Java SDK: merchant_key|merchant_email|start_date|end_date|salt
        const reqHash = await sha512(`${merchantKey}|${merchantEmail}|${c.startDate}|${c.endDate}|${merchantSalt}`);
        let cursor: string | null = null;
        let pageNum = 0;
        let firstParsed: any = null;
        let totalRows = 0;
        let stopReason = "ok";
        while (pageNum < 50) { // hard cap on pages so we can't infinite-loop
          pageNum++;
          const payload: any = { ...c.body, hash: reqHash };
          if (cursor) payload.cursor = cursor;
          let httpStatus = 0; let raw = "";
          try {
            const ebRes = await fetch(`${dashboardBase}/transaction/v2/retrieve/date`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            httpStatus = ebRes.status;
            raw = await ebRes.text();
          } catch (e) {
            stopReason = `fetch_error:${String(e)}`;
            break;
          }
          let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = { _unparsed: raw.slice(0, 500) }; }
          if (pageNum === 1) firstParsed = parsed;
          if (httpStatus !== 200 || parsed?.status === false) { stopReason = `http_${httpStatus}_ebStatus_${parsed?.status}`; break; }
          const pageRows: any[] = Array.isArray(parsed?.data)
            ? parsed.data
            : Array.isArray(parsed?.data?.transaction_details) ? parsed.data.transaction_details : [];
          totalRows += pageRows.length;
          allRows.push(...pageRows);
          // Pagination cursor is at top level on this endpoint (`next`).
          // When it's null/undefined/empty we've reached the end.
          cursor = parsed?.next || null;
          console.log(`[easebuzz] reconcile-by-udf1 attempt=${c.label} page=${pageNum} rows=${pageRows.length} next=${cursor ? "yes" : "no"}`);
          if (!cursor) { stopReason = "exhausted"; break; }
        }
        attempts.push({ label: c.label, pages: pageNum, total_rows: totalRows, stop: stopReason, sample: firstParsed });
        if (totalRows > 0) { ebData = firstParsed; chosen = c; break; }
        if (!ebData && firstParsed) ebData = firstParsed;
      }

      if (!ebData) {
        return new Response(
          JSON.stringify({ error: "EaseBuzz API: no usable response from any attempt", attempts }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const rows: any[] = allRows;
      const byUdf1 = new Map<string, any>();
      for (const t of rows) {
        const st = String(t?.status || t?.txn_status || "").toLowerCase();
        const udf1 = String(t?.udf1 || "").trim();
        if (!udf1) continue;
        if (st !== "success" && st !== "settled" && st !== "captured") continue;
        // Keep the most recent successful txn per udf1 in case the
        // candidate paid twice (duplicate-charge edge case — flag both,
        // but only the first is needed for reconciliation).
        const existing = byUdf1.get(udf1);
        if (!existing) { byUdf1.set(udf1, t); continue; }
        const prev = new Date(existing?.addedon || existing?.transaction_date || 0).getTime();
        const curr = new Date(t?.addedon || t?.transaction_date || 0).getTime();
        if (curr > prev) byUdf1.set(udf1, t);
      }

      // Now pull our pending applications. Scoped to the same window so
      // we don't accidentally revive ancient rows the admin closed.
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      let pq = admin
        .from("applications")
        .select("application_id, fee_amount, payment_status, lead_id")
        .eq("payment_status", "pending")
        .not("application_id", "is", null);
      if (onlyAppId) pq = pq.eq("application_id", onlyAppId);
      else pq = pq.gt("created_at", new Date(Date.now() - (daysBack + 2) * 86400000).toISOString());
      const { data: pending, error: pErr } = await pq;
      if (pErr) {
        return new Response(
          JSON.stringify({ error: pErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const reconciled: any[] = [];
      const skipped: any[] = [];
      for (const app of pending || []) {
        const match = byUdf1.get(String(app.application_id));
        if (!match) { skipped.push({ application_id: app.application_id, reason: "no_match" }); continue; }
        const expected = Number(app.fee_amount || 0);
        const got      = Number(match?.amount || 0);
        // 0.01 tolerance for paise rounding drift.
        if (expected > 0 && Math.abs(expected - got) > 0.01) {
          skipped.push({ application_id: app.application_id, reason: "amount_mismatch", expected, got });
          continue;
        }
        const easepayid  = String(match?.easepayid || match?.mihpayid || match?.txnid || "").trim();
        const refTag     = `RECON_UDF1_${easepayid.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}`;

        // Duplicacy guard: if this easepayid was already attached to a
        // DIFFERENT paid application, abort. The DB has a UNIQUE INDEX on
        // (payment_ref) WHERE payment_status='paid' that would also catch
        // this — but the pre-check gives us a clean skipped-reason instead
        // of a raw constraint violation in the response.
        const { data: existingPaid } = await admin
          .from("applications")
          .select("application_id")
          .eq("payment_status", "paid")
          .or(`payment_ref.ilike.%${easepayid}%`)
          .neq("application_id", app.application_id)
          .limit(1)
          .maybeSingle();
        if (existingPaid?.application_id) {
          skipped.push({
            application_id: app.application_id,
            reason: "payment_ref_already_used",
            other_app: existingPaid.application_id,
            easepayid,
          });
          continue;
        }

        const { error: upErr } = await admin
          .from("applications")
          .update({ payment_status: "paid", payment_ref: refTag })
          .eq("application_id", app.application_id);
        if (upErr) {
          // Including unique-index violations from the new DB guards — these
          // surface as 23505. Treat them as informative skips, not failures.
          skipped.push({ application_id: app.application_id, reason: "db_update_failed", detail: upErr.message });
          continue;
        }

        // Fire-and-forget receipt generation, like surl + mark-paid-manual.
        fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ application_id: app.application_id }),
        }).catch((e) => console.error(`[easebuzz] reconcile-by-udf1 receipt invoke failed (${app.application_id}):`, e));

        reconciled.push({ application_id: app.application_id, easepayid, amount: got, source: "udf1_date_range" });
      }

      // ── Pass 2: per-application fallback via /transaction/v2/retrieve ──
      // EaseBuzz's date-range API doesn't always surface every txn the
      // dashboard shows (Naaz Bano's case — settled txn visible in dashboard
      // but absent from /transaction/v2/retrieve/date). For each remaining
      // pending application with a stored pending_txnid, we hit the per-txn
      // retrieve endpoint — that endpoint powers the dashboard's "Transaction
      // Details" view and sees txns the listing API hides.
      const matchedAppIds = new Set(reconciled.map((r) => r.application_id));
      const stillPending = (pending || []).filter((p) =>
        !matchedAppIds.has(p.application_id),
      );
      const fallback_attempts: any[] = [];
      for (const app of stillPending) {
        // Need a txnid to look up. If pending_txnid is empty, candidate never
        // even reached EaseBuzz's initiate — nothing to verify.
        const txnid = (await admin
          .from("applications")
          .select("pending_txnid")
          .eq("application_id", app.application_id)
          .maybeSingle()).data?.pending_txnid;
        if (!txnid) {
          fallback_attempts.push({ application_id: app.application_id, skipped: "no_pending_txnid" });
          continue;
        }

        // Single-txn retrieve uses different hash: SHA512(key|txnid|salt)
        const hashInput = `${merchantKey}|${txnid}|${merchantSalt}`;
        const hash = await sha512(hashInput);
        const formData = new URLSearchParams({ key: merchantKey, txnid, hash });

        let txn: any = null;
        try {
          const ebRes = await fetch(`${baseUrl}/transaction/v2/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData.toString(),
          });
          const raw = await ebRes.text();
          let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = null; }
          if (parsed?.status === 1) {
            txn = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
          }
        } catch (e) {
          fallback_attempts.push({ application_id: app.application_id, txnid, error: String(e) });
          continue;
        }

        if (!txn || String(txn.status || "").toLowerCase() !== "success") {
          fallback_attempts.push({
            application_id: app.application_id,
            txnid,
            eb_status: txn?.status || "not_found",
          });
          continue;
        }

        const got       = Number(txn.amount || 0);
        const expected  = Number(app.fee_amount || 0);
        if (expected > 0 && Math.abs(expected - got) > 0.01) {
          skipped.push({ application_id: app.application_id, reason: "amount_mismatch_fallback", expected, got });
          continue;
        }
        const easepayid = String(txn.easepayid || txn.mihpayid || txn.txnid || "").trim();
        const refTag    = `RECON_TXN_${easepayid.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80)}`;

        // Duplicacy pre-check (same as the UDF1 pass).
        const { data: existingPaid } = await admin
          .from("applications")
          .select("application_id")
          .eq("payment_status", "paid")
          .ilike("payment_ref", `%${easepayid}%`)
          .neq("application_id", app.application_id)
          .limit(1)
          .maybeSingle();
        if (existingPaid?.application_id) {
          skipped.push({
            application_id: app.application_id,
            reason: "payment_ref_already_used_fallback",
            other_app: existingPaid.application_id,
            easepayid,
          });
          continue;
        }

        const { error: upErr } = await admin
          .from("applications")
          .update({ payment_status: "paid", payment_ref: refTag })
          .eq("application_id", app.application_id);
        if (upErr) {
          skipped.push({ application_id: app.application_id, reason: "db_update_failed_fallback", detail: upErr.message });
          continue;
        }

        fetch(`${supabaseUrl}/functions/v1/generate-application-fee-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ application_id: app.application_id }),
        }).catch((e) => console.error(`[easebuzz] reconcile-by-udf1 fallback receipt invoke failed (${app.application_id}):`, e));

        reconciled.push({ application_id: app.application_id, easepayid, amount: got, source: "per_txn_retrieve" });
        fallback_attempts.push({ application_id: app.application_id, txnid, easepayid, status: "marked_paid" });
      }

      console.log(`[easebuzz] reconcile-by-udf1 done: scanned=${pending?.length ?? 0} matched=${reconciled.length} (udf1=${reconciled.filter(r => r.source === "udf1_date_range").length}, fallback=${reconciled.filter(r => r.source === "per_txn_retrieve").length}) skipped=${skipped.length}`);

      // Flat summary fields — one paste from DevTools tells us exactly
      // what UDF1 values EaseBuzz returned vs what's in our pending set,
      // without having to expand the deep response tree.
      const eb_udf1_values = [...byUdf1.entries()].map(([udf1, t]) => ({
        udf1,
        txnid: t?.txnid,
        easepayid: t?.easepayid || t?.mihpayid,
        amount: Number(t?.amount ?? 0),
        status: t?.status,
        firstname: t?.firstname,
        email: t?.email,
        addedon: t?.addedon || t?.transaction_date,
      }));
      const pending_application_ids = (pending || []).map((p) => ({
        application_id: p.application_id,
        fee_amount: Number(p.fee_amount ?? 0),
      }));
      // Find near-matches (case-insensitive, trimmed, or substring) — helps
      // diagnose if it's a format issue rather than a true no-match.
      const ebSet = new Set(eb_udf1_values.map(x => String(x.udf1).toLowerCase().trim()));
      const near_matches = pending_application_ids.filter(p => {
        const lower = String(p.application_id).toLowerCase().trim();
        if (ebSet.has(lower)) return true;
        for (const ebVal of ebSet) {
          if (ebVal.includes(lower) || lower.includes(ebVal)) return true;
        }
        return false;
      });

      return new Response(
        JSON.stringify({
          ok: true,
          window: { start_iso: startIso, end_iso: endIso, days_back: daysBack },
          chosen_attempt: chosen?.label || null,
          eb_txns_in_window: rows.length,
          eb_successful_with_udf1: byUdf1.size,
          pending_scanned: pending?.length ?? 0,
          reconciled,
          skipped_count: skipped.length,
          // Flat summary fields — these are what you'll inspect in DevTools
          eb_udf1_values,
          pending_application_ids: pending_application_ids.slice(0, 20),
          near_matches,
          fallback_attempts: fallback_attempts.slice(0, 30),
          // Full attempts kept for deep debugging if needed
          attempts,
          skipped: skipped.slice(0, 10),
        }),
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
