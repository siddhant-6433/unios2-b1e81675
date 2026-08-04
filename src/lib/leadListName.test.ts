import { describe, it, expect } from "vitest";
import { buildListName, dominantCourse, formatDueDateInWords } from "./leadListName";

describe("dominantCourse", () => {
  it("returns the strict plurality course", () => {
    expect(dominantCourse(["BBA", "BBA", "BCA"])).toBe("BBA");
  });
  it("falls back to Mixed when empty", () => {
    expect(dominantCourse([])).toBe("Mixed");
    expect(dominantCourse([null, "", undefined])).toBe("Mixed");
  });
  it("falls back to Mixed on a tie", () => {
    expect(dominantCourse(["BBA", "BCA"])).toBe("Mixed");
  });
});

describe("buildListName", () => {
  const due = "2026-08-23";

  it("builds the canonical format", () => {
    expect(buildListName({ course: "BBA", dueDate: due, source: "followup" }))
      .toBe("BBA - 23 Aug 2026 - Follow-up");
  });

  it("appends the optional identifier", () => {
    expect(buildListName({ course: "BBA", dueDate: due, source: "filter", identifier: "Meta batch 3" }))
      .toBe("BBA - 23 Aug 2026 - Filter - Meta batch 3");
  });

  it("omits an empty due date", () => {
    expect(buildListName({ course: "BCA", source: "import" }))
      .toBe("BCA - Imported");
  });

  it("prepends a non-editable counsellor prefix", () => {
    expect(buildListName({ course: "Mixed", dueDate: due, source: "followup", counsellorPrefix: "Ravi Kumar" }))
      .toBe("Ravi Kumar - Mixed - 23 Aug 2026 - Follow-up");
  });
});

describe("formatDueDateInWords", () => {
  it("formats to in-words en-IN", () => {
    expect(formatDueDateInWords("2026-08-23")).toBe("23 Aug 2026");
  });
  it("returns empty for nullish/invalid", () => {
    expect(formatDueDateInWords(null)).toBe("");
    expect(formatDueDateInWords("not-a-date")).toBe("");
  });
});
