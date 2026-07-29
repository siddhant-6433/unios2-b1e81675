import { PageLoader } from "@/components/ui/page-loader";
import { useEffect, useMemo, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Receipt, ChevronDown, ChevronRight, FileImage, IndianRupee, Plus, Pencil, History, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OfflinePaymentDialog } from "./OfflinePaymentDialog";
import { PaymentEditDialog } from "./PaymentEditDialog";
import { PaymentAuditDialog } from "./PaymentAuditDialog";

const PAY_TYPE_LABELS: Record<string, string> = {
  application_fee: "Application Fee",
  token_fee: "Token Fee",
  pre_admission_token: "Token Fee (pre-admission)",
  registration_fee: "Registration Fee",
  other: "Other",
};
const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer / NEFT",
  cheque: "Cheque / DD", online: "Online", gateway: "Gateway",
};

interface LeadPayment {
  id: string;
  receipt_no: string | null;
  type: string;
  amount: number;
  concession_amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  status: string;
  payment_date: string | null;
  created_at: string;
  receipt_url: string | null;
  proof_url: string | null;
  waiver_reason: string | null;
}

interface LedgerRow {
  id: string;
  fee_code_id: string;
  term: string;
  total_amount: number;
  concession: number;
  paid_amount: number;
  balance: number;
  due_date: string;
  status: string;
  fee_codes: { name: string; code: string } | null;
}

interface LedgerLink {
  id: string;
  fee_ledger_id: string;
  lead_payment_id: string | null;
  amount: number;
  concession_amount: number;
  applied_at: string;
  notes: string | null;
}

interface PreviewRow {
  fee_code_id: string;
  fee_code_code: string;
  fee_code_name: string;
  term: string;
  total_amount: number;
  due_date: string;
}

