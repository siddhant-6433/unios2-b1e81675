/**
 * Document review wizard for AdminApplicationView.
 *
 * Replaces the previous compact list with a single-doc focused workflow:
 *   - Sidebar lists every uploaded doc with their current state
 *   - Main pane previews the active doc inline (image / PDF)
 *   - Action bar on the right: Verify, Reject + reason, Request Re-upload
 *   - "Next ›" auto-advances after a decision so operators can sweep
 *     through the queue without breaking flow
 *
 * The component is fully controlled by parent state (docs + reviews +
 * setDocStatus callback) — no internal data fetching, so the parent's
 * refresh() stays in charge.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight,
  ExternalLink, RefreshCw, FileText, Image as ImageIcon, GraduationCap,
} from "lucide-react";
import type { PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { CahetRegistrationDetails } from "@/components/leads/CahetRegistrationDetails";
import type { CahetRegistrationDetails as CahetRegistrationDetailsType } from "@/lib/cahet";

type DocStatus = "pending" | "verified" | "rejected";

export interface DocReview {
  file_path: string;
  status: DocStatus;
  notes: string | null;
  reviewed_at: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
}

export interface DocReviewCourseInfo {
  name: string;
  code: string | null;
  durationYears: number | null;
  /** Curated duration from course_facts ("4 Years (3 Years + 1 Year Internship)").
   *  Preferred over durationYears, which can only say "4 years". */
  durationText?: string | null;
  eligibility: string | null;
  entranceExam: string | null;
  entranceMandatory: boolean | null;
}

interface Props {
  docs: PreviewDoc[];
  reviews: Record<string, DocReview>;
  /** Parent persists the change, then echoes it back via the `reviews` prop. */
  onSetStatus: (doc: PreviewDoc, next: DocStatus, notes?: string) => Promise<void> | void;
  /** Course the applicant has applied for — surfaced so the reviewer can
   *  cross-check the uploaded documents against the course's eligibility
   *  before clearing the application for offer-letter generation. */
  courseInfo?: DocReviewCourseInfo | null;
  /** When true, hides Verify/Reject actions — useful once the application
   *  has been decided so operators aren't prompted to re-review docs. */
  readOnly?: boolean;
  readOnlyReason?: string;
  cahetRegistration?: CahetRegistrationDetailsType | null;
}

