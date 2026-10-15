// Offline payment recorder — lets super-admin / campus_admin / accountant
// mark an application or token-fee payment as confirmed without going
// through the gateway. Inserts a `lead_payments` row with status='confirmed';
// the existing triggers then assign a receipt number, advance the lifecycle
// (PAN/AN issuance), and fire notify-event to send WA + finance@ email +
// receipt PDF.

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { combineIndiaDateTimeInput, getCurrentIndiaDateTimeInput } from "@/lib/indiaDateTime";
import { useCashReceiptGate } from "@/hooks/useCashReceiptGate";
import { buildReceiptExactReferenceFilter, buildReceiptReviewPath } from "@/lib/financeReceiptSearch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextField, SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { FeeHeadAllocationField, type FeeAllocation } from "./FeeHeadAllocationField";
import { Year1LumpSumInfoBanner } from "./Year1LumpSumBanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  allocationsCoverYear1Tuition,
  scaleYear1AllocationsForLumpSum,
  type Year1LumpSumOffer,
} from "@/lib/year1LumpSumWaiver";
import { IndianRupee, Upload, X as XIcon, FileText, AlertTriangle } from "lucide-react";

const PAY_TYPES: { value: string; label: string }[] = [
  { value: "application_fee",     label: "Application Fee" },
  { value: "pre_admission_token", label: "Token Fee (prior to admission)" },
  { value: "token_fee",           label: "Token Fee" },
  { value: "registration_fee",    label: "Registration Fee" },
  { value: "other",               label: "Other Charges" },
];

// A consultant credit note is a non-cash settlement of a student's fee; it is
// never an application-fee payment. Filing one as 'application_fee' mislabels
// the receipt and inflates the student's "Application fee paid" (Pranjal Singh,
// receipt N382), so the option is withheld in credit-note mode.
const CREDIT_NOTE_PAY_TYPES = PAY_TYPES.filter(p => p.value !== "application_fee");

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

type DuplicatePaymentDetails = {
  receipt_no?: string | null;
  candidate_name?: string | null;
  admission_no?: string | null;
  course_name?: string | null;
} | null;

type ConfirmedReferenceQuery = {
  select(columns: string): ConfirmedReferenceQuery;
  eq(column: string, value: string): ConfirmedReferenceQuery;
  or(filter: string): ConfirmedReferenceQuery;
  limit(count: number): ConfirmedReferenceQuery;
  maybeSingle(): Promise<{
    data: {
      id?: string;
      receipt_no?: string | null;
      amount?: number;
      person_name?: string | null;
      admission_no?: string | null;
      source?: string;
    } | null;
    error: { message?: string } | null;
  }>;
};

async function lookupDuplicatePayment(reference: string): Promise<DuplicatePaymentDetails> {
  try {
    const { data, error } = await (supabase.rpc as any)("lookup_confirmed_payment_reference", {
      _reference: reference,
    });
    if (error || !data) return null;
    return (Array.isArray(data) ? data[0] : data) || null;
  } catch {
    return null;
  }
}

function duplicatePaymentDescription(reference: string, details: DuplicatePaymentDetails): string {
  const fields = [
    details?.receipt_no && `Receipt: ${details.receipt_no}`,
    details?.candidate_name && `Candidate: ${details.candidate_name}`,
    details?.admission_no && `Admission No./PAN: ${details.admission_no}`,
    details?.course_name && `Course: ${details.course_name}`,
  ].filter(Boolean);

  return [
    `Reference ${reference} is already attached to a confirmed payment${fields.length ? ` (${fields.join(" · ")})` : ""}.`,
    "Ask a finance admin to review it before recording this payment again.",
  ].join(" ");
}

type ChargeHead = { id: string; fee_code_id: string; code: string; name: string; amount: number };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-admission / admitted-with-lead payer. Omit for a lead-less student. */
  leadId?: string;
  /**
   * Post-admission student with no admission lead (school pupils). When set and
   * leadId is absent, the receipt is booked against the student directly:
   * lead_payments.student_id, type is locked to a plain fee payment, and the
   * receipt PDF is generated from the student's own course→institution chain.
   */
  studentId?: string;
  applicationId?: string | null;
  defaultType?: string;
  /** Pre-fills the amount — the cashier desk passes the selected head's balance. */
  defaultAmount?: number | null;
  /**
   * Counter collection: the cashier already picked the heads and amounts by
   * ticking rows in the fee table, so the breakup arrives settled. When present
   * it is shown read-only and the total drives the amount — one receipt across
   * every ticked head instead of one receipt per head.
   */
  defaultAllocations?: FeeAllocation[] | null;
  /** Year-1 tuition lump-sum offer; cashiers can apply 5% when collecting remaining Year 1 in full. */
  year1LumpSum?: Year1LumpSumOffer | null;
  onRecorded?: () => void;
}

