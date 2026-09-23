// Payslip presentation helpers.
//
// Pure functions on purpose, the same rule payroll.ts follows: the component
// amounts arrive already itemised and rounded from the database, so everything
// here only groups, labels and lays them out. Supabase stays out of this file so
// the money maths and the PDF can be verified without a running backend.
//
// The RPC contract this shapes:
//   payslip_detail(_line_id uuid)
//     -> component_code, component_name, kind, amount, display_order

import { jsPDF } from "jspdf";

export type PayslipKind = "earning" | "deduction" | "employer_contribution";

/**
 * One row of `payroll_lines` (plus the cycle fields `my_payslips` joins on).
 * Every field but `id` is optional — the self-service RPC returns line totals
 * and cycle info but not the employee identity columns.
 */
export interface PayslipLine {
  id: string;
  employee_name?: string | null;
  employee_number?: string | null;
  designation?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  cycle_name?: string | null;
  status?: string | null;
  monthly_gross?: number | null;
  total_days?: number | null;
  payable_days?: number | null;
  lop_days?: number | null;
  gross_earnings?: number | null;
  total_deductions?: number | null;
  employer_cost?: number | null;
  net_pay?: number | null;
}

export interface PayslipComponent {
  component_code: string;
  component_name: string;
  kind: PayslipKind;
  amount: number;
  display_order: number;
}

/** What `payslip_detail` resolves to, ready to render or print. */
export interface PayslipDetail {
  components: PayslipComponent[];
}

/** Payslips are printed in whole rupees. */
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

/** Rupee figure for net pay, e.g. `₹42,500`. */
export function netPayLabel(netPay: number | null | undefined): string {
  return `₹${inr(Number(netPay) || 0)}`;
}

/** Sum one component kind, guarding against a null/missing list. */
function sumKind(components: PayslipComponent[] | null | undefined, kind: PayslipKind): number {
  return Math.round(
    (components ?? []).reduce(
      (sum, c) => (c.kind === kind ? sum + (Number(c.amount) || 0) : sum),
      0,
    ),
  );
}

/** Total of everything the employee earns this period. */
export function earningsOf(components: PayslipComponent[] | null | undefined): number {
  return sumKind(components, "earning");
}

/** Total of everything withheld from the employee this period. */
export function deductionsOf(components: PayslipComponent[] | null | undefined): number {
  return sumKind(components, "deduction");
}

/** Total the employer pays on top of gross (PF/ESI employer share, …). */
export function employerContribOf(components: PayslipComponent[] | null | undefined): number {
  return sumKind(components, "employer_contribution");
}

const monthName = (iso: string | null | undefined, width: "long" | "short" = "long"): string => {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { month: width, year: "numeric" });
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * True when `cycle_name` is just the default month-year label. `my_payslips`
 * sets it to `to_char(period_start, 'Mon YYYY')` (e.g. "Sep 2026"), so it must
 * not be printed alongside the month we already derive. Parsed by month token
 * plus year rather than string equality because ICU spells September "Sept".
 */
function isDefaultCycleName(cycle: string, iso: string | null | undefined): boolean {
  if (!iso) return false;
  const monthMatch = cycle.match(/^([a-z]{3})/i);
  const yearMatch = cycle.match(/(\d{4})/);
  if (!monthMatch || !yearMatch) return false;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return MONTHS.indexOf(monthMatch[1].toLowerCase()) === d.getMonth() && Number(yearMatch[1]) === d.getFullYear();
}

/**
 * Human label for the payroll period. Shows the month of `period_start`, and
 * appends `cycle_name` only when it is a genuine run name — `my_payslips`
 * defaults it to the same month, which would otherwise print twice.
 */
export function payslipPeriodLabel(line: PayslipLine): string {
  const long = monthName(line.period_start);
  const cycle = (line.cycle_name ?? "").trim();
  const custom = cycle && !isDefaultCycleName(cycle, line.period_start) ? cycle : "";
  if (long && custom) return `${long} · ${custom}`;
  return long || custom || "—";
}

/** Stable download name, e.g. `Payslip-Asha-Rao-2026-09.pdf`. */
export function payslipFileName(line: PayslipLine): string {
  const who = (line.employee_name || line.employee_number || "Payslip")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const period = (line.period_start || "").slice(0, 7) || "period";
  return `Payslip-${who || "Payslip"}-${period}.pdf`;
}

/**
 * Lay one payslip out on A4 and return the document. Saving is the caller's
 * job (`buildPayslipPdf(detail, line).save(payslipFileName(line))`) so the build
 * itself stays free of side effects and is safe to call in tests.
 */
