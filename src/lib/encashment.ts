// Leave encashment — pure types and helpers.
//
// An employee requests to cash out unused paid leave; HR approves; payroll pays
// it. Paying reduces the entitlement rather than `used_days`, because `used_days`
// is recomputed from approved leave requests. Nothing in this file touches
// Supabase — the panel components own the I/O; the rules that decide what an
// encashment means live here so they can be unit-tested without a database.
//
// Money convention: `amount` arrives as numeric(14,2) from Postgres, which the
// supabase client hands back as a number-or-string. Every helper coerces with
// Number() before arithmetic so a string amount cannot silently concatenate.

export type EncashmentStatus = "requested" | "approved" | "rejected" | "paid" | "cancelled";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const ENCASHMENT_STATUSES: readonly EncashmentStatus[] = [
  "requested",
  "approved",
  "paid",
  "rejected",
  "cancelled",
] as const;

/** The statuses the HR filter bar offers. */
export const ENCASHMENT_FILTERS = [
  "all",
  "requested",
  "approved",
  "paid",
  "rejected",
  "cancelled",
] as const;
export type EncashmentFilter = (typeof ENCASHMENT_FILTERS)[number];

/** A row of `leave_encashments_inbox` (employee/leave-type joins flattened). */
export interface EncashmentRow {
  id: string;
  employee_profile_id?: string | null;
  employee_name?: string | null;
  employee_number?: string | null;
  leave_type_id?: string | null;
  leave_type?: string | null;
  leave_year: number;
  days: number | string;
  amount: number | string;
  status: EncashmentStatus | string;
  requested_at?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  paid_at?: string | null;
  note?: string | null;
  payroll_cycle_id?: string | null;
}

/** A row of `my_leave_balances()` — the self-service entitlements snapshot. */
export interface LeaveBalance {
  leave_type_id: string;
  leave_type: string;
  leave_year: number;
  entitled: number | string;
  carried_forward: number | string;
  used: number | string;
  available: number | string;
}

export interface EncashmentSummary {
  /** Total rows. */
  total: number;
  /** Row counts by status. */
  requested: number;
  approved: number;
  paid: number;
  rejected: number;
  /** Rupees requested, still awaiting a decision. */
  requestedAmount: number;
  /** Rupees approved, not yet paid. */
  approvedAmount: number;
  /** Rupees already paid out. */
  paidAmount: number;
}

const STATUS_CLASS: Record<EncashmentStatus, string> = {
  requested: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  approved: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  paid: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  rejected: "bg-pastel-red text-foreground/80 border-0 text-[10px]",
  cancelled: "bg-muted text-muted-foreground border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them as
 * a family, so a status never invents its own colour.
 */
export function encashmentStatusBadge(status: EncashmentStatus | string): string {
  return STATUS_CLASS[status as EncashmentStatus] ?? STATUS_CLASS.cancelled;
}

/** Human label ("requested" → "Requested"). */
export function encashmentStatusLabel(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Indian-grouped rupees, e.g. 1234567.5 → "12,34,567.5". */
export function formatInr(n: number | string | null | undefined): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  return INR.format(value);
}

/**
 * Counts and rupee buckets for the HR summary cards. `requestedAmount` is money
 * still awaiting a decision; `approvedAmount` is approved-but-unpaid; `paidAmount`
 * is money already out of the door. The buckets are disjoint.
 */
export function summarizeEncashments(
  rows: ReadonlyArray<Pick<EncashmentRow, "status" | "amount">>,
): EncashmentSummary {
  const sum = (match: (s: string) => boolean) =>
    round2(rows.reduce((acc, r) => (match(r.status) ? acc + numberOrZero(r.amount) : acc), 0));

  return {
    total: rows.length,
    requested: rows.filter((r) => r.status === "requested").length,
    approved: rows.filter((r) => r.status === "approved").length,
    paid: rows.filter((r) => r.status === "paid").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    requestedAmount: sum((s) => s === "requested"),
    approvedAmount: sum((s) => s === "approved"),
    paidAmount: sum((s) => s === "paid"),
  };
}

/**
 * Balances a person may actually encash: available > 0, newest year first, then
 * by name. The request form is built from exactly this list so it can never offer
 * a type the RPC will reject for having nothing left.
 */
export function balancesWithAvailable(
  rows: ReadonlyArray<LeaveBalance>,
): LeaveBalance[] {
  return rows
    .filter((b) => numberOrZero(b.available) > 0)
    .sort((a, b) => b.leave_year - a.leave_year || a.leave_type.localeCompare(b.leave_type));
}

/** Total spendable leave days across every balance. */
export function totalAvailable(rows: ReadonlyArray<LeaveBalance>): number {
  return round2(rows.reduce((acc, b) => acc + numberOrZero(b.available), 0));
}

/** Available days for one leave type/year, or 0 when there is no such balance. */
export function availableFor(
  rows: ReadonlyArray<LeaveBalance>,
  leaveTypeId: string,
  leaveYear: number,
): number {
  const balance = rows.find(
    (b) => b.leave_type_id === leaveTypeId && b.leave_year === leaveYear,
  );
  return balance ? numberOrZero(balance.available) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numberOrZero(n: number | string | null | undefined): number {
  const value = Number(n);
  return Number.isFinite(value) ? value : 0;
}

// Day-count formatting is shared with comp-off so both pillars read identically.
export { formatDays } from "./compOff";
