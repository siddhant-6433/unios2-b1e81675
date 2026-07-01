import { describe, expect, it } from "vitest";
import { normalizeStudentImportDate, resolveStudentImportAdmissionDate } from "./studentImportDate";

describe("student import admission dates", () => {
  it("keeps the CSV admission date ahead of the modal default", () => {
    expect(resolveStudentImportAdmissionDate("2024-04-01", "2026-07-01")).toBe("2024-04-01");
  });

  it("falls back to the modal admission date when the CSV row is blank", () => {
    expect(resolveStudentImportAdmissionDate("", "2026-07-01")).toBe("2026-07-01");
  });

  it("normalizes common India-style CSV dates to Postgres date format", () => {
    expect(normalizeStudentImportDate("01/04/2024")).toBe("2024-04-01");
    expect(normalizeStudentImportDate("1-4-2024")).toBe("2024-04-01");
  });

  it("rejects invalid calendar dates instead of sending them to Supabase", () => {
    expect(normalizeStudentImportDate("31/02/2024")).toBe("");
  });
});
