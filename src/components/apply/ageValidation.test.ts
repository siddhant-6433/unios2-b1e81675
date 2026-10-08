import { describe, expect, it } from "vitest";
import { calculateAgeAsOfCutoff, getSchoolGradeSortRank, validateAge } from "./ageValidation";

describe("Mirai grade choice", () => {
  it("sorts EYP, PYP and MYP by programme and ascending grade number", () => {
    const grades = [
      ["MYP 1 (Grade VI)", "MES-MYP1"],
      ["PYP 5 (Grade V)", "MES-PYP5"],
      ["PYP 2 (Grade II)", "MES-PYP2"],
      ["MYP 3 (Grade VIII)", "MES-MYP3"],
      ["EYP 3 (Graduation/UKG)", "MES-EYP3"],
      ["EYP 1 (Junior/Nursery)", "MES-EYP1"],
      ["PYP 1 (Grade I)", "MES-PYP1"],
      ["MYP 2 (Grade VII)", "MES-MYP2"],
      ["PYP 4 (Grade IV)", "MES-PYP4"],
      ["EYP 2 (Senior/LKG)", "MES-EYP2"],
      ["PYP 3 (Grade III)", "MES-PYP3"],
    ] as const;

    const sorted = [...grades].sort((a, b) =>
      getSchoolGradeSortRank(a[0], a[1], "mirai") - getSchoolGradeSortRank(b[0], b[1], "mirai")
    );

    expect(sorted.map(([name]) => name)).toEqual([
      "EYP 1 (Junior/Nursery)",
      "EYP 2 (Senior/LKG)",
      "EYP 3 (Graduation/UKG)",
      "PYP 1 (Grade I)",
      "PYP 2 (Grade II)",
      "PYP 3 (Grade III)",
      "PYP 4 (Grade IV)",
      "PYP 5 (Grade V)",
      "MYP 1 (Grade VI)",
      "MYP 2 (Grade VII)",
      "MYP 3 (Grade VIII)",
    ]);
  });

  it("shows age as of July 31 in the selected session year without blocking grade choice", () => {
    const age = calculateAgeAsOfCutoff("2015-01-09", 2027, 6, 31);
    const pypFive = validateAge("2015-01-09", "PYP 5 (Grade V)", "MES-PYP5", "mirai", 2027);

    expect(age).toBe(12.6);
    expect(pypFive.ageAsOfJuly31).toBe(age);
    expect(pypFive.eligible).toBe(true);
    expect(pypFive.message).toContain("July 31, 2027");
    expect(pypFive.message).toContain("PYP 3–12");
  });
});
