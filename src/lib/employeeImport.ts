// Parsing + validation for the HR bulk employee import (CSV/Excel).
//
// Kept as pure functions, like src/lib/libraryImport.ts, so the messy parts —
// header aliases, Indian ID formats, "Ramesh Kumar Singh" -> first/middle/last,
// duplicate detection — are unit-tested without mounting the dialog.
//
// Sheets come from whoever kept the staff register: a Keka export, an accountant's
// salary sheet, or something typed by hand. Column names are never stable, so we
// alias aggressively and let the caller override the mapping in the UI.

import { normalizeHeader, resolveColumns } from "./libraryImport";
import { normalizeStudentImportDate } from "./studentImportDate";

export { normalizeHeader, resolveColumns };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Dates as they actually arrive from an HR export.
 *
 * Keka writes `01-Jul-2012`, which the shared student-import parser rejects — it
 * only knows ISO and dd/mm/yyyy. Silently dropping every joining date would break
 * payroll pro-rating for anyone who joined mid-month, so month names are handled
 * here before falling back to the shared parser.
 */
export function normalizeEmployeeDate(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  // Excel serial dates. A sheet read without `raw: false` yields 41091 rather than
  // "01-Jul-2012"; treating that as junk silently drops every joining date. The
  // epoch is 1899-12-30 because Excel wrongly believes 1900 was a leap year.
  // Bounded to 1970-2100 so a genuine number like an employee code isn't read as a date.
  if (/^\d{4,5}$/.test(value)) {
    const serial = Number(value);
    if (serial >= 25569 && serial <= 73415) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    return "";
  }

  // 01-Jul-2012 / 1 July 2012 / 01/Jul/2012
  const named = value.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const day = Number(named[1]);
      const year = Number(named[3]);
      if (day >= 1 && day <= 31) {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        // Round-trip through the shared parser so impossible dates (31 Feb) still fail.
        return normalizeStudentImportDate(iso);
      }
    }
    return "";
  }

  return normalizeStudentImportDate(value);
}

/** Import fields -> accepted column headings. Order matters: first match wins. */
export const EMPLOYEE_COLUMN_ALIASES: Record<string, string[]> = {
  employee_number: ["Employee Number", "Employee No", "Emp No", "Emp Code", "Employee ID", "Emp ID", "Staff ID", "Code"],
  full_name: ["Name", "Full Name", "Employee Name", "Staff Name", "Display Name"],
  first_name: ["First Name", "Firstname", "Given Name"],
  middle_name: ["Middle Name", "Middlename"],
  last_name: ["Last Name", "Lastname", "Surname", "Family Name"],
  salutation: ["Salutation", "Title", "Honorific", "Prefix"],
  gender: ["Gender", "Sex"],
  date_of_birth: ["Date of Birth", "DOB", "Birth Date", "Birthdate"],
  marital_status: ["Marital Status"],
  blood_group: ["Blood Group", "Blood"],
  nationality: ["Nationality"],
  work_email: ["Work Email", "Official Email", "Company Email", "Email", "Email ID", "Email Address"],
  personal_email: ["Personal Email", "Alternate Email"],
  mobile_number: ["Mobile", "Mobile Number", "Phone", "Phone Number", "Contact", "Contact Number", "Mobile No"],
  work_number: ["Work Number", "Office Number", "Extension"],
  date_of_joining: ["Date of Joining", "DOJ", "Joining Date", "Join Date"],
  job_title: ["Job Title", "Designation", "Position", "Role"],
  department: ["Department", "Dept"],
  campus: ["Campus", "Location", "Branch", "Work Location"],
  institution: ["Institution", "School", "College", "Business Unit"],
  legal_entity: ["Legal Entity", "Employer", "Company"],
  sub_department: ["Sub Department", "Sub-Department"],
  reports_to_name: ["Reporting To", "Reports To", "Manager"],
  worker_type: ["Worker Type", "Employment Type", "Employee Type"],
  time_type: ["Time Type", "Work Type"],
  employment_status: ["Employment Status", "Status"],
  pan_number: ["PAN", "PAN Number", "PAN No", "PAN Card"],
  aadhaar_number: ["Aadhaar", "Aadhar", "Aadhaar Number", "Aadhar Number", "Aadhaar No", "UID"],
  bank_account_holder_name: ["Account Holder Name", "Account Name", "Bank Account Name", "Name as per Bank"],
  bank_account_number: ["Account Number", "Bank Account Number", "Account No", "A/C No", "Bank A/C"],
  bank_ifsc: ["IFSC", "IFSC Code", "IFS Code"],
  bank_name: ["Bank", "Bank Name"],
  bank_branch: ["Branch", "Bank Branch"],
};

