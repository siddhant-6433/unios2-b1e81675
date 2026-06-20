import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const offerLetterFunction = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");

describe("offer letter campus and applicant name rendering", () => {
  it("renders applicant names in sentence case on the generated offer letter", () => {
    expect(offerLetterFunction).toContain("function sentenceCaseName");
    expect(offerLetterFunction).toContain("const applicantName = sentenceCaseName(opts.lead.name)");
    expect(offerLetterFunction).toContain("`Dear ${applicantName},`");
    expect(offerLetterFunction).toContain('{ label: "Applicant Name",    value: applicantName }');
  });

  it("uses the offer campus, not stale lead branding, in the institution sentence", () => {
    expect(offerLetterFunction).toContain("function institutionNameForOffer");
    expect(offerLetterFunction).toContain("const institutionName = institutionNameForOffer(opts.branding?.name, opts.campus?.name)");
    expect(offerLetterFunction).toContain('"Congratulations! On behalf of " + institutionName');
    expect(offerLetterFunction).not.toContain('"Congratulations! On behalf of " + (opts.branding?.name');
  });
});
