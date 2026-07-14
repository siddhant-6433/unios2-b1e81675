import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const portal = readFileSync("src/pages/ApplicantPortal.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260714120000_applicant_lead_info_include_phone.sql",
  "utf8",
);

describe("token fee payment phone resolution", () => {
  it("falls back to lead phone when login profile phone is missing", () => {
    expect(panel).toContain("function pickPhone");
    expect(panel).toContain("paymentPhone = pickPhone");
    expect(panel).toContain("leadRow.phone");
    expect(panel).toContain("Phone number missing");
    expect(panel).not.toMatch(/disabled=\{paying \|\| !applicantPhone\}/);
  });

  it("applicant portal passes application phone and lead_id into TokenFeePanel", () => {
    expect(portal).toContain("app.phone");
    expect(portal).toContain("leadId={app.lead_id");
    expect(portal).toContain("phone, email, lead_id");
  });

  it("get_applicant_lead_info returns phone for checkout prefill", () => {
    expect(migration).toContain("phone text");
    expect(migration).toContain("l.phone");
  });
});
