import { useState } from "react";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, CheckCircle2, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Shared row shape from the consultant_payout_sheet view (select "*").
export type PayoutSheetRow = {
  payout_id: string;
  consultant_id: string;
  consultant_name: string;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  bank_upi: string | null;
  candidate_name: string;
  admission_no: string | null;
  course_name: string | null;
  student_fee_paid: number;
  payout_amount: number;
  fee_paid_pct: number;
  status: string;
  payment_mode: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  payment_proof_path: string | null;
  paid_at: string | null;
  zoho_bill_id?: string | null;
  zoho_bill_number?: string | null;
  zoho_synced_at?: string | null;
  zoho_sync_error?: string | null;
};

export const CAN_MANAGE_PAYOUT_ROLES = ["super_admin", "campus_admin", "admission_head"];
export const PAYMENT_MODES = ["bank_transfer", "upi", "cheque", "cash", "other"];
export const modeLabel: Record<string, string> = { bank_transfer: "Bank Transfer", upi: "UPI", cheque: "Cheque", cash: "Cash", other: "Other" };
export const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "proof";

// ---- Per-payout PDF slip ----------------------------------------------------
function buildSlipDoc(r: PayoutSheetRow): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  let y = 56;
  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(label, M, y);
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(value || "—", M + 150, y);
    y += 20;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20);
  doc.text("NIMT Educational Institutions", M, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  doc.text("Consultant Payout Slip", M, y); y += 10;
  doc.setDrawColor(200); doc.line(M, y, 547, y); y += 26;

  line("Consultant", r.consultant_name, true);
  line("Bank Account", r.bank_account_number ? `${r.bank_account_name || ""}  ${r.bank_account_number}` : "Not on file");
  line("IFSC / Bank", [r.bank_ifsc, r.bank_name].filter(Boolean).join(" / ") || "—");
  if (r.bank_upi) line("UPI", r.bank_upi);
  y += 6; doc.setDrawColor(230); doc.line(M, y - 12, 547, y - 12);
  line("Candidate", r.candidate_name, true);
  line("Admission No.", r.admission_no || "—");
  line("Course", r.course_name || "—");
  line("Fee Collected", `${inr(Number(r.student_fee_paid))}  (${Number(r.fee_paid_pct)}% of total)`);
  line("Payout Amount", inr(Number(r.payout_amount)), true);
  line("Status", r.status.toUpperCase());
  if (r.status === "paid") {
    line("Paid On", r.payment_date || (r.paid_at ? new Date(r.paid_at).toLocaleDateString("en-IN") : "—"));
    line("Payment Mode", r.payment_mode ? (modeLabel[r.payment_mode] || r.payment_mode) : "—");
    line("Reference", r.payment_reference || "—");
  }
  y += 34;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  doc.text("Prepared by: __________________", M, y);
  doc.text("Approved by: __________________", 320, y);
  doc.setFontSize(7.5); doc.setTextColor(150);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 800);
  return doc;
}

export function downloadPayoutSlip(r: PayoutSheetRow) {
  buildSlipDoc(r).save(`payout-slip-${safeFileName(r.candidate_name)}-${safeFileName(r.consultant_name)}.pdf`);
}

// Base64 of the slip PDF (for attaching to a Zoho bill).
function payoutSlipBase64(r: PayoutSheetRow): string {
  const uri = buildSlipDoc(r).output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}

// ---- Mark-paid dialog -------------------------------------------------------
export function MarkPaidDialog({ payout, onClose, onDone }: { payout: PayoutSheetRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  const submit = async () => {
    setSaving(true);
    let proofPath: string | null = null;
    if (proof) {
      const path = `payouts/${payout.payout_id}/${Date.now()}-${safeFileName(proof.name)}`;
      const { error: upErr } = await supabase.storage.from("consultant-documents").upload(path, proof, { contentType: proof.type || undefined, upsert: false });
      if (upErr) { toast({ title: "Proof upload failed", description: upErr.message, variant: "destructive" }); setSaving(false); return; }
      proofPath = path;
    }
    const { error } = await (supabase.rpc as any)("mark_consultant_payout_paid", {
      _payout_id: payout.payout_id, _payment_mode: mode, _payment_reference: reference.trim() || null,
      _payment_date: date || null, _proof_path: proofPath, _note: note.trim() || null,
    });
    if (error) { setSaving(false); toast({ title: "Couldn't mark paid", description: error.message, variant: "destructive" }); return; }
    // If this payout is already a Zoho bill, also record the payment in Zoho (best-effort).
    if (payout.zoho_bill_id) {
      const { error: zErr } = await supabase.functions.invoke("zoho-books-sync", { body: { payout_id: payout.payout_id, action: "record_payment" } });
      if (zErr) toast({ title: "Marked paid, but Zoho sync failed", description: "Record the payment in Zoho manually.", variant: "destructive" });
    }
    setSaving(false);
    toast({ title: "Payout marked paid" });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Mark payout paid</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
            <div className="font-medium text-foreground">{payout.candidate_name} → {payout.consultant_name}</div>
            <div className="text-muted-foreground">Payout {inr(Number(payout.payout_amount))}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} className={inputCls}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{modeLabel[m]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Reference / UTR / Cheque no.</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className={inputCls} placeholder="e.g. UTR 402931..." />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment proof (optional)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setProof(e.target.files?.[0] || null)}
              className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Mark paid
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Send-to-Zoho button (creates the Zoho vendor + bill, attaches the slip) --
export function ZohoSyncButton({ row, onDone }: { row: PayoutSheetRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("zoho-books-sync", {
      body: { payout_id: row.payout_id, action: "create_bill", pdf_base64: payoutSlipBase64(row) },
    });
    setBusy(false);
    const errMsg = error?.message || (data as { error?: string } | null)?.error;
    if (errMsg) { toast({ title: "Zoho sync failed", description: errMsg, variant: "destructive" }); return; }
    toast({ title: "Sent to Zoho Books" });
    onDone();
  };

  if (row.zoho_bill_id) {
    return (
      <Badge className="border-0 bg-primary/10 text-primary text-[10px] gap-1" title={row.zoho_synced_at ? `Synced ${new Date(row.zoho_synced_at).toLocaleString("en-IN")}` : ""}>
        <Building2 className="h-3 w-3" />Zoho {row.zoho_bill_number || "✓"}
      </Badge>
    );
  }
  return (
    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[10px]" disabled={busy} onClick={send} title={row.zoho_sync_error || "Create a bill in Zoho Books"}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}Send to Zoho
    </Button>
  );
}
