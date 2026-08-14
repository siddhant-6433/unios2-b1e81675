// Parsing and validation for a salary (CTC) import.
//
// Pure, like employeeImport, because this is the money path: the numbers have to be
// checkable against the source sheet without a database. A CTC export names people by
// employee number, carries an annual figure and the date the revision took effect, so
// this module's job is to turn that into effective-dated monthly gross — and to refuse
// anything it cannot read rather than quietly importing a wrong salary.

import { normalizeEmployeeDate } from "./employeeImport";
import { normalizeHeader } from "./libraryImport";

export const SALARY_COLUMN_ALIASES: Record<string, string[]> = {
  employee_number: ["Employee Number", "Employee No", "Emp No", "Emp Code", "Employee ID", "Staff ID"],
  employee_name: ["Employee Name", "Name", "Full Name"],
  annual_ctc: ["Total CTC", "Annual CTC", "CTC", "Gross CTC", "Annual Salary"],
  monthly_gross: ["Monthly Gross", "Gross Salary", "Monthly Salary"],
  effective_from: ["Revision Effective From", "Effective From", "Effective Date", "Revision Date"],
  remuneration_type: ["Remuneration Type", "Pay Type"],
  employment_status: ["Employment Status", "Status"],
  worker_type: ["Worker Type", "Employment Type"],
};

export const SALARY_IMPORT_FIELDS = Object.keys(SALARY_COLUMN_ALIASES);

/**
 * "3,00,000.00 " / "₹1,20,000" / "60000" -> 60000.
 * Indian grouping (lakh/crore commas) and a trailing space are both normal here.
 * Returns null for anything that isn't a number, so the caller can reject the row
 * rather than treat it as zero.
 */
export function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[₹,\s]/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedSalaryRow {
  rowNumber: number;
  employeeNumber: string;
  employeeName: string;
  annualCtc: number | null;
  monthlyGross: number | null;
  effectiveFrom: string;
  valid: boolean;
  error: string;
  warnings: string[];
}

/**
 * A salary this small is almost certainly a placeholder rather than a real wage —
 * NIMT's export contains a ₹1,000/year "HR Manager" row. Importing it silently would
 * put someone on ₹83 a month. Flagged, not dropped: a human decides.
 */
const IMPLAUSIBLE_ANNUAL_CTC = 24000;

export function buildSalaryRows(
  body: string[][],
  mapping: Record<string, number>,
  headerOffset = 2,
): ParsedSalaryRow[] {
  const seen = new Set<string>();

  return body.map((row, i) => {
    const get = (f: string) => {
      const idx = mapping[f];
      return idx === undefined || idx < 0 ? "" : (row[idx] ?? "").toString().trim();
    };

    const employeeNumber = get("employee_number");
    const employeeName = get("employee_name");
    const warnings: string[] = [];

    const annualCtc = parseAmount(get("annual_ctc"));
    const explicitMonthly = parseAmount(get("monthly_gross"));

    // An explicit monthly figure always wins; otherwise derive from annual CTC.
    // Annual/12 is rounded to whole rupees so the stored figure matches a payslip.
    const monthlyGross = explicitMonthly ?? (annualCtc !== null ? Math.round(annualCtc / 12) : null);

    const effectiveFrom = normalizeEmployeeDate(get("effective_from"));
    if (get("effective_from") && !effectiveFrom) {
      warnings.push(`Effective date "${get("effective_from")}" is not a recognised date`);
    }

    let error = "";
    if (!employeeNumber) error = "Employee number is required to match the salary to a person";
    else if (monthlyGross === null) error = "No readable CTC or monthly gross";
    else if (monthlyGross <= 0) error = "Salary must be greater than zero";
    else if (seen.has(employeeNumber.toLowerCase())) error = "Duplicate employee number in this file";

    if (!error) {
      seen.add(employeeNumber.toLowerCase());
      if (annualCtc !== null && annualCtc < IMPLAUSIBLE_ANNUAL_CTC) {
        warnings.push(
          `CTC of ${annualCtc.toLocaleString("en-IN")}/year looks like a placeholder — check before importing`,
        );
      }
    }

    return {
      rowNumber: i + headerOffset,
      employeeNumber,
      employeeName,
      annualCtc,
      monthlyGross,
      effectiveFrom,
      valid: !error,
      error,
      warnings,
    };
  });
}

/** Locate the header row of a CTC export, which sits under a title banner. */
export function detectSalaryHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map((c) => normalizeHeader((c ?? "").toString()));
    const hasWho = cells.some((c) => c.includes("employeenumber") || c.includes("empno") || c.includes("employeename"));
    const hasMoney = cells.some((c) => c.includes("ctc") || c.includes("gross") || c.includes("salary"));
    if (hasWho && hasMoney) return i;
  }
  return 0;
}
