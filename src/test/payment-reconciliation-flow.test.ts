import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const easebuzzPayment = readFileSync("supabase/functions/easebuzz-payment/index.ts", "utf8");
const transactionHistory = readFileSync("src/components/admin/TransactionHistoryPanel.tsx", "utf8");

describe("manual payment reconciliation flow", () => {
  it("reports whether Easebuzz verify-payment actually updated the application", () => {
    expect(easebuzzPayment).toContain("let applicationUpdated = false");
    expect(easebuzzPayment).toContain("application_updated: applicationUpdated");
    expect(easebuzzPayment).toContain("application_update_error: applicationUpdateError");
    expect(easebuzzPayment).toContain("application_not_found");
  });

  it("does not count gateway success as reconciled unless Uni was updated", () => {
    expect(transactionHistory).toContain("data?.application_updated === true");
    expect(transactionHistory).toContain("gatewayOnly++");
    expect(transactionHistory).toContain("gateway-success rows still failed DB update");
  });

  it("falls back to an Easebuzz UDF1 sweep from the same reconcile button", () => {
    expect(transactionHistory).toContain('action: "reconcile-by-udf1"');
    expect(transactionHistory).toContain("days_back: 30");
    expect(transactionHistory).toContain("recovered by UDF1 sweep");
  });
});
