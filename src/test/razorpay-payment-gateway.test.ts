import { readFileSync } from "node:fs";

const razorpayFunction = readFileSync("supabase/functions/razorpay-payment/index.ts", "utf8");
const netlifyConfig = readFileSync("netlify.toml", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
const checkoutHelper = readFileSync("src/lib/razorpayCheckout.ts", "utf8");
const paymentSection = readFileSync("src/components/apply/PaymentSection.tsx", "utf8");
const receiptDialog = readFileSync("src/components/receipts/ReceiptDialog.tsx", "utf8");
const applicationReceiptFunction = readFileSync("supabase/functions/generate-application-fee-receipt/index.ts", "utf8");
const paymentReceiptFunction = readFileSync("supabase/functions/generate-payment-receipt/index.ts", "utf8");
const prioritizeRazorpayMigration = readFileSync(
  "supabase/migrations/20260625150000_prioritize_razorpay_gateway.sql",
  "utf8",
);
const settlementMigration = readFileSync(
  "supabase/migrations/20260714160000_razorpay_gateway_settlements.sql",
  "utf8",
);

describe("Razorpay payment gateway wiring", () => {
  it("exposes create-order, verify-payment, and reconcile-order API routes through Netlify", () => {
    expect(netlifyConfig).toContain('from = "/api/create-order"');
    expect(netlifyConfig).toContain("action=create-order");
    expect(netlifyConfig).toContain('from = "/api/verify-payment"');
    expect(netlifyConfig).toContain("action=verify-payment");
    expect(netlifyConfig).toContain('from = "/api/reconcile-order"');
    expect(netlifyConfig).toContain("action=reconcile-order");
  });

  it("keeps the Supabase function public and verifies signatures server-side", () => {
    expect(supabaseConfig).toMatch(/\[functions\.razorpay-payment\]\s+verify_jwt = false/s);
    expect(razorpayFunction).toContain('Deno.env.get("RAZORPAY_KEY_SECRET")');
    expect(razorpayFunction).toContain("hmacSha256Hex(keySecret, `${serverOrderId}|${paymentId}`)");
    expect(razorpayFunction).toContain('return json({ error: "Invalid payment signature" }, 400)');
  });

  it("settles all Standard Checkout contexts through one shared function", () => {
    expect(razorpayFunction).toContain("async function settleFromRazorpayCapture");
    expect(razorpayFunction).toContain('context === "application_fee"');
    expect(razorpayFunction).toContain('context === "token_fee" || context === "lead_payment"');
    expect(razorpayFunction).toContain('context === "student_fee"');
    expect(razorpayFunction).toContain("claimGatewayPayment");
    expect(razorpayFunction).toContain("gateway_settlements");
  });

  it("handles Razorpay payment.captured webhook with signature verification", () => {
    expect(razorpayFunction).toContain('Deno.env.get("RAZORPAY_WEBHOOK_SECRET")');
    expect(razorpayFunction).toContain("x-razorpay-signature");
    expect(razorpayFunction).toContain('eventName !== "payment.captured"');
    expect(razorpayFunction).toContain('eventName === "payment_link.paid"');
    expect(razorpayFunction).toContain('reason: "handled_by_pay_link"');
    expect(razorpayFunction).toContain('source: "webhook"');
  });

  it("can reconcile paid Razorpay orders for all contexts and stranded cron", () => {
    expect(razorpayFunction).toContain('action === "reconcile-order"');
    expect(razorpayFunction).toContain('action === "reconcile-stranded"');
    expect(razorpayFunction).toContain("async function settlePaidOrder");
    expect(razorpayFunction).toContain("firstSettledRazorpayPayment");
    expect(razorpayFunction).toMatch(/orderId,\s*"cron"/);
    expect(razorpayFunction).toContain('parsed.source === "cron"');
  });

  it("prefers claim transitions so double-marking is impossible", () => {
    // Application: only unpaid → paid
    expect(razorpayFunction).toContain('.neq("payment_status", "paid")');
    // Lead payment: only pending → confirmed
    expect(razorpayFunction).toContain('.eq("status", "pending")');
    // Student: skip ledger re-apply when transaction_ref exists
    expect(razorpayFunction).toContain("Never re-apply ledger");
    // Global payment id uniqueness
    expect(settlementMigration).toContain("CONSTRAINT gateway_settlements_payment_uidx UNIQUE (gateway, gateway_payment_id)");
    expect(settlementMigration).toContain("lead_payments_confirmed_gateway_ref_uidx");
    expect(settlementMigration).toContain("applications_paid_gateway_ref_uidx");
    expect(settlementMigration).toContain("razorpay-order-reconcile");
  });

  it("loads Standard Checkout and posts successful payments for verification with reconcile fallback", () => {
    expect(checkoutHelper).toContain("https://checkout.razorpay.com/v1/checkout.js");
    expect(checkoutHelper).toContain('postRazorpay("create-order"');
    expect(checkoutHelper).toContain('postRazorpay("verify-payment"');
    expect(checkoutHelper).toContain('postRazorpay("reconcile-order"');
    expect(checkoutHelper).toContain("razorpay_payment_id");
    expect(checkoutHelper).toContain("razorpay_signature");
    // Dismiss must not cancel once capture is known
    expect(checkoutHelper).toContain("if (capture || settling)");
    // Always fall back to edge invoke
    expect(checkoutHelper).toContain('supabase.functions.invoke("razorpay-payment"');
  });

  it("apply portal razorpay path recovers unpaid UI from DB after verify failure", () => {
    expect(paymentSection).toContain("handlePayRazorpay");
    expect(paymentSection).toContain('context: "application_fee"');
    expect(paymentSection).toContain('eq("application_id", data.application_id)');
    expect(paymentSection).toContain('payment_status === "paid"');
  });

  it("shows Razorpay on all receipt renderers even when only a pay_ reference is present", () => {
    for (const source of [receiptDialog, applicationReceiptFunction, paymentReceiptFunction]) {
      expect(source).toContain('startsWith("pay_")');
      expect(source).toContain('razorpay: "Razorpay"');
    }

    expect(receiptDialog).toContain("gatewayLabelFromReceipt");
    expect(receiptDialog).toContain("Payment Gateway");
    expect(applicationReceiptFunction).toContain("gatewayLabel(payment.gateway, payment.payment_mode, payment.transaction_ref)");
    expect(paymentReceiptFunction).toContain("gatewayLabel(lp.gateway, lp.payment_mode, lp.transaction_ref)");
  });

  it("promotes Razorpay ahead of ICICI and EaseBuzz in existing scoped gateway rules", () => {
    expect(prioritizeRazorpayMigration).toContain("WHEN 'razorpay' THEN 10");
    expect(prioritizeRazorpayMigration).toContain("WHEN 'icici'    THEN 20");
    expect(prioritizeRazorpayMigration).toContain("WHEN 'easebuzz' THEN 30");
    expect(prioritizeRazorpayMigration).toContain("gateway IN ('razorpay', 'icici', 'easebuzz', 'cashfree')");
  });
});
