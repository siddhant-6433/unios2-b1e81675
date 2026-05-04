/**
 * Shared lifecycle-stage computation for the admission flow.
 *
 * Single source of truth for both the full visual stepper on the
 * application detail page (AdmissionLifecycleStepper) and the compact
 * dots renderer on the applications list dashboard (MiniLifecycleStepper).
 *
 * Stages, in order:
 *   1. submitted  — application past 'draft'
 *   2. fee        — application_fee paid
 *   3. docs       — every uploaded doc has a verified/rejected status
 *   4. approved   — applications.status = 'approved' (or 'rejected')
 *   5. offer      — at least one offer_letters row exists for the lead
 *   6. token      — leads.pre_admission_no is set (PAN issued)
 *   7. admitted   — leads.admission_no is set (AN issued)
 */

import { CheckCircle2, FileCheck2, CreditCard, ShieldCheck, Gift, Coins, GraduationCap } from "lucide-react";

export type StageState = "done" | "current" | "future" | "blocked";

export interface DocCounts {
  total: number;
  verified: number;
  rejected: number;
  pending: number;
}

export interface LifecycleInput {
  app: {
    status: string;
    payment_status: string | null;
    approved_at?: string | null;
    rejection_reason?: string | null;
  } | null;
  lead: {
    id: string;
    pre_admission_no?: string | null;
    admission_no?: string | null;
  } | null;
  /** Whether application has a linked, existing lead. False when lead was deleted (orphan). */
  hasLead: boolean;
  /** Confirmed application_fee total (from lead_payments). */
  appFeePaid: number;
  /** Whether at least one offer_letters row exists for this lead. */
  hasOffer: boolean;
  /** Document review counts. */
  docs: DocCounts;
}

export interface Stage {
  key: "submitted" | "fee" | "docs" | "approved" | "offer" | "token" | "admitted";
  label: string;
  Icon: typeof CheckCircle2;
  state: StageState;
  hint?: string;
}

export const STAGE_ORDER: Stage["key"][] = ["submitted", "fee", "docs", "approved", "offer", "token", "admitted"];

export function computeStages(p: LifecycleInput): Stage[] {
  const a = p.app;
  if (!a) return [];

  const isSubmitted = a.status !== "draft";
  const isFeePaid = (a.payment_status === "paid") || p.appFeePaid > 0;
  const allDocsReviewed = p.docs.total === 0 || p.docs.pending === 0;
  const isApproved = a.status === "approved";
  const isRejectedApp = a.status === "rejected";
  const hasOffer = p.hasOffer;
  const hasPan = !!p.lead?.pre_admission_no;
  const hasAn = !!p.lead?.admission_no;
  const docsBlocked = p.docs.rejected > 0 && !isRejectedApp;

  const raw: Array<Pick<Stage, "key" | "label" | "Icon"> & { hint?: string; isDone: boolean; isBlocked?: boolean }> = [
    { key: "submitted", label: "Submitted",     Icon: FileCheck2,    isDone: isSubmitted, hint: a.status },
    { key: "fee",       label: "Fee Paid",      Icon: CreditCard,    isDone: isFeePaid,   hint: p.appFeePaid > 0 ? `₹${p.appFeePaid.toLocaleString("en-IN")}` : undefined },
    { key: "docs",      label: "Docs Reviewed", Icon: ShieldCheck,   isDone: allDocsReviewed && !docsBlocked, isBlocked: docsBlocked, hint: p.docs.total > 0 ? `${p.docs.verified}/${p.docs.total} verified` : "no docs" },
    { key: "approved",  label: isRejectedApp ? "Rejected" : "Approved", Icon: ShieldCheck, isDone: isApproved, isBlocked: isRejectedApp },
    { key: "offer",     label: "Offer Issued",  Icon: Gift,          isDone: hasOffer },
    { key: "token",     label: "Token → PAN",   Icon: Coins,         isDone: hasPan,      hint: p.lead?.pre_admission_no || undefined },
    { key: "admitted",  label: "Admitted",      Icon: GraduationCap, isDone: hasAn,       hint: p.lead?.admission_no || undefined },
  ];

  let foundCurrent = false;
  return raw.map(r => {
    let state: StageState;
    if (r.isBlocked) state = "blocked";
    else if (r.isDone) state = "done";
    else if (!foundCurrent) { state = "current"; foundCurrent = true; }
    else state = "future";
    return { key: r.key, label: r.label, Icon: r.Icon, state, hint: r.hint };
  });
}
