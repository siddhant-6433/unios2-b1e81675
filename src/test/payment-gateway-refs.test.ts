import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cashfree = readFileSync("supabase/functions/cashfree-payment/index.ts", "utf8");
const icici = readFileSync("supabase/functions/icici-payment/index.ts", "utf8");
const easebuzz = readFileSync("supabase/functions/easebuzz-payment/index.ts", "utf8");

describe("payment gateway references", () => {
  it("prefixes Cashfree application payment refs before writing applications", () => {
    expect(cashfree).toContain("const paymentRef = `CASHFREE_${order_id}`");
    expect(cashfree).toContain("const paymentRef = `CASHFREE_${paymentData?.cf_payment_id || orderId}`");
    expect(cashfree).toContain("application update failed");
  });

  it("prefixes ICICI application payment refs before writing applications", () => {
    expect(icici).toContain("const appPaymentRef = paymentRef ? `ICICI_${paymentRef}` : null");
    expect(icici).toContain("payment_ref: appPaymentRef");
    expect(icici).toContain("payment_ref: `ICICI_${paymentRef}`");
  });

  it("keeps Easebuzz reconciliation refs source-tagged", () => {
    expect(easebuzz).toContain("RECON_UDF1_");
    expect(easebuzz).toContain("RECON_TXN_");
    expect(easebuzz).toContain("MANUAL_");
  });
});
