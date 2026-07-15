import { readFileSync } from "node:fs";

const shared = readFileSync("supabase/functions/_shared/gateway-settlement.ts", "utf8");
const easebuzzPayment = readFileSync("supabase/functions/easebuzz-payment/index.ts", "utf8");
const easebuzzWebhook = readFileSync("supabase/functions/easebuzz-webhook/index.ts", "utf8");
const icici = readFileSync("supabase/functions/icici-payment/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260715100000_gateway_settlement_ref_indexes.sql", "utf8");

describe("Easebuzz + ICICI at-most-once settlement", () => {
  it("shared helper claims gateway_settlements and uses status transitions", () => {
    expect(shared).toContain("export async function claimGatewayPayment");
    expect(shared).toContain("export async function settleApplicationFee");
    expect(shared).toContain("export async function settleLeadPaymentRow");
    expect(shared).toContain("export async function settleStudentFeePayment");
    expect(shared).toContain('.neq("payment_status", "paid")');
    expect(shared).toContain('.eq("status", "pending")');
    expect(shared).toContain("Never re-apply ledger for an existing gateway capture");
    expect(shared).toContain("gateway_settlements");
  });

  it("easebuzz-payment uses shared settler for app / lead / student", () => {
    expect(easebuzzPayment).toContain('from "../_shared/gateway-settlement.ts"');
    expect(easebuzzPayment).toContain("settleApplicationFee");
    expect(easebuzzPayment).toContain("settleLeadPaymentRow");
    expect(easebuzzPayment).toContain("settleStudentFeePayment");
    // No local double-settlement student fee function
    expect(easebuzzPayment).not.toContain("async function settleStudentFeePayment(");
    // Application path must not bare-update without claim
    expect(easebuzzPayment).not.toMatch(
      /\.from\("applications"\)\s*\n\s*\.update\(\{\s*payment_status:\s*"paid"/,
    );
  });

  it("easebuzz-webhook uses shared settler for all three paths", () => {
    expect(easebuzzWebhook).toContain('from "../_shared/gateway-settlement.ts"');
    expect(easebuzzWebhook).toContain("settleApplicationFee");
    expect(easebuzzWebhook).toContain("settleLeadPaymentRow");
    expect(easebuzzWebhook).toContain("settleStudentFeePayment");
    expect(easebuzzWebhook).toContain('source: "webhook"');
  });

  it("icici-payment uses shared settler for callback / verify / cron", () => {
    expect(icici).toContain('from "../_shared/gateway-settlement.ts"');
    expect(icici).toContain("settleApplicationFee");
    expect(icici).toContain("settleLeadPaymentRow");
    expect(icici).toContain("settleStudentFeePayment");
    expect(icici).toContain('source: "callback"');
    expect(icici).toContain('source: "verify"');
    expect(icici).toContain('source: "cron"');
  });

  it("broadens unique indexes for Easebuzz E* and ICICI numeric bank refs", () => {
    expect(migration).toContain("lead_payments_confirmed_gateway_ref_uidx");
    expect(migration).toContain("E[0-9]");
    expect(migration).toContain("^[0-9]{10,}$");
  });
});
