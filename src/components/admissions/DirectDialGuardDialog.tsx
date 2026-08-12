import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface DirectDialGuardCounts {
  paid_pending: number;
  overdue_pending: number;
}

interface Props {
  open: boolean;
  counts: DirectDialGuardCounts;
  leadName: string;
  onOpenChange: (open: boolean) => void;
  /** Called with the reason text when the counsellor chooses to override. */
  onCallAnyway: (reason: string) => Promise<void> | void;
  /** Called when the counsellor is working an urgent list and snoozes the
   *  guard for this session (no per-lead reason). Logged for TL review. */
  onSnooze: () => Promise<void> | void;
}

/**
 * Soft guard shown before a direct call to a non-priority lead when the
 * counsellor has unattempted paid (meta/google <24h) leads or followups
 * overdue by >2h. Two paths: redirect to /cloud-dialer, or override with
 * a logged reason. Hard blocks would just be worked around — overrides
 * give TLs the audit trail to coach without adding friction for legit
 * cases.
 */
export function DirectDialGuardDialog({ open, counts, leadName, onOpenChange, onCallAnyway, onSnooze }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showReason, setShowReason] = useState(false);

  const reasonValid = reason.trim().split(/\s+/).filter(Boolean).length >= 5;
  const total = counts.paid_pending + counts.overdue_pending;

  const handleConfirm = async () => {
    if (!reasonValid) return;
    setSubmitting(true);
    try {
      await onCallAnyway(reason.trim());
    } finally {
      setSubmitting(false);
      setReason("");
      setShowReason(false);
      onOpenChange(false);
    }
  };

  const handleSnooze = async () => {
    setSubmitting(true);
    try {
      await onSnooze();
    } finally {
      setSubmitting(false);
      onOpenChange(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (submitting) return;
    if (!next) {
      setReason("");
      setShowReason(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Priority leads pending
          </DialogTitle>
          <DialogDescription>
            You have {total} {total === 1 ? "lead" : "leads"} that should be called first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {counts.paid_pending > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-primary/5 dark:bg-primary/80/20 p-3">
              <div>
                <div className="text-sm font-medium">Fresh Meta / Google Ads</div>
                <div className="text-xs text-muted-foreground">Unattempted, &lt; 24 hours old</div>
              </div>
              <div className="text-2xl font-bold text-primary dark:text-primary/50">
                {counts.paid_pending}
              </div>
            </div>
          )}
          {counts.overdue_pending > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-destructive/5 dark:bg-destructive/80/20 p-3">
              <div>
                <div className="text-sm font-medium">Overdue followups</div>
                <div className="text-xs text-muted-foreground">Past their scheduled time by &gt; 2 hours</div>
              </div>
              <div className="text-2xl font-bold text-destructive dark:text-destructive/60">
                {counts.overdue_pending}
              </div>
            </div>
          )}
        </div>

        {!showReason && (
          <button
            type="button"
            onClick={handleSnooze}
            disabled={submitting}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Working an urgent list? Snooze this for 2 hours
          </button>
        )}

        {showReason && (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Why call <span className="font-semibold">{leadName}</span> first?
            </label>
            <Textarea
              placeholder="e.g. Parent requested call back at this exact time. Min 5 words."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Your team leader can review override reasons.
            </p>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {!showReason ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setShowReason(true)}
                disabled={submitting}
              >
                Call anyway
              </Button>
              <Button asChild>
                <Link to="/cloud-dialer">
                  Open Dialer Queue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => { setShowReason(false); setReason(""); }}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!reasonValid || submitting}
              >
                <Phone className="mr-2 h-4 w-4" />
                {submitting ? "Placing call…" : "Confirm & Call"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
