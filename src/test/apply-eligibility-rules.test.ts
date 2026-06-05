import { describe, expect, it } from "vitest";
import { validateAcademicEligibility, type EligibilityRule } from "@/components/apply/eligibilityRules";

const cahetPcbEnglishRule: EligibilityRule = {
  minAge: 17,
  class12MinMarks: 50,
  entranceExamName: "CAHET 2026 Registration",
  entranceExamRequired: true,
  subjectPrerequisites: ["PCB (English Mandatory)"],
};

describe("apply eligibility rules", () => {
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
