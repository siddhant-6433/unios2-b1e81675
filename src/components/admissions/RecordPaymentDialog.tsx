import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IndianRupee, Loader2, Upload, FileImage, X } from "lucide-react";

const PAYMENT_TYPES = [
  { value: "application_fee", label: "Application Fee" },
  { value: "token_fee", label: "Token Fee" },
  { value: "registration_fee", label: "Registration Fee" },
  { value: "other", label: "Other" },
];

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer / NEFT" },
  { value: "cheque", label: "Cheque / DD" },
  { value: "online", label: "Online / Gateway" },
];

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  onSuccess?: () => void;
  defaultType?: string;
  requireScreenshot?: boolean;
  title?: string;
}

export function RecordPaymentDialog({
  open, onOpenChange, leadId, leadName, onSuccess,
  defaultType, requireScreenshot, title,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [type, setType] = useState(defaultType || "application_fee");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("upi");
  const [transactionRef, setTransactionRef] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [notes, setNotes] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [feeStatus, setFeeStatus] = useState<{
    first_year_fee: number;
    token_required: number;
    token_paid: number;
    application_paid: number;
    total_paid: number;
    twenty_five_pct: number;
    min_token_instalment?: number;
    token_complete: boolean;
    twenty_five_complete: boolean;
  } | null>(null);

  // Pull live fee status whenever the dialog opens so the user sees outstanding /
  // threshold info and we can validate the minimum instalment.
  useEffect(() => {
    if (!open || !leadId) { setFeeStatus(null); return; }
    supabase.rpc("lead_fee_status" as any, { _lead_id: leadId }).then(({ data }) => {
      if (data) setFeeStatus(data as any);
    });
  }, [open, leadId]);

  const tokenOutstanding = feeStatus ? Math.max(0, feeStatus.token_required - feeStatus.token_paid) : 0;
  const minInstalment = feeStatus?.min_token_instalment ?? 5000;
  const isTokenInstalmentBelowMin =
    type === "token_fee" &&
    amount !== "" &&
    parseFloat(amount) > 0 &&
    parseFloat(amount) < minInstalment &&
    tokenOutstanding > minInstalment;

  useEffect(() => {
    if (open) {
      setType(defaultType || "application_fee");
      setAmount("");
      setMode("upi");
      setTransactionRef("");
      setReceiptNo("");
      setNotes("");
      setScreenshot(null);
    }
  }, [open, defaultType]);

  const handleSave = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (isTokenInstalmentBelowMin) {
      toast({
        title: `Minimum ₹${minInstalment.toLocaleString("en-IN")} per token instalment`,
        description: `Outstanding token: ₹${tokenOutstanding.toLocaleString("en-IN")}. Pay at least ₹${minInstalment.toLocaleString("en-IN")} unless this is the final balance.`,
        variant: "destructive",
      });
      return;
    }
    if (requireScreenshot && !screenshot) {
      toast({ title: "Screenshot required", description: "Upload the payment proof image to continue.", variant: "destructive" });
      return;
    }
    if (requireScreenshot && !transactionRef.trim()) {
      toast({ title: "Transaction reference required", description: "Enter the UTR / transaction ref.", variant: "destructive" });
      return;
    }
    setSaving(true);

    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    let receiptUrl: string | null = null;
    if (screenshot) {
      const ext = screenshot.name.split(".").pop() || "jpg";
      const path = `payment-receipts/${leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, screenshot, { contentType: screenshot.type, upsert: false });
      if (upErr) {
        toast({ title: "Screenshot upload failed", description: upErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      const { data: pub } = supabase.storage.from("application-documents").getPublicUrl(path);
      receiptUrl = pub?.publicUrl || path;
    }

    const { data: inserted, error } = await supabase.from("lead_payments" as any).insert({
      lead_id: leadId,
      type,
      amount: parseFloat(amount),
      payment_mode: mode,
      transaction_ref: transactionRef || null,
      receipt_no: receiptNo || null,
      receipt_url: receiptUrl,
      notes: notes || null,
      recorded_by: profileId,
      status: "confirmed",
    } as any).select("id").single();

    if (error) {
      toast({ title: "Failed to record payment", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Fire receipt PDF + notifications (WhatsApp + email). Fire-and-forget so
    // the user isn't blocked on PDF rendering / network.
    if (inserted?.id) {
      supabase.functions.invoke("generate-payment-receipt", { body: { lead_payment_id: inserted.id } })
        .catch(() => {});
    }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: user?.id || null,
      type: "info_update",
      description: `${PAYMENT_TYPES.find((t) => t.value === type)?.label || type} of ₹${parseFloat(amount).toLocaleString("en-IN")} recorded (${PAYMENT_MODES.find((m) => m.value === mode)?.label || mode})${transactionRef ? ` — Ref: ${transactionRef}` : ""}`,
    });

    // Stage advancement is handled by the lead_payments AFTER trigger
    // (handle_lead_payment_change). It checks the 10% / 25% thresholds and
    // auto-issues PAN / AN. We don't flip stage from here anymore.

    toast({ title: "Payment recorded", description: `₹${parseFloat(amount).toLocaleString("en-IN")} ${PAYMENT_TYPES.find((t) => t.value === type)?.label} recorded.` });
    setSaving(false);
    onOpenChange(false);
    onSuccess?.();
  };

  const inputClass = "w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-5 w-5 text-primary" />
            {title || "Record Payment"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{leadName}</p>
        </DialogHeader>

        {feeStatus && feeStatus.first_year_fee > 0 && (
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">First-year fee</span>
              <span className="font-semibold text-foreground">₹{feeStatus.first_year_fee.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Token (10%)</span>
              <span className="text-foreground">
                ₹{feeStatus.token_paid.toLocaleString("en-IN")} / ₹{feeStatus.token_required.toLocaleString("en-IN")}
                {feeStatus.token_complete && <span className="ml-1 text-emerald-600">✓ complete</span>}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Towards 25% (admission)</span>
              <span className="text-foreground">
                ₹{feeStatus.total_paid.toLocaleString("en-IN")} / ₹{feeStatus.twenty_five_pct.toLocaleString("en-IN")}
                {feeStatus.twenty_five_complete && <span className="ml-1 text-emerald-600">✓ complete</span>}
              </span>
            </div>
            {type === "token_fee" && tokenOutstanding > 0 && !feeStatus.token_complete && (
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                Outstanding token: ₹{tokenOutstanding.toLocaleString("en-IN")} · min instalment ₹{minInstalment.toLocaleString("en-IN")}{tokenOutstanding < minInstalment && " (final balance, any amount allowed)"}
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                {PAYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Amount <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={`${inputClass} pl-8`}
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Mode</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    mode === m.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Transaction Ref / UTR</label>
              <input
                type="text"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                placeholder="UPI / Cheque No"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Receipt No</label>
              <input
                type="text"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Payment Proof / Screenshot{requireScreenshot && <span className="text-destructive ml-0.5">*</span>}
            </label>
            {screenshot ? (
              <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm">
                <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate text-foreground">{screenshot.name}</span>
                <span className="text-xs text-muted-foreground">{(screenshot.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => setScreenshot(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-card px-3 py-3 text-sm text-muted-foreground hover:bg-muted cursor-pointer">
                <Upload className="h-4 w-4" />
                <span>Click to upload (image or PDF)</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={
              !amount || parseFloat(amount) <= 0 || saving ||
              isTokenInstalmentBelowMin ||
              (requireScreenshot && (!screenshot || !transactionRef.trim()))
            }
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
