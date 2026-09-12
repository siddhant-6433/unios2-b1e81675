// Super-admin-only edit + delete dialog for a single lead_payments row.
//
// Every edit / delete writes an audit row via the lead_payments trigger
// (see migration 20260612160000_lead_payments_audit.sql). The user must
// supply a "reason" which is captured into the audit row via a Postgres
// session-local setting, set just before the mutation.
//
// Amount changes are locked while the receipt is still applied to fee
// heads: unassign first, optionally reassign the corrected figure, then
// save. The RPC also clamps allocated-to-ledger so it cannot exceed the
// receipt amount if someone bypasses the UI.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { combineIndiaDateTimeInput, splitToIndiaDateTimeInput } from "@/lib/indiaDateTime";
import { feeTermLabel, type FeeStructureMetadata } from "@/lib/feeTermLabels";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Lock, Trash2 } from "lucide-react";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "cash",          label: "Cash" },
  { value: "upi",           label: "UPI / Wallet / QR" },
  { value: "bank_transfer", label: "NEFT / IMPS / Bank Transfer" },
  { value: "cheque",        label: "Cheque / DD" },
  { value: "online",        label: "Online (Manual)" },
  { value: "gateway",       label: "Gateway" },
];

const money = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

interface LeadPayment {
  id: string;
  receipt_no: string | null;
  type: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  payment_date: string | null;
  notes: string | null;
  lead_id?: string | null;
  student_id?: string | null;
}

export interface ReceiptEditFeeHead {
  id: string;
  fee_code_id?: string | null;
  term?: string | null;
  balance?: number;
  fee_codes?: { name?: string | null; code?: string | null } | null;
}

interface AppliedHead {
  flpId: string;
  feeLedgerId: string;
  feeCodeId: string;
  amount: number;
  label: string;
}

interface AssignHead {
  id: string;
  feeCodeId: string;
  label: string;
  due: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: LeadPayment | null;
  onSaved?: () => void;
  studentId?: string | null;
  leadId?: string | null;
  fees?: ReceiptEditFeeHead[];
  feeMeta?: FeeStructureMetadata;
}

