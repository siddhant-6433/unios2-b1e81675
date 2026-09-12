import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const sql = readMigration("apply_receipts_blocked_by_overcredited_ledger");

describe("blocked receipts apply after an over-credit clamp", () => {
  it("re-runs provision after unapplying so waiting receipts can land", () => {
    expect(sql).toContain("_drain_unapplied_student_receipts");
    expect(sql).toContain("PERFORM public._drain_unapplied_student_receipts(");
    expect(sql).toContain("provision_student_fees_for_student");
  });

  it("repairs student receipts that have allocations but no ledger links", () => {
    expect(sql).toContain("lp.applied_to_ledger = false");
    expect(sql).toContain("jsonb_array_length(lp.allocations) > 0");
    expect(sql).toContain("NOT EXISTS (");
    expect(sql).toContain("flp.lead_payment_id = lp.id");
  });

  it("parks a fully unapplied receipt so provision cannot sweep it onto the earliest due month", () => {
    expect(sql).toContain("THEN true");
    expect(sql).toContain("THEN '[]'::jsonb");
  });

  it("does not expose the drain helper to the browser role", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public._drain_unapplied_student_receipts(uuid, uuid)",
    );
  });
});
