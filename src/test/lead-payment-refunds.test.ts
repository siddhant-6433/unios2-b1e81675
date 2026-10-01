import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const leadLedger = read("src/components/finance/LeadFeeLedger.tsx");
const collections = read("src/pages/FeeCollections.tsx");
const dialog = read("src/components/finance/RefundDialog.tsx");
const refundsPage = read("src/pages/Refunds.tsx");
const refundActions = read("src/lib/leadRefundActions.ts");
const migrationPath = readdirSync("supabase/migrations").find((f) => f.endsWith("_lead_payment_refunds.sql"))!;
const multiReceiptMigrationPath = readdirSync("supabase/migrations").find((f) => f.endsWith("_lead_multi_receipt_refunds.sql"))!;
const syncSafetyMigrationPath = readdirSync("supabase/migrations").find((f) => f.endsWith("_lead_refund_sync_idempotency_and_cent_validation.sql"))!;
const migration = read(`supabase/migrations/${migrationPath}`);
const multiReceiptMigration = read(`supabase/migrations/${multiReceiptMigrationPath}`);
const syncSafetyMigration = read(`supabase/migrations/${syncSafetyMigrationPath}`);
const zohoSync = read("supabase/functions/zoho-refund-sync/index.ts");

describe("lead payment refunds", () => {
  it("offers one lead-level action and loads all eligible receipts", () => {
    expect(leadLedger).toContain("hasEligibleLeadRefundPayment(payments)");
    expect(refundActions).toContain('payment.status === "confirmed" && payment.type !== "application_fee"');
    expect(leadLedger).toContain('hasPermission("finance:refund")');
    expect(leadLedger).toContain('onClick={() => setRefundOpen(true)}');
    expect(collections).toContain("getLeadRefundActionRows(filtered as any[], canRefund)");
    expect(collections).toContain("refundActionRows.has(p.id)");
    expect(dialog).toContain('"get_refundable_lead_payments"');
    expect(dialog).toContain('"create_lead_refund"');
    expect(collections).toContain('can("finance", "refund")');
  });

  it("submits selected lead receipt amounts while preserving student allocation refunds", () => {
    expect(dialog).toContain("lead_payment_id: r.lead_payment_id");
    expect(dialog).toContain('"get_refundable_allocations"');
    expect(dialog).toContain('"create_fee_refund"');
  });

  it("explains when the required refund RPC is missing from the database schema cache", () => {
    expect(dialog).toContain('error.code === "PGRST202"');
    expect(dialog).toContain("Apply the pending Supabase migrations");
  });

  it("reserves refundable balance atomically and permits later partial refunds", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_lead_payment_refund");
    expect(migration).toContain("WHERE id = _lead_payment_id\n   FOR UPDATE");
    expect(migration).toContain("_amount > v_payment.amount - v_already + 0.009");
    expect(migration).toContain("fr.status <> 'rejected'");
    expect(migration).toContain("v_payment.amount - v_payment_refunded");
    expect(migration).toContain("v_paid_refunds + 0.009 >= v_payment.amount");
  });

  it("releases rejected requests and marks lead receipts refunded only after full payout", () => {
    expect(multiReceiptMigration).toContain("fr.status <> 'rejected'");
    expect(migration).toContain("fr.status = 'paid'");
    expect(migration).toContain("IF v_paid_refunds + 0.009 >= v_payment.amount THEN");
    expect(migration).toContain("UPDATE public.lead_payments SET status = 'refunded'");
    expect(migration).toContain("WHERE id = v_payment.id AND status = 'confirmed'");
  });

  it("shows lead identities in Finance refunds and supports Zoho vendor sync", () => {
    expect(refundsPage).toContain('leads(name, admission_no, pre_admission_no)');
    expect(refundsPage).toContain("r.students?.name || r.leads?.name");
    expect(zohoSync).toContain('admin.from("leads")');
    expect(zohoSync).toContain("const personName = student?.name || lead?.name || \"Candidate\"");
    expect(zohoSync).toContain('admin.rpc("can_manage_fee_refund", { _user: uid })');
    expect(zohoSync).toContain('refund.status !== "paid"');
    expect(zohoSync).toContain('caller.rpc("claim_fee_refund_zoho_payment_sync"');
    expect(zohoSync).toContain('reference_number: refund.payment_reference || undefined');
    expect(zohoSync).toContain('description_contains: `UniOs refund ${refundId}`');
    expect(zohoSync).toContain('if (refund.zoho_payment_id)');
  });

  it("creates multi-receipt lead refunds atomically and excludes ineligible receipts", () => {
    expect(multiReceiptMigration).toContain("public.get_refundable_lead_payments(_lead_id uuid, _student_id uuid)");
    expect(multiReceiptMigration).toContain("public.create_lead_refund(");
    expect(multiReceiptMigration).toContain("FOR UPDATE OF lp");
    expect(multiReceiptMigration).toContain("lp.type <> 'application_fee'");
    expect(multiReceiptMigration).toContain("lp.status = 'confirmed'");
    expect(multiReceiptMigration).toContain("fr.status <> 'rejected'");
  });

  it("enforces cent precision and serializes Zoho payout retries", () => {
    expect(syncSafetyMigration).toContain("total_amount = round(total_amount, 2)");
    expect(syncSafetyMigration).toContain("amount = round(amount, 2)");
    expect(syncSafetyMigration).toContain("claim_fee_refund_zoho_payment_sync");
    expect(syncSafetyMigration).toContain("interval '5 minutes'");
    const authClaimPath = readdirSync("supabase/migrations").find((f) => f.endsWith("_bind_refund_sync_claim_to_auth_user.sql"))!;
    expect(read(`supabase/migrations/${authClaimPath}`)).toContain("auth.uid() IS DISTINCT FROM _user");
  });
});
