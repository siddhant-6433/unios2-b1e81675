import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync("src/components/admissions/TransferLeadDialog.tsx", "utf8");

describe("TransferLeadDialog unassign option", () => {
  it("exposes unassign as a select option and writes counsellor_id null", () => {
    expect(dialog).toContain('UNASSIGN_VALUE = "__unassigned__"');
    expect(dialog).toContain("Unassign lead");
    expect(dialog).toContain("targetCounsellorId = isUnassign ? null : selectedCounsellor");
    expect(dialog).toContain("counsellor_id: targetCounsellorId");
    expect(dialog).toContain("Primary counsellor unassigned");
    expect(dialog).toContain("Leads unassigned");
  });
});
