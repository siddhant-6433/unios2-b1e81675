/**
 * Visual stepper for the application → admission lifecycle.
 *
 * Designed so any admin / team leader can see at a glance:
 *   - which stages are done (green)
 *   - which stage is current and what to do next (blue, with CTA hint)
 *   - which stages are still ahead (gray)
 *   - any blockers (rose)
 *
 * Stages:
 *   1. Submitted       — application exists past 'draft'
 *   2. Fee Paid        — lead has a confirmed application_fee payment
 *   3. Docs Reviewed   — every uploaded doc has a verified/rejected status
 *   4. Approved        — applications.status = 'approved'
 *   5. Offer Issued    — at least one offer_letters row for this lead
 *   6. Token Paid      — leads.pre_admission_no is set (PAN issued)
 *   7. Admitted        — leads.admission_no is set (AN issued)
 *
 * The "Next action" card below the stepper tells the operator exactly
 * what to do or what they're waiting on, so confusion like
 * "why is Issue Offer Letter disabled?" is replaced with explicit
 * guidance ("approve the application first", "lead has been deleted").
 */

import {
  CheckCircle2, Circle, AlertCircle, FileCheck2,
  CreditCard, ShieldCheck, Gift, Coins, GraduationCap, ArrowRight, Loader2,
} from "lucide-react";

interface DocCounts { total: number; verified: number; rejected: number; pending: number; }

export interface LifecycleProps {
  app: {
    status: string;
    payment_status: string | null;
    approved_at: string | null;
    rejection_reason: string | null;
  } | null;
  lead: { id: string; pre_admission_no?: string | null; admission_no?: string | null } | null;
  /** Whether application has a linked lead at all. False when lead was deleted. */
  hasLead: boolean;
  /** Sum of confirmed application_fee payments. */
  appFeePaid: number;
  /** Whether at least one offer_letters row exists for this lead. */
  hasOffer: boolean;
  /** Document review counts. */
  docs: DocCounts;
  /** Suggested action triggers for the call-to-action slot. */
  onApprove?: () => void;
  onIssueOffer?: () => void;
}

type StageState = "done" | "current" | "future" | "blocked";

interface Stage {
  key: string;
  label: string;
  Icon: typeof CheckCircle2;
  state: StageState;
  hint?: string;
}

