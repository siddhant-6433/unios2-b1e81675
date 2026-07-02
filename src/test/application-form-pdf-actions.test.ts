import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const generateApplicationForm = readFileSync("supabase/functions/generate-application-form/index.ts", "utf8");

describe("application form PDF actions", () => {
  it("lets applicants generate the application PDF when the stored URL is missing", () => {
    expect(applyPortal).toContain("generateSubmittedApplicationPdf");
    expect(applyPortal).toContain('supabase.functions.invoke("generate-application-form"');
    expect(applyPortal).toContain("APPLICATION_FORM_PDF_STATUSES.has(app.status)");
    expect(applyPortal).toContain("Generate PDF");
  });

  it("lets staff generate the form PDF from the application detail page", () => {
    expect(adminApplicationView).toContain("const generateFormPdf = async ()");
    expect(adminApplicationView).toContain('supabase.functions.invoke("generate-application-form"');
    expect(adminApplicationView).toContain("APPLICATION_FORM_PDF_STATUSES.has(app.status)");
    expect(adminApplicationView).toContain("Generate Form PDF");
  });

  it("normalizes Unicode text before drawing with pdf-lib StandardFonts", () => {
    expect(generateApplicationForm).toContain("function pdfText(value: unknown): string");
    expect(generateApplicationForm).toContain('.replace(/₹/g, "Rs.")');
    expect(generateApplicationForm).toContain("text = pdfText(text)");
  });

  it("uses a compact A4 passport-photo placeholder when no photo is uploaded", () => {
    expect(generateApplicationForm).toContain("const MM_TO_PT = 72 / 25.4");
    expect(generateApplicationForm).toContain("const PASSPORT_PHOTO_W = 35 * MM_TO_PT");
    expect(generateApplicationForm).toContain("const PASSPORT_PHOTO_H = 45 * MM_TO_PT");
    expect(generateApplicationForm).toContain("const SECTION_HEADER_H = 15");
  });

  it("uses the fee-proposal style header for school application forms", () => {
    expect(generateApplicationForm).toContain("function drawProposalStyleHeader(ctx: Ctx)");
    expect(generateApplicationForm).toContain("APPLICATION_FORM_LOGO_BY_SLUG");
    expect(generateApplicationForm).toContain('return "NIMT B School"');
    expect(generateApplicationForm).toContain('return "Mirai Experiential School"');
    expect(generateApplicationForm).toContain('const title = "APPLICATION FORM"');
    expect(generateApplicationForm).toContain('const label = "Application Form No"');
    expect(generateApplicationForm).toContain("const badgeColor = rgb(0.20, 0.69, 0.39)");
    expect(generateApplicationForm).toContain("usesProposalHeader");
  });

  it("uses the selected school branch address in the application PDF header", () => {
    expect(generateApplicationForm).toContain("function applicationHeaderAddress(app: any, branding: any): string");
    expect(generateApplicationForm).toContain("Avantika Extension Colony, Ghaziabad");
    expect(generateApplicationForm).toContain("Near Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007");
    expect(generateApplicationForm).toContain("Ansal Avantika Colony, Shastri Nagar, Ghaziabad 201015");
    expect(generateApplicationForm).toContain("_applicationHeaderAddress");
  });

  it("uses parent signature labels for school application PDFs", () => {
    expect(generateApplicationForm).toContain('const signatureSectionTitle = isSchoolForm ? "Parent Name & Signature" : "Student Signature"');
    expect(generateApplicationForm).toContain('const signatureLineLabel = isSchoolForm ? "Signature of Parent / Guardian" : "Signature of Applicant"');
  });

  it("uses programme details and a photo-side personal details layout for school PDFs", () => {
    expect(generateApplicationForm).toContain('const programmeSectionTitle = isSchoolForm ? "Programme Details" : "Course Preferences"');
    expect(generateApplicationForm).toContain("function drawSectionBox(ctx: Ctx");
    expect(generateApplicationForm).toContain("function measureKVRowHeight(");
    expect(generateApplicationForm).toContain("const canStartPersonalBesidePhoto");
    expect(generateApplicationForm).toContain('drawSectionBox(ctx, "Personal Details", ctx.margin, leftW)');
  });

  it("does not render institution authorized signatory blocks in application PDFs", () => {
    expect(generateApplicationForm).not.toContain("For the Institution");
    expect(generateApplicationForm).not.toContain("AUTHORISED SIGNATORY");
    expect(generateApplicationForm).not.toContain("signature_url");
    expect(generateApplicationForm).not.toContain("signatory_name");
  });

  it("keeps the header date outside the application-number badge area", () => {
    expect(generateApplicationForm).toContain("const dateText = `Date: ${fmtDate(ctx.applicationDate)}`");
    expect(generateApplicationForm).toContain("x: textLeftX, y: y - 60");
    expect(generateApplicationForm).toContain('const label = "Application Form No"');
  });
});
