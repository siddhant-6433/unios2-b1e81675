import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const sql = readMigration("receipt_edit_syncs_ledger");
const dialog = readFileSync("src/components/finance/PaymentEditDialog.tsx", "utf8");
const studentPanel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");

describe("receipt edit keeps the fee ledger in sync", () => {
  it("unapplies this receipt's links newest-head-first, not another receipt on the same month", () => {
    expect(sql).toContain("_unapply_lead_payment_links");
    expect(sql).toContain("ORDER BY fl.due_date DESC NULLS LAST, flp.applied_at DESC NULLS LAST, flp.id DESC");
    expect(sql).not.toContain("_move_fee_ledger_payment_links(_from_id");
    expect(sql).toContain("WHERE flp.lead_payment_id = _payment_id");
  });

  it("clamps allocated-to-ledger when the receipt amount is reduced", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.edit_lead_payment(");
    expect(sql).toContain("IF v_linked > _amount + 0.009 THEN");
    expect(sql).toContain("PERFORM public._unapply_lead_payment_links(_id, v_linked - _amount)");
  });

  it("unapplies the receipt before deleting it so paid_amount cannot outlive the row", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_lead_payment(");
    expect(sql).toContain("PERFORM public._unapply_lead_payment_links(_id, v_linked)");
    expect(sql).toContain("DELETE FROM public.lead_payments WHERE id = _id");
  });

  it("repairs receipts that already have more applied than the receipt amount", () => {
    expect(sql).toContain("COALESCE(x.linked, 0) > lp.amount + 0.009");
    expect(sql).toContain("Repair: receipt");
  });

  it("does not expose the internal unapply helper to the browser role", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public._unapply_lead_payment_links(uuid, numeric)",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.unapply_lead_payment_from_ledger(uuid, text, numeric)",
    );
  });
});

describe("school receipt correction notices", () => {
  it("does not treat a lead-less payment as missing", () => {
    expect(sql).toContain("SELECT lead_id, student_id, type INTO v_lead_id, v_student_id, v_type");
    expect(sql).toContain("IF NOT FOUND THEN");
    expect(sql).toContain("IF v_lead_id IS NULL THEN");
    expect(sql).toContain("RETURN;");
    expect(sql).not.toMatch(/IF v_lead_id IS NULL THEN\s+RAISE EXCEPTION 'Payment % not found'/);
  });

  it("regenerates the PDF from the client when there is no admission lead", () => {
    expect(dialog).toContain("generate-payment-receipt");
    expect(dialog).toContain('body: { payment_id: payment.id }');
    expect(dialog).toContain("School receipts have no admission lead");
  });
});

describe("receipt edit UI lock", () => {
  it("locks the amount while the receipt is still applied to fee heads", () => {
    expect(dialog).toContain("Unassign from the ledger first");
    expect(dialog).toContain("Locked while this receipt is applied to fee heads");
    expect(dialog).toContain("disabled={amountLocked}");
    expect(dialog).toContain("Unassign excess");
    expect(dialog).toContain("Unassign all");
  });

  it("lets the cashier reassign the corrected amount onto specific heads", () => {
    expect(dialog).toContain("Reassign to fee heads");
    expect(dialog).toContain("apply_lead_payment_allocations");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.apply_lead_payment_allocations(");
  });

  it("threads student + ledger rows into the edit dialog from the collect panel", () => {
    expect(studentPanel).toContain("studentId={student.id}");
    expect(studentPanel).toContain("fees={fees}");
    expect(studentPanel).toContain("lead_id, student_id, notes");
  });
});
