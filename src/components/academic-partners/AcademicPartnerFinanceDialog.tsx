import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CandidateLead = {
  id: string; name: string; phone: string | null; email: string | null; stage: string;
  course_id: string | null; academic_partner_id: string | null; courses?: { name: string } | null;
};
type CandidateStudent = {
  partner_id: string; student_id: string; lead_id: string | null; student_name: string;
  admission_no: string | null; status: string; course_name: string | null; batch_name: string | null;
  fee_total: number; fee_paid: number; fee_balance: number;
};
type Partner = { id: string; name: string; company_name: string | null; default_payout_percentage: number; phone: string | null };
type Receipt = {
  id: string; lead_id: string; amount: number; payment_date: string | null; created_at: string;
  type: string; payment_mode: string | null; transaction_ref: string | null; receipt_no: string | null; status: string;
};
type Payout = {
  id: string; lead_id: string | null; student_id: string | null; lead_payment_id: string | null;
  course_id: string; fee_paid: number; payout_percentage: number; payout_amount: number;
  status: string; leads?: { name: string } | null; students?: { name: string } | null;
  courses?: { name: string } | null;
};
type PartnerBill = {
  id: string; period_start: string; period_end: string; amount: number; payout_count: number;
  status: "draft" | "approved" | "synced_to_zoho" | "cancelled";
  zoho_bill_number: string | null; zoho_sync_error: string | null;
};

