/**
 * Compose and send a WhatsApp nudge to a candidate who has an offer letter
 * but hasn't yet completed the AN-gate payment (25% of first-year fee).
 *
 * Sends via the Meta Cloud API through the existing `whatsapp-send` edge
 * function using the `admission_payment_nudge` template. The Meta template
 * must be approved separately in Meta WhatsApp Business Manager — see
 * migration 20260613140000 for the required body-param order.
 *
 * The Sem 1 due date used in the message is the global
 * `fee_submission_deadline` app-config value (the same key edited in
 * Settings → Applicant Deadlines). This dialog only previews it; to change
 * it, open Settings.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  effectiveApplicationDeadline,
  INITIAL_APPLICATION_DEADLINE,
} from "@/lib/deadlineRollover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, CalendarDays, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  candidate: {
    lead_id: string;
    full_name: string;
    phone: string | null;
    course_name: string | null;
    an_due: number | null;
    year1_due: number | null;
  } | null;
}

const fmtINR = (n: number | null | undefined) =>
  n != null && !isNaN(n) ? n.toLocaleString("en-IN") : "0";

const fmtDateHuman = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

export function NudgePaymentDialog({ open, onClose, candidate }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [dueDate, setDueDate] = useState<string>("");
  const [loadingDate, setLoadingDate] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingDate(true);
    (supabase as any).rpc("get_applicant_deadlines").then(({ data }: any) => {
      const v = (data?.fee_submission_deadline as string) || INITIAL_APPLICATION_DEADLINE;
      setDueDate(effectiveApplicationDeadline(v));
      setLoadingDate(false);
    });
  }, [open]);

  if (!candidate) return null;

  const anDue = candidate.an_due ?? 0;
  const year1Due = candidate.year1_due ?? 0;
  const dateLabel = fmtDateHuman(dueDate);
  const courseName = candidate.course_name || "your course";

  // Message preview — must match the body of the Meta template
  // `admission_payment_nudge` so admins know what will actually go out.
  const previewLines: string[] = [
    `Hi ${candidate.full_name},`,
    "",
    `Your offer for ${courseName} is awaiting confirmation.`,
    "",
    `Please pay ₹${fmtINR(anDue)} now to confirm admission and receive your Admission Number.`,
    "",
    `The full Sem 1 balance of ₹${fmtINR(year1Due)} must be cleared before ${dateLabel}.`,
    "",
    "Reply here if you need any help with the payment.",
  ];
  const preview = previewLines.join("\n");

  const handleSend = async () => {
    if (!candidate.phone) {
      toast({ title: "No phone number on file", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: "admission_payment_nudge",
          phone: candidate.phone,
          lead_id: candidate.lead_id,
          params: [
            candidate.full_name,
            courseName,
            fmtINR(anDue),
            fmtINR(year1Due),
            dateLabel,
          ],
        },
      });
      if (error) {
        // The edge function puts the real Meta error on error.context — extract.
        let detail = error.message;
        try {
          const ctx = (error as any)?.context;
          const body = typeof ctx?.json === "function"
            ? await ctx.json().catch(() => null)
            : ctx?.body ? JSON.parse(ctx.body) : null;
          if (body?.error) detail = body.error;
          else if (body?.message) detail = body.message;
        } catch { /* fall through */ }
        throw new Error(detail);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Nudge sent", description: `WhatsApp message sent to ${candidate.full_name}.` });
      onClose();
    } catch (e: any) {
      toast({
        title: "Couldn't send nudge",
        description: e?.message || "WhatsApp send failed. If this is the first send, make sure the `admission_payment_nudge` template is approved in Meta Business Manager.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-success" />
            Nudge {candidate.full_name} to confirm admission
          </DialogTitle>
          <DialogDescription className="text-xs">
            Sends the <code className="text-[10px] bg-muted px-1 rounded">admission_payment_nudge</code> WhatsApp template via Meta Cloud API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Amount summary */}
          <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground">To confirm admission (AN)</span>
              <span className="text-sm font-semibold tabular-nums text-success">₹{fmtINR(anDue)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground">Full Sem 1 balance</span>
              <span className="text-sm font-semibold tabular-nums">₹{fmtINR(year1Due)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground">Phone</span>
              <span className="text-sm font-mono tabular-nums">{candidate.phone || "—"}</span>
            </div>
          </div>

          {/* Due date — read-only here; managed in Settings */}
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">Sem 1 2026 Due Date</p>
                <p className="text-xs text-muted-foreground truncate">
                  {loadingDate ? "Loading…" : dateLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { onClose(); navigate("/settings"); }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline shrink-0"
              title="Edit in Settings → Applicant Deadlines"
            >
              Change
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          {/* Message preview */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Message preview <span className="text-muted-foreground/60">(must match the approved Meta template body)</span>
            </label>
            <div className="rounded-lg border border-border bg-card p-3 text-xs whitespace-pre-wrap leading-relaxed text-foreground/90 max-h-56 overflow-y-auto">
              {preview}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={sending || !candidate.phone || loadingDate}
            className="gap-1.5 bg-success hover:bg-success/90"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
            Send via WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
