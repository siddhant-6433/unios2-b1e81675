import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Printer, AlertTriangle, Download, CheckCircle2, RotateCcw } from "lucide-react";

type PayoutRow = {
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
};

type Filter = "payable" | "paid" | "all";
const FILTERS: { key: Filter; label: string; statuses: string[] | null }[] = [
  { key: "payable", label: "Payable", statuses: ["pending", "approved"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "all", label: "All", statuses: null },
];
const PAYMENT_MODES = ["bank_transfer", "upi", "cheque", "cash", "other"];
const modeLabel: Record<string, string> = { bank_transfer: "Bank Transfer", upi: "UPI", cheque: "Cheque", cash: "Cash", other: "Other" };

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string | null | undefined) =>
  String(s ?? "—").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "proof";
const CAN_MANAGE_ROLES = ["super_admin", "campus_admin", "admission_head"];

// ---- Per-payout PDF slip (true download) ------------------------------------
function downloadSlip(r: PayoutRow) {
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

  doc.save(`payout-slip-${safeFileName(r.candidate_name)}-${safeFileName(r.consultant_name)}.pdf`);
}

// ---- Mark-paid dialog -------------------------------------------------------
function MarkPaidDialog({ payout, onClose, onDone }: { payout: PayoutRow; onClose: () => void; onDone: () => void }) {
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
    setSaving(false);
    if (error) { toast({ title: "Couldn't mark paid", description: error.message, variant: "destructive" }); return; }
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

export const ConsultantPayoutsTab = () => {
  const { toast } = useToast();
  const { role } = useAuth();
  const canManage = CAN_MANAGE_ROLES.includes(role || "");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("payable");
  const [markPaid, setMarkPaid] = useState<PayoutRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const statuses = FILTERS.find(f => f.key === filter)!.statuses;
    let q = (supabase.from("consultant_payout_sheet" as any) as any).select("*").order("consultant_name", { ascending: true });
    if (statuses) q = q.in("status", statuses); else q = q.neq("status", "cancelled");
    const { data } = await q;
    setRows((data || []) as PayoutRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const groups = useMemo(() => {
    const map = new Map<string, PayoutRow[]>();
    for (const r of rows) map.set(r.consultant_id, [...(map.get(r.consultant_id) || []), r]);
    return [...map.values()];
  }, [rows]);

  const grandTotal = rows.reduce((t, r) => t + Number(r.payout_amount), 0);

  const unmark = async (r: PayoutRow) => {
    setBusyId(r.payout_id);
    const { error } = await (supabase.rpc as any)("unmark_consultant_payout_paid", { _payout_id: r.payout_id });
    setBusyId(null);
    if (error) { toast({ title: "Couldn't revert", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Reverted to pending" });
    load();
  };

  const printSheet = () => {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const sections = groups.map(g => {
      const c = g[0];
      const subtotal = g.reduce((t, r) => t + Number(r.payout_amount), 0);
      const bank = c.bank_account_number
        ? `A/C Name: <b>${esc(c.bank_account_name)}</b> &nbsp; A/C No: <b>${esc(c.bank_account_number)}</b> &nbsp; IFSC: <b>${esc(c.bank_ifsc)}</b> &nbsp; Bank: <b>${esc(c.bank_name)}</b>${c.bank_upi ? ` &nbsp; UPI: <b>${esc(c.bank_upi)}</b>` : ""}`
        : `<span class="warn">⚠ No bank details on file — add them in the consultant's onboarding before paying.</span>`;
      const trs = g.map(r => `
        <tr>
          <td>${esc(r.candidate_name)}</td>
          <td>${esc(r.admission_no)}</td>
          <td>${esc(r.course_name)}</td>
          <td class="num">${inr(Number(r.student_fee_paid))} (${Number(r.fee_paid_pct)}%)</td>
          <td class="num">${inr(Number(r.payout_amount))}</td>
          <td>${esc(r.status)}</td>
        </tr>`).join("");
      return `
        <div class="consultant">
          <h2>${esc(c.consultant_name)}</h2>
          <p class="bank">${bank}</p>
          <table>
            <thead><tr><th>Candidate</th><th>Admission No.</th><th>Course</th><th class="num">Fee Paid</th><th class="num">Payout</th><th>Status</th></tr></thead>
            <tbody>${trs}</tbody>
            <tfoot><tr><td colspan="4">Subtotal — ${esc(c.consultant_name)}</td><td class="num">${inr(subtotal)}</td><td></td></tr></tfoot>
          </table>
        </div>`;
    }).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Consultant Payout Sheet</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 32px; font-size: 12px; }
        header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
        header h1 { font-size: 18px; margin: 0; }
        header .meta { font-size: 11px; color: #555; }
        .consultant { margin-bottom: 22px; page-break-inside: avoid; }
        .consultant h2 { font-size: 14px; margin: 0 0 2px; }
        .bank { font-size: 10.5px; color: #333; margin: 0 0 8px; }
        .warn { color: #b45309; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
        th { background: #f3f4f6; font-size: 10.5px; text-transform: uppercase; letter-spacing: .02em; }
        .num { text-align: right; white-space: nowrap; }
        tfoot td { font-weight: 700; background: #fafafa; }
        .grand { margin-top: 8px; text-align: right; font-size: 14px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; }
        .sign { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; color: #555; }
        @media print { body { margin: 12mm; } }
      </style></head><body>
      <header>
        <h1>Consultant Payout Sheet</h1>
        <div class="meta">Generated ${today} &nbsp;·&nbsp; ${groups.length} consultant(s) &nbsp;·&nbsp; ${rows.length} payout(s)</div>
      </header>
      ${sections || '<p>No payouts.</p>'}
      <div class="grand">Grand Total: ${inr(grandTotal)}</div>
      <div class="sign"><span>Prepared by: ____________________</span><span>Approved by: ____________________</span><span>Accountant: ____________________</span></div>
      <script>window.onload = function(){ window.print(); }</script>
      </body></html>`;

    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl border border-input bg-card p-0.5">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{rows.length} payout(s) · {inr(grandTotal)}</p>
        </div>
        <Button onClick={printSheet} disabled={rows.length === 0} className="gap-2"><Printer className="h-4 w-4" />Print Sheet</Button>
      </div>

      {groups.map(g => {
        const c = g[0];
        const subtotal = g.reduce((t, r) => t + Number(r.payout_amount), 0);
        const missingBank = !c.bank_account_number;
        return (
          <Card key={c.consultant_id} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{c.consultant_name}</h3>
                  {missingBank && (
                    <Badge className="gap-1 border-0 bg-warning/15 text-warning text-[10px]">
                      <AlertTriangle className="h-3 w-3" />No bank details
                    </Badge>
                  )}
                </div>
                <span className="text-sm font-medium tabular-nums">{inr(subtotal)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40">
                      <th className="py-1.5 pr-3 font-medium">Candidate</th>
                      <th className="py-1.5 pr-3 font-medium">Admission No.</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Fee Paid</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Payout</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.map(r => (
                      <tr key={r.payout_id} className="border-b border-border/20 last:border-0 align-top">
                        <td className="py-2 pr-3 text-foreground">{r.candidate_name}<div className="text-[10px] text-muted-foreground">{r.course_name || ""}</div></td>
                        <td className="py-2 pr-3 text-muted-foreground">{r.admission_no || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{inr(Number(r.student_fee_paid))} <span className="text-muted-foreground">({Number(r.fee_paid_pct)}%)</span></td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{inr(Number(r.payout_amount))}</td>
                        <td className="py-2 pr-3">
                          {r.status === "paid" ? (
                            <div>
                              <Badge className="border-0 bg-success/15 text-success text-[10px]">Paid</Badge>
                              <div className="mt-0.5 text-[10px] text-muted-foreground">
                                {r.payment_date || (r.paid_at ? new Date(r.paid_at).toLocaleDateString("en-IN") : "")}
                                {r.payment_mode ? ` · ${modeLabel[r.payment_mode] || r.payment_mode}` : ""}
                                {r.payment_reference ? ` · ${r.payment_reference}` : ""}
                              </div>
                            </div>
                          ) : (
                            <Badge className="border-0 bg-warning/15 text-warning text-[10px]">{r.status}</Badge>
                          )}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[10px]" onClick={() => downloadSlip(r)}>
                            <Download className="h-3.5 w-3.5" />Slip
                          </Button>
                          {canManage && r.status !== "paid" && (
                            <Button size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setMarkPaid(r)}>
                              <CheckCircle2 className="h-3.5 w-3.5" />Mark paid
                            </Button>
                          )}
                          {canManage && r.status === "paid" && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[10px] text-muted-foreground" disabled={busyId === r.payout_id} onClick={() => unmark(r)}>
                              {busyId === r.payout_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Revert
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {groups.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">No payouts in this view.</div>
      )}

      {markPaid && <MarkPaidDialog payout={markPaid} onClose={() => setMarkPaid(null)} onDone={() => { setMarkPaid(null); load(); }} />}
    </div>
  );
};
