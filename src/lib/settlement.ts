// Full & Final (F&F) settlement — pure types and helpers.
//
// Nothing in this file touches Supabase. The panel components own the I/O; the
// rules that turn a stored settlement statement into labels, totals and a
// printable document live here so they can be unit-tested without a database.
//
// Money convention: numeric(14,2) arrives from Postgres as a number-or-string,
// so every helper coerces with Number() before doing arithmetic.

import { jsPDF } from "jspdf";

export type SettlementStatus = "draft" | "finalized" | "paid" | "cancelled";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const SETTLEMENT_STATUSES: readonly SettlementStatus[] = [
  "draft",
  "finalized",
  "paid",
  "cancelled",
] as const;

export type SettlementLineKind = "earning" | "deduction";

/** The two line kinds `employee_settlement_lines.kind` allows. */
export const SETTLEMENT_LINE_KINDS: readonly SettlementLineKind[] = [
  "earning",
  "deduction",
] as const;

/** One row of `employee_settlement_lines`. */
export interface SettlementLine {
  id: string;
  settlement_id: string;
  code: string;
  name: string;
  kind: SettlementLineKind;
  amount: number | string;
  detail: string | null;
  display_order: number;
}

/**
 * A row of the `employee_settlements_inbox` view — a settlement with its
 * employee identity and exit type flattened in.
 */
export interface SettlementRow {
  id: string;
  employee_profile_id: string;
  exit_id: string;
  status: SettlementStatus | string;
  last_working_day: string | null;
  gross_earnings: number | string;
  total_deductions: number | string;
  net_settlement: number | string;
  computed_at: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  note: string | null;
  employee_name: string | null;
  employee_number: string | null;
  job_title: string | null;
  exit_type: string | null;
}

