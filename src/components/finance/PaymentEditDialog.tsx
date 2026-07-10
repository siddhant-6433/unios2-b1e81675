// Super-admin-only edit + delete dialog for a single lead_payments row.
//
// Every edit / delete writes an audit row via the lead_payments trigger
// (see migration 20260612160000_lead_payments_audit.sql). The user must
// supply a "reason" which is captured into the audit row via a Postgres
// session-local setting, set just before the mutation.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { combineIndiaDateTimeInput, splitToIndiaDateTimeInput } from "@/lib/indiaDateTime";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "cash",          label: "Cash" },
  { value: "upi",           label: "UPI / Wallet / QR" },
  { value: "bank_transfer", label: "NEFT / IMPS / Bank Transfer" },
  { value: "cheque",        label: "Cheque / DD" },
  { value: "online",        label: "Online (Manual)" },
  { value: "gateway",       label: "Gateway" },
];

interface LeadPayment {
  id: string;
  receipt_no: string | null;
  type: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  payment_date: string | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: LeadPayment | null;
  onSaved?: () => void;
}

export function PaymentEditDialog({ open, onOpenChange, payment, onSaved }: Props) {
  const { toast } = useToast();
  const [amount,  setAmount]  = useState("");
  const [mode,    setMode]    = useState("cash");
  const [txnRef,  setTxnRef]  = useState("");
  const [date,    setDate]    = useState("");
  const [time,    setTime]    = useState("");
  const [notes,   setNotes]   = useState("");
  const [reason,  setReason]  = useState("");
  const [notifyCorrection, setNotifyCorrection] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!payment) return;
    setAmount(String(payment.amount));
    setMode(payment.payment_mode || "cash");
    setTxnRef(payment.transaction_ref || "");
    const paymentDateTime = splitToIndiaDateTimeInput(payment.payment_date);
    setDate(paymentDateTime.date);
    setTime(paymentDateTime.time);
    setNotes(payment.notes || "");
    setReason("");
    setNotifyCorrection(true);
    setConfirmDelete(false);
  }, [payment]);

  const inputCls = "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  const handleSave = async () => {
    if (!payment) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "Describe why this receipt is being edited.", variant: "destructive" });
      return;
    }
    setBusy(true);
    // edit_lead_payment is a SECURITY DEFINER RPC that performs
    // set_config('app.audit_reason') + UPDATE in one transaction, so the
    // audit trigger picks up the reason. Direct table UPDATE would lose
    // the GUC across the request boundary.
    const { error } = await (supabase as any).rpc("edit_lead_payment", {
      _id:              payment.id,
      _amount:          amt,
      _payment_mode:    mode,
      _transaction_ref: txnRef.trim() || null,
      _payment_date:    combineIndiaDateTimeInput(date, time) || payment.payment_date,
      _notes:           notes.trim() || null,
      _reason:          reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not update receipt", description: error.message, variant: "destructive" });
      return;
    }

    // Optionally fire a correction-notice notification. notify-event clears
    // receipt_url so the PDF gets regenerated with the new figures, then
    // re-fires the same WhatsApp template + finance/super-admin email.
    if (notifyCorrection) {
      const { error: nErr } = await (supabase as any).rpc("resend_payment_notification", {
        _payment_id: payment.id,
        _mode: "correction",
      });
      if (nErr) {
        toast({
          title: "Saved, but correction notice failed",
          description: nErr.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Receipt updated", description: "Correction notice sent to candidate + finance." });
      }
    } else {
      toast({ title: "Receipt updated", description: "Audit entry recorded. No correction notice sent." });
    }
    onSaved?.();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!payment) return;
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "Describe why this receipt is being deleted.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await (supabase as any).rpc("delete_lead_payment", {
      _id:     payment.id,
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not delete receipt", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Receipt deleted", description: "Audit entry recorded." });
    onSaved?.();
    onOpenChange(false);
  };

  if (!payment) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (busy) return; onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit receipt
            {payment.receipt_no && (
              <span className="text-xs font-mono text-muted-foreground">#{payment.receipt_no}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
              <input
                className={inputCls}
                type="number" min="1" step="1" inputMode="numeric"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Date</label>
              <input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Time</label>
              <input className={inputCls} type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Mode</label>
              <select className={inputCls} value={mode} onChange={e => setMode(e.target.value)}>
                {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Transaction Ref</label>
            <input
              className={inputCls}
              type="text"
              value={txnRef}
              onChange={e => setTxnRef(e.target.value)}
              placeholder="UTR, UPI ref, cheque #..."
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea
              className={inputCls}
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-destructive">
              Reason for change <span className="text-destructive">*</span>
            </label>
            <textarea
              className={inputCls + " border-destructive/25"}
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Corrected typo in amount (was ₹1000, should be ₹10000)"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Captured on the audit trail. Super-admins can review every edit + deletion.
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              checked={notifyCorrection}
              onChange={e => setNotifyCorrection(e.target.checked)}
              className="mt-0.5"
            />
            <div className="text-xs">
              <p className="font-medium text-foreground">Send correction notice</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Regenerate the PDF with the new figures and re-send the receipt to the candidate (WhatsApp + email),
                with a copy to finance and super-admin. Uncheck if this is a silent back-office correction.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {!confirmDelete ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="mr-auto text-destructive border-destructive/20 hover:bg-destructive/5"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete receipt
              </Button>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-destructive mr-auto">
                Confirm permanent deletion. The audit row will remain.
              </p>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-destructive hover:bg-destructive text-white"
                onClick={handleDelete}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm delete"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