export const EMPLOYEE_IMPORT_FIELDS = Object.keys(EMPLOYEE_COLUMN_ALIASES);

/** Every field that lands in employee_bank_details rather than employee_profiles. */
export const BANK_FIELDS = [
  "bank_account_holder_name",
  "bank_account_number",
  "bank_ifsc",
  "bank_name",
  "bank_branch",
] as const;

// The real header row is not always row 0 — sheets carry title banners and blank
// spacer rows. Pick the first row that names a person and at least one other
// employee-ish column.
export function detectEmployeeHeaderRow(rows: string[][]): number {
  const nameish = /\bname\b|employee|staff/i;
  const otherish = /email|mobile|phone|designation|department|joining|doj|emp\s*(no|code|id)|salary|pan|aadha?ar/i;
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const cells = row.map((c) => (c ?? "").toString());
    if (cells.some((c) => nameish.test(c)) && cells.some((c) => otherish.test(c))) return i;
  }
  return 0;
}

/** "Dr. Ramesh Kumar Singh" -> salutation + first/middle/last. */
const SALUTATIONS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "shri", "smt", "er"]);

export function splitName(raw: string): {
  salutation: string;
  first_name: string;
  middle_name: string;
  last_name: string;
} {
  const parts = (raw ?? "").toString().trim().split(/\s+/).filter(Boolean);
  let salutation = "";
  if (parts.length > 1) {
    const head = parts[0].replace(/\.$/, "").toLowerCase();
    if (SALUTATIONS.has(head)) {
      salutation = parts.shift()!.replace(/\.$/, "");
      salutation = salutation.charAt(0).toUpperCase() + salutation.slice(1).toLowerCase();
    }
  }
  return {
    salutation,
    first_name: parts[0] ?? "",
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    last_name: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

/** Indian mobile numbers arrive as "9871763193", "+91 98717-63193", "919871763193". */
export function normalizePhone(raw: unknown): string {
  const digits = (raw ?? "").toString().replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ParsedEmployeeRow {
  rowNumber: number;
  /** Column values as typed, for the failed-rows CSV. */
  raw: Record<string, string>;
  /** Cleaned values keyed by import field. */
  values: Record<string, string>;
  valid: boolean;
  error: string;
  /** Non-fatal notes shown in the preview (e.g. "PAN ignored — malformed"). */
  warnings: string[];
  duplicate: boolean;
}

/**
 * Turn resolved rows into validated employee records.
 *
 * `existingKeys` carries employee numbers and work emails already in the
 * database so a re-run of the same sheet doesn't create a second copy of
 * everyone. Keys are compared lowercased.
 */
export function buildEmployeeRows(
  body: string[][],
  mapping: Record<string, number>,
  existingKeys: Set<string> = new Set(),
  headerOffset = 2,
): ParsedEmployeeRow[] {
  const seen = new Set<string>();

  return body.map((row, i) => {
    const raw: Record<string, string> = {};
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx >= 0) raw[field] = (row[idx] ?? "").toString().trim();
    }

    const values: Record<string, string> = {};
    const warnings: string[] = [];

    // ── Name ────────────────────────────────────────────────────────────
    // Either an explicit first/last pair or a single full-name column.
    const fullName = raw.full_name || "";
    const split = splitName(fullName);
    values.first_name = raw.first_name || split.first_name;
    values.middle_name = raw.middle_name || split.middle_name;
    values.last_name = raw.last_name || split.last_name;
    values.salutation = raw.salutation || split.salutation;
    values.display_name =
      fullName || [values.first_name, values.middle_name, values.last_name].filter(Boolean).join(" ");

    // ── Straight copies ────────────────────────────────────────────────
    for (const f of [
      "employee_number", "gender", "marital_status", "blood_group", "nationality",
      "personal_email", "job_title", "department", "campus", "institution",
      "legal_entity", "sub_department", "reports_to_name",
      "worker_type", "time_type", "employment_status",
      "bank_account_holder_name", "bank_account_number", "bank_name", "bank_branch",
    ]) {
      if (raw[f]) values[f] = raw[f];
    }

    // ── Normalised fields ──────────────────────────────────────────────
    values.mobile_number = normalizePhone(raw.mobile_number);
    values.work_number = raw.work_number || "";

    if (raw.work_email) {
      if (EMAIL_RE.test(raw.work_email)) values.work_email = raw.work_email.toLowerCase();
      else warnings.push(`Work email "${raw.work_email}" looks malformed — dropped`);
    }

    for (const [field, label] of [["date_of_joining", "Date of joining"], ["date_of_birth", "Date of birth"]] as const) {
      if (!raw[field]) continue;
      const iso = normalizeEmployeeDate(raw[field]);
      if (iso) values[field] = iso;
      else warnings.push(`${label} "${raw[field]}" is not a recognised date — dropped`);
    }

    if (raw.pan_number) {
      const pan = raw.pan_number.toUpperCase().replace(/\s/g, "");
      if (PAN_RE.test(pan)) values.pan_number = pan;
      else warnings.push(`PAN "${raw.pan_number}" is malformed — dropped`);
    }

    if (raw.aadhaar_number) {
      const aadhaar = raw.aadhaar_number.replace(/\D/g, "");
      if (aadhaar.length === 12) values.aadhaar_number = aadhaar;
      else warnings.push(`Aadhaar "${raw.aadhaar_number}" is not 12 digits — dropped`);
    }

    if (raw.bank_ifsc) {
      const ifsc = raw.bank_ifsc.toUpperCase().replace(/\s/g, "");
      if (IFSC_RE.test(ifsc)) values.bank_ifsc = ifsc;
      else warnings.push(`IFSC "${raw.bank_ifsc}" is malformed — dropped`);
    }

    // ── Validation ─────────────────────────────────────────────────────
    let error = "";
    if (!values.display_name) error = "Name is required";
    else if (values.bank_account_number && !values.bank_ifsc)
      error = "Bank account number given without a valid IFSC";

    // ── Duplicates ─────────────────────────────────────────────────────
    // Employee number is the natural key (it has a unique index); fall back to
    // work email, then name+mobile for hand-typed sheets with neither.
    const key = (
      values.employee_number ||
      values.work_email ||
      `${values.display_name}|${values.mobile_number}`
    ).toLowerCase();

    let duplicate = false;
    if (key) {
      if (seen.has(key)) {
        duplicate = true;
        error = error || "Duplicate of an earlier row in this file";
      } else if (existingKeys.has(key)) {
        duplicate = true;
        error = error || "Already exists in the employee directory";
      } else {
        seen.add(key);
      }
    }

    return {
      rowNumber: i + headerOffset,
      raw,
      values,
      valid: !error,
      error,
      warnings,
      duplicate,
    };
  });
}

/** The columns of a blank import template, in a sensible data-entry order. */
export function templateHeaders(): string[] {
  return EMPLOYEE_IMPORT_FIELDS.filter((f) => f !== "first_name" && f !== "middle_name" && f !== "last_name")
    .map((f) => EMPLOYEE_COLUMN_ALIASES[f][0]);
}

/** Failed rows as CSV so HR can fix them in place and re-upload. */
export function failedRowsCsv(rows: ParsedEmployeeRow[], fields: string[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["Row", "Error", ...fields].map(esc).join(",");
  const body = rows.map((r) =>
    [String(r.rowNumber), r.error, ...fields.map((f) => r.raw[f] ?? "")].map(esc).join(","),
  );
  return [header, ...body].join("\n");
}
