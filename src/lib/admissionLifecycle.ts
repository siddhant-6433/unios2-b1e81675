/**
 * Shared lifecycle-stage computation for the admission flow.
 *
 * Single source of truth for both the full visual stepper on the
 * application detail page (AdmissionLifecycleStepper) and the compact
 * dots renderer on the applications list dashboard (MiniLifecycleStepper).
 *
 * Stages, in order (labels shown to users are neutral nouns — see raw[] below):
 *   1. fee        — application_fee paid                          → "Fee"
 *   2. docs       — every uploaded doc has a verified/rejected    → "Docs"
 *   3. submitted  — application past 'draft' (declaration done)   → "Submission"
 *   4. approved   — applications.status = 'approved' (or rejected)→ "Approval"
 *   5. offer      — at least one offer_letters row for the lead   → "Offer"
 *   6. token      — leads.pre_admission_no is set (PAN issued)    → "Token / PAN"
 *   7. admitted   — leads.admission_no is set (AN issued)         → "Admission"
 *
 * Order matters: in NIMT's portal flow the candidate pays the fee FIRST,
 * then uploads docs, then signs the declaration (= status flips out of
 * draft). So Fee → Docs → Submission is the real path, not the other way.
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
  /**
   * Amount the candidate still owes to trigger PAN (Pre-Admission Number)
   * issuance, computed by the server-side `lead_fee_status` RPC:
   * max(0, token_required - token_paid). Null when not applicable
   * (lead has no offer yet, or already has PAN).
   */
  panDue?: number | null;
  /**
   * Amount the candidate still owes to trigger AN (Admission Number)
   * issuance: max(0, an_threshold - total_paid). Null when not applicable
   * (lead has no PAN yet, or already has AN).
   */
  anDue?: number | null;
}

export interface Stage {
  key: "submitted" | "fee" | "docs" | "approved" | "offer" | "token" | "admitted";
  label: string;
  Icon: typeof CheckCircle2;
  state: StageState;
  hint?: string;
  /** Amount still due to advance past this stage, in INR. Set on the
   *  `token` stage (= PAN due) and `admitted` stage (= AN due) when the
   *  stage isn't done yet. Renderers show this beneath the label so admins
   *  see exactly what the candidate must pay next. */
  amountDue?: number | null;
}

export const STAGE_ORDER: Stage["key"][] = ["fee", "docs", "submitted", "approved", "offer", "token", "admitted"];

export function computeStages(p: LifecycleInput): Stage[] {
  const a = p.app;
  if (!a) return [];

  const isSubmitted = a.status !== "draft";
  // Use ONLY this application's own payment_status — never the lead-level
  // appFeePaid aggregate. Falling back to "any paid app for the lead" made
  // every sibling draft visually light up "Fee Paid" when the lead had any
  // other paid application (e.g., Naaz Bano's abandoned XS8L draft showing
  // paid because XQUX was the real paid app).
  const isFeePaid = a.payment_status === "paid";
  const allDocsReviewed = p.docs.total === 0 || p.docs.pending === 0;
  const isApproved = a.status === "approved";
  const isRejectedApp = a.status === "rejected";
  const hasOffer = p.hasOffer;
  const hasPan = !!p.lead?.pre_admission_no;
  const hasAn = !!p.lead?.admission_no;
  // Once the application has been decided (approved/rejected), the admin has
  // accepted the doc state — don't keep marking docs as a blocker or "current"
  // action, since the next real step is offer issuance / rejection handling.
  const decided = isApproved || isRejectedApp;
  const docsBlocked = p.docs.rejected > 0 && !isRejectedApp && !isApproved;

  // Labels are neutral stage NAMES, not state claims — the dot color tells
  // you whether the stage is done/current/future/blocked. Past-tense labels
  // like "Offer Issued" misled users into reading the label as a fact even
  // when the dot was the (blue) current/pending state.
  const raw: Array<Pick<Stage, "key" | "label" | "Icon"> & { hint?: string; isDone: boolean; isBlocked?: boolean; amountDue?: number | null }> = [
    { key: "fee",       label: "Fee",           Icon: CreditCard,    isDone: isFeePaid,   hint: p.appFeePaid > 0 ? `₹${p.appFeePaid.toLocaleString("en-IN")}` : undefined },
    { key: "docs",      label: "Docs",          Icon: ShieldCheck,   isDone: (allDocsReviewed && !docsBlocked) || decided, isBlocked: docsBlocked, hint: p.docs.total > 0 ? `${p.docs.verified}/${p.docs.total} verified` : "no docs" },
    { key: "submitted", label: "Submission",    Icon: FileCheck2,    isDone: isSubmitted, hint: a.status },
    { key: "approved",  label: isRejectedApp ? "Rejected" : "Approval", Icon: ShieldCheck, isDone: isApproved, isBlocked: isRejectedApp },
    { key: "offer",     label: "Offer",         Icon: Gift,          isDone: hasOffer },
    { key: "token",     label: "Token / PAN",   Icon: Coins,         isDone: hasPan,      hint: p.lead?.pre_admission_no || undefined, amountDue: !hasPan ? (p.panDue ?? null) : null },
    { key: "admitted",  label: "Admission",     Icon: GraduationCap, isDone: hasAn,       hint: p.lead?.admission_no || undefined, amountDue: !hasAn ? (p.anDue ?? null) : null },
  ];

  let foundCurrent = false;
  return raw.map(r => {
    let state: StageState;
    if (r.isBlocked) state = "blocked";
    else if (r.isDone) state = "done";
    else if (!foundCurrent) { state = "current"; foundCurrent = true; }
    else state = "future";
    return { key: r.key, label: r.label, Icon: r.Icon, state, hint: r.hint, amountDue: r.amountDue };
  });
}
