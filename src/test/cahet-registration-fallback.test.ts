import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cahetRegistrationFromApplication } from "@/lib/cahet";

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const leadDetail = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const offerLetterDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const offerLetterFunction = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");

describe("CAHET registration fallback", () => {
  it("derives CAHET registration from applicant-entered academic details", () => {
    const registration = cahetRegistrationFromApplication({
      application_id: "APP-26-BTQK",
      lead_id: "lead-1",
      academic_details: {
        entrance_exams: [
          {
            exam_name: "CAHET 2026 Registration",
            status: "registered",
            registration_no: " CAHET-2026-12345 ",
            registered_name: "Applicant Name",
          },
        ],
      },
    });

    expect(registration).toMatchObject({
      id: "application:APP-26-BTQK:cahet",
      lead_id: "lead-1",
      registration_no: "CAHET-2026-12345",
      document_url: null,
      notes: "Name on CAHET form: Applicant Name",
      registered_at: null,
    });
  });

  it("does not invent registration details when the applicant has no CAHET number", () => {
    expect(cahetRegistrationFromApplication({
      academic_details: {
        entrance_exams: [{ exam_name: "CAHET 2026 Registration", status: "yet_to_appear" }],
      },
    })).toBeNull();
  });

  it("uses applicant-entered CAHET data on the approval and offer-letter paths", () => {
    expect(adminApplicationView).toContain("cahetRegistrationFromApplication(appRow, appRow.lead_id)");
    expect(adminApplicationView).toContain("cahetRow || applicationCahet");
    expect(offerLetterFunction).toContain("cahetRegistrationFromApplication(applicationRow)");
    expect(offerLetterFunction).toContain("cahetRegistrationRow || cahetRegistrationFromApplication");
    expect(offerLetterDialog).toContain("cahetRegistrationFromApplication(appRow as ApplicationCahetSource | null, leadId)");
  });

  it("blocks BPT/BMRIT offer issuance when CAHET registration details are missing", () => {
    expect(adminApplicationView).toContain("courseName={lead.course?.name}");
    expect(leadDetail).toContain("courseName={courseName}");
    expect(offerLetterDialog).toContain("const requiresCahetRegistration = isBptOrBmritCourseName(courseName)");
    expect(offerLetterDialog).toContain("const cahetOfferBlocked = requiresCahetRegistration && !cahetRegistration");
    expect(offerLetterDialog).toContain("disabled={saving || programmeTotal <= 0 || cahetOfferBlocked}");
    expect(offerLetterDialog).toContain("decision === \"approved\" && cahetOfferBlocked");
    expect(offerLetterFunction).toContain("isBptOrBmritCourseName(course?.name) && !cahetRegistration");
    expect(offerLetterFunction).toContain("status: 409");
  });
});