export function DocReviewPanel({ docs, reviews, onSetStatus, courseInfo, readOnly, readOnlyReason, cahetRegistration }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset note draft whenever active doc changes
  useEffect(() => {
    const active = docs[activeIdx];
    setNotes(active ? (reviews[active.path]?.notes ?? "") : "");
  }, [activeIdx, docs, reviews]);

  const counts = useMemo(() => {
    let v = 0, r = 0, p = 0;
    docs.forEach(d => {
      const s = reviews[d.path]?.status ?? "pending";
      if (s === "verified") v++;
      else if (s === "rejected") r++;
      else p++;
    });
    return { verified: v, rejected: r, pending: p, total: docs.length };
  }, [docs, reviews]);

  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <FileText className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        <p className="text-[11px] text-muted-foreground/80 mt-1">The applicant will upload documents from the apply portal; they'll appear here for review.</p>
      </div>
    );
  }

  const active = docs[activeIdx];
  const activeReview = reviews[active.path];
  const activeStatus: DocStatus = activeReview?.status ?? "pending";

  // Find next pending doc to auto-advance to after a decision.
  const nextPendingIdx = (fromIdx: number) => {
    for (let i = fromIdx + 1; i < docs.length; i++) {
      if ((reviews[docs[i].path]?.status ?? "pending") === "pending") return i;
    }
    // wrap-around
    for (let i = 0; i < fromIdx; i++) {
      if ((reviews[docs[i].path]?.status ?? "pending") === "pending") return i;
    }
    return null;
  };

  const handleDecision = async (next: DocStatus) => {
    if (next === "rejected" && !notes.trim()) {
      // Don't submit rejection without a reason — applicant gets the note in their WhatsApp.
      const el = document.getElementById("doc-reject-notes") as HTMLTextAreaElement | null;
      el?.focus();
      return;
    }
    setBusy(true);
    await onSetStatus(active, next, notes.trim() || undefined);
    setBusy(false);
    // Auto-advance to the next still-pending doc, if any
    const np = nextPendingIdx(activeIdx);
    if (np !== null) setActiveIdx(np);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            Document Verification
            <span className="text-[11px] font-normal text-muted-foreground">
              {activeIdx + 1} of {docs.length}
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Approve valid files or reject with a reason. Rejected files stay locked here until the applicant uploads a replacement.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <CountChip Icon={CheckCircle2} cls="bg-success/5 text-success">{counts.verified} verified</CountChip>
          {counts.rejected > 0 && <CountChip Icon={XCircle} cls="bg-destructive/5 text-destructive">{counts.rejected} rejected</CountChip>}
          {counts.pending > 0 && <CountChip Icon={Clock} cls="bg-warning/5 text-warning-foreground">{counts.pending} pending</CountChip>}
        </div>
      </div>

      {/* Applied-for course context — helps the reviewer match docs to
          eligibility without leaving the page. */}
      {courseInfo && (
        <div className="px-4 py-2.5 border-b border-border bg-info/5/40 dark:bg-info/90/20 flex items-start gap-2.5">
          <GraduationCap className="h-4 w-4 text-info-foreground dark:text-info/60 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">
              Applied for: {courseInfo.name}
              {courseInfo.code && (
                <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">({courseInfo.code})</span>
              )}
              {(courseInfo.durationText || courseInfo.durationYears) && (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  · {courseInfo.durationText
                      || `${courseInfo.durationYears} ${courseInfo.durationYears === 1 ? "year" : "years"}`}
                </span>
              )}
            </p>
            {courseInfo.eligibility ? (
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                <span className="font-medium text-foreground/80">Eligibility:</span> {courseInfo.eligibility}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/70 italic mt-0.5">No eligibility criteria recorded for this course.</p>
            )}
            {courseInfo.entranceExam && (
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                <span className="font-medium text-foreground/80">Entrance:</span> {courseInfo.entranceExam}
                {courseInfo.entranceMandatory ? " (mandatory)" : " (optional)"}
              </p>
            )}
          </div>
        </div>
      )}
      {cahetRegistration && (
        <div className="px-4 py-2.5 border-b border-border bg-success/5/50 dark:bg-success/90/20">
          <CahetRegistrationDetails registration={cahetRegistration} compact />
        </div>
      )}

      {/* Body: sidebar list + main preview + action panel */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_240px] gap-0">
        {/* Sidebar: doc list */}
        <ul className="md:border-r border-border max-h-[480px] overflow-y-auto bg-muted/20">
          {docs.map((d, i) => {
            const s = reviews[d.path]?.status ?? "pending";
            const review = reviews[d.path];
            const isActive = i === activeIdx;
            return (
              <li key={d.path}>
                <button
                  onClick={() => setActiveIdx(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/40 flex items-start gap-2 transition-colors ${isActive ? "bg-info/5 dark:bg-info/90/20" : "hover:bg-muted/40"}`}
                >
                  <DocStatusDot status={s} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] truncate ${isActive ? "text-foreground font-medium" : "text-foreground"}`} title={d.name}>
                      {d.name}
                    </span>
                    {review?.reviewed_by_name && s !== "pending" && (
                      <span className="block text-[9px] text-muted-foreground truncate">
                        {s === "verified" ? "Verified" : "Rejected"} by {review.reviewed_by_name}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Main preview pane */}
        <div className="border-r-0 md:border-r border-border min-w-0 bg-muted/10">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <DocStatusDot status={activeStatus} />
              <span className="font-medium text-foreground truncate" title={active.name}>{active.name}</span>
            </div>
            <a
              href={active.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open in new tab <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <DocPreview doc={active} />
        </div>

        {/* Action panel — hides Verify once the doc is already verified so
            the operator isn't prompted to re-verify an already-decided doc. */}
        <div className="p-4 space-y-3 bg-card">
          {activeStatus === "verified" ? (
            <div className="rounded-lg bg-success/5 border border-success/20 px-3 py-2.5 flex items-center gap-2 dark:bg-success/90/20 dark:border-success/60/40">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-success-foreground dark:text-success/40">Verified</p>
                {activeReview?.reviewed_at && (
                  <p className="text-[10px] text-success/80 dark:text-success/60/70">
                    {activeReview.reviewed_by_name ? `Verified by ${activeReview.reviewed_by_name}` : "Verified"}
                    {" · "}
                    {new Date(activeReview.reviewed_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          ) : activeStatus === "rejected" ? (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2.5 dark:bg-destructive/90/20 dark:border-destructive/60/40">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <p className="text-xs font-semibold text-destructive dark:text-destructive/40">Rejected</p>
              </div>
              <p className="text-[11px] text-destructive/90 dark:text-destructive/50/80 mt-1 leading-snug">
                Waiting for the applicant to re-upload this document from the apply portal. Review actions will appear on the replacement file.
              </p>
              {activeReview?.reviewed_at && (
                <p className="text-[10px] text-destructive/70 dark:text-destructive/50/70 mt-1.5">
                  {activeReview.reviewed_by_name ? `Rejected by ${activeReview.reviewed_by_name}` : "Rejected"}
                  {" · "}
                  {new Date(activeReview.reviewed_at).toLocaleString()}
                </p>
              )}
            </div>
          ) : readOnly ? (
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground">
                {activeStatus === "rejected" ? "Rejected" : "Pending"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {readOnlyReason || "The application has been decided — no further doc review needed."}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Notes {notes ? "" : "(required for rejection)"}
                </label>
                <Textarea
                  id="doc-reject-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Photo unclear — please rescan in better light"
                  rows={3}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Button
                  size="sm"
                  className="w-full bg-success hover:bg-success/90 text-white"
                  onClick={() => handleDecision("verified")}
                  disabled={busy}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Verify
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-destructive border-destructive/20 hover:bg-destructive/5"
                  onClick={() => handleDecision("rejected")}
                  disabled={busy}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  Reject — request re-upload
                </Button>
              </div>
            </>
          )}

          {activeReview?.notes && (
            <div className="rounded-lg bg-muted/40 px-2.5 py-2 border border-border/60">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Last note</p>
              <p className="text-[11px] text-foreground leading-snug">{activeReview.notes}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setActiveIdx((i) => (i - 1 + docs.length) % docs.length)}
              disabled={docs.length < 2}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1"
              onClick={() => setActiveIdx((i) => (i + 1) % docs.length)}
              disabled={docs.length < 2}
            >
              Next<ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline preview ───────────────────────────────────────────────────

function DocPreview({ doc }: { doc: PreviewDoc }) {
  // Best-effort mime detection from filename. Storage signed URLs don't
  // include a content-type query, so extension is the cheapest signal.
  const lower = doc.name.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower);
  const isPdf = /\.pdf$/.test(lower);

  if (isImage) {
    return (
      <div className="flex items-center justify-center bg-muted/30 max-h-[480px] overflow-auto">
        <img src={doc.url} alt={doc.name} className="max-h-[480px] max-w-full object-contain" />
      </div>
    );
  }
  if (isPdf) {
    return (
      <iframe
        src={doc.url}
        title={doc.name}
        className="w-full h-[480px] bg-white"
      />
    );
  }
  // Unknown type — graceful fallback
  return (
    <div className="h-[200px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <ImageIcon className="h-8 w-8" />
      <p className="text-xs">No inline preview for this file type.</p>
      <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
        Open in new tab <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────

function DocStatusDot({ status }: { status: DocStatus }) {
  const cls = {
    verified: "bg-success/50",
    rejected: "bg-destructive/50",
    pending:  "bg-warning/40",
  }[status];
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${cls}`} aria-label={status} />;
}

function CountChip({ Icon, cls, children }: { Icon: typeof CheckCircle2; cls: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />{children}
    </span>
  );
}
