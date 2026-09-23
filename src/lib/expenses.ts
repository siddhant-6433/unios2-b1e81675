// Expenses & Reimbursements — pure types and helpers.
//
// Nothing in this file touches Supabase. The panel components own the I/O; the
// rules that decide what a claim means (can this person still edit it? how do we
// label a status? what do the summary cards add up to?) live here so they can be
// unit-tested without a database.
//
// Money convention: amounts arrive as numeric(14,2) from Postgres, which the
// supabase client hands back as a number-or-string. Every helper coerces with
// Number() before doing arithmetic so a string amount cannot silently concatenate.

export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "reimbursed"
  | "cancelled";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const EXPENSE_STATUSES: readonly ExpenseStatus[] = [
  "draft",
  "submitted",
  "approved",
  "reimbursed",
  "rejected",
  "cancelled",
] as const;

/** The statuses a reviewer's filter bar offers. */
export const REVIEW_FILTERS = ["all", "submitted", "approved", "reimbursed", "rejected"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** The two states in which an owner may still change or cancel their own claim. */
export const EDITABLE_STATUSES: readonly ExpenseStatus[] = ["draft", "submitted"] as const;

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  kind: "reimbursement" | "advance";
  requires_receipt: boolean;
  max_amount: number | null;
  is_active: boolean;
  display_order: number;
}

export interface ExpenseClaim {
  id: string;
  employee_profile_id: string;
  submitted_by: string | null;
  category_id: string | null;
  title: string;
  amount: number | string;
  currency: string;
  expense_date: string;
  description: string | null;
  receipt_url: string | null;
  status: ExpenseStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  reimbursed_at: string | null;
  payroll_cycle_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of the expense_claims_inbox view — a claim with its joins flattened. */
export interface ExpenseClaimInboxRow extends ExpenseClaim {
  category_name: string | null;
  category_code: string | null;
  employee_name: string | null;
  employee_number: string | null;
  employee_user_id: string | null;
}

export interface ClaimSummary {
  /** Sum of every claim's amount, regardless of status. */
  total: number;
  approved: number;
  /** Money still awaiting a decision (status 'submitted'). */
  pending: number;
  reimbursed: number;
  rejected: number;
}

const STATUS_CLASS: Record<ExpenseStatus, string> = {
  draft: "bg-muted text-muted-foreground border-0 text-[10px]",
  submitted: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  approved: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  rejected: "bg-pastel-red text-foreground/80 border-0 text-[10px]",
  reimbursed: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  cancelled: "bg-muted text-muted-foreground border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them as a
 * family, so a status never invents its own colour.
 */
export function statusBadge(status: ExpenseStatus | string): string {
  return STATUS_CLASS[status as ExpenseStatus] ?? STATUS_CLASS.cancelled;
}

/** Human label ("submitted" → "Submitted"). */
export function statusLabel(status: string): string {
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
 * Can `userId` still edit or cancel this claim? Only its own submitter, and only
 * while the claim is in flight. A null userId (signed out) can never edit.
 */
export function canEditClaim(
  claim: Pick<ExpenseClaim, "submitted_by" | "status"> | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!claim || !userId) return false;
  if (claim.submitted_by !== userId) return false;
  return EDITABLE_STATUSES.includes(claim.status);
}

/**
 * Money totals by status, for the reviewer's summary cards and the employee's
 * own header. `total` counts everything; the status buckets are disjoint.
 */
export function summarizeClaims(
  claims: ReadonlyArray<Pick<ExpenseClaim, "status" | "amount">>,
): ClaimSummary {
  const sum = (match: (s: ExpenseStatus) => boolean) =>
    claims.reduce((acc, c) => (match(c.status) ? acc + Number(c.amount || 0) : acc), 0);

  return {
    total: claims.reduce((acc, c) => acc + Number(c.amount || 0), 0),
    approved: sum((s) => s === "approved"),
    pending: sum((s) => s === "submitted"),
    reimbursed: sum((s) => s === "reimbursed"),
    rejected: sum((s) => s === "rejected"),
  };
}