const fmt = (amount: number | string | null | undefined) => `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const statusClass = (status: string) => ["paid", "approved", "confirmed", "synced_to_zoho"].includes(status)
  ? "bg-success/10 text-success" : ["rejected", "cancelled", "failed"].includes(status)
    ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "Please try again.";

export function AcademicPartnerFinanceDialog({
  open, onOpenChange, partner, canManageFinance,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; partner: Partner | null;
  canManageFinance: boolean;
}) {
  const { toast } = useToast();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [scopedLeads, setScopedLeads] = useState<CandidateLead[]>([]);
  const [scopedStudents, setScopedStudents] = useState<CandidateStudent[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bills, setBills] = useState<PartnerBill[]>([]);
  const [billSchemaReady, setBillSchemaReady] = useState(true);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadFinance = useCallback(async () => {
    if (!partner) return;
    setLoading(true);
    const [leadsRes, assignmentsRes, payoutRes, billRes] = await Promise.all([
      (supabase as any).from("leads")
        .select("id, name, phone, email, stage, course_id, academic_partner_id, courses:course_id(name)")
        .eq("academic_partner_id", partner.id).order("created_at", { ascending: false }).limit(5000),
      (supabase as any).from("academic_partner_assignments")
        .select("course_id, batch_id").eq("partner_id", partner.id).eq("is_active", true),
      (supabase as any).from("academic_partner_payouts")
        .select("id, lead_id, student_id, lead_payment_id, course_id, fee_paid, payout_percentage, payout_amount, status, leads:lead_id(name), students:student_id(name), courses:course_id(name)")
        .eq("partner_id", partner.id).order("created_at", { ascending: false }).limit(2000),
      (supabase as any).from("academic_partner_bills")
        .select("id, period_start, period_end, amount, payout_count, status, zoho_bill_number, zoho_sync_error")
        .eq("partner_id", partner.id).order("period_start", { ascending: false }).limit(200),
    ]);
    const leadRows = (leadsRes.data || []) as CandidateLead[];
    const assignmentRows = (assignmentsRes.data || []) as { course_id: string; batch_id: string | null }[];
    const courseIds = Array.from(new Set(assignmentRows.map((assignment) => assignment.course_id)));
    const rawStudentsRes = courseIds.length ? await (supabase as any).from("students")
      .select("id, lead_id, name, first_name, middle_name, last_name, admission_no, status, course_id, batch_id, courses:course_id(name), batches:batch_id(name)")
      .in("course_id", courseIds).limit(5000)
      : { data: [], error: null };
    const rawStudents = (rawStudentsRes.data || []).filter((student: any) => assignmentRows.some((assignment) =>
      assignment.course_id === student.course_id && (!assignment.batch_id || assignment.batch_id === student.batch_id)));
    const studentIds = rawStudents.map((student: any) => student.id);
    const feeLedgerRes = studentIds.length ? await (supabase as any).from("fee_ledger")
      .select("student_id, total_amount, paid_amount, balance").in("student_id", studentIds).limit(10000)
      : { data: [], error: null };
    const feeTotals = new Map<string, { total: number; paid: number; balance: number }>();
    for (const fee of (feeLedgerRes.data || []) as { student_id: string; total_amount: number; paid_amount: number; balance: number }[]) {
      const aggregate = feeTotals.get(fee.student_id) || { total: 0, paid: 0, balance: 0 };
      aggregate.total += Number(fee.total_amount || 0);
      aggregate.paid += Number(fee.paid_amount || 0);
      aggregate.balance += Number(fee.balance || 0);
      feeTotals.set(fee.student_id, aggregate);
    }
    const studentRows = rawStudents.map((student: any) => {
      const fee = feeTotals.get(student.id) || { total: 0, paid: 0, balance: 0 };
      return {
        partner_id: partner.id, student_id: student.id, lead_id: student.lead_id,
        student_name: [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ") || student.name,
        admission_no: student.admission_no, status: student.status,
        course_name: student.courses?.name || null, batch_name: student.batches?.name || null,
        fee_total: fee.total, fee_paid: fee.paid, fee_balance: fee.balance,
      } as CandidateStudent;
    });
    const leadIds = leadRows.map((lead) => lead.id);
    const receiptRes = leadIds.length ? await (supabase as any).from("lead_payments")
      .select("id, lead_id, amount, payment_date, created_at, type, payment_mode, transaction_ref, receipt_no, status")
      .in("lead_id", leadIds).eq("status", "confirmed").order("payment_date", { ascending: false }).limit(5000)
      : { data: [], error: null };
    const missingBillSchema = Boolean(billRes.error && /academic_partner_bills.*schema cache|could not find.*academic_partner_bills/i.test(billRes.error.message));
    setBillSchemaReady(!missingBillSchema);
    if (leadsRes.error || assignmentsRes.error || rawStudentsRes.error || feeLedgerRes.error || payoutRes.error || (!missingBillSchema && billRes.error) || receiptRes.error) {
      const err = leadsRes.error || assignmentsRes.error || rawStudentsRes.error || feeLedgerRes.error || payoutRes.error || (!missingBillSchema && billRes.error) || receiptRes.error;
      toast({ title: "Could not load partner finance", description: err.message, variant: "destructive" });
    }
    setScopedLeads(leadRows);
    setScopedStudents(studentRows);
    setPayouts((payoutRes.data || []) as Payout[]);
    setBills((billRes.data || []) as PartnerBill[]);
    setReceipts((receiptRes.data || []) as Receipt[]);
    setLoading(false);
  }, [partner, toast]);

  useEffect(() => { if (open && partner) void loadFinance(); }, [open, partner, loadFinance]);

  const roster = useMemo(() => {
    const byLead = new Map<string, { key: string; name: string; admissionNo: string | null; phone: string | null; course: string; batch: string; stage: string; feePaid: number | null; feeBalance: number | null; source: string }>();
    for (const lead of scopedLeads) {
      byLead.set(lead.id, { key: lead.id, name: lead.name, admissionNo: null, phone: lead.phone, course: lead.courses?.name || "—", batch: "—", stage: lead.stage, feePaid: null, feeBalance: null, source: "Partner lead" });
    }
    for (const student of scopedStudents) {
      const existing = student.lead_id ? byLead.get(student.lead_id) : undefined;
      const key = student.lead_id || `student:${student.student_id}`;
      byLead.set(key, {
        key, name: student.student_name || existing?.name || "Unnamed", admissionNo: student.admission_no,
        phone: existing?.phone || null, course: student.course_name || existing?.course || "—", batch: student.batch_name || "—",
        stage: student.status || existing?.stage || "student", feePaid: Number(student.fee_paid || 0),
        feeBalance: Number(student.fee_balance || 0), source: existing ? "Partner lead + enrolled student" : "Assigned batch student",
      });
    }
    return Array.from(byLead.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedLeads, scopedStudents]);

  const leadById = useMemo(() => new Map(scopedLeads.map((lead) => [lead.id, lead])), [scopedLeads]);
  const totalCollected = receipts.reduce((total, receipt) => total + Number(receipt.amount || 0), 0);
  const pendingPayout = payouts.filter((payout) => !["paid", "cancelled"].includes(payout.status)).reduce((total, payout) => total + Number(payout.payout_amount || 0), 0);

  const runBillAction = async (action: "create" | "approve" | "send", billId?: string) => {
    if (!partner) return;
    setBusy(billId || "create");
    try {
      if (action === "create") {
        const [year, monthNumber] = month.split("-").map(Number);
        const start = `${month}-01`;
        const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
        const { error } = await (supabase as any).rpc("create_academic_partner_bill", { _partner_id: partner.id, _period_start: start, _period_end: end });
        if (error) throw error;
        toast({ title: "Draft bill created", description: "Review the calculated receipt based payouts below before approval." });
      } else if (action === "approve" && billId) {
        const { error } = await (supabase as any).rpc("approve_academic_partner_bill", { _bill_id: billId });
        if (error) throw error;
        toast({ title: "Bill approved", description: "It is ready for the explicit Zoho Books action." });
      } else if (action === "send" && billId) {
        const { data, error } = await supabase.functions.invoke("zoho-academic-partner-bill-sync", { body: { bill_id: billId } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast({ title: "Bill sent to Zoho Books", description: data?.zoho_bill_number ? `Bill ${data.zoho_bill_number}` : undefined });
      }
      await loadFinance();
    } catch (error) {
      toast({ title: "Partner bill action failed", description: errorMessage(error), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const partnerLeadIds = new Set(scopedLeads.map((lead) => lead.id));
  const title = partner?.company_name || partner?.name || "Academic partner";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader><DialogTitle>{title} · Candidates &amp; Finance</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border px-3 py-2"><p className="text-lg font-bold">{roster.length}</p><p className="text-xs text-muted-foreground">Distinct candidate records</p></div>
          <div className="rounded-lg border px-3 py-2"><p className="text-lg font-bold">{partnerLeadIds.size}</p><p className="text-xs text-muted-foreground">Partner leads</p></div>
          <div className="rounded-lg border px-3 py-2"><p className="text-lg font-bold">{fmt(totalCollected)}</p><p className="text-xs text-muted-foreground">Confirmed lead receipts</p></div>
          <div className="rounded-lg border px-3 py-2"><p className="text-lg font-bold">{fmt(pendingPayout)}</p><p className="text-xs text-muted-foreground">Unpaid calculated payouts</p></div>
        </div>
        <Tabs defaultValue="candidates" className="w-full">
          <TabsList><TabsTrigger value="candidates">Candidates ({roster.length})</TabsTrigger><TabsTrigger value="collections">Fee collections ({receipts.length})</TabsTrigger><TabsTrigger value="payouts">Payouts &amp; bills ({payouts.length})</TabsTrigger></TabsList>
          <TabsContent value="candidates">
            <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Shows all candidates from partner leads and active course/batch assignments. Overlapping records are matched by lead ID.</p><Button variant="outline" size="sm" onClick={() => void loadFinance()} disabled={loading}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button></div>
            <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[850px] text-sm">
              <thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">Candidate</th><th className="px-3 py-2 text-left">Course / batch</th><th className="px-3 py-2 text-left">Source</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Fee paid</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
              <tbody>{roster.map((candidate) => <tr key={candidate.key} className="border-b last:border-0"><td className="px-3 py-2"><div className="font-medium">{candidate.name}</div><div className="text-xs text-muted-foreground">{candidate.admissionNo || candidate.phone || "Admission number not issued"}</div></td><td className="px-3 py-2">{candidate.course}{candidate.batch !== "—" ? ` · ${candidate.batch}` : ""}</td><td className="px-3 py-2 text-xs text-muted-foreground">{candidate.source}</td><td className="px-3 py-2"><Badge className={`border-0 text-[10px] ${statusClass(candidate.stage)}`}>{candidate.stage.replace(/_/g, " ")}</Badge></td><td className="px-3 py-2 text-right">{candidate.feePaid === null ? "—" : fmt(candidate.feePaid)}</td><td className="px-3 py-2 text-right">{candidate.feeBalance === null ? "—" : fmt(candidate.feeBalance)}</td></tr>)}
                {!roster.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No partner candidates found.</td></tr>}</tbody>
            </table></div>
          </TabsContent>
          <TabsContent value="collections">
            <p className="mb-3 text-xs text-muted-foreground">Confirmed fee submissions for partner-owned leads. Pending or failed submissions are excluded from payout calculations.</p>
            <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">Candidate</th><th className="px-3 py-2 text-left">Receipt / reference</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Type / mode</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th></tr></thead>
              <tbody>{receipts.map((receipt) => <tr key={receipt.id} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{leadById.get(receipt.lead_id)?.name || "Candidate"}</td><td className="px-3 py-2 font-mono text-xs">{receipt.receipt_no || receipt.transaction_ref || "—"}</td><td className="px-3 py-2">{receipt.payment_date ? new Date(receipt.payment_date).toLocaleDateString("en-IN") : new Date(receipt.created_at).toLocaleDateString("en-IN")}</td><td className="px-3 py-2 capitalize">{receipt.type.replace(/_/g, " ")} · {(receipt.payment_mode || "—").replace(/_/g, " ")}</td><td className="px-3 py-2 text-right font-semibold">{fmt(receipt.amount)}</td><td className="px-3 py-2 text-center"><Badge className={`border-0 text-[10px] ${statusClass(receipt.status)}`}>{receipt.status}</Badge></td></tr>)}
                {!receipts.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No confirmed fee receipts found.</td></tr>}</tbody></table></div>
          </TabsContent>
          <TabsContent value="payouts" className="space-y-4">
            <div className="rounded-lg border p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Partner bills</h3><p className="text-xs text-muted-foreground">Each confirmed receipt is multiplied by the active course/batch payout percentage. Bill creation, approval, and Zoho submission are separate admin actions.</p></div>{canManageFinance && billSchemaReady && <div className="flex items-end gap-2"><label className="text-xs text-muted-foreground">Payout month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label><Button onClick={() => void runBillAction("create")} disabled={!!busy || !month}>{busy === "create" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create draft bill</Button></div>}</div>
              {!billSchemaReady && <div role="status" className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"><p className="font-medium">Bill workflow is not enabled in this database yet.</p><p className="mt-0.5 text-xs text-muted-foreground">The academic partner billing migration must be applied before draft bills can be created or sent to Zoho Books.</p></div>}
              <div className="mt-3 overflow-x-auto rounded-md border"><table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">Period</th><th className="px-3 py-2 text-right">Receipts</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-center">Status</th><th className="px-3 py-2 text-left">Zoho bill</th><th className="px-3 py-2 text-right">Action</th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id} className="border-b last:border-0"><td className="px-3 py-2">{bill.period_start} – {bill.period_end}</td><td className="px-3 py-2 text-right">{bill.payout_count}</td><td className="px-3 py-2 text-right font-semibold">{fmt(bill.amount)}</td><td className="px-3 py-2 text-center"><Badge className={`border-0 text-[10px] ${statusClass(bill.status)}`}>{bill.status.replace(/_/g, " ")}</Badge></td><td className="px-3 py-2">{bill.zoho_bill_number || "—"}{bill.zoho_sync_error && <p className="text-xs text-destructive">{bill.zoho_sync_error}</p>}</td><td className="px-3 py-2 text-right whitespace-nowrap">{canManageFinance && bill.status === "draft" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runBillAction("approve", bill.id)}>{busy === bill.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Approve</Button>}{canManageFinance && bill.status === "approved" && <Button size="sm" disabled={!!busy} onClick={() => void runBillAction("send", bill.id)}><Building2 className="mr-2 h-3.5 w-3.5" />{busy === bill.id ? "Sending…" : "Send to Zoho"}</Button>}{bill.status === "synced_to_zoho" && <span className="text-xs text-muted-foreground">Sent</span>}</td></tr>)}
                {!bills.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No bills created. Choose a month to calculate a draft from confirmed fee receipts.</td></tr>}</tbody></table></div>
            </div>
            <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">Candidate</th><th className="px-3 py-2 text-left">Course</th><th className="px-3 py-2 text-right">Confirmed fee</th><th className="px-3 py-2 text-right">Payout %</th><th className="px-3 py-2 text-right">Payout</th><th className="px-3 py-2 text-center">Status</th></tr></thead><tbody>{payouts.map((payout) => <tr key={payout.id} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{payout.students?.name || payout.leads?.name || "—"}</td><td className="px-3 py-2">{payout.courses?.name || "—"}</td><td className="px-3 py-2 text-right">{fmt(payout.fee_paid)}</td><td className="px-3 py-2 text-right">{Number(payout.payout_percentage || 0)}%</td><td className="px-3 py-2 text-right font-semibold">{fmt(payout.payout_amount)}</td><td className="px-3 py-2 text-center"><Badge className={`border-0 text-[10px] ${statusClass(payout.status)}`}>{payout.status}</Badge></td></tr>)}
              {!payouts.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Payout rows are generated when you create a draft bill for a month.</td></tr>}</tbody></table></div>
          </TabsContent>
        </Tabs>
        {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Refreshing finance records…</div>}
      </DialogContent>
    </Dialog>
  );
}
