// Offline payment recorder — lets super-admin / campus_admin / accountant
// mark an application or token-fee payment as confirmed without going
// through the gateway. Inserts a `lead_payments` row with status='confirmed';
// the existing triggers then assign a receipt number, advance the lifecycle
// (PAN/AN issuance), and fire notify-event to send WA + finance@ email +
// receipt PDF.

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { combineIndiaDateTimeInput, getCurrentIndiaDateTimeInput } from "@/lib/indiaDateTime";
import { useCashReceiptGate } from "@/hooks/useCashReceiptGate";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextField, SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { FeeHeadAllocationField, type FeeAllocation } from "./FeeHeadAllocationField";
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

// super_admin-only: settle a student's fee against a consultant's credit note
// instead of cash. Records a confirmed receipt (fee clears) but is booked as a
// non-cash offset against "due to consultant" — excluded from cash totals.
const CREDIT_NOTE_MODE = "consultant_credit_note";

type CreditNoteRow = {
  id: string;
  credit_note_no: string;
  remaining: number;
  status: string;
};

const WALLET_OPTIONS = [
  "Paytm", "PhonePe", "GPay", "BHIM", "Bharath Pay", "SBI Pay", "Cred", "Other",
];

const BANK_OPTIONS = [
  "ICICI Bank", "HDFC Bank", "SBI", "Axis Bank", "Yes Bank", "Kotak Mahindra",
  "Punjab National Bank", "Bank of Baroda", "Canara Bank", "Union Bank",
  "IndusInd Bank", "IDFC First Bank", "Other",
];

type ChargeHead = { id: string; fee_code_id: string; code: string; name: string; amount: number };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  applicationId?: string | null;
  defaultType?: string;
  /** Pre-fills the amount — the cashier desk passes the selected head's balance. */
  defaultAmount?: number | null;
  onRecorded?: () => void;
}

