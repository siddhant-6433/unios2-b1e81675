// Offline payment recorder — lets super-admin / campus_admin / accountant
// mark an application or token-fee payment as confirmed without going
// through the gateway. Inserts a `lead_payments` row with status='confirmed';
// the existing triggers then assign a receipt number, advance the lifecycle
// (PAN/AN issuance), and fire notify-event to send WA + finance@ email +
// receipt PDF.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, IndianRupee } from "lucide-react";

const PAY_TYPES: { value: string; label: string }[] = [
  { value: "application_fee", label: "Application Fee" },
  { value: "token_fee",       label: "Token Fee" },
  { value: "registration_fee",label: "Registration Fee" },
  { value: "other",           label: "Other Charges" },
];

// Payment modes the candidate's offline channel might use. The DB CHECK
// constraint accepts ('cash','upi','bank_transfer','cheque','online','gateway')
// — we expose these as user-friendly labels and pack any extra context
// (cheque #, bank, wallet name) into transaction_ref + notes.
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "cash",          label: "Cash" },
  { value: "upi",           label: "UPI / Wallet / QR" },
  { value: "bank_transfer", label: "NEFT / IMPS / Bank Transfer" },
  { value: "cheque",        label: "Cheque / DD" },
  { value: "online",        label: "Online (Manual)" },
];

const WALLET_OPTIONS = [
  "Paytm", "PhonePe", "GPay", "BHIM", "Bharath Pay", "SBI Pay", "Cred", "Other",
];

const BANK_OPTIONS = [
  "ICICI Bank", "HDFC Bank", "SBI", "Axis Bank", "Yes Bank", "Kotak Mahindra",
  "Punjab National Bank", "Bank of Baroda", "Canara Bank", "Union Bank",
  "IndusInd Bank", "IDFC First Bank", "Other",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  defaultType?: string;
  onRecorded?: () => void;
}