export function PaymentEditDialog({
  open, onOpenChange, payment, onSaved, studentId, leadId, fees, feeMeta,
}: Props) {
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
  const [applied, setApplied] = useState<AppliedHead[]>([]);
  const [assignable, setAssignable] = useState<AssignHead[]>([]);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});

  const headLabel = (fee: ReceiptEditFeeHead | AppliedHead | { term?: string | null; label?: string; fee_codes?: ReceiptEditFeeHead["fee_codes"] }) => {
    if ("label" in fee && fee.label) return fee.label;
    const codes = "fee_codes" in fee ? fee.fee_codes : undefined;
    const name = codes?.name || codes?.code || "Fee head";
    const term = "term" in fee ? fee.term : undefined;
    return term ? `${name} — ${feeTermLabel(term, feeMeta)}` : name;
  };

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
    setAssignTo({});
  }, [payment]);

  useEffect(() => {
    if (!open || !payment) {
      setApplied([]);
      setAssignable([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("fee_ledger_payments")
        .select("id, amount, fee_ledger_id, fee_ledger:fee_ledger_id(id, term, due_date, fee_code_id, fee_codes:fee_code_id(name, code))")
        .eq("lead_payment_id", payment.id);
      if (cancelled) return;
      const rows: AppliedHead[] = ((data || []) as any[]).map((row) => ({
        flpId: row.id,
        feeLedgerId: row.fee_ledger_id,
        feeCodeId: row.fee_ledger?.fee_code_id || "",
        amount: Number(row.amount || 0),
        label: headLabel({
          term: row.fee_ledger?.term,
          fee_codes: row.fee_ledger?.fee_codes,
        }),
      }));
      setApplied(rows);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment?.id]);

  useEffect(() => {
    const fromFees: AssignHead[] = (fees || []).map((f) => ({
      id: f.id,
      feeCodeId: f.fee_code_id || "",
      label: headLabel(f),
      due: Number(f.balance || 0),
    }));
    const byId = new Map(fromFees.map((h) => [h.id, h]));
    for (const a of applied) {
      const cur = byId.get(a.feeLedgerId) || {
        id: a.feeLedgerId,
        feeCodeId: a.feeCodeId,
        label: a.label,
        due: 0,
      };
      byId.set(a.feeLedgerId, cur);
    }
    setAssignable([...byId.values()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fees, applied]);

  const appliedTotal = useMemo(
    () => Math.round(applied.reduce((s, a) => s + a.amount, 0) * 100) / 100,
    [applied],
  );
  const isLeadless = !(payment?.lead_id || leadId) && !!(payment?.student_id || studentId);
  const receiptAmt = Number(amount) || 0;
  const excess = Math.round((appliedTotal - receiptAmt) * 100) / 100;
  const amountLocked = appliedTotal > 0.009;
  const assignSum = useMemo(
    () => Math.round(Object.values(assignTo).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100,
    [assignTo],
  );

  const inputCls = "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  const requireReason = () => {
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "Describe why this receipt is being changed.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const loadApplied = async (paymentId: string) => {
    const { data } = await (supabase as any)
      .from("fee_ledger_payments")
      .select("id, amount, fee_ledger_id, fee_ledger:fee_ledger_id(id, term, due_date, fee_code_id, fee_codes:fee_code_id(name, code))")
      .eq("lead_payment_id", paymentId);
    const rows: AppliedHead[] = ((data || []) as any[]).map((row) => ({
      flpId: row.id,
      feeLedgerId: row.fee_ledger_id,
      feeCodeId: row.fee_ledger?.fee_code_id || "",
      amount: Number(row.amount || 0),
      label: headLabel({
        term: row.fee_ledger?.term,
        fee_codes: row.fee_ledger?.fee_codes,
      }),
    }));
    setApplied(rows);
    return rows;
  };

  const unassign = async (amountToUnapply: number | null) => {
    if (!payment || !requireReason()) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("unapply_lead_payment_from_ledger", {
      _payment_id: payment.id,
      _reason: reason.trim(),
      _amount: amountToUnapply,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not unassign from ledger", description: error.message, variant: "destructive" });
      return;
    }
    const released = Number(data?.unapplied || amountToUnapply || appliedTotal);
    const remaining = await loadApplied(payment.id);
    if (remaining.length === 0) setAssignTo({});
    onSaved?.();
    toast({
      title: "Unassigned from ledger",
      description: `${money(released)} is now unallocated. ${remaining.length === 0 ? "You can change the amount and reassign it below." : "Remaining heads still hold this receipt."}`,
    });
  };

  const handleSave = async () => {
    if (!payment) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!requireReason()) return;
    if (amountLocked && Math.abs(amt - Number(payment.amount)) > 0.009) {
      toast({
        title: "Unassign from the ledger first",
        description: "This receipt is still applied to fee heads. Unassign, then change the amount, then reassign.",
        variant: "destructive",
      });
      return;
    }
    const assignRows = Object.entries(assignTo)
      .map(([id, raw]) => {
        const head = assignable.find((h) => h.id === id);
        const value = Number(raw) || 0;
        return head && value > 0
          ? { fee_ledger_id: head.id, fee_code_id: head.feeCodeId, amount: value, label: head.label }
          : null;
      })
      .filter(Boolean) as { fee_ledger_id: string; fee_code_id: string; amount: number; label: string }[];
    if (assignRows.length > 0 && assignSum > amt + 0.009) {
      toast({
        title: "Assignment exceeds the receipt",
        description: `Heads add up to ${money(assignSum)} but the receipt is ${money(amt)}.`,
        variant: "destructive",
      });
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
    if (error) {
      setBusy(false);
      toast({ title: "Could not update receipt", description: error.message, variant: "destructive" });
      return;
    }

    if (assignRows.length > 0) {
      const { error: aErr } = await (supabase as any).rpc("apply_lead_payment_allocations", {
        _payment_id: payment.id,
        _allocations: assignRows,
        _reason: reason.trim(),
      });
      if (aErr) {
        setBusy(false);
        toast({
          title: "Receipt saved, but reassignment failed",
          description: aErr.message,
          variant: "destructive",
        });
        onSaved?.();
        return;
      }
    }

    // Optionally fire a correction-notice notification. notify-event clears
    // receipt_url so the PDF gets regenerated with the new figures, then
    // re-fires the same WhatsApp template + finance/super-admin email.
    // School (lead-less) receipts have no WhatsApp lead — regenerate the PDF
    // directly so the notice does not fail with "Payment not found".
    if (notifyCorrection) {
      const { error: nErr } = await (supabase as any).rpc("resend_payment_notification", {
        _payment_id: payment.id,
        _mode: "correction",
      });
      let pdfFailed = !!nErr;
      if (isLeadless || !payment.lead_id) {
        const { error: pdfErr } = await supabase.functions.invoke("generate-payment-receipt", {
          body: { payment_id: payment.id },
        });
        pdfFailed = !!pdfErr;
      }
      setBusy(false);
      if (pdfFailed) {
        toast({
          title: "Saved, but correction notice failed",
          description: nErr?.message || "The receipt PDF could not be regenerated.",
          variant: "destructive",
        });
      } else if (payment.lead_id) {
        toast({ title: "Receipt updated", description: "Correction notice sent to candidate + finance." });
      } else {
        toast({ title: "Receipt updated", description: "PDF regenerated with the new figures." });
      }
    } else {
      setBusy(false);
      toast({ title: "Receipt updated", description: "Audit entry recorded. No correction notice sent." });
    }
    onSaved?.();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!payment) return;
    if (!requireReason()) return;
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
    toast({ title: "Receipt deleted", description: "Ledger application reversed. Audit entry recorded." });
    onSaved?.();
    onOpenChange(false);
  };

  if (!payment) return null;

  const showReassign = applied.length === 0 && assignable.some((h) => h.due > 0.009);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (busy) return; onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit receipt
            {payment.receipt_no && (
              <span className="text-xs font-mono text-muted-foreground">#{payment.receipt_no}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {applied.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 space-y-2">
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Applied to the fee ledger · {money(appliedTotal)}
              </p>
              <div className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/60">
                {applied.map((a) => (
                  <div key={a.flpId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="text-[11px] text-foreground truncate">{a.label}</span>
                    <span className="text-[11px] font-semibold tabular-nums">{money(a.amount)}</span>
                  </div>
                ))}
              </div>
              {excess > 0.009 && (
                <p className="text-[11px] text-destructive">
                  Ledger still has {money(excess)} more credited than this {money(receiptAmt)} receipt.
                  Unassign the excess so the heads match the receipt.
                </p>
              )}
              {excess <= 0.009 && (
                <p className="text-[11px] text-muted-foreground">
                  Unassign from the ledger before changing the amount, then reassign the corrected figure.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {excess > 0.009 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => unassign(excess)} disabled={busy}>
                    Unassign excess {money(excess)}
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => unassign(null)} disabled={busy}>
                  Unassign all
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
              <input
                className={inputCls + (amountLocked ? " bg-muted/50 text-muted-foreground" : "")}
                type="number" min="1" step="1" inputMode="numeric"
                value={amount}
                disabled={amountLocked}
                onChange={e => setAmount(e.target.value)}
              />
              {amountLocked && (
                <p className="text-[10px] text-muted-foreground mt-1">Locked while this receipt is applied to fee heads.</p>
              )}
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

          {showReassign && (
            <div className="rounded-lg border border-border px-3 py-2 space-y-2">
              <p className="text-xs font-medium text-foreground">Reassign to fee heads</p>
              <p className="text-[11px] text-muted-foreground">
                Optional. Tick the heads this {money(receiptAmt || Number(payment.amount))} should settle.
                Leftover stays as unallocated credit.
              </p>
              <div className="max-h-40 overflow-y-auto divide-y divide-border rounded-md border border-border/60">
                {assignable.filter((h) => h.due > 0.009).map((h) => {
                  const on = assignTo[h.id] != null;
                  return (
                    <label key={h.id} className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          setAssignTo((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) next[h.id] = String(Math.min(h.due, receiptAmt || h.due));
                            else delete next[h.id];
                            return next;
                          });
                        }}
                      />
                      <span className="flex-1 text-[11px] truncate">{h.label}</span>
                      {on ? (
                        <input
                          className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-xs tabular-nums"
                          type="number" min="1" step="1"
                          value={assignTo[h.id]}
                          onChange={(e) => setAssignTo((prev) => ({ ...prev, [h.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground tabular-nums">due {money(h.due)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
              {assignSum > 0 && (
                <p className={`text-[11px] tabular-nums ${assignSum - receiptAmt > 0.009 ? "text-destructive" : "text-muted-foreground"}`}>
                  Assigning {money(assignSum)} of {money(receiptAmt)}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-destructive">
              Reason for change <span className="text-destructive">*</span>
            </label>
            <textarea
              className={inputCls + " border-destructive/25"}
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Corrected typo in amount (was ₹1600, should be ₹800)"
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
                Regenerate the PDF with the new figures
                {leadId || payment.lead_id
                  ? " and re-send the receipt to the candidate (WhatsApp + email), with a copy to finance and super-admin."
                  : ". School receipts have no admission lead, so only the PDF is regenerated."}
                {" "}Uncheck if this is a silent back-office correction.
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
                {busy ? <ButtonOrb state="connecting" onFilled /> : "Save changes"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-destructive mr-auto">
                Confirm permanent deletion. The ledger application is reversed. The audit row will remain.
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
                {busy ? <ButtonOrb state="connecting" onFilled /> : "Confirm delete"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
