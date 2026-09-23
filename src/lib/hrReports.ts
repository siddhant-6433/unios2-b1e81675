// HR reporting primitives.
//
// Deliberately free of React and Supabase so the pure pieces — CSV
// serialisation, default ranges, money/percentage formatting — can be unit
// tested without a browser or a database.
//
// The report RPCs (hr_headcount_summary, hr_attendance_summary, …) all return
// flat aggregate rows, so a single generic table component can render them.

export type CsvRow = Record<string, unknown>;

/** One CSV field, RFC 4180 style: quote when the value contains a comma,
 *  double-quote, CR or LF; escape embedded quotes by doubling them. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialise rows to an RFC-4180 CSV document.
 *
 * Headers come from the first row's keys and stay fixed for every row, so a
 * later row carrying extra keys cannot desynchronise the columns. An empty
 * list yields an empty string (there is no header without data).
 */
export function toCsv(rows: CsvRow[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvField(row[header])).join(","));
  }
  return lines.join("\r\n");
}

/** Trigger a client-side download of `rows` as a CSV file. A UTF-8 BOM is
 *  prepended so Excel on Windows reads currency/accents correctly. */
export function downloadCsv(filename: string, rows: CsvRow[]): void {
  const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * The full calendar month containing `now`, as ISO dates.
 *
 * Built from local date parts — never `toISOString()`, which would shift the
 * day backwards/forwards for anyone east or west of UTC.
 */
export function defaultMonthRange(now: Date = new Date()): DateRange {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** Indian rupee formatting, e.g. 125000 → "₹1,25,000". */
export function fmtInr(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "₹0";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;
}

/** `part` as a percentage of `whole`, rounded to one decimal. 0 when whole is 0. */
export function pct(part: number, whole: number): number {
  if (!whole || !Number.isFinite(part) || !Number.isFinite(whole)) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// ── RPC row shapes ──────────────────────────────────────────────────────────
// These mirror the RETURNS TABLE declarations in
// supabase/migrations/20260923152627_hr_reports_rpc.sql.

export interface HeadcountSummaryRow {
  legal_entity: string;
  department: string;
  campus: string;
  employment_status: string;
  worker_type: string;
  headcount: number;
  on_probation: number;
  joined_this_month: number;
  exited_this_month: number;
}

export interface AttendanceSummaryRow {
  employee_profile_id: string;
  employee_name: string | null;
  employee_number: string | null;
  present_days: number;
  absent_days: number;
  avg_hours: number;
  first_punch: string | null;
  last_punch: string | null;
}

export interface LeaveSummaryRow {
  employee_profile_id: string;
  employee_name: string | null;
  leave_type: string;
  entitled: number;
  carried_forward: number;
  used: number;
  available: number;
}

export interface PayrollCostRow {
  cycle_id: string;
  cycle_name: string;
  legal_entity: string;
  status: string;
  employees: number;
  gross_earnings: number;
  deductions: number;
  employer_cost: number;
  net_pay: number;
}

export interface AttritionRow {
  exit_type: string;
  exits: number;
  avg_tenure_days: number;
}

export interface RecruitmentFunnelRow {
  status: string;
  source: string | null;
  applicants: number;
}

export interface ExpenseSummaryRow {
  status: string;
  category: string;
  claims: number;
  total: number;
}
