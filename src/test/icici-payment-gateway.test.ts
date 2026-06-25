import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
const iciciSource = readFileSync("supabase/functions/icici-payment/index.ts", "utf8");
const transactionHistoryPanel = readFileSync("src/components/admin/TransactionHistoryPanel.tsx", "utf8");
const scopedGatewayMigration = readFileSync(
  "supabase/migrations/20260624100200_scoped_payment_gateway_rules.sql",
  "utf8",
);

describe("ICICI payment gateway wiring", () => {
  it("keeps the ICICI callback endpoint public for gateway redirects", () => {
    expect(supabaseConfig).toMatch(/\[functions\.icici-payment\]\s+verify_jwt = false/s);
  });

  it("verifies production callbacks with bad signatures against ICICI status before mutating records", () => {
    const signatureCheck = iciciSource.indexOf("const sigCheck = await verifySignature(fields, apiKey)");
    const invalidGuard = iciciSource.indexOf('if (!sigCheck.valid && env === "production")');
    const statusCheck = iciciSource.indexOf('transactionType: "STATUS"', invalidGuard);
    const statusSettled = iciciSource.indexOf("const statusSettled =", statusCheck);
    const acceptedAfterStatus = iciciSource.indexOf("accepted invalid callback signature after STATUS verification", statusSettled);
    const leadMutation = iciciSource.indexOf('.from("lead_payments")', invalidGuard);
    const applicationMutation = iciciSource.indexOf('.from("applications")', invalidGuard);

    expect(signatureCheck).toBeGreaterThan(-1);
    expect(invalidGuard).toBeGreaterThan(signatureCheck);
    expect(statusCheck).toBeGreaterThan(invalidGuard);
    expect(statusSettled).toBeGreaterThan(statusCheck);
    expect(acceptedAfterStatus).toBeGreaterThan(statusSettled);
    expect(leadMutation).toBeGreaterThan(acceptedAfterStatus);
    expect(applicationMutation).toBeGreaterThan(acceptedAfterStatus);
  });

  it("supports ICICI student-fee and alumni-service initiation without lead payment coupling", () => {
    expect(iciciSource).toContain('action === "initiate-fee-payment"');
    expect(iciciSource).toContain('addlParam1:       "student_fee"');
    expect(iciciSource).toContain('action === "initiate-alumni-payment"');
    expect(iciciSource).toContain('addlParam1:       "alumni_service"');
    expect(iciciSource).toContain('.from("pg_transactions").insert');
  });

  it("uses ICICI's distinct production and UAT endpoint bases", () => {
    expect(iciciSource).toContain('"https://pgpay.icicibank.com/pg/api"');
    expect(iciciSource).toContain('"https://pgpayuat.icicibank.com/tsp/pg/api"');
    expect(iciciSource).toContain('const initiateUrl = `${baseUrl}/v2/initiateSale`');
    expect(iciciSource).toContain('const commandUrl  = `${baseUrl}/command`');
  });

  it("validates application-fee amount server-side before ICICI initiation", () => {
    const initiatePath = iciciSource.indexOf('action === "initiate"');
    const appLookup = iciciSource.indexOf('.from("applications")', initiatePath);
    const expectedAmount = iciciSource.indexOf("const expectedAmount = Number(appRow.fee_amount || 0)", initiatePath);
    const mismatchGuard = iciciSource.indexOf("Amount does not match application fee", initiatePath);
    const payloadAmount = iciciSource.indexOf("amount:           expectedAmount.toFixed(2)", initiatePath);

    expect(initiatePath).toBeGreaterThan(-1);
    expect(appLookup).toBeGreaterThan(initiatePath);
    expect(expectedAmount).toBeGreaterThan(appLookup);
    expect(mismatchGuard).toBeGreaterThan(expectedAmount);
    expect(payloadAmount).toBeGreaterThan(mismatchGuard);
  });

  it("persists ICICI application txn ids and wires finance reconciliation to ICICI", () => {
    expect(iciciSource).toContain('.update({ pending_txnid: String(txnid) })');
    expect(transactionHistoryPanel).toContain('pending_txnid');
    expect(transactionHistoryPanel).toContain('action: "verify-payment"');
    expect(transactionHistoryPanel).toContain('supabase.functions.invoke("icici-payment"');
    expect(transactionHistoryPanel).toContain('Reconcile ICICI');
    expect(transactionHistoryPanel).toContain('Verify ICICI');
  });

  it("seeds scoped defaults with Easebuzz public and ICICI staff-pilot-only", () => {
    expect(scopedGatewayMigration).toContain("'easebuzz', true, false, 30");
    expect(scopedGatewayMigration).toContain("'icici', true, true, 20");
    expect(scopedGatewayMigration).toContain("payment_context IN ('application_fee', 'token_fee', 'student_fee', 'alumni_service')");
    expect(scopedGatewayMigration).toContain("scope_type IN ('global', 'institution_group', 'campus', 'institution', 'institution_type')");
  });
});
