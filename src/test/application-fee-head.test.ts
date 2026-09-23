import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260922061648_application_fee_head_reconciliation.sql",
  "utf8",
);
const panel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");
const edgeFn = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");

describe("application fee head", () => {
  it("resolves the app-fee code by enrollment category, never bare %FORM%", () => {
    // UNIFORM has category 'other' but its code contains "FORM", so a bare
    // ILIKE '%FORM%' wrongly treats it as the application-fee code.
    expect(migration).toContain("AND fc.category = 'enrollment'");
    expect(migration).toContain("reconcile_application_fee");
  });

  it("repairs existing app-fee links off course heads", () => {
    expect(migration).toContain("'app_fee_head_repair'");
    expect(migration).toContain("NOT (fc.code IN ('FORM-FEE','MR-REG','NB-REG')");
  });

  it("edge provisioner no longer credits app fees to the seat-block", () => {
    expect(edgeFn).not.toContain("remainingApplicationCredit");
    expect(edgeFn).toContain("reconcile_application_fee");
  });

  it("panel excludes the application fee head from the course totals", () => {
    expect(panel).toContain("isApplicationFeeRow");
    expect(panel).toContain("billableFees");
  });
});
