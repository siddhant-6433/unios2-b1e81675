// Student fee refund — cashier ticks the receipt(s)/heads to refund, enters a
// reason + payee bank details + a cancelled-cheque/passbook proof, and submits
// via create_fee_refund. Mirrors OfflinePaymentDialog's dialog/upload conventions.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/state-fields";
import { BankDetailsFields, type BankVerification } from "@/components/bank/BankDetailsFields";
import type { BankDetails } from "@/lib/bankDetails";
import { IndianRupee, Upload, X as XIcon, FileText } from "lucide-react";

type Allocation = {
  fee_ledger_payment_id: string;
  fee_ledger_id: string;
  lead_payment_id: string;
  fee_code: string;
  fee_head: string;
  term: string;
  receipt_no: string | null;
  payment_date: string | null;
  gateway: string | null;
  payment_mode: string | null;
  collected: number;
  already_refunded: number;
  remaining: number;
};

interface Props {
  studentId: string;
  studentName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const EMPTY_BANK: BankDetails = { holderName: "", accountNumber: "", ifsc: "", bankName: "", upi: "" };

export function RefundDialog({ studentId, studentName, open, onOpenChange, onDone }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Allocation[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [bank, setBank] = useState<BankDetails>(EMPTY_BANK);
  const [verification, setVerification] = useState<BankVerification | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked({});
    setReason("");
    setNotes("");
    setBank(EMPTY_BANK);
    setVerification(null);
    setProofFile(null);
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase.rpc as any)("get_refundable_allocations", { _student_id: studentId });
      setLoading(false);
      if (error) { toast({ title: "Could not load refundable payments", description: error.message, variant: "destructive" }); return; }
      setRows((data || []) as Allocation[]);
    })();
  }, [open, studentId]);

  const groups = useMemo(() => {
    const byReceipt = new Map<string, Allocation[]>();
    for (const r of rows) {
      const key = r.lead_payment_id;
      byReceipt.set(key, [...(byReceipt.get(key) || []), r]);
    }
    return Array.from(byReceipt.entries());
  }, [rows]);

  const toggle = (r: Allocation, on: boolean) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[r.fee_ledger_payment_id] = r.remaining;
      else delete next[r.fee_ledger_payment_id];
      return next;
    });

  const setAmount = (r: Allocation, raw: number) =>
    setPicked((prev) => ({ ...prev, [r.fee_ledger_payment_id]: Math.min(Math.max(0, raw), r.remaining) }));

  const total = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0);

  const handleSubmit = async () => {
    if (total <= 0) { toast({ title: "Select at least one head with an amount" }); return; }
    if (!reason.trim()) { toast({ title: "Reason is required", variant: "destructive" }); return; }

    setSubmitting(true);

    let proofUrl: string | null = null;
    if (proofFile) {
      const ext = proofFile.name.split(".").pop() || "bin";
      const path = `refunds/${studentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, proofFile, { contentType: proofFile.type, upsert: false });
      if (upErr) {
        setSubmitting(false);
        toast({ title: "Proof upload failed", description: upErr.message, variant: "destructive" });
        return;
      }
      const { data: pub } = supabase.storage.from("application-documents").getPublicUrl(path);
      proofUrl = pub?.publicUrl || path;
    }

    const items = rows
      .filter((r) => Number(picked[r.fee_ledger_payment_id]) > 0)
      .map((r) => ({ fee_ledger_payment_id: r.fee_ledger_payment_id, amount: Number(picked[r.fee_ledger_payment_id]) }));

    const bankPayload = {
      account_name: bank.holderName || null,
      account_number: bank.accountNumber || null,
      ifsc: bank.ifsc || null,
      bank_name: bank.bankName || null,
      upi: bank.upi || null,
      verified_name: verification?.name || null,
      verified_at: verification?.at || null,
      verification_ref: verification?.ref || null,
      verification_status: verification?.status || "unverified",
    };

    const { error } = await (supabase.rpc as any)("create_fee_refund", {
      _student_id: studentId,
      _reason: reason.trim(),
      _items: items,
      _bank: bankPayload,
      _proof_url: proofUrl,
      _notes: notes.trim() || null,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Could not create refund", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Refund created", description: `${money(total)} recorded as a draft refund for ${studentName || "this student"}.` });
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-primary" />
            Refund Payment{studentName ? ` — ${studentName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-2">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading refundable payments…</div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No refundable payments found for this student.</div>
          ) : (
            <div className="space-y-3">
              {groups.map(([receiptId, items]) => (
                <div key={receiptId} className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
                    Receipt {items[0].receipt_no || receiptId.slice(0, 8)}
                    <span className="ml-2 text-muted-foreground">
                      {items[0].payment_date ? new Date(items[0].payment_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      {items[0].gateway ? ` · ${items[0].gateway}` : ""}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((r) => {
                        const checked = picked[r.fee_ledger_payment_id] !== undefined;
                        return (
                          <tr key={r.fee_ledger_payment_id} className="border-t border-border/40">
                            <td className="w-8 px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-primary"
                                checked={checked}
                                onChange={(e) => toggle(r, e.target.checked)}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <span className="block font-medium text-foreground">{r.fee_head}</span>
                              <span className="block text-[10px] text-muted-foreground">
                                {r.term} · collected {money(r.collected)}
                                {r.already_refunded > 0 ? ` · refunded ${money(r.already_refunded)}` : ""} · balance {money(r.remaining)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right w-28">
                              <input
                                type="number" min={0} max={r.remaining} step={1} inputMode="numeric"
                                value={checked ? picked[r.fee_ledger_payment_id] : ""}
                                disabled={!checked}
                                onChange={(e) => setAmount(r, Math.round(Number(e.target.value) || 0))}
                                className="w-24 rounded-lg border border-input bg-background px-2 py-1 text-right text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-40"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              <div className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                <span>Total refund</span>
                <span>{money(total)}</span>
              </div>
            </div>
          )}

          <TextAreaField
            value={reason}
            onValueChange={setReason}
            label="Reason for refund"
            required
            placeholder="Why is this being refunded?"
          />

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Payee Bank Details</p>
            <BankDetailsFields
              value={bank}
              onChange={setBank}
              onVerification={setVerification}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Cancelled Cheque / Passbook (optional)</label>
            {proofFile ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2 text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate text-foreground">{proofFile.name}</span>
                <span className="text-muted-foreground">{(proofFile.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => setProofFile(null)} className="text-muted-foreground hover:text-foreground" title="Remove">
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-card px-3 py-3 text-xs text-muted-foreground hover:bg-muted/30 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>Click to attach a cancelled cheque or passbook photo</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) { toast({ title: "File too large", description: "Max 10 MB.", variant: "destructive" }); return; }
                    setProofFile(f);
                  }}
                />
              </label>
            )}
          </div>

          <TextAreaField
            value={notes}
            onValueChange={setNotes}
            label="Notes (optional)"
            placeholder="Internal note for finance"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || total <= 0 || !reason.trim()}>
            {submitting ? <ButtonOrb state="connecting" onFilled /> : null}
            {submitting ? "Creating…" : `Create Refund ${total > 0 ? money(total) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
