/**
 * Visual stepper for the application → admission lifecycle.
 *
 * Designed so any admin / team leader can see at a glance:
 *   - which stages are done (green)
 *   - which stage is current and what to do next (blue, with CTA hint)
 *   - which stages are still ahead (gray)
 *   - any blockers (rose)
 *
 * Stages (labels are neutral nouns so users don't read a stage NAME as a
 * state claim — the dot color tells you whether it's done/current/future):
 *   1. Submission   — application exists past 'draft'
 *   2. Fee          — lead has a confirmed application_fee payment
 *   3. Docs         — every uploaded doc has a verified/rejected status
 *   4. Approval     — applications.status = 'approved'
 *   5. Offer        — at least one offer_letters row for this lead
 *   6. Token / PAN  — leads.pre_admission_no is set (PAN issued)
 *   7. Admission    — leads.admission_no is set (AN issued)
 *
 * The "Next action" card below the stepper tells the operator exactly
 * what to do or what they're waiting on, so confusion like
 * "why is Issue Offer Letter disabled?" is replaced with explicit
 * guidance ("approve the application first", "lead has been deleted").
 */

import {
  CheckCircle2, AlertCircle, FileCheck2,
  CreditCard, ShieldCheck, Gift, Coins, GraduationCap, ArrowRight, Loader2, FileDown,
} from "lucide-react";
import { computeStages, type LifecycleInput, type Stage, type StageState } from "@/lib/admissionLifecycle";

export interface LifecycleProps extends LifecycleInput {
  /** Suggested action triggers for the call-to-action slot. */
  onApprove?: () => void;
  onIssueOffer?: () => void;
  /** Pre-generated application-fee receipt URL — shown as a button under the Fee Paid circle. */
  feeReceiptUrl?: string | null;
  /** Called when receipt isn't available yet and needs to be generated on demand. */
  onGenerateFeeReceipt?: () => void;
}

