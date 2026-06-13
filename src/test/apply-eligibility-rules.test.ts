import { describe, expect, it } from "vitest";
import {
  validateAcademicEligibility,
  validateDobEligibility,
  type EligibilityRule,
} from "@/components/apply/eligibilityRules";

const cahetPcbEnglishRule: EligibilityRule = {
  minAge: 17,
  class12MinMarks: 50,
  entranceExamName: "CAHET 2026 Registration",
  entranceExamRequired: true,
  subjectPrerequisites: ["PCB (English Mandatory)"],
};

describe("apply eligibility rules", () => {
  it("checks UG and PG age rules as of December 31 of the admission year", () => {
    expect(
      validateDobEligibility(
        "professional",
        "2009-09-22",
        2026,
        { minAge: 17 },
      ),
    ).toBeNull();

    expect(
      validateDobEligibility(
        "professional",
        "2009-09-22",
        2026,
        { minAge: 18 },
      ),
    ).toEqual({
      field: "dob",
      message: "Minimum age 18 years required (as of December 31, 2026). Applicant is 17.3 years old.",
      type: "error",
    });
  });

  it("keeps K-12 school age rules on their school-specific cutoff", () => {
    expect(
      validateDobEligibility(
        "school",
        "2021-08-01",
        2026,
        { minAge: 6 },
        "Grade I",
        "NIMT Beacon",
      ),
    ).toEqual({
      field: "dob",
      message: "Minimum age 6 years required (as of July 31, 2026). Applicant is 5 years old.",
      type: "error",
    });
  });

  it("requires both PCB group subjects and English for CAHET health programmes", () => {
    const withoutBiologyOrEnglish = validateAcademicEligibility(
      "professional",
      {
        class_12: {
          result_status: "declared",
          marks: "72",
          subjects: "Physics,Chemistry,Mathematics",
        },
      },
      cahetPcbEnglishRule,
    );

    expect(withoutBiologyOrEnglish.map(result => result.message)).toEqual(
      expect.arrayContaining([
        "English is a mandatory subject for this course.",
        "This course requires one of: PCB (Physics, Chemistry, Biology) in Class 12.",
      ]),
    );

    const withPcbAndEnglish = validateAcademicEligibility(
      "professional",
      {
        class_12: {
          result_status: "declared",
          marks: "72",
          subjects: "Physics,Chemistry,Biology,English",
        },
      },
      cahetPcbEnglishRule,
    );

    expect(withPcbAndEnglish.some(result => result.type === "error")).toBe(false);
    expect(withPcbAndEnglish).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "entrance_exam",
          message: "Entrance exam required: CAHET 2026 Registration",
          type: "info",
        }),
      ]),
    );
  });
});
