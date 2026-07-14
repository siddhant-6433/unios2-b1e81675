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
import { combineIndiaDateTimeInput, getCurrentIndiaDateTimeInput } from "@/lib/indiaDateTime";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextField, SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { Loader2, IndianRupee, Upload, X as XIcon, FileText } from "lucide-react";

const PAY_TYPES: { value: string; label: string }[] = [
  { value: "application_fee",     label: "Application Fee" },
  { value: "pre_admission_token", label: "Token Fee (prior to admission)" },
  { value: "token_fee",           label: "Token Fee" },
  { value: "registration_fee",    label: "Registration Fee" },
  { value: "other",               label: "Other Charges" },
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
  applicationId?: string | null;
  defaultType?: string;
  onRecorded?: () => void;
}

export function OfflinePaymentDialog({ open, onOpenChange, leadId, applicationId, defaultType, onRecorded }: Props) {
  const { profile, role } = useAuth();
  const { toast } = useToast();

  const [type,   setType]   = useState<string>(defaultType || "application_fee");
  const [amount, setAmount] = useState<string>("");
  const initialDateTime = getCurrentIndiaDateTimeInput();
  const [date,   setDate]   = useState<string>(initialDateTime.date);
  const [time,   setTime]   = useState<string>(initialDateTime.time);
  const [mode,   setMode]   = useState<string>("cash");
  const [txnRef, setTxnRef] = useState<string>("");
  const [bank,   setBank]   = useState<string>("");
  const [wallet, setWallet] = useState<string>("");
  const [remarks,setRemarks]= useState<string>("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Owner decision: offline cash recording is cashier (accountant) + super_admin
  // only — no counsellors, no campus admins, no consultants.
  const allowedRole = ["super_admin", "accountant"].includes(role || "");

  if (!allowedRole) return null;

  const reset = () => {
    const now = getCurrentIndiaDateTimeInput();
    setType(defaultType || "application_fee");
    setAmount("");
    setDate(now.date);
    setTime(now.time);
    setMode("cash");
    setTxnRef("");
    setBank("");
    setWallet("");
    setRemarks("");
    setProofFile(null);
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
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
    if (type === "application_fee" && applicationId) noteBits.push(`Application: ${applicationId}`);
    if (mode === "cheque" && bank) noteBits.push(`Bank: ${bank}`);
    if (mode === "bank_transfer" && bank) noteBits.push(`Bank: ${bank}`);
    if (mode === "upi" && wallet) noteBits.push(`Wallet/App: ${wallet}`);
    if (remarks.trim()) noteBits.push(remarks.trim());
    const notes = noteBits.join(" · ");

    setSubmitting(true);

    // Upload supporting document/image FIRST so we can store its URL on
    // the lead_payments row. Bucket = application-documents (public) so
    // the link in the receipts table works without signing every time.
    let proofUrl: string | null = null;
    if (proofFile) {
      const ext = proofFile.name.split(".").pop() || "bin";
      const path = `payment-proofs/${leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

    const { data: inserted, error } = await (supabase.from("lead_payments") as any).insert({
      lead_id:         leadId,
      type,
      amount:          amt,
      payment_mode:    mode,
      transaction_ref: txnRef.trim() || null,
      payment_date:    combineIndiaDateTimeInput(date, time),
      status:          "confirmed",
      recorded_by:     profile?.id || null,
      gateway:         "offline",
      notes:           notes || null,
      proof_url:       proofUrl,
      application_id:   type === "application_fee" ? applicationId || null : null,
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
        body: { event, lead_id: leadId, context: { payment_id: paymentId, application_id: applicationId || undefined } },
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
          {/* Type + amount row */}
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              value={type}
              onValueChange={setType}
              options={PAY_TYPES.map(p => ({ value: p.value, label: p.label }))}
              label="Fee Type"
              allowEmpty={false}
            />
            <FieldShell label="Amount (₹)">
              <Input
                type="number" min="1" step="1" inputMode="numeric"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
              />
            </FieldShell>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Transaction Date">
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </FieldShell>
            <FieldShell label="Transaction Time">
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </FieldShell>
          </div>

          <SelectField
            value={mode}
            onValueChange={value => { setMode(value); setTxnRef(""); setBank(""); setWallet(""); }}
            options={MODE_OPTIONS.map(m => ({ value: m.value, label: m.label }))}
            label="Payment Mode"
            allowEmpty={false}
          />

          {/* Mode-specific fields */}
          {mode === "cheque" && (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                value={txnRef}
                onValueChange={setTxnRef}
                label="Cheque / DD Number"
                placeholder="e.g. 123456"
              />
              <SelectField
                value={bank}
                onValueChange={setBank}
                options={[{ value: "", label: "Select Bank" }, ...BANK_OPTIONS.map(b => ({ value: b, label: b }))]}
                label="Bank"
                placeholder="Select Bank"
              />
            </div>
          )}

          {mode === "bank_transfer" && (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                value={txnRef}
                onValueChange={setTxnRef}
                label="UTR / Reference Number"
                placeholder="e.g. NEFT123456"
              />
              <SelectField
                value={bank}
                onValueChange={setBank}
                options={[{ value: "", label: "Select Bank" }, ...BANK_OPTIONS.map(b => ({ value: b, label: b }))]}
                label="Bank"
                placeholder="Select Bank"
              />
            </div>
          )}

          {mode === "upi" && (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                value={txnRef}
                onValueChange={setTxnRef}
                label="UPI / Txn Reference"
                placeholder="UPI ref / txn id"
              />
              <SelectField
                value={wallet}
                onValueChange={setWallet}
                options={[{ value: "", label: "Select" }, ...WALLET_OPTIONS.map(w => ({ value: w, label: w }))]}
                label="Wallet / App"
                placeholder="Select"
              />
            </div>
          )}

          {mode === "online" && (
            <TextField
              value={txnRef}
              onValueChange={setTxnRef}
              label="Reference / Receipt Number"
              placeholder="External ref no"
            />
          )}

          {/* Cash needs no extra fields */}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Supporting Document / Image (optional)</label>
            {proofFile ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2 text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate text-foreground">{proofFile.name}</span>
                <span className="text-muted-foreground">{(proofFile.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={() => setProofFile(null)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Remove"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-card px-3 py-3 text-xs text-muted-foreground hover:bg-muted/30 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                <span>Click to attach receipt photo, cheque scan, or PDF</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) {
                      toast({ title: "File too large", description: "Max 10 MB.", variant: "destructive" });
                      return;
                    }
                    setProofFile(f);
                  }}
                />
              </label>
            )}
          </div>

          <TextAreaField
            value={remarks}
            onValueChange={setRemarks}
            label="Remarks (optional)"
            placeholder="Internal note for finance / counsellor"
          />

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