export function AdmissionLifecycleStepper(p: LifecycleProps) {
  const stages = computeStages(p);
  const current = stages.find(s => s.state === "current") ?? stages.find(s => s.state === "blocked");
  const allDone = stages.every(s => s.state === "done");
  const nextAction = computeNextAction(p, current?.key, allDone);

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-background to-muted/30 p-4 md:p-5 space-y-4">
      {/* Stepper.
          NOTE on padding: `overflow-x-auto` forces overflow-y to clip too
          (CSS doesn't allow x:auto + y:visible). The current-state nodes
          use `ring-2 ring-offset-1 animate-pulse`, which extends ~4px
          above/below the 40px circle — without vertical padding the ring
          gets cropped at the top. `py-2` gives the rings breathing room. */}
      <div className="flex items-stretch gap-1 overflow-x-auto -mx-1 px-1 py-2">
        {stages.map((s, i) => {
          const isLast = i === stages.length - 1;
          const href = s.key === "admitted" && s.state === "done" && p.lead?.admission_no
            ? `/students/${p.lead.admission_no}`
            : undefined;
          const feeReceipt = s.key === "fee" && s.state === "done"
            ? { url: p.feeReceiptUrl || null, onGenerate: p.onGenerateFeeReceipt }
            : undefined;
          return (
            <div key={s.key} className="flex items-stretch flex-1 min-w-[110px]">
              <StageNode stage={s} href={href} feeReceipt={feeReceipt} />
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

function StageNode({ stage, href, feeReceipt }: {
  stage: Stage;
  href?: string;
  feeReceipt?: { url: string | null; onGenerate?: () => void } | undefined;
}) {
  const palette = {
    done:    { bg: "bg-success/10 dark:bg-success/80/30", ring: "ring-emerald-500", text: "text-success-foreground dark:text-success/40", icon: "text-success", labelCls: "text-foreground" },
    current: { bg: "bg-info/10 dark:bg-info/80/30", ring: "ring-blue-500 ring-offset-1 animate-pulse", text: "text-info-foreground dark:text-info/40", icon: "text-info-foreground", labelCls: "text-foreground font-semibold" },
    future:  { bg: "bg-muted",       ring: "ring-border",  text: "text-muted-foreground", icon: "text-muted-foreground", labelCls: "text-muted-foreground" },
    blocked: { bg: "bg-destructive/10 dark:bg-destructive/80/30",  ring: "ring-rose-500",  text: "text-destructive dark:text-destructive/40",  icon: "text-destructive",  labelCls: "text-foreground font-semibold" },
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
      {href && (
        <a
          href={href}
          className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-success px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-success/90 transition-colors"
        >
          View Student
        </a>
      )}
      {feeReceipt && (
        feeReceipt.url ? (
          <a
            href={feeReceipt.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            <FileDown className="h-3 w-3" />Receipt PDF
          </a>
        ) : feeReceipt.onGenerate ? (
          <button
            onClick={feeReceipt.onGenerate}
            className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            <FileDown className="h-3 w-3" />Get Receipt
          </button>
        ) : null
      )}
    </div>
  );
}

function Connector({ from, to }: { from: StageState; to: StageState }) {
  const filled = from === "done" && (to === "done" || to === "current" || to === "blocked");
  return (
    <div className="flex items-center justify-center flex-1 min-w-[12px] -mt-3">
      <div className={`h-0.5 w-full ${filled ? "bg-success/50" : "bg-border"}`} />
    </div>
  );
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
      tone: "border-destructive/20 bg-destructive/5 dark:border-destructive/60/40 dark:bg-destructive/90/20",
      iconCls: "text-destructive",
      titleCls: "text-destructive dark:text-destructive/40",
      cta: p.onIssueOffer ? { label: "Create Lead & Issue Offer", onClick: p.onIssueOffer, cls: "bg-teal-600 hover:bg-teal-700" } : undefined,
    };
  }

  if (allDone) {
    return {
      Icon: CheckCircle2,
      title: "Admission complete",
      body: "All lifecycle steps are done. Student has been admitted and the portal-claim link was sent via WhatsApp.",
      tone: "border-success/20 bg-success/5 dark:border-success/60/40 dark:bg-success/90/20",
      iconCls: "text-success",
      titleCls: "text-success-foreground dark:text-success/40",
    };
  }

  const a = p.app!;
  const docsBlocked = p.docs.rejected > 0 && a.status !== "rejected";

  if (docsBlocked) {
    return {
      Icon: AlertCircle,
      title: `${p.docs.rejected} document${p.docs.rejected > 1 ? "s" : ""} need re-upload`,
      body: "AN issuance is blocked while any document is rejected. The applicant has been notified via WhatsApp; once they re-upload, mark the doc verified.",
      tone: "border-destructive/20 bg-destructive/5 dark:border-destructive/60/40 dark:bg-destructive/90/20",
      iconCls: "text-destructive",
      titleCls: "text-destructive dark:text-destructive/40",
    };
  }

  if (a.status === "rejected") {
    return {
      Icon: AlertCircle,
      title: "Application rejected",
      body: a.rejection_reason || "The applicant was notified via WhatsApp. No further admission steps will proceed.",
      tone: "border-destructive/20 bg-destructive/5 dark:border-destructive/60/40 dark:bg-destructive/90/20",
      iconCls: "text-destructive",
      titleCls: "text-destructive dark:text-destructive/40",
    };
  }

  // Per-stage guidance
  const ctaCls = "bg-info hover:bg-info/60";
  switch (currentKey) {
    case "submitted":
      return {
        Icon: FileCheck2,
        title: "Awaiting application submission",
        body: "Applicant has not submitted the form yet. They'll receive a WhatsApp confirmation once they do.",
        tone: "border-warning/20 bg-warning/5/60", iconCls: "text-warning-foreground", titleCls: "text-warning-foreground dark:text-warning/40",
      };
    case "fee":
      return {
        Icon: CreditCard,
        title: "Awaiting application fee",
        body: "Applicant needs to pay the application fee. They've received a payment link in their apply portal.",
        tone: "border-warning/20 bg-warning/5/60", iconCls: "text-warning-foreground", titleCls: "text-warning-foreground dark:text-warning/40",
      };
    case "docs":
      return {
        Icon: ShieldCheck,
        title: `Review ${p.docs.pending} document${p.docs.pending > 1 ? "s" : ""}`,
        body: "Mark each uploaded document Verified or Rejected below. Rejected docs will block AN until resolved.",
        tone: "border-info/20 bg-info/5 dark:border-info/60/40 dark:bg-info/90/20",
        iconCls: "text-info-foreground", titleCls: "text-info-foreground dark:text-info/40",
      };
    case "approved":
      return {
        Icon: CheckCircle2,
        title: "Approve the application",
        body: "All checks are clear. Approving advances the lead stage and unlocks the offer-letter step.",
        tone: "border-info/20 bg-info/5 dark:border-info/60/40 dark:bg-info/90/20",
        iconCls: "text-info-foreground", titleCls: "text-info-foreground dark:text-info/40",
        cta: p.onApprove ? { label: "Approve", onClick: p.onApprove, cls: ctaCls } : undefined,
      };
    case "offer":
      return {
        Icon: Gift,
        title: "Issue the offer letter",
        body: "Generate the offer letter; the applicant gets a WhatsApp with the offer PDF and a magic link to pay the token fee.",
        tone: "border-info/20 bg-info/5 dark:border-info/60/40 dark:bg-info/90/20",
        iconCls: "text-info-foreground", titleCls: "text-info-foreground dark:text-info/40",
        cta: p.onIssueOffer ? { label: "Issue Offer Letter", onClick: p.onIssueOffer, cls: "bg-teal-600 hover:bg-teal-700" } : undefined,
      };
    case "token":
      return {
        Icon: Coins,
        title: "Awaiting token-fee payment",
        body: "Offer was sent. Once the applicant pays the token fee, a Pre-Admission Number is auto-issued.",
        tone: "border-warning/20 bg-warning/5/60", iconCls: "text-warning-foreground", titleCls: "text-warning-foreground dark:text-warning/40",
      };
    case "admitted":
      return {
        Icon: GraduationCap,
        title: "Awaiting balance to 25%",
        body: "Pre-admitted. Once total fees paid reach 25% of year-1, the Admission Number is auto-issued and the student is enrolled.",
        tone: "border-warning/20 bg-warning/5/60", iconCls: "text-warning-foreground", titleCls: "text-warning-foreground dark:text-warning/40",
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
