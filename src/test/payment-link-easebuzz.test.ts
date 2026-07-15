import { readFileSync } from "node:fs";

const payLink = readFileSync("supabase/functions/pay-link/index.ts", "utf8");
const createLink = readFileSync("supabase/functions/create-payment-link/index.ts", "utf8");
const easebuzzPayment = readFileSync("supabase/functions/easebuzz-payment/index.ts", "utf8");
const easebuzzWebhook = readFileSync("supabase/functions/easebuzz-webhook/index.ts", "utf8");
const payLinkPage = readFileSync("src/pages/PayLink.tsx", "utf8");
const shared = readFileSync("supabase/functions/_shared/gateway-settlement.ts", "utf8");

describe("Easebuzz payment links", () => {
  it("shared settlePaymentLink exists and claims once", () => {
    expect(shared).toContain("export async function settlePaymentLink");
    expect(shared).toContain('context: "payment_link"');
    expect(shared).toContain('.eq("status", "active")');
  });

  it("pay-link can initiate Easebuzz checkout for a link token", () => {
    expect(payLink).toContain("create-easebuzz-order");
    expect(payLink).toContain('udf3 = "payment_link"');
    expect(payLink).toContain("settlePaymentLink");
    expect(payLink).toContain("payment/initiateLink");
  });

  it("create-payment-link accepts gateway preference and EasyCollect optional path", () => {
    expect(createLink).toContain("gatewayPref");
    expect(createLink).toContain("easebuzzEasyCollectCreateLink");
    expect(createLink).toContain("EASEBUZZ_EASYCOLLECT_URL");
    expect(createLink).toContain('gateway = "easebuzz"');
  });

  it("easebuzz surl and webhook settle payment_link udf", () => {
    expect(easebuzzPayment).toContain('udf3 === "payment_link"');
    expect(easebuzzPayment).toContain("settlePaymentLink");
    expect(easebuzzWebhook).toContain('udf3 === "payment_link"');
    expect(easebuzzWebhook).toContain("settlePaymentLink");
  });

  it("PayLink UI branches Easebuzz vs Razorpay", () => {
    expect(payLinkPage).toContain("handlePayEasebuzz");
    expect(payLinkPage).toContain('gateway: "easebuzz"');
    expect(payLinkPage).toContain("Secured by {gatewayLabel}");
  });
});