const STATUS_CLASS: Record<SettlementStatus, string> = {
  draft: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  finalized: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  paid: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  cancelled: "bg-muted text-muted-foreground border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them as
 * a family, so a status never invents its own colour.
 */
export function settlementStatusBadge(status: SettlementStatus | string): string {
  return STATUS_CLASS[status as SettlementStatus] ?? STATUS_CLASS.cancelled;
}

/** Human label ("finalized" → "Finalized"). */
export function settlementStatusLabel(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const LINE_KIND_LABEL: Record<SettlementLineKind, string> = {
  earning: "Earning",
  deduction: "Deduction",
};

/** Human label ("earning" → "Earning"). */
export function lineKindLabel(kind: SettlementLineKind | string): string {
  return LINE_KIND_LABEL[kind as SettlementLineKind] ?? "";
}

/** Coerce a possibly-string, possibly-missing numeric to a finite number. */
function numeric(n: number | string | null | undefined): number {
  const value = Number(n);
  return Number.isFinite(value) ? value : 0;
}

/** Round to the paise, the precision Postgres stores money at. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Indian-grouped rupees, e.g. 1234567.5 → "12,34,567.5". */
export function formatInr(n: number | string | null | undefined): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  return INR.format(value);
}

/** Sum every line of a kind, ignoring NaN amounts rather than poisoning the total. */
function sumKind(
  lines: ReadonlyArray<Pick<SettlementLine, "kind" | "amount">> | null | undefined,
  kind: SettlementLineKind,
): number {
  return round2(
    (lines ?? []).reduce(
      (sum, line) => (line.kind === kind ? sum + numeric(line.amount) : sum),
      0,
    ),
  );
}

/** Total of everything the employee is owed at exit. */
export function earningsOf(
  lines: ReadonlyArray<Pick<SettlementLine, "kind" | "amount">> | null | undefined,
): number {
  return sumKind(lines, "earning");
}

/** Total of everything recovered from the employee at exit. */
export function deductionsOf(
  lines: ReadonlyArray<Pick<SettlementLine, "kind" | "amount">> | null | undefined,
): number {
  return sumKind(lines, "deduction");
}

/**
 * Net settlement. The stored `net_settlement` is the snapshot the statement was
 * computed against, so it wins whenever it is present. When it is missing we
 * fall back to gross − deductions and clamp at zero, mirroring the
 * `GREATEST(..., 0)` the compute RPC applies.
 */
export function settlementNet(
  row: Pick<SettlementRow, "gross_earnings" | "total_deductions" | "net_settlement"> | null | undefined,
): number {
  const raw = row?.net_settlement;
  if (raw !== null && raw !== undefined && raw !== "") {
    const net = Number(raw);
    if (Number.isFinite(net)) return round2(net);
  }
  return round2(Math.max(0, numeric(row?.gross_earnings) - numeric(row?.total_deductions)));
}

/** Stable download name, e.g. `Settlement-Asha-Rao-2026-09-30.pdf`. */
export function settlementFileName(row: Pick<SettlementRow, "employee_name" | "employee_number" | "last_working_day">): string {
  const who = (row.employee_name || row.employee_number || "Settlement")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const day = (row.last_working_day || "").slice(0, 10) || "exit";
  return `Settlement-${who || "Settlement"}-${day}.pdf`;
}

/** Human label for a settlement's last working day, e.g. "30 Sep 2026". */
export function settlementDayLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Lay one settlement statement out on A4 and return the document. Saving is the
 * caller's job (`buildSettlementPdf(row, lines).save(settlementFileName(row))`)
 * so the build itself stays free of side effects and is safe to call in tests.
 */
export function buildSettlementPdf(row: SettlementRow, lines: SettlementLine[]): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  const gap = 10;
  const colW = (pageW - margin * 2 - gap) / 2;
  const leftX = margin;
  const rightX = margin + colW + gap;
  const fullW = pageW - margin * 2;

  const rows = lines ?? [];
  const earnings = rows
    .filter((l) => l.kind === "earning")
    .sort((a, b) => a.display_order - b.display_order);
  const deductions = rows
    .filter((l) => l.kind === "deduction")
    .sort((a, b) => a.display_order - b.display_order);

  let y = margin;

  // ── Header ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("FULL & FINAL SETTLEMENT", pageW / 2, y, { align: "center" });
  y += 6.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Last working day: ${settlementDayLabel(row.last_working_day)}`, pageW / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(210);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Employee facts ────────────────────────────────────────────────────
  const facts: Array<[string, string]> = [
    ["Employee", row.employee_name || "—"],
    ["Employee no.", row.employee_number || "—"],
    ["Designation", row.job_title || "—"],
    ["Exit type", (row.exit_type || "—").replace(/_/g, " ")],
  ];
  doc.setFontSize(9);
  for (let i = 0; i < facts.length; i += 2) {
    facts.slice(i, i + 2).forEach(([label, value], j) => {
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
  y += 4;

  // ── Two money columns ─────────────────────────────────────────────────
  const drawColumn = (
    x: number,
    top: number,
    title: string,
    totalLabel: string,
    colRows: SettlementLine[],
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
    for (const line of colRows) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(35);
      doc.text(doc.splitTextToSize(line.name, colW - 26).slice(0, 1), x + 2.5, cy + 4.6);
      doc.text(formatInr(line.amount), x + colW - 2.5, cy + 4.6, { align: "right" });
      cy += 6;
    }
    if (colRows.length === 0) {
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
    doc.text(formatInr(total), x + colW - 2.5, cy, { align: "right" });
    return cy + 6;
  };

  const leftEnd = drawColumn(leftX, y, "Earnings", "Total earnings", earnings, earningsOf(rows));
  const rightEnd = drawColumn(rightX, y, "Deductions", "Total deductions", deductions, deductionsOf(rows));
  y = Math.max(leftEnd, rightEnd);

  // ── Net settlement band ───────────────────────────────────────────────
  y += 2;
  doc.setFillColor(232, 240, 254);
  doc.rect(leftX, y, fullW, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Net settlement", leftX + 2.5, y + 7.2);
  doc.text(`₹${formatInr(settlementNet(row))}`, leftX + fullW - 2.5, y + 7.2, { align: "right" });
  y += 16;

  // ── Footer ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    "This is a computer-generated statement. Amounts are a snapshot taken when the settlement was computed.",
    margin,
    y,
    { maxWidth: fullW },
  );
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    margin,
    y + 5,
  );

  return doc;
}
