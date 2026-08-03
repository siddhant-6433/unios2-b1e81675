import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Wand2, Plus, HandCoins, Check, Clock, AlertTriangle, Trash2, Link as LinkIcon,
  Receipt, FileText, RefreshCw, Wallet, ArrowLeftRight, History,
} from "lucide-react";
import { ConcessionDialog } from "./ConcessionDialog";
import { OfflinePaymentDialog } from "./OfflinePaymentDialog";
import { AddChargeDialog } from "./AddChargeDialog";
import { SendPaymentLinkDialog } from "./SendPaymentLinkDialog";
import { ApplyCreditDialog } from "./ApplyCreditDialog";
import { TransferFeeDialog } from "./TransferFeeDialog";
import { FeeLedgerAuditDialog } from "./FeeLedgerAuditDialog";
import { defaultFeeTermLabel, ONE_TIME_TERMS, ONE_TIME_GROUP, oneTimeRank } from "@/lib/feeTermLabels";

interface StudentFeePanelProps {
  student: any;
  onRefresh?: () => void;
}

const feeStatusBg: Record<string, string> = {
  paid: "bg-success/10 text-success",
  due: "bg-warning/10 text-warning",
  overdue: "bg-destructive/10 text-destructive",
};

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  application_fee: "Application Fee",
  token_fee: "Token Fee",
  registration_fee: "Registration Fee",
  other: "Other",
};

