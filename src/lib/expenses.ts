// Expenses & Reimbursements — pure types and helpers.
//
// Nothing in this file touches Supabase. The panel components own the I/O; the
// rules that decide what a claim means (which queue a claim belongs to, who may
// act on it, how do we label a status, what do the summary cards add up to?)
// live here so they can be unit-tested without a database.
//
// The claim now moves through a two-stage approval that mirrors the video
// portal, ending in a Zoho Books vendor bill:
//
//   draft → submitted → pending_superadmin → approved → synced_to_zoho → reimbursed
//     │          │                │
//     │          ├── changes_requested (either level) → resubmit
//     │          └── rejected (either level, terminal)
//     └── cancelled (employee)
//
// Money convention: amounts arrive as numeric(14,2) from Postgres, which the
// supabase client hands back as a number-or-string. Every helper coerces with
// Number() before doing arithmetic so a string amount cannot silently concatenate.

export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "pending_superadmin"
  | "approved"
  | "synced_to_zoho"
  | "reimbursed"
  | "rejected"
  | "cancelled";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const EXPENSE_STATUSES: readonly ExpenseStatus[] = [
  "draft",
  "submitted",
  "changes_requested",
  "pending_superadmin",
  "approved",
  "synced_to_zoho",
  "reimbursed",
  "rejected",
  "cancelled",
] as const;

/** The queues a reviewer's filter bar offers, in display order. */
export const REVIEW_QUEUES = [
  "with_me",
  "final",
  "zoho",
  "reimbursed",
  "rejected",
  "all",
] as const;
export type ReviewQueue = (typeof REVIEW_QUEUES)[number];