interface Props {
  /** Either leadId OR studentId — both work, leadId is preferred from CRM views */
  leadId?: string;
  studentId?: string;
  refreshKey?: number;
  /** Fired when the empty/non-empty state settles so the parent can host the
      "Record Offline Payment" trigger elsewhere (e.g. the quick-action bar)
      when there's no ledger to show. */
  onEmptyChange?: (empty: boolean) => void;
}

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function LeadFeeLedger({ leadId, studentId, refreshKey, onEmptyChange }: Props) {
  const { role } = useAuth();
  const [resolvedLeadId, setResolvedLeadId] = useState<string | null>(leadId ?? null);
  const [resolvedStudentId, setResolvedStudentId] = useState<string | null>(studentId ?? null);
  const [payments, setPayments] = useState<LeadPayment[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [links, setLinks] = useState<LedgerLink[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [internalRefresh, setInternalRefresh] = useState(0);
  const [editPayment, setEditPayment] = useState<LeadPayment | null>(null);
  const [auditPayment, setAuditPayment] = useState<LeadPayment | null>(null);
  const [credit, setCredit] = useState<{ application_fee_paid: number; general_credit: number } | null>(null);
  const canRecordOffline = ["super_admin", "campus_admin", "accountant"].includes(role || "");
  const isSuperAdmin = role === "super_admin";
  const { toast } = useToast();
  const [resending, setResending] = useState<string | null>(null);

  const resendReceipt = async (payment: LeadPayment) => {
    setResending(payment.id);
    const { error } = await (supabase as any).rpc("resend_payment_notification", {
      _payment_id: payment.id,
      _mode: "resend",
    });
    setResending(null);
    if (error) {
      toast({ title: "Could not resend receipt", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Receipt re-sent",
      description: "Candidate WhatsApp + finance/super-admin email queued.",
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // Resolve the missing side of (lead, student).
      let lid = leadId ?? null;
      let sid = studentId ?? null;
      if (lid && !sid) {
        const { data } = await supabase.from("students").select("id").eq("lead_id", lid).maybeSingle();
        sid = data?.id ?? null;
      } else if (sid && !lid) {
        const { data } = await supabase.from("students").select("lead_id").eq("id", sid).maybeSingle();
        lid = data?.lead_id ?? null;
      }
      if (!alive) return;
      setResolvedLeadId(lid);
      setResolvedStudentId(sid);

      const queries: any[] = [];
      if (lid) {
        queries.push(supabase.from("lead_payments")
          .select("id, receipt_no, type, amount, concession_amount, payment_mode, transaction_ref, status, payment_date, created_at, receipt_url, proof_url, waiver_reason")
          .eq("lead_id", lid).order("created_at", { ascending: false }));
      }
      if (sid) {
        queries.push(supabase.from("fee_ledger")
          .select("id, fee_code_id, term, total_amount, concession, paid_amount, balance, due_date, status, fee_codes:fee_code_id(name, code)")
          .eq("student_id", sid).order("term").order("due_date"));
      }
      const results = await Promise.all(queries);
      const lpRes = lid ? results[0] : { data: [] };
      const fcRes = sid ? results[lid ? 1 : 0] : { data: [] };

      const lpData = (lpRes.data ?? []) as LeadPayment[];
      const fcData = (fcRes.data ?? []) as LedgerRow[];
      setPayments(lpData);
      setLedger(fcData);

      // Pull link rows once we know the ledger ids.
      if (fcData.length > 0) {
        const ledgerIds = fcData.map(r => r.id);
        const { data: lk } = await supabase.from("fee_ledger_payments")
          .select("id, fee_ledger_id, lead_payment_id, amount, concession_amount, applied_at, notes")
          .in("fee_ledger_id", ledgerIds);
        if (alive) setLinks((lk ?? []) as LedgerLink[]);
      } else {
        setLinks([]);
      }

      // Pre-PAN preview: when there's no real ledger yet, project the
      // fee_structure so finance can validate the breakdown before the
      // candidate crosses the token threshold.
      if (fcData.length === 0 && lid) {
        const { data: prev } = await (supabase as any).rpc("lead_fee_preview", { _lead_id: lid });
        if (alive) setPreview((prev ?? []) as PreviewRow[]);
      } else {
        setPreview([]);
      }

      // Credit balance is informational here — it accrues pre-admission and
      // carries forward once a real student ledger exists.
      const creditTargetId = sid || lid;
      if (creditTargetId) {
        const { data: cred } = await (supabase.rpc as any)("student_fee_credit_balance", { _id: creditTargetId });
        if (alive) setCredit(cred || null);
      } else {
        setCredit(null);
      }

      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [leadId, studentId, refreshKey, internalRefresh]);

  const totals = useMemo(() => {
    const ledgerTotal      = ledger.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const ledgerPaid       = ledger.reduce((s, r) => s + Number(r.paid_amount  || 0), 0);
    const ledgerConcession = ledger.reduce((s, r) => s + Number(r.concession   || 0), 0);
    const ledgerBalance    = ledger.reduce((s, r) => s + Number(r.balance      || 0), 0);
    const preAdmissionPaid = payments
      .filter(p => p.status === "confirmed")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    return { ledgerTotal, ledgerPaid, ledgerConcession, ledgerBalance, preAdmissionPaid };
  }, [ledger, payments]);

  // Distribute confirmed pre-admission payments across the preview rows
  // the same way provision_student_fees would at PAN issuance: application
  // fee -> form fee row, or seat-block row when the structure has no form
  // fee; token / other -> year_N rows oldest-first.
  const previewWithPaid = useMemo(() => {
    if (preview.length === 0) return [];
    const rows = preview.map(p => ({ ...p, paid_amount: 0, paid_payment_ids: [] as string[] }));
    const confirmed = payments.filter(p => p.status === "confirmed");
    const appPayments   = confirmed.filter(p => p.type === "application_fee");
    const tokenPayments = confirmed.filter(p => p.type === "token_fee" || p.type === "pre_admission_token" || p.type === "other" || p.type === "registration_fee");

    const applicationCreditRow =
      rows.find(r => /FORM|APPLICATION/i.test(r.fee_code_code)) ||
      rows.find(r => r.term === "year_1" && /SEAT|BLOCK/i.test(`${r.fee_code_code} ${r.fee_code_name}`));
    if (applicationCreditRow) {
      let cap = applicationCreditRow.total_amount;
      for (const p of appPayments) {
        if (cap <= 0) break;
        const take = Math.min(cap, Number(p.amount || 0));
        if (take > 0) {
          applicationCreditRow.paid_amount += take;
          applicationCreditRow.paid_payment_ids.push(p.id);
          cap -= take;
        }
      }
    }

    const tokenQueue = [...tokenPayments];
    for (const r of rows) {
      if (!/^year_\d+$/.test(r.term)) continue;
      let remainingForRow = r.total_amount - r.paid_amount;
      while (remainingForRow > 0 && tokenQueue.length > 0) {
        const p = tokenQueue[0];
        const avail = Number(p.amount || 0) - ((p as any)._consumed || 0);
        if (avail <= 0) { tokenQueue.shift(); continue; }
        const take = Math.min(remainingForRow, avail);
        r.paid_amount += take;
        if (!r.paid_payment_ids.includes(p.id)) r.paid_payment_ids.push(p.id);
        (p as any)._consumed = ((p as any)._consumed || 0) + take;
        remainingForRow -= take;
        if (((p as any)._consumed || 0) >= Number(p.amount || 0)) tokenQueue.shift();
      }
    }
    return rows;
  }, [preview, payments]);

  const isEmpty = !loading && payments.length === 0 && ledger.length === 0 && preview.length === 0;
  useEffect(() => { onEmptyChange?.(isEmpty); }, [isEmpty, onEmptyChange]);

  if (loading) return <PageLoader />;
  // No fee activity → hide the ledger entirely. The parent (LeadDetail) is
  // notified via onEmptyChange and hosts the "Record Offline Payment" trigger
  // up in the quick-action bar, so nothing renders here.
  if (isEmpty) return null;

  return (
    <Card className="border-border/60">
    <CardContent className="p-4 space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Ledger</h3>
      {/* Header bar with offline-payment trigger (super_admin / campus_admin / accountant) */}
      {canRecordOffline && resolvedLeadId && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Fee ledger &amp; receipts for this candidate.</p>
          <Button size="sm" variant="outline" onClick={() => setOfflineOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Record Offline Payment
          </Button>
          <OfflinePaymentDialog
            open={offlineOpen}
            onOpenChange={setOfflineOpen}
            leadId={resolvedLeadId}
            onRecorded={() => setInternalRefresh(n => n + 1)}
          />
        </div>
      )}

      {/* Top summary */}
      {ledger.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Total Course Fee" value={fmt(totals.ledgerTotal)} />
          <Stat label="Concession" value={fmt(totals.ledgerConcession)} tone="amber" />
          <Stat label="Paid" value={fmt(totals.ledgerPaid)} tone="emerald" />
          <Stat label="Outstanding" value={fmt(totals.ledgerBalance)} tone={totals.ledgerBalance > 0 ? "red" : "emerald"} />
        </div>
      )}

      {/* Credit balance — informational, read-only pre-admission (or post-
          admission before a Transfer/Apply UI is warranted here). */}
      {credit && Number(credit.general_credit || 0) > 0 && (
        <div className="rounded-xl border border-border bg-card px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Credit (unallocated):</span>
          <span className="font-semibold text-foreground">{fmt(credit.general_credit)}</span>
          {Number(credit.application_fee_paid || 0) > 0 && (
            <span className="text-muted-foreground">
              Application fee paid: <span className="font-medium text-foreground">{fmt(credit.application_fee_paid)}</span>
            </span>
          )}
        </div>
      )}

      {/* Pre-admission payments (lead_payments) */}
      {payments.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
            <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Receipts</span>
            <span className="text-[10px] text-muted-foreground">{payments.length} payment{payments.length === 1 ? "" : "s"}</span>
          </div>
          {/* Horizontal scroll wrapper — the receipts table has 8 columns and
              gets clipped in narrow containers (e.g. inside the LeadDetail
              application drawer). Letting it scroll keeps all columns reachable. */}
          <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="bg-muted/20 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Receipt</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-right px-3 py-2 font-medium">Concession</th>
                <th className="text-left px-3 py-2 font-medium">Mode / Ref</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">PDF</th>
                {isSuperAdmin && <th className="text-right px-3 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-foreground">{p.receipt_no || "—"}</td>
                  <td className="px-3 py-2 text-foreground">
                    {PAY_TYPE_LABELS[p.type] || p.type}
                    {p.type === "pre_admission_token" && preview.length > 0 && (
                      <p className="text-[10px] text-success dark:text-success">Adjusted against admission fee</p>
                    )}
                    {p.waiver_reason && (
                      <p className="text-[10px] text-muted-foreground/70">{p.waiver_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">{fmt(p.amount)}</td>
                  <td className="px-3 py-2 text-right text-warning-foreground">{p.concession_amount > 0 ? fmt(p.concession_amount) : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span>{MODE_LABELS[p.payment_mode] || p.payment_mode}</span>
                    {p.transaction_ref && <span className="ml-1 font-mono text-[10px]">· {p.transaction_ref}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.payment_date || p.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      p.status === "confirmed" ? "bg-success/10 text-success dark:bg-success/80/30 dark:text-success"
                      : p.status === "pending" ? "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
                      : "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80"
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.receipt_url && (
                      <a href={p.receipt_url} target="_blank" rel="noopener" className="text-primary hover:underline text-[11px]">PDF</a>
                    )}
                    {p.receipt_url && p.proof_url && <span className="mx-1 text-muted-foreground/40">·</span>}
                    {p.proof_url && (
                      <a href={p.proof_url} target="_blank" rel="noopener" className="text-primary hover:underline text-[11px]">Proof</a>
                    )}
                    {!p.receipt_url && !p.proof_url && <span className="text-muted-foreground/40">—</span>}
                  </td>
                  {isSuperAdmin && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => resendReceipt(p)}
                        disabled={resending === p.id}
                        className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                        title="Resend WhatsApp + email receipt"
                      >
                        {resending === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPayment(p)}
                        className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        title="Edit / delete receipt (audited)"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditPayment(p)}
                        className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        title="View audit history"
                      >
                        <History className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Preview ledger (pre-PAN): projected from fee_structure_items */}
      {ledger.length === 0 && previewWithPaid.length > 0 && (() => {
        const grandTotal = previewWithPaid.reduce((s, r) => s + Number(r.total_amount || 0), 0);
        const grandPaid  = previewWithPaid.reduce((s, r) => s + Number(r.paid_amount  || 0), 0);
        const grandDue   = grandTotal - grandPaid;
        const itemCount  = previewWithPaid.length;

        return (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewExpanded(v => !v)}
              className="w-full px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
            >
              {previewExpanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
              <IndianRupee className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold text-foreground">Fee Ledger</span>
              <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-medium bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning">PREVIEW</span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">Locks in once pre-admitted</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                <span>{itemCount} items</span>
                <span>· {fmt(grandTotal)}</span>
                {grandPaid > 0 && <span className="text-success font-semibold">· {fmt(grandPaid)} paid</span>}
                <span className={grandDue > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>
                  · {fmt(grandDue)} {grandDue > 0 ? "due" : "settled"}
                </span>
              </span>
            </button>

            {previewExpanded && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="bg-muted/20 text-muted-foreground">
                      <th className="text-center px-3 py-2 font-medium">Fee</th>
                      <th className="text-center px-3 py-2 font-medium">Term</th>
                      <th className="text-center px-3 py-2 font-medium">Total</th>
                      <th className="text-center px-3 py-2 font-medium">Credits / Receipts</th>
                      <th className="text-center px-3 py-2 font-medium">Due</th>
                      <th className="text-center px-3 py-2 font-medium">Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewWithPaid.map(r => {
                      const paidPayments = (r.paid_payment_ids || [])
                        .map(pid => payments.find(p => p.id === pid))
                        .filter((p): p is NonNullable<typeof p> => !!p);
                      const firstPayment = paidPayments[0];
                      const due = r.total_amount - r.paid_amount;
                      return (
                        <tr key={r.fee_code_id + r.term} className="border-t border-border">
                          <td className="px-3 py-2 text-center text-foreground">
                            {r.fee_code_name}
                            <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">{r.fee_code_code}</span>
                          </td>
                          <td className="px-3 py-2 text-center text-muted-foreground capitalize">{r.term.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-center text-foreground tabular-nums">{fmt(r.total_amount)}</td>
                          <td className="px-3 py-2 text-center">
                            {r.paid_amount > 0 ? (
                              <span className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                                <span className="text-success font-semibold tabular-nums">{fmt(r.paid_amount)}</span>
                                {firstPayment && (
                                  <>
                                    <span className="text-muted-foreground/60">·</span>
                                    <span className="font-mono text-[10px] text-foreground">{firstPayment.receipt_no || "—"}</span>
                                    {firstPayment.receipt_url && (
                                      <a
                                        href={firstPayment.receipt_url}
                                        target="_blank"
                                        rel="noopener"
                                        className="text-success hover:underline text-[11px] font-medium"
                                      >
                                        PDF
                                      </a>
                                    )}
                                    {paidPayments.length > 1 && (
                                      <span className="text-[10px] text-muted-foreground">+{paidPayments.length - 1}</span>
                                    )}
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            <span className={due > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>
                              {fmt(due)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-muted-foreground whitespace-nowrap">{fmtDate(r.due_date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Ledger (flat, term shown per-row) */}
      {ledger.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
            <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Fee Ledger</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="bg-muted/20 text-muted-foreground">
                  <th className="text-center px-3 py-2 font-medium">Fee</th>
                  <th className="text-center px-3 py-2 font-medium">Term</th>
                  <th className="text-center px-3 py-2 font-medium">Total</th>
                  <th className="text-center px-3 py-2 font-medium">Concession</th>
                  <th className="text-center px-3 py-2 font-medium">Credits / Receipts</th>
                  <th className="text-center px-3 py-2 font-medium">Due</th>
                  <th className="text-center px-3 py-2 font-medium">Due Date</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(r => {
                  const isOpen = expandedRow === r.id;
                  const rowLinks = links.filter(l => l.fee_ledger_id === r.id);
                  const firstLink = rowLinks[0];
                  const firstPayment = firstLink ? payments.find(x => x.id === firstLink.lead_payment_id) : null;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => rowLinks.length ? setExpandedRow(isOpen ? null : r.id) : null}
                        className={`border-t border-border ${rowLinks.length ? "cursor-pointer hover:bg-muted/20" : ""}`}
                      >
                        <td className="px-3 py-2 text-center text-foreground">
                          <span className="inline-flex items-center gap-1 justify-center">
                            {rowLinks.length > 0 && (isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />)}
                            <span>{r.fee_codes?.name || r.fee_code_id.slice(0, 8)}</span>
                            <span className="font-mono text-[10px] text-muted-foreground/70">{r.fee_codes?.code || ""}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground capitalize">{r.term.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2 text-center text-foreground tabular-nums">{fmt(r.total_amount)}</td>
                        <td className="px-3 py-2 text-center text-warning-foreground tabular-nums">{r.concession > 0 ? fmt(r.concession) : "—"}</td>
                        <td className="px-3 py-2 text-center">
                          {r.paid_amount > 0 ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                              <span className="text-success font-semibold tabular-nums">{fmt(r.paid_amount)}</span>
                              {firstPayment && (
                                <>
                                  <span className="text-muted-foreground/60">·</span>
                                  <span className="font-mono text-[10px] text-foreground">{firstPayment.receipt_no || "—"}</span>
                                  {firstPayment.receipt_url && (
                                    <a
                                      href={firstPayment.receipt_url}
                                      target="_blank"
                                      rel="noopener"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-success hover:underline text-[11px] font-medium"
                                    >
                                      PDF
                                    </a>
                                  )}
                                  {rowLinks.length > 1 && (
                                    <span className="text-[10px] text-muted-foreground">+{rowLinks.length - 1}</span>
                                  )}
                                </>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          <span className={r.balance > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>{fmt(r.balance)}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground whitespace-nowrap">{fmtDate(r.due_date)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.status === "paid" ? "bg-success/10 text-success dark:bg-success/80/30 dark:text-success"
                            : r.status === "overdue" ? "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80"
                            : "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
                          }`}>{r.status}</span>
                        </td>
                      </tr>
                      {isOpen && rowLinks.length > 0 && (
                        <tr className="bg-muted/10 border-t border-border">
                          <td colSpan={8} className="px-3 py-2 space-y-1">
                            {rowLinks.map(l => {
                              const p = payments.find(x => x.id === l.lead_payment_id);
                              return (
                                <div key={l.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <FileImage className="h-3 w-3" />
                                  <span>Receipt <span className="font-mono text-foreground">{p?.receipt_no || "—"}</span></span>
                                  <span>· {fmt(l.amount)} paid{l.concession_amount > 0 ? ` + ${fmt(l.concession_amount)} concession` : ""}</span>
                                  <span>· {fmtDate(l.applied_at)}</span>
                                  {p?.receipt_url && <a href={p.receipt_url} target="_blank" rel="noopener" className="text-success hover:underline font-medium">PDF</a>}
                                  {l.notes && <span className="italic">· {l.notes}</span>}
                                </div>
                              );
                            })}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isSuperAdmin && (
        <>
          <PaymentEditDialog
            open={!!editPayment}
            onOpenChange={(v) => { if (!v) setEditPayment(null); }}
            payment={editPayment}
            onSaved={() => setInternalRefresh(n => n + 1)}
          />
          <PaymentAuditDialog
            open={!!auditPayment}
            onOpenChange={(v) => { if (!v) setAuditPayment(null); }}
            paymentId={auditPayment?.id || ""}
            receiptNo={auditPayment?.receipt_no}
          />
        </>
      )}
    </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" | "red" }) {
  const cls =
    tone === "amber"   ? "border-warning/20 bg-warning/5 text-warning-foreground" :
    tone === "emerald" ? "border-success/20 bg-success/5 text-success-foreground" :
    tone === "red"     ? "border-destructive/20 bg-destructive/5 text-destructive" :
    "border-border bg-card text-foreground";
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-base font-bold mt-0.5">{value}</p>
    </div>
  );
}
