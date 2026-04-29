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

    const { error } = await supabase.from("lead_payments" as any).insert({
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
    } as any);

    if (error) {
      toast({ title: "Failed to record payment", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      user_id: user?.id || null,
      type: "info_update",
      description: `${PAYMENT_TYPES.find((t) => t.value === type)?.label || type} of ₹${parseFloat(amount).toLocaleString("en-IN")} recorded (${PAYMENT_MODES.find((m) => m.value === mode)?.label || mode})${transactionRef ? ` — Ref: ${transactionRef}` : ""}`,
    });

    // Auto-advance stage if applicable
    const { data: lead } = await supabase.from("leads").select("stage").eq("id", leadId).single();
    if (lead) {
      const stageOrder = [
        "new_lead", "application_in_progress", "application_fee_paid", "application_submitted",
        "ai_called", "counsellor_call", "visit_scheduled", "interview",
        "offer_sent", "token_paid", "pre_admitted", "admitted", "rejected",
      ];
      const currentIdx = stageOrder.indexOf(lead.stage);

      if (type === "application_fee" && currentIdx < stageOrder.indexOf("application_fee_paid")) {
        await supabase.from("leads").update({ stage: "application_fee_paid" }).eq("id", leadId);
      } else if (type === "token_fee" && currentIdx < stageOrder.indexOf("token_paid")) {
        await supabase.from("leads").update({ stage: "token_paid" }).eq("id", leadId);
      }
    }

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
            disabled={!amount || parseFloat(amount) <= 0 || saving || (requireScreenshot && (!screenshot || !transactionRef.trim()))}
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