export function OfflinePaymentDialog({ open, onOpenChange, leadId, defaultType, onRecorded }: Props) {
  const { profile, role } = useAuth();
  const { toast } = useToast();

  const [type,   setType]   = useState<string>(defaultType || "application_fee");
  const [amount, setAmount] = useState<string>("");
  const [date,   setDate]   = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [mode,   setMode]   = useState<string>("cash");
  const [txnRef, setTxnRef] = useState<string>("");
  const [bank,   setBank]   = useState<string>("");
  const [wallet, setWallet] = useState<string>("");
  const [remarks,setRemarks]= useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const allowedRole = ["super_admin", "campus_admin", "accountant"].includes(role || "");

  if (!allowedRole) return null;

  const reset = () => {
    setType(defaultType || "application_fee");
    setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setMode("cash");
    setTxnRef("");
    setBank("");
    setWallet("");
    setRemarks("");
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    // DB enforces token_fee >= ₹5,000 via chk_lead_payments_token_fee_min
    if (type === "token_fee" && amt < 5000) {
      toast({ title: "Token fee must be at least ₹5,000", variant: "destructive" });
      return;
    }
    if (mode === "cheque" && !txnRef.trim()) {
      toast({ title: "Cheque / DD number is required", variant: "destructive" });
      return;
    }
    if ((mode === "bank_transfer" || mode === "upi") && !txnRef.trim()) {
      toast({ title: "Transaction reference is required", variant: "destructive" });
      return;
    }

    // Pack mode-specific context into notes so the receipt + audit trail
    // captures it (we don't want to grow the schema for every mode).
    const noteBits: string[] = [];
    if (mode === "cheque" && bank) noteBits.push(`Bank: ${bank}`);
    if (mode === "bank_transfer" && bank) noteBits.push(`Bank: ${bank}`);
    if (mode === "upi" && wallet) noteBits.push(`Wallet/App: ${wallet}`);
    if (remarks.trim()) noteBits.push(remarks.trim());
    const notes = noteBits.join(" · ");

    setSubmitting(true);
    const { data: inserted, error } = await (supabase.from("lead_payments") as any).insert({
      lead_id:         leadId,
      type,
      amount:          amt,
      payment_mode:    mode,
      transaction_ref: txnRef.trim() || null,
      payment_date:    `${date}T00:00:00+05:30`,
      status:          "confirmed",
      recorded_by:     profile?.id || null,
      gateway:         "offline",
      notes:           notes || null,
    }).select("id").maybeSingle();
    setSubmitting(false);

    if (error) {
      toast({ title: "Could not record payment", description: error.message, variant: "destructive" });
      return;
    }

    // Fire receipt PDF + WhatsApp + email explicitly from the client. The DB
    // trigger fn_notify_payment_received also fires for offline rows via
    // pg_net, but production has shown that path occasionally not delivering
    // (silent pg_net failures, _app_config drift). Invoking notify-event
    // directly here makes the offline flow self-contained — the migration
    // that pairs with this change makes the DB trigger skip gateway='offline'
    // rows so we don't double-send.
    const paymentId = inserted?.id as string | undefined;
    if (paymentId) {
      const event = type === "application_fee" ? "app_fee_paid" : "payment_received";
      supabase.functions.invoke("notify-event", {
        body: { event, lead_id: leadId, context: { payment_id: paymentId } },
      }).catch(e => console.error("[OfflinePaymentDialog] notify-event failed:", e));
    }

    toast({
      title: "Payment recorded",
      description: `${PAY_TYPES.find(p => p.value === type)?.label} of ₹${amt.toLocaleString("en-IN")} marked as confirmed.`,
    });
    reset();
    onOpenChange(false);
    onRecorded?.();
  };

  const inputCls = "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-primary" />
            Record Offline Payment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Type + Amount + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fee Type</label>
              <select className={inputCls} value={type} onChange={e => setType(e.target.value)}>
                {PAY_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
              <input
                className={inputCls}
                type="number" min="1" step="1" inputMode="numeric"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Transaction Date</label>
              <input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Payment Mode</label>
              <select className={inputCls} value={mode} onChange={e => { setMode(e.target.value); setTxnRef(""); setBank(""); setWallet(""); }}>
                {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* Mode-specific fields */}
          {mode === "cheque" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Cheque / DD Number</label>
                <input className={inputCls} value={txnRef} onChange={e => setTxnRef(e.target.value)} placeholder="e.g. 123456" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Bank</label>
                <select className={inputCls} value={bank} onChange={e => setBank(e.target.value)}>
                  <option value="">Select Bank</option>
                  {BANK_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
          )}

          {mode === "bank_transfer" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">UTR / Reference Number</label>
                <input className={inputCls} value={txnRef} onChange={e => setTxnRef(e.target.value)} placeholder="e.g. NEFT123456" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Bank</label>
                <select className={inputCls} value={bank} onChange={e => setBank(e.target.value)}>
                  <option value="">Select Bank</option>
                  {BANK_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
          )}

          {mode === "upi" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">UPI / Txn Reference</label>
                <input className={inputCls} value={txnRef} onChange={e => setTxnRef(e.target.value)} placeholder="UPI ref / txn id" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Wallet / App</label>
                <select className={inputCls} value={wallet} onChange={e => setWallet(e.target.value)}>
                  <option value="">Select</option>
                  {WALLET_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            </div>
          )}

          {mode === "online" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Reference / Receipt Number</label>
              <input className={inputCls} value={txnRef} onChange={e => setTxnRef(e.target.value)} placeholder="External ref no" />
            </div>
          )}

          {/* Cash needs no extra fields */}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Remarks (optional)</label>
            <textarea
              className={`${inputCls} min-h-[60px]`}
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Internal note for finance / counsellor"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Marking this confirmed will trigger receipt-number allocation, fee-ledger credit, and applicant + finance notifications.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {submitting ? "Recording…" : "Mark as Paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
