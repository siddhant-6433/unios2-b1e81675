import { describe, it, expect } from "vitest";
import {
  parseAmount, buildSalaryRows, detectSalaryHeaderRow,
  SALARY_COLUMN_ALIASES,
} from "./salaryImport";
import { resolveColumns } from "./libraryImport";

describe("parseAmount", () => {
  it("reads the shapes an Indian CTC sheet actually contains", () => {
    // Trailing space and lakh-grouped commas are exactly how Keka writes these.
    expect(parseAmount("300,000.00 ")).toBe(300000);
    expect(parseAmount("1,68,0000")).toBe(1680000);
    expect(parseAmount("₹1,20,000")).toBe(120000);
    expect(parseAmount("60000")).toBe(60000);
    expect(parseAmount(" 92,400.50 ")).toBe(92400.5);
  });

  it("returns null rather than zero for anything unreadable", () => {
    // Zero would import as a real salary of nothing; null lets the row be rejected.
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("see contract")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("detectSalaryHeaderRow", () => {
  it("skips the report banner above the header", () => {
    expect(detectSalaryHeaderRow([
      ["NIMT Educational Institutions", "", ""],
      ["Employee Current CTC Report | Currency : INR", "", ""],
      ["Employee Number", "Employee Name", "Total CTC"],
      ["1", "Siddhant Singh", "300,000.00 "],
    ])).toBe(2);
  });
});

describe("buildSalaryRows", () => {
  const header = ["Employee Number", "Employee Name", "Revision Effective From", "Total CTC"];
  const mapping = resolveColumns(header, SALARY_COLUMN_ALIASES);
  const build = (body: string[][]) => buildSalaryRows(body, mapping);

  it("derives monthly gross from annual CTC and parses the effective date", () => {
    const [r] = build([["E1037K", "kajal Kushwaha", "08-Apr-2024", "126,000.00 "]]);
    expect(r.valid).toBe(true);
    expect(r.annualCtc).toBe(126000);
    expect(r.monthlyGross).toBe(10500); // 126000 / 12
    expect(r.effectiveFrom).toBe("2024-04-08");
    expect(r.warnings).toEqual([]);
  });

  it("rounds to whole rupees so the stored figure matches a payslip", () => {
    const [r] = build([["E1", "Odd Amount", "01-Apr-2024", "100,000"]]);
    expect(r.monthlyGross).toBe(8333); // 8333.33 -> 8333
  });

  it("rejects a row with no employee number — it could not be matched to anyone", () => {
    const [r] = build([["", "Nameless", "01-Apr-2024", "120,000"]]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Employee number/);
  });

  it("rejects an unreadable salary rather than importing zero", () => {
    const [r] = build([["E2", "No Salary", "01-Apr-2024", "as per contract"]]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/No readable CTC/);
  });

  it("flags a placeholder CTC without dropping the row", () => {
    // NIMT's real export contains a ₹1,000/year "HR Manager".
    const [r] = build([["E902K", "HR Manager", "11-Apr-2023", "1,000.00 "]]);
    expect(r.valid).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/placeholder/);
  });

  it("flags a duplicate employee number so one person cannot get two salaries", () => {
    const rows = build([
      ["E5", "First", "01-Apr-2024", "120,000"],
      ["E5", "Second", "01-Apr-2025", "180,000"],
    ]);
    expect(rows[0].valid).toBe(true);
    expect(rows[1].valid).toBe(false);
    expect(rows[1].error).toMatch(/Duplicate/);
  });

  it("keeps the row when only the effective date is unreadable", () => {
    const [r] = build([["E6", "Bad Date", "not-a-date", "120,000"]]);
    expect(r.valid).toBe(true);
    expect(r.effectiveFrom).toBe("");
    expect(r.warnings.join(" ")).toMatch(/not a recognised date/);
  });
});