export function OfflinePaymentDialog({
  open, onOpenChange, leadId, applicationId, defaultType,
  defaultAmount, onRecorded,
}: Props) {
  const { profile, role } = useAuth();
  const { toast } = useToast();

  const [type,   setType]   = useState<string>(defaultType || "application_fee");
  const [amount, setAmount] = useState<string>(defaultAmount ? String(defaultAmount) : "");
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

  // Ad-hoc charge heads a super_admin has enabled for this person. Only offered
  // pre-admission: an admitted student gets a real fee_ledger row via
  // AddChargeDialog, and the allocation breakup below routes money to it.
  const [chargeHeads, setChargeHeads] = useState<ChargeHead[]>([]);
  const [chargeHeadId, setChargeHeadId] = useState<string>("");
  const selectedChargeHead = chargeHeads.find(h => h.id === chargeHeadId) || null;

  useEffect(() => {
    if (!open || !leadId) return;
    (async () => {
      const { data: student } = await supabase.from("students").select("id").eq("lead_id", leadId).maybeSingle();
      if (student?.id) { setChargeHeads([]); return; }
      const { data: charges } = await (supabase.rpc as any)("available_fee_charges", { _student_id: null, _lead_id: leadId });
      setChargeHeads((charges || []) as ChargeHead[]);
    })();
  }, [open, leadId]);

  // Optional per-head breakup — split the receipt across specific fee heads so
  // it maps to the right fee_ledger rows (via provision_student_fees). For
  // pre-admission leads the breakup is held and mapped at admission.
  const [allocations, setAllocations] = useState<FeeAllocation[]>([]);

  // Re-seed the amount whenever the dialog reopens for a different ledger row.
  useEffect(() => {
    if (!open) return;
    if (defaultAmount) setAmount(String(defaultAmount));
  }, [open, defaultAmount]);

  // Consultant credit-note (super_admin only) state.
  const isSuperAdmin = role === "super_admin";
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [consultantId, setConsultantId] = useState<string>("");
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const [creditNoteId, setCreditNoteId] = useState<string>("");
  const isCreditNote = mode === CREDIT_NOTE_MODE;
  const selectedNote = creditNotes.find(n => n.id === creditNoteId) || null;

  // Load active consultants the first time the credit-note mode is opened.
  useEffect(() => {
    if (!open || !isCreditNote || !isSuperAdmin || consultants.length) return;
    (supabase.from("consultants").select("id, name").neq("stage", "inactive").order("name") as any)
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setConsultants(data || []));
  }, [open, isCreditNote, isSuperAdmin, consultants.length]);

  // Load the chosen consultant's open credit notes with remaining balance.
  useEffect(() => {
    if (!isCreditNote || !consultantId) { setCreditNotes([]); setCreditNoteId(""); return; }
    (supabase.from("consultant_credit_note_summary" as any)
      .select("id, credit_note_no, remaining, status")
      .eq("consultant_id", consultantId).eq("status", "open").gt("remaining", 0)
      .order("issue_date", { ascending: false }) as any)
      .then(({ data }: { data: CreditNoteRow[] | null }) => {
        setCreditNotes(data || []);
        setCreditNoteId("");
      });
  }, [isCreditNote, consultantId]);

  // Day-closer / 9AM–6PM cash window gate (super_admin is always exempt server-side).
  const { blocked: cashBlocked, reason: cashReason } = useCashReceiptGate(open, leadId, mode);

  // Owner decision: offline cash recording is cashier (accountant) + super_admin
  // only — no counsellors, no campus admins, no consultants.
  const allowedRole = ["super_admin", "accountant"].includes(role || "");

  if (!allowedRole) return null;

  const modeOptions = isSuperAdmin
    ? [...MODE_OPTIONS, { value: CREDIT_NOTE_MODE, label: "Consultant Credit Note (no cash)" }]
    : MODE_OPTIONS;

  const reset = () => {
    const now = getCurrentIndiaDateTimeInput();
    setType(defaultType || "application_fee");
    setAmount(defaultAmount ? String(defaultAmount) : "");
    setChargeHeadId("");
    setDate(now.date);
    setTime(now.time);
    setMode("cash");
    setTxnRef("");
    setBank("");
    setWallet("");
    setRemarks("");
    setProofFile(null);
    setConsultantId("");
    setCreditNoteId("");
    setCreditNotes([]);
    setAllocations([]);
  };

  const breakupTotal = Math.round(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;
  // A breakup, when present, must equal the amount so nothing is silently dropped.
  const breakupValid = (amt: number) =>
    allocations.length === 0 ||
    (allocations.every((a) => a.fee_code_id && a.amount > 0) && Math.abs(breakupTotal - amt) < 0.01);

  // super_admin: settle the fee against a consultant credit note (non-cash).
  // A SECURITY DEFINER RPC atomically records the confirmed lead_payments
  // receipt AND draws down the credit note, re-validating the balance so it
  // can't be overdrawn.
  const submitCreditNote = async (amt: number) => {
    if (!consultantId) { toast({ title: "Select a consultant", variant: "destructive" }); return; }
    if (!creditNoteId) { toast({ title: "Select a credit note", variant: "destructive" }); return; }
    if (selectedNote && amt > selectedNote.remaining) {
      toast({ title: "Amount exceeds credit note balance", description: `Remaining ₹${selectedNote.remaining.toLocaleString("en-IN")}.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await (supabase.rpc as any)("apply_consultant_credit_note_receipt", {
      _credit_note_id: creditNoteId,
      _lead_id: leadId,
      _amount: amt,
      _type: type,
      _application_id: type === "application_fee" ? applicationId || null : null,
      _payment_date: combineIndiaDateTimeInput(date, time),
      _notes: remarks.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not apply credit note", description: error.message, variant: "destructive" });
      return;
    }
    const paymentId = (data as { lead_payment_id?: string } | null)?.lead_payment_id;
    if (paymentId) {
      const event = type === "application_fee" ? "app_fee_paid" : "payment_received";
      supabase.functions.invoke("notify-event", {
        body: { event, lead_id: leadId, context: { payment_id: paymentId, application_id: applicationId || undefined } },
      }).catch(e => console.error("[OfflinePaymentDialog] notify-event failed:", e));
    }
    toast({
      title: "Credit note applied",
      description: `${PAY_TYPES.find(p => p.value === type)?.label} of ₹${amt.toLocaleString("en-IN")} settled against the consultant credit note (no cash received).`,
    });
    reset();
    onOpenChange(false);
    onRecorded?.();
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (isCreditNote) { await submitCreditNote(amt); return; }
    if (!breakupValid(amt)) {
      toast({ title: "Breakup must equal the amount", description: `Breakup total ₹${breakupTotal.toLocaleString("en-IN")} vs amount ₹${amt.toLocaleString("en-IN")}. Each head also needs a positive amount.`, variant: "destructive" });
      return;
    }
    if (cashBlocked) {
      toast({ title: "Cash receipt not allowed", description: cashReason || undefined, variant: "destructive" });
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
      fee_code_id:     selectedChargeHead?.fee_code_id || null,
      application_id:   type === "application_fee" ? applicationId || null : null,
      allocations:     allocations.length ? allocations : null,
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

        <div className="min-w-0 space-y-3 py-2">
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
                readOnly={!!selectedChargeHead}
                title={selectedChargeHead ? "Amount is fixed by the fee head" : undefined}
              />
            </FieldShell>
          </div>

          {/* Ad-hoc charge heads (pre-admission only). The amount is fixed by
              the super_admin who enabled the head — the cashier can't edit it. */}
          {chargeHeads.length > 0 && (
            <SelectField
              value={chargeHeadId}
              onValueChange={(v) => {
                setChargeHeadId(v);
                const head = chargeHeads.find(h => h.id === v);
                if (head) { setAmount(String(head.amount)); setType("other"); }
              }}
              options={[
                { value: "", label: "No specific head" },
                ...chargeHeads.map(h => ({ value: h.id, label: `${h.name} — ₹${Number(h.amount).toLocaleString("en-IN")}` })),
              ]}
              label="Fee Head"
              allowEmpty={false}
            />
          )}

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
            options={modeOptions.map(m => ({ value: m.value, label: m.label }))}
            label="Payment Mode"
            allowEmpty={false}
          />

          {cashBlocked && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {cashReason}
            </p>
          )}

          {/* Consultant credit note (super_admin, non-cash offset) */}
          {isCreditNote && (
            <div className="space-y-3 rounded-lg border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 p-3">
              <SelectField
                value={consultantId}
                onValueChange={setConsultantId}
                options={[{ value: "", label: "Select consultant" }, ...consultants.map(c => ({ value: c.id, label: c.name }))]}
                label="Consultant"
                placeholder="Select consultant"
              />
              <SelectField
                value={creditNoteId}
                onValueChange={setCreditNoteId}
                options={[
                  { value: "", label: consultantId ? (creditNotes.length ? "Select credit note" : "No open credit notes") : "Select consultant first" },
                  ...creditNotes.map(n => ({ value: n.id, label: `${n.credit_note_no} · ₹${n.remaining.toLocaleString("en-IN")} left` })),
                ]}
                label="Credit Note"
                placeholder="Select credit note"
              />
              {selectedNote && (
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  Remaining balance ₹{selectedNote.remaining.toLocaleString("en-IN")}. This receipt is booked against the consultant's credit note — no cash is received and it is excluded from cash collections.
                </p>
              )}
            </div>
          )}

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

          {!isCreditNote && (
            <FeeHeadAllocationField
              open={open}
              leadId={leadId}
              value={allocations}
              onChange={setAllocations}
            />
          )}

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
          <Button onClick={handleSubmit} disabled={submitting || cashBlocked}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {submitting ? "Recording…" : "Mark as Paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