export function buildPayslipPdf(detail: PayslipDetail, line: PayslipLine): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  const gap = 10;
  const colW = (pageW - margin * 2 - gap) / 2;
  const leftX = margin;
  const rightX = margin + colW + gap;

  const components = detail?.components ?? [];
  const earnings = components
    .filter((c) => c.kind === "earning")
    .sort((a, b) => a.display_order - b.display_order);
  const deductions = components
    .filter((c) => c.kind === "deduction")
    .sort((a, b) => a.display_order - b.display_order);
  const employer = components
    .filter((c) => c.kind === "employer_contribution")
    .sort((a, b) => a.display_order - b.display_order);

  let y = margin;

  // ── Header ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("PAYSLIP", pageW / 2, y, { align: "center" });
  y += 6.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(payslipPeriodLabel(line), pageW / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(210);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Employee / period facts ───────────────────────────────────────────
  const facts: Array<[string, string]> = [
    ["Employee", line.employee_name || "—"],
    ["Employee no.", line.employee_number || "—"],
    ["Designation", line.designation || "—"],
    ["Payable days", `${Number(line.payable_days ?? 0)} / ${Number(line.total_days ?? 0)}`],
  ];
  doc.setFontSize(9);
  for (let i = 0; i < facts.length; i += 2) {
    const row = facts.slice(i, i + 2);
    row.forEach(([label, value], j) => {
      const x = j === 0 ? leftX : rightX;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120);
      doc.text(label, x, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(25);
      doc.text(doc.splitTextToSize(value, colW - 26).slice(0, 1), x + 26, y);
    });
    y += 6;
  }

  if (Number(line.lop_days ?? 0) > 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 90, 10);
    doc.text(`Loss of pay: ${Number(line.lop_days)} day(s)`, leftX, y);
    doc.setTextColor(25);
    y += 6;
  }
  y += 4;

  // ── Two money columns ─────────────────────────────────────────────────
  const drawColumn = (
    x: number,
    top: number,
    title: string,
    totalLabel: string,
    rows: PayslipComponent[],
    total: number,
  ): number => {
    let cy = top;
    doc.setFillColor(245, 247, 250);
    doc.rect(x, cy, colW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(title, x + 2.5, cy + 4.9);
    cy += 7;

    doc.setFontSize(8.6);
    for (const c of rows) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(35);
      doc.text(doc.splitTextToSize(c.component_name, colW - 26).slice(0, 1), x + 2.5, cy + 4.6);
      doc.text(inr(c.amount), x + colW - 2.5, cy + 4.6, { align: "right" });
      cy += 6;
    }
    if (rows.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(150);
      doc.text("None", x + 2.5, cy + 4.6);
      cy += 6;
    }

    doc.setDrawColor(215);
    doc.line(x, cy, x + colW, cy);
    cy += 5;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(25);
    doc.text(totalLabel, x + 2.5, cy);
    doc.text(inr(total), x + colW - 2.5, cy, { align: "right" });
    return cy + 6;
  };

  const leftEnd = drawColumn(leftX, y, "Earnings", "Total earnings", earnings, earningsOf(components));
  const rightEnd = drawColumn(rightX, y, "Deductions", "Total deductions", deductions, deductionsOf(components));
  y = Math.max(leftEnd, rightEnd);

  // ── Employer contributions (not withheld; cost to the company) ─────────
  if (employer.length > 0) {
    const fullW = pageW - margin * 2;
    doc.setFillColor(245, 247, 250);
    doc.rect(leftX, y, fullW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text("Employer contributions (cost to company)", leftX + 2.5, y + 4.9);
    y += 7;

    doc.setFontSize(8.6);
    for (const c of employer) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(35);
      doc.text(doc.splitTextToSize(c.component_name, fullW - 40).slice(0, 1), leftX + 2.5, y + 4.6);
      doc.text(inr(c.amount), leftX + fullW - 2.5, y + 4.6, { align: "right" });
      y += 6;
    }
    doc.setDrawColor(215);
    doc.line(leftX, y, leftX + fullW, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(25);
    doc.text("Total employer contribution", leftX + 2.5, y);
    doc.text(inr(employerContribOf(components)), leftX + fullW - 2.5, y, { align: "right" });
    y += 6;
  }

  // ── Net pay band ──────────────────────────────────────────────────────
  y += 2;
  const fullW = pageW - margin * 2;
  doc.setFillColor(232, 240, 254);
  doc.rect(leftX, y, fullW, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Net pay", leftX + 2.5, y + 7.2);
  doc.text(netPayLabel(line.net_pay ?? earningsOf(components) - deductionsOf(components)), leftX + fullW - 2.5, y + 7.2, {
    align: "right",
  });
  y += 16;

  // ── Footer ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    "This is a computer-generated payslip. Amounts are a snapshot taken when the payroll cycle was released.",
    margin,
    y,
    { maxWidth: fullW },
  );
  doc.text(`Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`, margin, y + 5);

  return doc;
}