/** Legacy filter names kept for any older import; the new UI uses REVIEW_QUEUES. */
export const REVIEW_FILTERS = ["all", "submitted", "approved", "reimbursed", "rejected"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

/** The three verbs a reviewer can use at either stage. */
export const REVIEW_ACTIONS = ["approve", "correction", "reject"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** How an approved claim was (or will be) reimbursed. */
export const REIMBURSEMENT_MODES = ["payroll", "zoho", "bank_transfer"] as const;
export type ReimbursementMode = (typeof REIMBURSEMENT_MODES)[number];

/** Which stage (if any) is currently waiting on the signed-in reviewer. */
export type ReviewStage = "l1" | "l2" | "none";

/** The two states in which an owner may still change or cancel their own claim. */
export const EDITABLE_STATUSES: readonly ExpenseStatus[] = ["draft", "changes_requested"] as const;

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
  // Two-stage review / corrections.
  submitted_at: string | null;
  l1_reviewer: string | null;
  l1_status: string | null;
  l1_at: string | null;
  l1_note: string | null;
  l2_reviewer: string | null;
  l2_status: string | null;
  l2_at: string | null;
  l2_note: string | null;
  correction_note: string | null;
  correction_at: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  // Zoho Books vendor-bill linkage.
  zoho_bill_id: string | null;
  zoho_bill_number: string | null;
  zoho_synced_at: string | null;
  zoho_sync_error: string | null;
  reimbursement_mode: string | null;
}

/** A row of the expense_claims_inbox view — a claim with its joins flattened. */
export interface ExpenseClaimInboxRow extends ExpenseClaim {
  category_name: string | null;
  category_code: string | null;
  employee_name: string | null;
  employee_number: string | null;
  employee_user_id: string | null;
  proof_count: number | string | null;
}

/** A proof attached to a claim (expense_claim_attachments). */
export interface ExpenseAttachment {
  id: string;
  claim_id: string;
  file_url: string;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | string | null;
  uploaded_at: string | null;
}

export interface ClaimSummary {
  /** Sum of every claim's amount, regardless of status. */
  total: number;
  /** Money in the two review stages (submitted + pending_superadmin). */
  pending: number;
  /** Money the employee must fix (changes_requested). */
  changesRequested: number;
  /** Approved but not yet reimbursed (approved + synced_to_zoho). */
  approved: number;
  /** Approved and already sent to Zoho. */
  syncedToZoho: number;
  reimbursed: number;
  rejected: number;
  /** Count of drafts (no money yet in flight). */
  draft: number;
}

const STATUS_CLASS: Record<ExpenseStatus, string> = {
  draft: "bg-muted text-muted-foreground border-0 text-[10px]",
  submitted: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  changes_requested: "bg-pastel-orange text-foreground/80 border-0 text-[10px]",
  pending_superadmin: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  approved: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  synced_to_zoho: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  reimbursed: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  rejected: "bg-pastel-red text-foreground/80 border-0 text-[10px]",
  cancelled: "bg-muted text-muted-foreground border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them as a
 * family, so a status never invents its own colour.
 */
export function statusBadge(status: ExpenseStatus | string): string {
  return STATUS_CLASS[status as ExpenseStatus] ?? STATUS_CLASS.cancelled;
}

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: "Draft",
  submitted: "Pending L1",
  changes_requested: "Changes requested",
  pending_superadmin: "Pending final",
  approved: "Approved",
  synced_to_zoho: "Sent to Zoho",
  reimbursed: "Reimbursed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Human label for a status ("pending_superadmin" → "Pending final"). */
export function statusLabel(status: string): string {
  if (!status) return "";
  return (
    STATUS_LABEL[status as ExpenseStatus] ??
    status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")
  );
}

const REIMBURSEMENT_LABEL: Record<ReimbursementMode, string> = {
  payroll: "Payroll",
  zoho: "Zoho vendor payment",
  bank_transfer: "Bank transfer",
};

/** Human label for a reimbursement mode; falls back to the raw value. */
export function reimbursementLabel(mode: string | null | undefined): string {
  if (!mode) return "";
  return REIMBURSEMENT_LABEL[mode as ReimbursementMode] ?? mode.replace(/_/g, " ");
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
 * while the claim is still theirs to fix (draft, or sent back for correction). A
 * null userId (signed out) can never edit.
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
 * Can `userId` submit this claim (or resubmit it after a correction)? Same owner
 * rule as editing; the database enforces the proof requirement on submit.
 */
export function canSubmit(
  claim: Pick<ExpenseClaim, "submitted_by" | "status"> | null | undefined,
  userId: string | null | undefined,
): boolean {
  return canEditClaim(claim, userId);
}

/** Reviewer capabilities, derived from permissions in the panel. */
export interface ReviewerPerms {
  /** hr:expenses_approve — may action any claim at the L1 stage. */
  canApproveL1?: boolean;
  /** hr:expenses_final_approve (super_admin) — may action the L2 stage and Zoho. */
  canApproveL2?: boolean;
  /** hr:payroll_run or final-approve — may mark a claim reimbursed. */
  canReimburse?: boolean;
}

/**
 * Which stage of a claim is currently waiting on this reviewer. A reporting
 * manager sees their assigned claim at L1 even without an HR permission; an HR
 * approver (canApproveL1) sees every L1-stage claim because the RPC lets them
 * act as the fallback approver. `none` means this row is not theirs to action.
 */
export function reviewStage(
  row: Pick<ExpenseClaimInboxRow, "status" | "l1_reviewer"> | null | undefined,
  userId: string | null | undefined,
  perms: ReviewerPerms = {},
): ReviewStage {
  if (!row) return "none";
  if (row.status === "submitted") {
    if (userId && row.l1_reviewer === userId) return "l1";
    return perms.canApproveL1 ? "l1" : "none";
  }
  if (row.status === "pending_superadmin") {
    return perms.canApproveL2 ? "l2" : "none";
  }
  return "none";
}

/** True when this reviewer may approve / correct / reject the claim at L1. */
export function canL1(
  row: Pick<ExpenseClaimInboxRow, "status" | "l1_reviewer"> | null | undefined,
  userId: string | null | undefined,
  hasApproveL1: boolean,
): boolean {
  return reviewStage(row, userId, { canApproveL1: hasApproveL1 }) === "l1";
}

/** True when this reviewer may approve / correct / reject the claim at L2. */
export function canL2(
  row: Pick<ExpenseClaimInboxRow, "status" | "l1_reviewer"> | null | undefined,
  hasApproveL2: boolean,
): boolean {
  return reviewStage(row, null, { canApproveL2: hasApproveL2 }) === "l2";
}

/** True when a claim is approved (or failed to sync) and may be pushed to Zoho. */
export function canSendToZoho(
  row: Pick<ExpenseClaimInboxRow, "status" | "zoho_bill_id" | "zoho_sync_error"> | null | undefined,
  hasApproveL2: boolean,
): boolean {
  if (!row || !hasApproveL2) return false;
  if (row.zoho_bill_id) return false;
  return row.status === "approved" || (row.status === "synced_to_zoho" && !!row.zoho_sync_error);
}

/** True when an approved / synced claim may be marked reimbursed. */
export function canReimburse(
  row: Pick<ExpenseClaimInboxRow, "status"> | null | undefined,
  hasReimburse: boolean,
): boolean {
  if (!row || !hasReimburse) return false;
  return row.status === "approved" || row.status === "synced_to_zoho";
}

/** True when a claim is waiting on the employee to fix and resubmit. */
export function needsCorrection(
  row: Pick<ExpenseClaimInboxRow, "status"> | null | undefined,
): boolean {
  return !!row && row.status === "changes_requested";
}

/**
 * Money totals by status, for the reviewer's summary cards and the employee's
 * own header. `total` counts everything; the buckets are disjoint.
 */
export function summarizeClaims(
  claims: ReadonlyArray<Pick<ExpenseClaim, "status" | "amount">>,
): ClaimSummary {
  const sum = (match: (s: ExpenseStatus) => boolean) =>
    claims.reduce((acc, c) => (match(c.status) ? acc + Number(c.amount || 0) : acc), 0);

  return {
    total: claims.reduce((acc, c) => acc + Number(c.amount || 0), 0),
    pending: sum((s) => s === "submitted" || s === "pending_superadmin"),
    changesRequested: sum((s) => s === "changes_requested"),
    approved: sum((s) => s === "approved" || s === "synced_to_zoho"),
    syncedToZoho: sum((s) => s === "synced_to_zoho"),
    reimbursed: sum((s) => s === "reimbursed"),
    rejected: sum((s) => s === "rejected"),
    draft: sum((s) => s === "draft"),
  };
}