export function AdmissionLifecycleStepper(p: LifecycleProps) {
  const stages = computeStages(p);
  const current = stages.find(s => s.state === "current") ?? stages.find(s => s.state === "blocked");
  const allDone = stages.every(s => s.state === "done");
  const nextAction = computeNextAction(p, current?.key, allDone);

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-background to-muted/30 p-4 md:p-5 space-y-4">
      {/* Stepper */}
      <div className="flex items-stretch gap-1 overflow-x-auto -mx-1 px-1">
        {stages.map((s, i) => {
          const isLast = i === stages.length - 1;
          return (
            <div key={s.key} className="flex items-stretch flex-1 min-w-[110px]">
              <StageNode stage={s} />
              {!isLast && <Connector from={s.state} to={stages[i + 1].state} />}
            </div>
          );
        })}
      </div>

      {/* Next-action card */}
      <div className={`rounded-xl border p-3 md:p-4 flex items-start gap-3 ${nextAction.tone}`}>
        <nextAction.Icon className={`h-5 w-5 shrink-0 mt-0.5 ${nextAction.iconCls}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${nextAction.titleCls}`}>{nextAction.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{nextAction.body}</p>
        </div>
        {nextAction.cta && (
          <button onClick={nextAction.cta.onClick}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${nextAction.cta.cls}`}>
            {nextAction.cta.label}<ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stage node ────────────────────────────────────────────────────────

function StageNode({ stage }: { stage: Stage }) {
  const palette = {
    done:    { bg: "bg-emerald-100 dark:bg-emerald-900/30", ring: "ring-emerald-500", text: "text-emerald-800 dark:text-emerald-200", icon: "text-emerald-600", labelCls: "text-foreground" },
    current: { bg: "bg-blue-100 dark:bg-blue-900/30", ring: "ring-blue-500 ring-offset-1 animate-pulse", text: "text-blue-800 dark:text-blue-200", icon: "text-blue-600", labelCls: "text-foreground font-semibold" },
    future:  { bg: "bg-muted",       ring: "ring-border",  text: "text-muted-foreground", icon: "text-muted-foreground", labelCls: "text-muted-foreground" },
    blocked: { bg: "bg-rose-100 dark:bg-rose-900/30",  ring: "ring-rose-500",  text: "text-rose-800 dark:text-rose-200",  icon: "text-rose-600",  labelCls: "text-foreground font-semibold" },
  }[stage.state];

  const Icon = stage.state === "done" ? CheckCircle2
            : stage.state === "blocked" ? AlertCircle
            : stage.Icon;

  return (
    <div className="flex flex-col items-center gap-1.5 px-1 min-w-0">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${palette.bg} ${palette.ring}`}>
        <Icon className={`h-5 w-5 ${palette.icon}`} />
      </div>
      <p className={`text-[10.5px] leading-tight text-center ${palette.labelCls}`}>{stage.label}</p>
      {stage.hint && <p className="text-[9.5px] text-muted-foreground text-center -mt-0.5 truncate max-w-[110px]" title={stage.hint}>{stage.hint}</p>}
    </div>
  );
}

function Connector({ from, to }: { from: StageState; to: StageState }) {
  const filled = from === "done" && (to === "done" || to === "current" || to === "blocked");
  return (
    <div className="flex items-center justify-center flex-1 min-w-[12px] -mt-3">
      <div className={`h-0.5 w-full ${filled ? "bg-emerald-400" : "bg-border"}`} />
    </div>
  );
}

// ── Stage computation ────────────────────────────────────────────────

function computeStages(p: LifecycleProps): Stage[] {
  const a = p.app;
  if (!a) return [];

  const isSubmitted   = a.status !== "draft";
  const isFeePaid     = (a.payment_status === "paid") || p.appFeePaid > 0;
  const allDocsReviewed = p.docs.total === 0 || (p.docs.pending === 0);
  const isApproved    = a.status === "approved";
  const isRejectedApp = a.status === "rejected";
  const hasOffer      = p.hasOffer;
  const hasPan        = !!p.lead?.pre_admission_no;
  const hasAn         = !!p.lead?.admission_no;
  const docsBlocked   = p.docs.rejected > 0 && !isRejectedApp;

  // Resolve state for each stage in order. The first non-done stage is the
  // "current" one; everything after it is "future" (unless explicitly blocked).
  const raw: Array<Pick<Stage, "key" | "label" | "Icon"> & { hint?: string; isDone: boolean; isBlocked?: boolean }> = [
    { key: "submitted", label: "Submitted",     Icon: FileCheck2, isDone: isSubmitted,    hint: a.status },
    { key: "fee",       label: "Fee Paid",      Icon: CreditCard, isDone: isFeePaid,      hint: p.appFeePaid > 0 ? `₹${p.appFeePaid.toLocaleString("en-IN")}` : undefined },
    { key: "docs",      label: "Docs Reviewed", Icon: ShieldCheck, isDone: allDocsReviewed && !docsBlocked, isBlocked: docsBlocked, hint: p.docs.total > 0 ? `${p.docs.verified}/${p.docs.total} verified` : "no docs" },
    { key: "approved",  label: isRejectedApp ? "Rejected" : "Approved",  Icon: ShieldCheck, isDone: isApproved, isBlocked: isRejectedApp, hint: isApproved && a.approved_at ? "✓" : isRejectedApp ? "—" : undefined },
    { key: "offer",     label: "Offer Issued",  Icon: Gift, isDone: hasOffer },
    { key: "token",     label: "Token → PAN",   Icon: Coins, isDone: hasPan, hint: p.lead?.pre_admission_no || undefined },
    { key: "admitted",  label: "Admitted",      Icon: GraduationCap, isDone: hasAn, hint: p.lead?.admission_no || undefined },
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

// ── Next-action computation ──────────────────────────────────────────

interface ActionCard {
  Icon: typeof CheckCircle2;
  title: string;
  body: string;
  tone: string;     // outer card classes (border + bg)
  iconCls: string;
  titleCls: string;
  cta?: { label: string; onClick: () => void; cls: string };
}

function computeNextAction(p: LifecycleProps, currentKey: string | undefined, allDone: boolean): ActionCard {
  // Special case: lead was deleted but application orphaned.
  if (!p.hasLead) {
    return {
      Icon: AlertCircle,
      title: "Lead has been deleted",
      body: "This application's lead record no longer exists, so admission steps (approve, issue offer, payments, AN) can't proceed. Either restore the lead or delete this orphan application.",
      tone: "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20",
      iconCls: "text-rose-600",
      titleCls: "text-rose-900 dark:text-rose-200",
    };
  }

  if (allDone) {
    return {
      Icon: CheckCircle2,
      title: "Admission complete",
      body: "All lifecycle steps are done. Student has been admitted and the portal-claim link was sent via WhatsApp.",
      tone: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
      iconCls: "text-emerald-600",
      titleCls: "text-emerald-900 dark:text-emerald-200",
    };
  }

  const a = p.app!;
  const docsBlocked = p.docs.rejected > 0 && a.status !== "rejected";

  if (docsBlocked) {
    return {
      Icon: AlertCircle,
      title: `${p.docs.rejected} document${p.docs.rejected > 1 ? "s" : ""} need re-upload`,
      body: "AN issuance is blocked while any document is rejected. The applicant has been notified via WhatsApp; once they re-upload, mark the doc verified.",
      tone: "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20",
      iconCls: "text-rose-600",
      titleCls: "text-rose-900 dark:text-rose-200",
    };
  }

  if (a.status === "rejected") {
    return {
      Icon: AlertCircle,
      title: "Application rejected",
      body: a.rejection_reason || "The applicant was notified via WhatsApp. No further admission steps will proceed.",
      tone: "border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20",
      iconCls: "text-rose-600",
      titleCls: "text-rose-900 dark:text-rose-200",
    };
  }

  // Per-stage guidance
  const ctaCls = "bg-blue-600 hover:bg-blue-700";
  switch (currentKey) {
    case "submitted":
      return {
        Icon: FileCheck2,
        title: "Awaiting application submission",
        body: "Applicant has not submitted the form yet. They'll receive a WhatsApp confirmation once they do.",
        tone: "border-amber-200 bg-amber-50/60", iconCls: "text-amber-600", titleCls: "text-amber-900 dark:text-amber-200",
      };
    case "fee":
      return {
        Icon: CreditCard,
        title: "Awaiting application fee",
        body: "Applicant needs to pay the application fee. They've received a payment link in their apply portal.",
        tone: "border-amber-200 bg-amber-50/60", iconCls: "text-amber-600", titleCls: "text-amber-900 dark:text-amber-200",
      };
    case "docs":
      return {
        Icon: ShieldCheck,
        title: `Review ${p.docs.pending} document${p.docs.pending > 1 ? "s" : ""}`,
        body: "Mark each uploaded document Verified or Rejected below. Rejected docs will block AN until resolved.",
        tone: "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20",
        iconCls: "text-blue-600", titleCls: "text-blue-900 dark:text-blue-200",
      };
    case "approved":
      return {
        Icon: CheckCircle2,
        title: "Approve the application",
        body: "All checks are clear. Approving advances the lead stage and unlocks the offer-letter step.",
        tone: "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20",
        iconCls: "text-blue-600", titleCls: "text-blue-900 dark:text-blue-200",
        cta: p.onApprove ? { label: "Approve", onClick: p.onApprove, cls: ctaCls } : undefined,
      };
    case "offer":
      return {
        Icon: Gift,
        title: "Issue the offer letter",
        body: "Generate the offer letter; the applicant gets a WhatsApp with the offer PDF and a magic link to pay the token fee.",
        tone: "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20",
        iconCls: "text-blue-600", titleCls: "text-blue-900 dark:text-blue-200",
        cta: p.onIssueOffer ? { label: "Issue Offer Letter", onClick: p.onIssueOffer, cls: "bg-teal-600 hover:bg-teal-700" } : undefined,
      };
    case "token":
      return {
        Icon: Coins,
        title: "Awaiting token-fee payment",
        body: "Offer was sent. Once the applicant pays the token fee (10% of year-1), a Pre-Admission Number is auto-issued.",
        tone: "border-amber-200 bg-amber-50/60", iconCls: "text-amber-600", titleCls: "text-amber-900 dark:text-amber-200",
      };
    case "admitted":
      return {
        Icon: GraduationCap,
        title: "Awaiting balance to 25%",
        body: "Pre-admitted. Once total fees paid reach 25% of year-1, the Admission Number is auto-issued and the student is enrolled.",
        tone: "border-amber-200 bg-amber-50/60", iconCls: "text-amber-600", titleCls: "text-amber-900 dark:text-amber-200",
      };
    default:
      return {
        Icon: Loader2,
        title: "—",
        body: "",
        tone: "border-border bg-card", iconCls: "text-muted-foreground", titleCls: "text-foreground",
      };
  }
}