export function OfflinePaymentDialog({
  open, onOpenChange, leadId, studentId, applicationId, defaultType,
  defaultAmount, defaultAllocations, year1LumpSum, onRecorded,
}: Props) {
  const { profile, role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Lead-less student receipt: no lead, book against the student directly.
  const isStudent = !leadId && !!studentId;

  const [type,   setType]   = useState<string>(defaultType || (isStudent ? "other" : "application_fee"));
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
  const [checkingReference, setCheckingReference] = useState(false);
  const referenceCheckRequest = useRef(0);
  const [referenceCheckError, setReferenceCheckError] = useState<string | null>(null);
  const [duplicatePayment, setDuplicatePayment] = useState<{ reference: string; details: DuplicatePaymentDetails } | null>(null);
  const [receiptGenerationIssue, setReceiptGenerationIssue] = useState<{ paymentId: string; message: string } | null>(null);
  const [applyYear1LumpSum, setApplyYear1LumpSum] = useState(false);

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

  // A breakup handed down from the fee table. Locks the amount to its total so
  // the two can't drift apart between the table and the receipt.
  const seeded = !!(defaultAllocations && defaultAllocations.length > 0);
  const seededTotal = Math.round(
    (defaultAllocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;

  // Re-seed the amount whenever the dialog reopens for a different ledger row.
  useEffect(() => {
    if (!open) return;
    if (seeded) {
      setAllocations(defaultAllocations!);
      setAmount(String(seededTotal));
      return;
    }
    if (defaultAmount) setAmount(String(defaultAmount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAmount, seeded, seededTotal]);

  // Consultant credit-note (super_admin only) state.
  const isSuperAdmin = role === "super_admin";
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [consultantId, setConsultantId] = useState<string>("");
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const [creditNoteId, setCreditNoteId] = useState<string>("");
  const isCreditNote = mode === CREDIT_NOTE_MODE;
  const selectedNote = creditNotes.find(n => n.id === creditNoteId) || null;
  // For a lead the default type is 'application_fee'; a credit note must never
  // carry that label, so normalise it away as soon as the mode is credit-note.
  const feeTypeOptions = isCreditNote ? CREDIT_NOTE_PAY_TYPES : PAY_TYPES;

  useEffect(() => {
    if (isCreditNote && type === "application_fee") setType("other");
  }, [isCreditNote, type]);

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
  const { blocked: cashBlocked, reason: cashReason } = useCashReceiptGate(open, leadId, mode, studentId);

  useEffect(() => {
    if (!open) {
      referenceCheckRequest.current += 1;
      setCheckingReference(false);
    }
  }, [open]);

  // Owner decision: offline cash recording is cashier (accountant) + super_admin
  // only — no counsellors, no campus admins, no consultants. office_admin has
  // full accountant-level access (see has_role inheritance).
  const allowedRole = ["super_admin", "accountant", "office_admin"].includes(role || "");

  if (!allowedRole) return null;

  // Consultant credit notes are a lead concept — never offered for a lead-less
  // student receipt.
  const modeOptions = isSuperAdmin && !isStudent
    ? [...MODE_OPTIONS, { value: CREDIT_NOTE_MODE, label: "Consultant Credit Note (no cash)" }]
    : MODE_OPTIONS;

  const reset = () => {
    referenceCheckRequest.current += 1;
    const now = getCurrentIndiaDateTimeInput();
    setType(defaultType || (isStudent ? "other" : "application_fee"));
    setAmount(defaultAmount ? String(defaultAmount) : "");
    setChargeHeadId("");
    setDate(now.date);
    setTime(now.time);
    setMode("cash");
    setTxnRef("");
    setCheckingReference(false);
    setReferenceCheckError(null);
    setDuplicatePayment(null);
    setReceiptGenerationIssue(null);
    setBank("");
    setWallet("");
    setRemarks("");
    setProofFile(null);
    setConsultantId("");
    setCreditNoteId("");
    setCreditNotes([]);
    setAllocations([]);
    setApplyYear1LumpSum(false);
  };

  const verifyDuplicateReference = async (reference: string): Promise<"clear" | "duplicate" | "error"> => {
    const ref = reference.trim();
    if (!ref) return "clear";
    const request = ++referenceCheckRequest.current;
    setCheckingReference(true);
    setReferenceCheckError(null);
    try {
      const referenceFilter = buildReceiptExactReferenceFilter(ref);
      const result = await (supabase.from("v_all_payments" as never) as unknown as ConfirmedReferenceQuery)
        .select("id, receipt_no, amount, person_name, admission_no, source")
        .eq("status", "confirmed")
        .or(referenceFilter || "")
        .limit(1)
        .maybeSingle();
      if (request !== referenceCheckRequest.current) return "error";
      if (result.error) {
        setReferenceCheckError(result.error.message || "Please retry the reference check.");
        return "error";
      }
      const exact = result.data as {
        id?: string;
        receipt_no?: string | null;
        person_name?: string | null;
        admission_no?: string | null;
      } | null;
      if (exact?.id) {
        setDuplicatePayment({
          reference: ref,
          details: {
            receipt_no: exact.receipt_no,
            candidate_name: exact.person_name,
            admission_no: exact.admission_no,
          },
        });
        void lookupDuplicatePayment(ref).then((details) => {
          if (request === referenceCheckRequest.current && txnRef.trim() === ref) {
            setDuplicatePayment({ reference: ref, details: details || {
              receipt_no: exact.receipt_no,
              candidate_name: exact.person_name,
              admission_no: exact.admission_no,
            } });
          }
        });
        return "duplicate";
      }
      setDuplicatePayment(null);
      return "clear";
    } catch (caught) {
      if (request !== referenceCheckRequest.current) return "error";
      setReferenceCheckError(caught instanceof Error ? caught.message : "Please retry the reference check.");
      return "error";
    } finally {
      if (request === referenceCheckRequest.current) setCheckingReference(false);
    }
  };

  const breakupTotal = Math.round(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;
  const year1Covered = !!(year1LumpSum && allocationsCoverYear1Tuition(
    allocations.length ? allocations : defaultAllocations || [],
    year1LumpSum,
  ));
  const lumpSumCashTotal = year1Covered && applyYear1LumpSum && year1LumpSum
    ? Math.round(((allocations.length ? breakupTotal : Number(amount) || 0) - year1LumpSum.discount) * 100) / 100
    : null;
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
    if (type === "application_fee") {
      toast({ title: "Not allowed", description: "A consultant credit note cannot be filed as an Application Fee.", variant: "destructive" });
      return;
    }
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

  const generateStudentReceipt = async (paymentId: string) => {
    const { data, error } = await supabase.functions.invoke("generate-payment-receipt", {
      body: { payment_id: paymentId },
    });
    if (error) {
      const response = (error as { context?: unknown }).context;
      if (response instanceof Response) {
        const failure = await response.clone().json().catch(() => null) as { error?: string } | null;
        if (failure?.error) throw new Error(failure.error);
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    if (data?.ok !== true || !data?.receipt_url) {
      throw new Error("The receipt service did not return a receipt file.");
    }
  };

  const retryStudentReceipt = async () => {
    if (!receiptGenerationIssue || submitting) return;
    const paymentId = receiptGenerationIssue.paymentId;
    setSubmitting(true);
    try {
      await generateStudentReceipt(paymentId);
      setReceiptGenerationIssue(null);
      toast({ title: "Receipt generated", description: "The payment was already recorded." });
      reset();
      onOpenChange(false);
      onRecorded?.();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please retry receipt generation.";
      setReceiptGenerationIssue({ paymentId, message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (receiptGenerationIssue) return;
    const listAmt = parseFloat(amount);
    const applyingLump = year1Covered && applyYear1LumpSum && !!year1LumpSum;
    const amt = applyingLump && year1LumpSum
      ? Math.round((listAmt - year1LumpSum.discount) * 100) / 100
      : listAmt;
    const submitAllocations = applyingLump && year1LumpSum
      ? scaleYear1AllocationsForLumpSum(allocations, year1LumpSum)
      : allocations;
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (isCreditNote) { await submitCreditNote(amt); return; }
    const submitBreakup = Math.round(submitAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;
    const submitBreakupValid = submitAllocations.length === 0 ||
      (submitAllocations.every((a) => a.fee_code_id && a.amount > 0) && Math.abs(submitBreakup - amt) < 0.01);
    if (!submitBreakupValid) {
      toast({ title: "Breakup must equal the amount", description: `Breakup total ₹${submitBreakup.toLocaleString("en-IN")} vs amount ₹${amt.toLocaleString("en-IN")}. Each head also needs a positive amount.`, variant: "destructive" });
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

    // ── Duplicate guard ─────────────────────────────────────────────────────
    // The same rupee reaches us twice: the candidate pays on the gateway but
    // closes the UPI app before the redirect (so our row stays pending), then
    // sends a screenshot and a cashier keys it in by hand. When the reconcile
    // sweep later settles the gateway row, both rows mint a receipt number and
    // both credit the ledger. Catch it here, where a human can still tell the
    // difference.
    const ref = txnRef.trim();
    if (ref && await verifyDuplicateReference(ref) !== "clear") return;

    if (leadId) {
      const { data: pendingGw } = await (supabase.from("lead_payments") as any)
        .select("id, amount, gateway, created_at")
        .eq("lead_id", leadId)
        .eq("status", "pending")
        .eq("payment_mode", "gateway")
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      const sameAmount = (pendingGw || []).find((r: any) => Math.abs(Number(r.amount || 0) - amt) < 1);
      if (sameAmount) {
        const when = new Date(sameAmount.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
        const proceed = window.confirm(
          `This candidate already has a PENDING ${sameAmount.gateway || "gateway"} payment of ₹${Number(sameAmount.amount).toLocaleString("en-IN")} started on ${when}.\n\n` +
          `If that is the same payment, close this and use "Verify with EaseBuzz" on the Finance → Transaction History row instead — recording it here as well will issue two receipts for one payment.\n\n` +
          `Record it manually anyway?`,
        );
        if (!proceed) return;
      }
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
      const path = `payment-proofs/${leadId ?? studentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
      lead_id:         leadId ?? null,
      student_id:      isStudent ? studentId : null,
      type,
      amount:          amt,
      concession_amount: applyingLump && year1LumpSum ? year1LumpSum.discount : 0,
      waiver_reason:   applyingLump && year1LumpSum ? `Lump-sum Year 1 ${year1LumpSum.pct}%` : null,
      payment_mode:    mode,
      transaction_ref: txnRef.trim() || null,
      // Only UPI / bank transfers carry a bank RRN; a cheque number is not one.
      // Storing it lets the partial unique index block the gateway sweep from
      // receipting the same money a second time.
      bank_ref_num:    (mode === "upi" || mode === "bank_transfer") ? (txnRef.trim() || null) : null,
      payment_date:    combineIndiaDateTimeInput(date, time),
      status:          "confirmed",
      recorded_by:     profile?.id || null,
      gateway:         "offline",
      notes:           notes || null,
      proof_url:       proofUrl,
      fee_code_id:     selectedChargeHead?.fee_code_id || null,
      application_id:  !isStudent && type === "application_fee" ? applicationId || null : null,
      allocations:     submitAllocations.length ? submitAllocations : null,
    }).select("id").maybeSingle();
    if (error) {
      setSubmitting(false);
      if (error.code === "23505" && (
        error.message.includes("lead_payments_confirmed_gateway_ref_uidx") ||
        error.message.includes("lead_payments_confirmed_bank_ref_uidx") ||
        error.message.includes("confirmed_payment_reference_claims_pkey")
      )) {
        const details = await lookupDuplicatePayment(txnRef.trim());
        setDuplicatePayment({ reference: txnRef.trim(), details });
        return;
      }
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
      if (applyingLump && year1LumpSum) {
        await (supabase.rpc as any)("apply_year1_lump_sum_on_payment", {
          p_payment_id: paymentId,
          p_ledger_ids: year1LumpSum.feeIds,
        });
      }
      if (isStudent) {
        // No lead to notify (WhatsApp/email flow is lead-centric); mint the
        // receipt PDF + receipt_url straight from generate-payment-receipt.
        // Keep this dialog open with a retry path if that follow-up fails. The
        // payment row is already saved, so retry never inserts another payment.
        try {
          await generateStudentReceipt(paymentId);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Please retry receipt generation.";
          setReceiptGenerationIssue({ paymentId, message });
          setSubmitting(false);
          onRecorded?.();
          toast({
            title: "Payment recorded; receipt not generated",
            description: "The payment is saved. Retry receipt generation without recording it again.",
            variant: "destructive",
          });
          return;
        }
      } else {
        const event = type === "application_fee" ? "app_fee_paid" : "payment_received";
        supabase.functions.invoke("notify-event", {
          body: { event, lead_id: leadId, context: { payment_id: paymentId, application_id: applicationId || undefined } },
        }).catch(e => console.error("[OfflinePaymentDialog] notify-event failed:", e));
      }
    }

    setSubmitting(false);
    toast({
      title: "Payment recorded",
      description: `${PAY_TYPES.find(p => p.value === type)?.label} of ₹${amt.toLocaleString("en-IN")} marked as confirmed.`,
    });
    reset();
    onOpenChange(false);
    onRecorded?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v && checkingReference) return;
      if (!v) reset();
      onOpenChange(v);
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-primary" />
            Record Offline Payment
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-3 py-2">
          {duplicatePayment && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Payment reference already recorded</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>{duplicatePaymentDescription(duplicatePayment.reference, duplicatePayment.details)}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(buildReceiptReviewPath(duplicatePayment.reference));
                  }}
                >
                  Review existing receipt
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {referenceCheckError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not verify payment reference</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>{referenceCheckError}. No payment was recorded. Retry the check before continuing.</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={checkingReference || !txnRef.trim()}
                  onClick={() => void verifyDuplicateReference(txnRef)}
                >
                  {checkingReference ? "Checking reference…" : "Retry reference check"}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {receiptGenerationIssue && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Payment recorded; receipt not generated</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>{receiptGenerationIssue.message}. The payment is already saved; retry receipt generation without recording it again.</p>
                <Button type="button" variant="outline" disabled={submitting} onClick={() => void retryStudentReceipt()}>
                  {submitting ? "Generating receipt…" : "Retry receipt generation"}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {checkingReference && (
            <p role="status" className="text-xs text-muted-foreground">Checking for an existing confirmed payment…</p>
          )}
          {year1LumpSum?.eligible && <Year1LumpSumInfoBanner offer={year1LumpSum} />}
          {year1Covered && year1LumpSum && (
            <label className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={applyYear1LumpSum}
                onChange={(e) => setApplyYear1LumpSum(e.target.checked)}
              />
              <span>
                Apply {year1LumpSum.pct}% Year 1 tuition waiver (save ₹{year1LumpSum.discount.toLocaleString("en-IN")}).
                Collect ₹{year1LumpSum.amountDue.toLocaleString("en-IN")} for Year 1 tuition. Uniform is not discounted.
              </span>
            </label>
          )}
          {/* Type + amount row */}
          <div className="grid grid-cols-2 gap-3">
            {isStudent ? (
              // Lead-less student receipt: type is a plain fee payment (the
              // ticked ledger rows carry the real heads). App-fee/token types
              // are lead concepts and would fire lead-only triggers.
              <FieldShell label="Fee Type">
                <Input value="Fee Payment" readOnly />
              </FieldShell>
            ) : (
              <SelectField
                value={type}
                onValueChange={setType}
                options={feeTypeOptions.map(p => ({ value: p.value, label: p.label }))}
                label="Fee Type"
                allowEmpty={false}
              />
            )}
            <FieldShell label="Amount (₹)">
              <Input
                type="number" min="1" step="1" inputMode="numeric"
                value={lumpSumCashTotal != null ? String(lumpSumCashTotal) : amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
                readOnly={!!selectedChargeHead || seeded}
                title={
                  seeded ? "Total of the heads ticked in the fee table"
                    : selectedChargeHead ? "Amount is fixed by the fee head" : undefined
                }
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
            disabled={checkingReference}
            onValueChange={value => { setMode(value); setTxnRef(""); setReferenceCheckError(null); setDuplicatePayment(null); setBank(""); setWallet(""); }}
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
                onValueChange={(value) => { setTxnRef(value); setReferenceCheckError(null); setDuplicatePayment(null); }}
                disabled={checkingReference}
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
                onValueChange={(value) => { setTxnRef(value); setReferenceCheckError(null); setDuplicatePayment(null); }}
                disabled={checkingReference}
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
                onValueChange={(value) => { setTxnRef(value); setReferenceCheckError(null); setDuplicatePayment(null); }}
                disabled={checkingReference}
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
              onValueChange={(value) => { setTxnRef(value); setReferenceCheckError(null); setDuplicatePayment(null); }}
              disabled={checkingReference}
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

          {/* Counter collection: the heads came from the fee table, so show
              them rather than a second editor that could disagree with it. */}
          {seeded ? (
            <div className="min-w-0 space-y-1.5 rounded-xl border border-border/60 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Collecting against {allocations.length} head{allocations.length === 1 ? "" : "s"}
              </p>
              {allocations.map((a, i) => (
                <div key={a.fee_ledger_id || `${a.fee_code_id}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{a.label}</span>
                  <span className="shrink-0 font-medium text-foreground">
                    ₹{Number(a.amount).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border/60 pt-2 text-xs font-semibold text-foreground">
                <span>Total</span>
                <span>₹{seededTotal.toLocaleString("en-IN")}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                One receipt covering all of the above. Change the split by re-ticking rows in the fee table.
              </p>
            </div>
          ) : !isCreditNote && (
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting || checkingReference}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || cashBlocked || checkingReference || !!duplicatePayment || !!referenceCheckError || !!receiptGenerationIssue}>
            {submitting ? <ButtonOrb state="connecting" onFilled /> : null}
            {submitting ? "Recording…" : "Mark as Paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
