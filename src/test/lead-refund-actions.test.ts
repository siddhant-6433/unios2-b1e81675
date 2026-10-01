import { describe, expect, it } from "vitest";
import { getLeadRefundActionRows, hasEligibleLeadRefundPayment } from "@/lib/leadRefundActions";

describe("lead refund action eligibility", () => {
  it("shows a lead-level action only when a confirmed non-application payment exists", () => {
    expect(hasEligibleLeadRefundPayment([
      { id: "pending", status: "pending", type: "token_fee" },
      { id: "application", status: "confirmed", type: "application_fee" },
    ])).toBe(false);
    expect(hasEligibleLeadRefundPayment([
      { id: "confirmed", status: "confirmed", type: "token_fee" },
    ])).toBe(true);
  });

  it("hides Collect refund actions without permission", () => {
    expect(getLeadRefundActionRows([
      { id: "receipt", source: "lead", lead_id: "lead-1", fee_type: "token_fee" },
    ], false)).toEqual(new Set());
  });

  it("offers one action per candidate and excludes application fees and unrelated rows", () => {
    const rows = getLeadRefundActionRows([
      { id: "lead-first", source: "lead", lead_id: "lead-1", student_id: "student-1", fee_type: "token_fee" },
      { id: "lead-second", source: "lead", lead_id: "lead-1", student_id: "student-1", fee_type: "registration_fee" },
      { id: "application", source: "lead", lead_id: "lead-2", fee_type: "application_fee" },
      { id: "student", source: "student", student_id: "student-2", fee_type: "tuition" },
      { id: "missing-person", source: "lead", fee_type: "token_fee" },
      { id: "student-backed-lead", source: "lead", student_id: "student-3", fee_type: "other_fee" },
    ], true);

    expect(rows).toEqual(new Set(["lead-first", "student-backed-lead"]));
  });
});