export function StudentFeePanel({ student, onRefresh }: StudentFeePanelProps) {
  const { role, session, hasPermission } = useAuth();
  const { toast } = useToast();
  const [fees, setFees] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [migratingStetho, setMigratingStetho] = useState(false);
  const [concessionOpen, setConcessionOpen] = useState(false);
  const [pendingWaivers, setPendingWaivers] = useState<Record<string, number>>({});
  const [sendLinkOpen, setSendLinkOpen] = useState(false);
  const [applyCreditOpen, setApplyCreditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  // Which ledger row a per-row "Collect" click targeted — prefills the dialog.
  const [collectTarget, setCollectTarget] = useState<{ id: string; amount: number } | null>(null);
  const [selectedFeeItems, setSelectedFeeItems] = useState<string[]>([]);
  const [consultantManaged, setConsultantManaged] = useState<string | null>(null); // consultant name when flagged
  const [credit, setCredit] = useState<{ application_fee_paid: number; general_credit: number } | null>(null);
  // Fee codes that came from the ad-hoc catalog. A cashier may remove those
  // (the mirror of Add Charge) but not a structural tuition/boarding row.
  const [adhocCodeIds, setAdhocCodeIds] = useState<Set<string>>(new Set());

  const isFinanceRole = ["super_admin", "campus_admin", "principal", "accountant"].includes(role || "");
  const canProvision = isFinanceRole;
  const canRequestConcession = ["counsellor", "super_admin", "campus_admin", "accountant"].includes(role || "");
  const canReallocate = hasPermission("fee_ledger:reallocate") || ["super_admin", "accountant"].includes(role || "");
  // Taking money at the counter is cashier-only, same gate as OfflinePaymentDialog.
  const canCollect = ["super_admin", "accountant"].includes(role || "") && !!student?.lead_id;
  const courseCode = student?.courses?.code || student?.course_code || "";
  const isDaott = ["DAOTT-GN", "OTT-GN"].includes(courseCode);
  const isStethoBatch = student?.fee_structure_version === "stetho_batch";

  useEffect(() => {
    if (student?.id) {
      fetchFees();
      fetchPayments();
      fetchConsultantFlag();
      fetchCredit();
      fetchPendingWaivers();
      fetchRemovableCodes();
    }
  }, [student?.id, student?.lead_id]);

  // Per-head waiver/concession requests still awaiting approval, so the ledger
  // can badge a head as "waiver pending". Sum pending flat value per fee row.
  const fetchPendingWaivers = async () => {
    const { data } = await supabase
      .from("concessions")
      .select("fee_ledger_id, value, status")
      .eq("student_id", student.id)
      .in("status", ["pending_principal", "pending_super_admin"]);
    const map: Record<string, number> = {};
    for (const c of data || []) {
      if (c.fee_ledger_id) map[c.fee_ledger_id] = (map[c.fee_ledger_id] || 0) + Number(c.value || 0);
    }
    setPendingWaivers(map);
  };

  const fetchRemovableCodes = async () => {
    const { data } = await (supabase.rpc as any)("removable_fee_code_ids", { _student_id: student.id });
    setAdhocCodeIds(new Set(((data || []) as { fee_code_id: string }[]).map(r => r.fee_code_id)));
  };

  // Mirrors remove_fee_charge's server-side gate so we never render a button
  // that answers with a raw privilege error.
  const canRemoveRow = (f: any) => {
    if (Number(f.paid_amount) !== 0) return false;
    if (role === "super_admin" || hasPermission("fee_structure:manage")) return true;
    return role === "accountant" && adhocCodeIds.has(f.fee_code_id);
  };

  const fetchCredit = async () => {
    const { data } = await (supabase.rpc as any)("student_fee_credit_balance", { _id: student.id });
    if (data) setCredit(data);
  };

  // Cashier note: is this candidate's fee consultant-managed (structure hidden
  // from the student login)? Staff-readable via v_student_fee_visibility.
  const fetchConsultantFlag = async () => {
    const { data } = await (supabase.from("v_student_fee_visibility") as any)
      .select("effective_hidden, consultant_name")
      .eq("student_id", student.id)
      .maybeSingle();
    setConsultantManaged(data?.effective_hidden ? (data.consultant_name || "consultant") : null);
  };

  const fetchFees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fee_ledger")
      .select("*, fee_codes:fee_code_id(code, name, category)")
      .eq("student_id", student.id)
      .order("due_date").order("term");
    if (data) setFees(data);
    setLoading(false);
  };

  const fetchPayments = async () => {
    if (!student?.lead_id) return;
    const { data } = await supabase
      .from("lead_payments")
      .select("id, type, amount, payment_mode, transaction_ref, receipt_no, receipt_url, status, payment_date, created_at, concession_amount")
      .eq("lead_id", student.lead_id)
      .order("created_at", { ascending: false });
    if (data) setPayments(data);
  };

  const handleProvision = async (force = false) => {
    setProvisioning(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-student-fees", {
        body: { student_id: student.id, force_reprovision: force },
      });

      if (error) {
        // FunctionsHttpError stores the parsed response body in .data
        const errBody = (error as any).data;
        let detail = error.message;
        if (errBody) {
          detail = typeof errBody === "string" ? errBody : errBody?.error || errBody?.message || JSON.stringify(errBody);
        }
        console.error("provision-student-fees error:", { error, errBody, data });
        toast({ title: "Provisioning failed", description: detail, variant: "destructive" });
      } else if (data?.error) {
        // Function returned 200 but with an error field
        toast({ title: "Provisioning failed", description: data.error, variant: "destructive" });
      } else {
        const result = data?.results?.[0];
        if (result?.status === "error") {
          toast({ title: "Provisioning failed", description: result.error, variant: "destructive" });
        } else {
          toast({ title: "Fees provisioned", description: `${result?.items_created || 0} fee items created` });
          fetchFees();
          onRefresh?.();
        }
      }
    } catch (e: any) {
      console.error("provision-student-fees exception:", e);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setProvisioning(false);
  };

  const handleMigrateToStetho = async () => {
    const confirmed = window.confirm(
      "Migrate this DAOTT/DOTT admission to the Stetho Batch fee structure? The current ledger will be snapshotted before the live ledger is rebuilt.",
    );
    if (!confirmed) return;

    setMigratingStetho(true);
    const { data, error } = await (supabase as any).rpc("migrate_daott_student_to_stetho_batch", {
      _student_id: student.id,
    });
    setMigratingStetho(false);

    if (error) {
      toast({ title: "Migration failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Migrated to Stetho Batch",
      description: `Snapshot preserved. ${data?.ledger_rows_created || 0} fee rows created.`,
    });
    await fetchFees();
    onRefresh?.();
  };

  // Goes through remove_fee_charge: `authenticated` has no DELETE grant on
  // fee_ledger, so the direct .delete() failed with a privilege error for
  // every role — including the super_admin the RLS policy was written for.
  const handleRemoveUnpaid = async (feeId: string) => {
    const { error } = await (supabase.rpc as any)("remove_fee_charge", {
      _fee_ledger_id: feeId, _reason: null,
    });

    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Removed" });
      fetchFees();
      onRefresh?.();
    }
  };

  const totalFee = fees.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const totalConcession = fees.reduce((s, f) => s + Number(f.concession || 0), 0);
  const totalBalance = fees.reduce((s, f) => s + Number(f.balance || 0), 0);

  // Group consecutive rows by term (fees are due_date-ordered, so same-term
  // rows are already adjacent) — lets tuition + boarding for a quarter read
  // together under one header instead of as a flat list.
  const feeGroups = useMemo(() => {
    // The one-time charges (application fee, admission fee, security deposit)
    // share a due date and live under two different terms, so a plain
    // due_date/term sort interleaved them arbitrarily. Collapse them into one
    // leading section, ordered application → admission → deposit, then the
    // recurring collection terms in due-date order.
    const oneTime = fees
      .filter((f: any) => ONE_TIME_TERMS.includes(String(f.term || "").toLowerCase()))
      .sort((a: any, b: any) =>
        oneTimeRank(a.fee_codes?.code, a.fee_codes?.name) -
        oneTimeRank(b.fee_codes?.code, b.fee_codes?.name));

    const groups: { term: string; rows: any[] }[] = [];
    if (oneTime.length) groups.push({ term: ONE_TIME_GROUP, rows: oneTime });

    for (const f of fees) {
      if (ONE_TIME_TERMS.includes(String(f.term || "").toLowerCase())) continue;
      const last = groups[groups.length - 1];
      if (last && last.term === f.term) last.rows.push(f);
      else groups.push({ term: f.term, rows: [f] });
    }
    return groups;
  }, [fees]);

  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-4">
      {/* Student profile badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="capitalize">{student.student_type?.replace("_", " ") || "Day Scholar"}</Badge>
        {student.transport_zone && (
          <Badge className="bg-pastel-yellow text-foreground/70 border-0">
            Transport: {student.transport_zone.replace("_", " ").replace("zone ", "Zone ")}
          </Badge>
        )}
        {student.hostel_type && (
          <Badge className="bg-pastel-mint text-foreground/70 border-0">
            Hostel: {student.hostel_type === "ac_central" ? "AC C Block" : student.hostel_type === "ac_individual" ? "AC B Block" : "Non-AC"}
          </Badge>
        )}
        {student.fee_structure_version && (
          <Badge className={student.fee_structure_version === "existing_parent" ? "bg-warning/10 text-warning-foreground border-warning/20" : isStethoBatch ? "bg-primary/10 text-primary border-primary/20" : "bg-info/10 text-info-foreground border-info/20"}>
            {student.fee_structure_version === "existing_parent" ? "Existing Parent" : isStethoBatch ? "Stetho Batch" : "New Admission"}
          </Badge>
        )}
      </div>

      {/* Cashier note — consultant-managed fee */}
      {consultantManaged && (
        <div className="rounded-xl border border-warning/20 bg-warning/5 dark:border-warning/60/50 dark:bg-warning/80/20 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-warning-foreground dark:text-warning/40">
            Fee for this candidate is managed via consultant login / consultant-sent payment links
            <span className="font-medium"> ({consultantManaged})</span>. The fee structure is hidden from the student&rsquo;s login.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {canCollect && (
          <Button size="sm" onClick={() => { setCollectTarget(null); setCollectOpen(true); }} className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Collect Payment
          </Button>
        )}
        {["super_admin", "accountant"].includes(role || "") && (
          <Button size="sm" variant="outline" onClick={() => setChargeOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Charge
          </Button>
        )}
        {canProvision && (
          <>
            <Button size="sm" onClick={() => handleProvision(false)} disabled={provisioning} className="gap-1.5">
              {provisioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Auto-Assign Fees
            </Button>
            {fees.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => handleProvision(true)} disabled={provisioning} className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Re-provision (clear unpaid)
              </Button>
            )}
          </>
        )}
        {canRequestConcession && fees.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setConcessionOpen(true)} className="gap-1.5">
            <HandCoins className="h-3.5 w-3.5" /> Request Waiver / Concession
          </Button>
        )}
        {isFinanceRole && student?.id && (
          <Button size="sm" variant="outline" onClick={() => setSendLinkOpen(true)} className="gap-1.5">
            <LinkIcon className="h-3.5 w-3.5" /> Send Payment Link
          </Button>
        )}
        {isFinanceRole && isDaott && !isStethoBatch && (
          <Button size="sm" variant="outline" onClick={handleMigrateToStetho} disabled={migratingStetho} className="gap-1.5">
            {migratingStetho ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Migrate to Stetho Batch
          </Button>
        )}
        {isFinanceRole && Number(credit?.general_credit || 0) > 0 && (
          <Button size="sm" variant="outline" onClick={() => setApplyCreditOpen(true)} className="gap-1.5">
            <Wallet className="h-3.5 w-3.5" /> Apply Credit
          </Button>
        )}
        {canReallocate && fees.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)} className="gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer
          </Button>
        )}
        {isFinanceRole && (
          <Button size="sm" variant="outline" onClick={() => setAuditOpen(true)} className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Reallocation History
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Fee" value={totalFee} color="bg-chart-5/10 text-chart-5" />
        <SummaryCard label="Paid" value={totalPaid} color="bg-success/10 text-success" />
        <SummaryCard label="Concession" value={totalConcession} color="bg-pastel-purple text-foreground/70" />
        <SummaryCard label="Balance" value={totalBalance} color={totalBalance > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"} />
        <SummaryCard label="Credit (unallocated)" value={Number(credit?.general_credit || 0)} color="bg-pastel-mint text-foreground/70" />
      </div>
      {Number(credit?.application_fee_paid || 0) > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Application fee paid: ₹{Number(credit?.application_fee_paid || 0).toLocaleString("en-IN")}
        </p>
      )}

      {/* Fee table */}
      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">Fee Code</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Total</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Concession</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Paid</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Balance</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Due Date</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              {isFinanceRole && <th className="px-4 py-3 font-medium text-muted-foreground w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {fees.length === 0 ? (
              <tr>
                <td colSpan={isFinanceRole ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">
                  No fee records found. {canProvision && "Click 'Auto-Assign Fees' to provision."}
                </td>
              </tr>
            ) : feeGroups.map((g) => {
              const gTotal = g.rows.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
              const gConcession = g.rows.reduce((s: number, r: any) => s + Number(r.concession || 0), 0);
              return (
              <Fragment key={g.term}>
                <tr className="bg-muted/40 border-b border-border">
                  <td className="px-4 py-1.5 text-xs font-semibold text-foreground">
                    {g.term === ONE_TIME_GROUP
                      ? "One-time Fees"
                      : defaultFeeTermLabel(g.term, isStethoBatch ? "Semester" : undefined)}
                  </td>
                  <td className="px-4 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">₹{gTotal.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-1.5 text-right text-[11px] text-muted-foreground">{gConcession > 0 ? `₹${gConcession.toLocaleString("en-IN")}` : ""}</td>
                  <td colSpan={isFinanceRole ? 5 : 4} />
                </tr>
                {g.rows.map((f: any) => (
                  <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 pl-6">
                      <span className="font-medium text-foreground">{f.fee_codes?.code || "—"}</span>
                      <span className="block text-[10px] text-muted-foreground">{f.fee_codes?.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">₹{Number(f.total_amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {Number(f.concession) > 0 ? `₹${Number(f.concession).toLocaleString("en-IN")}` : "—"}
                      {pendingWaivers[f.id] > 0 && (
                        <span className="block text-[10px] font-medium text-warning" title="Waiver awaiting super-admin approval">
                          +₹{pendingWaivers[f.id].toLocaleString("en-IN")} pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">₹{Number(f.paid_amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">₹{Number(f.balance || 0).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {f.due_date ? new Date(f.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${feeStatusBg[f.status] || "bg-muted"}`}>
                        {f.status === "paid" && <Check className="h-3 w-3" />}
                        {f.status === "due" && <Clock className="h-3 w-3" />}
                        {f.status === "overdue" && <AlertTriangle className="h-3 w-3" />}
                        {f.status}
                      </span>
                    </td>
                    {isFinanceRole && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {canCollect && Number(f.balance) > 0 && (
                            <button
                              onClick={() => {
                                setCollectTarget({ id: f.id, amount: Math.round(Number(f.balance)) });
                                setCollectOpen(true);
                              }}
                              className="text-primary hover:underline text-[11px] font-medium whitespace-nowrap"
                              title="Collect against this head"
                            >
                              Collect
                            </button>
                          )}
                          {canRemoveRow(f) && (
                            <button
                              onClick={() => handleRemoveUnpaid(f.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Remove unpaid item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Receipts — confirmed payments only. Pending and failed/abandoned
          attempts live in the Transaction History table below. */}
      {(() => {
        const confirmed = payments.filter((p: any) => p.status === "confirmed");
        const otherTxns = payments.filter((p: any) => p.status !== "confirmed");
        return (
          <>
            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Receipts</span>
                <span className="text-xs text-muted-foreground">
                  {confirmed.length === 0 ? "no confirmed payments" : `${confirmed.length} receipt${confirmed.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {confirmed.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No confirmed payments yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">Receipt #</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Date</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Mode</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Amount</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmed.map((p: any) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs">{p.receipt_no || "—"}</td>
                        <td className="px-4 py-3 text-foreground">{PAYMENT_TYPE_LABEL[p.type] || p.type}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.payment_date ? new Date(p.payment_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">{p.payment_mode?.replace("_", " ") || "—"}</td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">₹{Number(p.amount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3">
                          {p.receipt_url ? (
                            <a href={p.receipt_url} target="_blank" rel="noopener" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                              <FileText className="h-3.5 w-3.5" /> Open
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">Generating…</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Transaction History — pending + failed/abandoned attempts.
                These never get a receipt number; they're kept for audit. */}
            {otherTxns.length > 0 && (
              <div className="rounded-xl bg-card card-shadow overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Transaction History</span>
                  <span className="text-xs text-muted-foreground">
                    {otherTxns.length} unconfirmed attempt{otherTxns.length === 1 ? "" : "s"}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Initiated</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Mode</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Ref</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Amount</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherTxns.map((p: any) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-foreground">{PAYMENT_TYPE_LABEL[p.type] || p.type}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.created_at ? new Date(p.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">{p.payment_mode?.replace("_", " ") || "—"}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{p.transaction_ref || "—"}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">₹{Number(p.amount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${
                            p.status === "pending" ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
                          }`}>
                            {p.status === "pending" ? <Clock className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}

      {student?.lead_id && (
        <OfflinePaymentDialog
          open={collectOpen}
          onOpenChange={(v) => { setCollectOpen(v); if (!v) setCollectTarget(null); }}
          leadId={student.lead_id}
          defaultType="other"
          defaultAmount={collectTarget?.amount ?? null}
          onRecorded={() => { fetchFees(); fetchPayments(); fetchCredit(); onRefresh?.(); }}
        />
      )}

      <AddChargeDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        studentId={student.id}
        onAdded={() => { fetchFees(); onRefresh?.(); }}
      />

      <ConcessionDialog
        open={concessionOpen}
        onOpenChange={setConcessionOpen}
        studentId={student.id}
        feeItems={fees}
        onSuccess={() => { fetchFees(); fetchPendingWaivers(); onRefresh?.(); }}
      />

      <SendPaymentLinkDialog
        open={sendLinkOpen}
        onOpenChange={setSendLinkOpen}
        studentId={student.id}
        leadId={student.lead_id || undefined}
        defaultAmount={totalBalance > 0 ? Math.round(totalBalance) : null}
        defaultPurpose="fee_due"
        onCreated={() => { fetchPayments(); onRefresh?.(); }}
      />

      <ApplyCreditDialog
        open={applyCreditOpen}
        onOpenChange={setApplyCreditOpen}
        studentId={student.id}
        fees={fees}
        availableCredit={Number(credit?.general_credit || 0)}
        onSuccess={() => { fetchFees(); fetchCredit(); onRefresh?.(); }}
      />

      <TransferFeeDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        studentId={student.id}
        fees={fees}
        onSuccess={() => { fetchFees(); fetchCredit(); onRefresh?.(); }}
      />

      <FeeLedgerAuditDialog
        open={auditOpen}
        onOpenChange={setAuditOpen}
        studentId={student.id}
      />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <span className="text-xs font-bold">₹</span>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">₹{value.toLocaleString("en-IN")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
