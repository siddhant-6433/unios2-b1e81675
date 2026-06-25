import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reconciliationMigration = readFileSync(
  "supabase/migrations/20260624131000_exact_application_payment_reconciliation.sql",
  "utf8",
);
const receiptFunction = readFileSync(
  "supabase/functions/generate-application-fee-receipt/index.ts",
  "utf8",
);
const easebuzzFunction = readFileSync(
  "supabase/functions/easebuzz-payment/index.ts",
  "utf8",
);

describe("application payment reconciliation", () => {
  it("prefers exact lead_payments.application_id before lead-level fallback", () => {
    const paymentAppId = reconciliationMigration.indexOf("v_payment_app_id := NULLIF");
    const exactMatch = reconciliationMigration.indexOf("a.application_id = v_payment_app_id");
    const legacyFallback = reconciliationMigration.indexOf("Legacy fallback only when the payment does not name an application");
    const latestPending = reconciliationMigration.indexOf("ORDER BY updated_at DESC", legacyFallback);

    expect(paymentAppId).toBeGreaterThan(-1);
    expect(exactMatch).toBeGreaterThan(paymentAppId);
    expect(legacyFallback).toBeGreaterThan(exactMatch);
    expect(latestPending).toBeGreaterThan(legacyFallback);
  });

  it("does not perform a broad historical backfill in the hotfix migration", () => {
    expect(reconciliationMigration).toContain("Historical backfill is intentionally omitted");
    expect(reconciliationMigration).not.toContain("one_pending_app");
    expect(reconciliationMigration).not.toContain("HAVING count(*) = 1");
  });

  it("lets receipt generation attach one safe legacy payment row", () => {
    expect(receiptFunction).toContain('.eq("amount", app.fee_amount)');
    expect(receiptFunction).toContain('.is("application_id", null)');
    expect(receiptFunction).toContain("if ((rows || []).length === 1 && !appIdFromNotes(rows[0].notes))");
    expect(receiptFunction).toContain(".update({ application_id: app.application_id } as any)");
  });

  it("reads amounts from both EaseBuzz retrieve API response shapes", () => {
    expect(easebuzzFunction).toContain("function easebuzzAmount");
    expect(easebuzzFunction).toContain("txn?.amount ?? txn?.total_debit_amount ?? txn?.net_debit_amount");
    expect(easebuzzFunction).toContain("const got      = easebuzzAmount(match)");
    expect(easebuzzFunction).toContain("const got       = easebuzzAmount(txn)");
  });
});
