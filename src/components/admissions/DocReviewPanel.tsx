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
  ExternalLink, RefreshCw, FileText, Image as ImageIcon,
} from "lucide-react";
import type { PreviewDoc } from "@/components/applicant/ApplicationPreview";

type DocStatus = "pending" | "verified" | "rejected";

export interface DocReview {
  file_path: string;
  status: DocStatus;
  notes: string | null;
  reviewed_at: string | null;
}

interface Props {
  docs: PreviewDoc[];
  reviews: Record<string, DocReview>;
  /** Parent persists the change, then echoes it back via the `reviews` prop. */
  onSetStatus: (doc: PreviewDoc, next: DocStatus, notes?: string) => Promise<void> | void;
}

export function DocReviewPanel({ docs, reviews, onSetStatus }: Props) {
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
            Approve, reject (with reason), or request a re-upload. The applicant gets the rejection note via WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <CountChip Icon={CheckCircle2} cls="bg-emerald-50 text-emerald-700">{counts.verified} verified</CountChip>
          {counts.rejected > 0 && <CountChip Icon={XCircle} cls="bg-rose-50 text-rose-700">{counts.rejected} rejected</CountChip>}
          {counts.pending > 0 && <CountChip Icon={Clock} cls="bg-amber-50 text-amber-700">{counts.pending} pending</CountChip>}
        </div>
      </div>

      {/* Body: sidebar list + main preview + action panel */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_240px] gap-0">
        {/* Sidebar: doc list */}
        <ul className="md:border-r border-border max-h-[480px] overflow-y-auto bg-muted/20">
          {docs.map((d, i) => {
            const s = reviews[d.path]?.status ?? "pending";
            const isActive = i === activeIdx;
            return (
              <li key={d.path}>
                <button
                  onClick={() => setActiveIdx(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/40 flex items-start gap-2 transition-colors ${isActive ? "bg-blue-50 dark:bg-blue-950/20" : "hover:bg-muted/40"}`}
                >
                  <DocStatusDot status={s} />
                  <span className={`text-[11px] truncate flex-1 ${isActive ? "text-foreground font-medium" : "text-foreground"}`} title={d.name}>
                    {d.name}
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

        {/* Action panel */}
        <div className="p-4 space-y-3 bg-card">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Notes {activeStatus === "rejected" || notes ? "" : "(required for rejection)"}
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
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => handleDecision("verified")}
              disabled={busy}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Verify
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-rose-700 border-rose-200 hover:bg-rose-50"
              onClick={() => handleDecision("rejected")}
              disabled={busy}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              {activeStatus === "rejected" ? "Update rejection" : "Reject — request re-upload"}
            </Button>
          </div>

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
    verified: "bg-emerald-500",
    rejected: "bg-rose-500",
    pending:  "bg-amber-400",
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
