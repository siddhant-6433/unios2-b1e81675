import { readFileSync } from "node:fs";

const razorpayFunction = readFileSync("supabase/functions/razorpay-payment/index.ts", "utf8");
const netlifyConfig = readFileSync("netlify.toml", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
const checkoutHelper = readFileSync("src/lib/razorpayCheckout.ts", "utf8");
const receiptDialog = readFileSync("src/components/receipts/ReceiptDialog.tsx", "utf8");
const applicationReceiptFunction = readFileSync("supabase/functions/generate-application-fee-receipt/index.ts", "utf8");
const paymentReceiptFunction = readFileSync("supabase/functions/generate-payment-receipt/index.ts", "utf8");

describe("Razorpay payment gateway wiring", () => {
  it("exposes create-order and verify-payment API routes through Netlify", () => {
    expect(netlifyConfig).toContain('from = "/api/create-order"');
    expect(netlifyConfig).toContain('action=create-order');
    expect(netlifyConfig).toContain('from = "/api/verify-payment"');
    expect(netlifyConfig).toContain('action=verify-payment');
  });

  it("keeps the Supabase function public and verifies signatures server-side", () => {
    expect(supabaseConfig).toMatch(/\[functions\.razorpay-payment\]\s+verify_jwt = false/s);
    expect(razorpayFunction).toContain('Deno.env.get("RAZORPAY_KEY_SECRET")');
    expect(razorpayFunction).toContain('hmacSha256Hex(keySecret, `${serverOrderId}|${paymentId}`)');
    expect(razorpayFunction).toContain('return json({ error: "Invalid payment signature" }, 400)');
  });

  it("can reconcile paid Razorpay orders when the checkout callback was missed", () => {
    expect(razorpayFunction).toContain('action === "reconcile-order"');
    expect(razorpayFunction).toContain('`/orders/${encodeURIComponent(orderId)}`');
    expect(razorpayFunction).toContain('`/orders/${encodeURIComponent(orderId)}/payments`');
    expect(razorpayFunction).toContain('firstSettledRazorpayPayment');
    expect(razorpayFunction).toContain('update({ payment_status: "paid", payment_ref: paymentId, pending_txnid: orderId })');
    expect(razorpayFunction).toContain("Razorpay order belongs to a different application");
  });

  it("loads Standard Checkout and posts successful payments for verification", () => {
    expect(checkoutHelper).toContain("https://checkout.razorpay.com/v1/checkout.js");
    expect(checkoutHelper).toContain('postRazorpay("create-order"');
    expect(checkoutHelper).toContain('postRazorpay("verify-payment"');
    expect(checkoutHelper).toContain("razorpay_payment_id");
    expect(checkoutHelper).toContain("razorpay_signature");
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
});
