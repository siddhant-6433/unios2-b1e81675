import { describe, expect, it } from "vitest";
import { calculateFee, determineProgramCategory, type CourseSelection } from "@/components/apply/types";

const selection = (programCategory: string, courseName = "Course"): CourseSelection => ({
  course_id: `${programCategory}-course`,
  campus_id: "campus-1",
  institution_id: "institution-1",
  course_name: courseName,
  campus_name: "Campus",
  preference_order: 1,
  program_category: programCategory,
});

describe("apply portal course fee calculation", () => {
  it("keeps B.Ed and D.El.Ed application fee at zero", () => {
    expect(determineProgramCategory("BED-GN", "Bachelor of Education (B.Ed)")).toBe("bed");
    expect(determineProgramCategory("DELED-GZ", "Diploma in Elementary Education (D.El.Ed)")).toBe("deled");

    expect(calculateFee([
      selection("bed", "Bachelor of Education (B.Ed)"),
      selection("deled", "Diploma in Elementary Education (D.El.Ed)"),
    ])).toBe(0);
  });

  it("uses the default fee only for unknown programme categories", () => {
    expect(calculateFee([selection("unknown")])).toBe(1000);
  });

  it("charges only the non-zero programme fee for mixed B.Ed and LLB selections", () => {
    expect(calculateFee([
      selection("bed", "Bachelor of Education (B.Ed)"),
      selection("professional", "LLB"),
    ])).toBe(1000);
  });
});
