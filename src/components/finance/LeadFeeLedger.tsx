import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Receipt, ChevronDown, ChevronRight, FileImage, IndianRupee, AlertCircle } from "lucide-react";

const PAY_TYPE_LABELS: Record<string, string> = {
  application_fee: "Application Fee",
  token_fee: "Token Fee",
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

interface Props {
  /** Either leadId OR studentId — both work, leadId is preferred from CRM views */
  leadId?: string;
  studentId?: string;
  refreshKey?: number;
}

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function LeadFeeLedger({ leadId, studentId, refreshKey }: Props) {
  const [resolvedLeadId, setResolvedLeadId] = useState<string | null>(leadId ?? null);
  const [resolvedStudentId, setResolvedStudentId] = useState<string | null>(studentId ?? null);
  const [payments, setPayments] = useState<LeadPayment[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [links, setLinks] = useState<LedgerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

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
          .select("id, receipt_no, type, amount, concession_amount, payment_mode, transaction_ref, status, payment_date, created_at, receipt_url, waiver_reason")
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
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [leadId, studentId, refreshKey]);

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

  const grouped = useMemo(() => {
    const m = new Map<string, LedgerRow[]>();
    for (const r of ledger) {
      const key = r.term || "other";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [ledger]);

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (payments.length === 0 && ledger.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="mx-auto mb-2 h-5 w-5" />
        No fee activity yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top summary */}
      {ledger.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Total Course Fee" value={fmt(totals.ledgerTotal)} />
          <Stat label="Concession" value={fmt(totals.ledgerConcession)} tone="amber" />
          <Stat label="Paid" value={fmt(totals.ledgerPaid)} tone="emerald" />
          <Stat label="Outstanding" value={fmt(totals.ledgerBalance)} tone={totals.ledgerBalance > 0 ? "red" : "emerald"} />
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
          <table className="w-full text-xs">
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
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-foreground">{p.receipt_no || "—"}</td>
                  <td className="px-3 py-2 text-foreground">
                    {PAY_TYPE_LABELS[p.type] || p.type}
                    {p.waiver_reason && (
                      <p className="text-[10px] text-muted-foreground/70">{p.waiver_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">{fmt(p.amount)}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{p.concession_amount > 0 ? fmt(p.concession_amount) : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span>{MODE_LABELS[p.payment_mode] || p.payment_mode}</span>
                    {p.transaction_ref && <span className="ml-1 font-mono text-[10px]">· {p.transaction_ref}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(p.payment_date || p.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      p.status === "confirmed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : p.status === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.receipt_url ? (
                      <a href={p.receipt_url} target="_blank" rel="noopener" className="text-primary hover:underline text-[11px]">View</a>
                    ) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ledger by term */}
      {ledger.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
            <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Fee Ledger</span>
          </div>
          <div className="divide-y divide-border">
            {grouped.map(([term, rows]) => {
              const termTotal      = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
              const termConcession = rows.reduce((s, r) => s + Number(r.concession   || 0), 0);
              const termPaid       = rows.reduce((s, r) => s + Number(r.paid_amount  || 0), 0);
              const termBalance    = rows.reduce((s, r) => s + Number(r.balance      || 0), 0);
              return (
                <div key={term}>
                  <div className="bg-muted/20 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground capitalize">{term.replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {fmt(termPaid)} paid · {termConcession > 0 ? fmt(termConcession) + " concession · " : ""}<span className={termBalance > 0 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>{fmt(termBalance)} {termBalance > 0 ? "due" : "settled"}</span>
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map(r => {
                        const isOpen = expandedRow === r.id;
                        const rowLinks = links.filter(l => l.fee_ledger_id === r.id);
                        return (
                          <>
                            <tr
                              key={r.id}
                              onClick={() => rowLinks.length ? setExpandedRow(isOpen ? null : r.id) : null}
                              className={`border-t border-border ${rowLinks.length ? "cursor-pointer hover:bg-muted/20" : ""}`}
                            >
                              <td className="px-3 py-2 w-4 text-muted-foreground">
                                {rowLinks.length > 0 ? (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                              </td>
                              <td className="px-3 py-2 text-foreground">
                                {r.fee_codes?.name || r.fee_code_id.slice(0, 8)}
                                <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">{r.fee_codes?.code || ""}</span>
                              </td>
                              <td className="px-3 py-2 text-right text-foreground">{fmt(r.total_amount)}</td>
                              <td className="px-3 py-2 text-right text-amber-700">{r.concession > 0 ? fmt(r.concession) : "—"}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{fmt(r.paid_amount)}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={r.balance > 0 ? "text-red-600 font-semibold" : "text-emerald-700 font-semibold"}>{fmt(r.balance)}</span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.due_date)}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  r.status === "paid" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : r.status === "overdue" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                }`}>{r.status}</span>
                              </td>
                            </tr>
                            {isOpen && rowLinks.length > 0 && (
                              <tr className="bg-muted/10">
                                <td></td>
                                <td colSpan={7} className="px-3 py-2 space-y-1">
                                  {rowLinks.map(l => {
                                    const p = payments.find(x => x.id === l.lead_payment_id);
                                    return (
                                      <div key={l.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                        <FileImage className="h-3 w-3" />
                                        <span>Receipt <span className="font-mono text-foreground">{p?.receipt_no || "—"}</span></span>
                                        <span>· {fmt(l.amount)} paid{l.concession_amount > 0 ? ` + ${fmt(l.concession_amount)} concession` : ""}</span>
                                        <span>· {fmtDate(l.applied_at)}</span>
                                        {p?.receipt_url && <a href={p.receipt_url} target="_blank" rel="noopener" className="text-primary hover:underline">PDF</a>}
                                        {l.notes && <span className="italic">· {l.notes}</span>}
                                      </div>
                                    );
                                  })}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "emerald" | "red" }) {
  const cls =
    tone === "amber"   ? "border-amber-200 bg-amber-50 text-amber-900" :
    tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
    tone === "red"     ? "border-red-200 bg-red-50 text-red-900" :
    "border-border bg-card text-foreground";
  return (
    <div className={`rounded-xl border ${cls} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-base font-bold mt-0.5">{value}</p>
    </div>
  );
}
