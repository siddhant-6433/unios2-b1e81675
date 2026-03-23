import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, RefreshCw, Download, Loader2, CheckCircle2, Clock,
  CreditCard, Banknote, Receipt, AlertCircle,
} from "lucide-react";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface AppTransaction {
  application_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  fee_amount: number;
  payment_status: string;
  payment_ref: string | null;
  updated_at: string;
  created_at: string;
  leads: { admission_no: string | null; pre_admission_no: string | null } | null;
}

interface StudentPayment {
  id: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  receipt_no: string | null;
  paid_at: string;
  notes: string | null;
  students: {
    name: string;
    admission_no: string | null;
    pre_admission_no: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  profiles: { display_name: string | null } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fmtAmount(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_COLORS: Record<string, string> = {
  paid:    "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  failed:  "bg-red-100  text-red-700",
};

const MODE_COLORS: Record<string, string> = {
  online:        "bg-blue-100  text-blue-700",
  cash:          "bg-green-100 text-green-700",
  cheque:        "bg-purple-100 text-purple-700",
  upi:           "bg-orange-100 text-orange-700",
  bank_transfer: "bg-cyan-100  text-cyan-700",
};

// ── Summary card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl bg-card border border-border p-4 space-y-1">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransactionHistoryPanel() {
  const [tab, setTab]                     = useState<"applications" | "students">("applications");
  const [appTxns, setAppTxns]             = useState<AppTransaction[]>([]);
  const [studentPmts, setStudentPmts]     = useState<StudentPayment[]>([]);
  const [loadingApp, setLoadingApp]       = useState(true);
  const [loadingStudent, setLoadingStudent] = useState(true);
  const [errorApp, setErrorApp]           = useState<string | null>(null);
  const [errorStudent, setErrorStudent]   = useState<string | null>(null);
  const [receipt, setReceipt]             = useState<ReceiptData | null>(null);

  // Filters
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter]   = useState("all");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchAppTxns = async () => {
    setLoadingApp(true);
    setErrorApp(null);
    const { data, error } = await (supabase as any)
      .from("applications")
      .select(`
        application_id, full_name, phone, email,
        fee_amount, payment_status, payment_ref,
        updated_at, created_at,
        leads ( admission_no, pre_admission_no )
      `)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) setErrorApp(error.message);
    else setAppTxns(data || []);
    setLoadingApp(false);
  };

  const fetchStudentPmts = async () => {
    setLoadingStudent(true);
    setErrorStudent(null);
    const { data, error } = await (supabase as any)
      .from("payments")
      .select(`
        id, amount, payment_mode, transaction_ref,
        receipt_no, paid_at, notes,
        students ( name, admission_no, pre_admission_no, phone, email ),
        profiles!recorded_by ( display_name )
      `)
      .order("paid_at", { ascending: false })
      .limit(1000);
    if (error) setErrorStudent(error.message);
    else setStudentPmts(data || []);
    setLoadingStudent(false);
  };

  useEffect(() => { fetchAppTxns(); fetchStudentPmts(); }, []);

  // ── Filtered data ──────────────────────────────────────────────────────────

  const filteredApps = useMemo(() => {
    const q = search.toLowerCase();
    return appTxns.filter((t) => {
      if (statusFilter !== "all" && t.payment_status !== statusFilter) return false;
      if (dateFrom && t.updated_at < dateFrom) return false;
      if (dateTo && t.updated_at > dateTo + "T23:59:59") return false;
      if (q) {
        const admNo    = t.leads?.admission_no?.toLowerCase() || "";
        const preAdmNo = t.leads?.pre_admission_no?.toLowerCase() || "";
        return (
          t.application_id.toLowerCase().includes(q) ||
          t.full_name.toLowerCase().includes(q) ||
          (t.phone || "").toLowerCase().includes(q) ||
          (t.payment_ref || "").toLowerCase().includes(q) ||
          admNo.includes(q) ||
          preAdmNo.includes(q)
        );
      }
      return true;
    });
  }, [appTxns, statusFilter, dateFrom, dateTo, search]);

  const filteredStudents = useMemo(() => {
    const q = search.toLowerCase();
    return studentPmts.filter((p) => {
      if (modeFilter !== "all" && p.payment_mode !== modeFilter) return false;
      if (dateFrom && p.paid_at < dateFrom) return false;
      if (dateTo && p.paid_at > dateTo + "T23:59:59") return false;
      if (q) {
        const name  = p.students?.name?.toLowerCase() || "";
        const admNo = p.students?.admission_no?.toLowerCase() || "";
        const pre   = p.students?.pre_admission_no?.toLowerCase() || "";
        const phone = p.students?.phone?.toLowerCase() || "";
        return (
          name.includes(q) ||
          admNo.includes(q) ||
          pre.includes(q) ||
          phone.includes(q) ||
          (p.receipt_no || "").toLowerCase().includes(q) ||
          (p.transaction_ref || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [studentPmts, modeFilter, dateFrom, dateTo, search]);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const appStats = useMemo(() => {
    const paid    = appTxns.filter((t) => t.payment_status === "paid");
    const pending = appTxns.filter((t) => t.payment_status === "pending");
    const total   = paid.reduce((s, t) => s + (t.fee_amount || 0), 0);
    return { total, paidCount: paid.length, pendingCount: pending.length };
  }, [appTxns]);

  const studentStats = useMemo(() => {
    const total = studentPmts.reduce((s, p) => s + (p.amount || 0), 0);
    return { total, count: studentPmts.length };
  }, [studentPmts]);

  // ── CSV export ─────────────────────────────────────────────────────────────

  const exportAppCSV = () => {
    const headers = ["Date", "Application ID", "Applicant Name", "Phone", "Email",
      "Amount", "Status", "Payment Ref", "Admission No", "Pre-Admission No"];
    const rows = filteredApps.map((t) => [
      fmtDate(t.updated_at),
      t.application_id,
      t.full_name,
      t.phone,
      t.email || "",
      t.fee_amount?.toFixed(2) || "0.00",
      t.payment_status,
      t.payment_ref || "",
      t.leads?.admission_no || "",
      t.leads?.pre_admission_no || "",
    ]);
    downloadCSV([headers, ...rows], `application-fee-transactions-${Date.now()}.csv`);
  };

  const exportStudentCSV = () => {
    const headers = ["Date", "Receipt No", "Student Name", "Phone", "Amount",
      "Mode", "Transaction Ref", "Admission No", "Pre-Admission No", "Recorded By", "Notes"];
    const rows = filteredStudents.map((p) => [
      fmtDate(p.paid_at),
      p.receipt_no || "",
      p.students?.name || "",
      p.students?.phone || "",
      p.amount?.toFixed(2) || "0.00",
      p.payment_mode,
      p.transaction_ref || "",
      p.students?.admission_no || "",
      p.students?.pre_admission_no || "",
      p.profiles?.display_name || "",
      p.notes || "",
    ]);
    downloadCSV([headers, ...rows], `student-fee-payments-${Date.now()}.csv`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
    <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Transaction History</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All payment transactions — application fees and student fee collections.
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="App Fees Collected"
          value={fmtAmount(appStats.total)}
          sub={`${appStats.paidCount} transactions`}
          color="text-green-600"
        />
        <StatCard
          label="App Fees Pending"
          value={String(appStats.pendingCount)}
          sub="awaiting payment"
          color="text-yellow-600"
        />
        <StatCard
          label="Student Payments"
          value={fmtAmount(studentStats.total)}
          sub={`${studentStats.count} transactions`}
          color="text-blue-600"
        />
        <StatCard
          label="Total Collected"
          value={fmtAmount(appStats.total + studentStats.total)}
          sub="all sources combined"
          color="text-foreground"
        />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["applications", "students"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSearch(""); setStatusFilter("all"); setModeFilter("all"); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "applications" ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
            {t === "applications" ? "Application Fees" : "Student Payments"}
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={
              tab === "applications"
                ? "Search by name, phone, app ID, ref, admission no…"
                : "Search by name, admission no, receipt, ref…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        {tab === "applications" ? (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        ) : (
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="all">All Modes</option>
            <option value="online">Online</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
        )}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <button
          onClick={tab === "applications" ? fetchAppTxns : fetchStudentPmts}
          className="rounded-xl border border-input bg-card p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        <button
          onClick={tab === "applications" ? exportAppCSV : exportStudentCSV}
          className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* ── Application Fee Table ── */}
      {tab === "applications" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loadingApp ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : errorApp ? (
            <div className="flex items-center gap-3 px-6 py-8 text-destructive text-sm">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{errorApp}</span>
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="py-16 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No transactions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Application ID</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Applicant</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Phone</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right whitespace-nowrap">Amount</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Payment Ref</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Admission No</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Pre-Admission No</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((t) => (
                    <tr key={t.application_id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {fmtDate(t.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded-md text-foreground">
                          {t.application_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{t.full_name || "—"}</p>
                        {t.email && <p className="text-xs text-muted-foreground">{t.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{t.phone || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                        {t.fee_amount > 0 ? fmtAmount(t.fee_amount) : <span className="text-muted-foreground font-normal">Waived</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLORS[t.payment_status] || "bg-muted text-muted-foreground"}`}>
                          {t.payment_status === "paid"    && <CheckCircle2 className="h-3 w-3" />}
                          {t.payment_status === "pending" && <Clock className="h-3 w-3" />}
                          {t.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.payment_ref
                          ? <span className="font-mono text-xs text-muted-foreground">{t.payment_ref}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {t.leads?.admission_no
                          ? <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{t.leads.admission_no}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {t.leads?.pre_admission_no
                          ? <span className="font-mono text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md">{t.leads.pre_admission_no}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {t.payment_status === "paid" && t.fee_amount > 0 ? (
                          <button
                            onClick={() => setReceipt({
                              type: "application_fee",
                              application_id: t.application_id,
                              applicant_name: t.full_name,
                              phone: t.phone,
                              email: t.email || undefined,
                              amount: t.fee_amount,
                              payment_ref: t.payment_ref,
                              payment_date: t.updated_at,
                            })}
                            className="flex items-center gap-1.5 rounded-lg border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                          >
                            <Receipt className="h-3.5 w-3.5" /> Receipt
                          </button>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loadingApp && !errorApp && filteredApps.length > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              Showing {filteredApps.length} of {appTxns.length} records
              {filteredApps.length > 0 && (
                <span className="ml-3 font-medium text-foreground">
                  Total shown: {fmtAmount(filteredApps.reduce((s, t) => s + (t.payment_status === "paid" ? (t.fee_amount || 0) : 0), 0))} collected
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Student Payment Table ── */}
      {tab === "students" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loadingStudent ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : errorStudent ? (
            <div className="flex items-center gap-3 px-6 py-8 text-destructive text-sm">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{errorStudent}</span>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-16 text-center">
              <Banknote className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payment records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Receipt No</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Student</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Phone</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground text-right">Amount</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Mode</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Transaction Ref</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Admission No</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Recorded By</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {fmtDate(p.paid_at)}
                      </td>
                      <td className="px-4 py-3">
                        {p.receipt_no
                          ? <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded-md text-foreground">{p.receipt_no}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{p.students?.name || "—"}</p>
                        {p.students?.email && <p className="text-xs text-muted-foreground">{p.students.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{p.students?.phone || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                        {fmtAmount(p.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${MODE_COLORS[p.payment_mode] || "bg-muted text-muted-foreground"}`}>
                          {p.payment_mode.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.transaction_ref
                          ? <span className="font-mono text-xs text-muted-foreground">{p.transaction_ref}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {p.students?.admission_no
                          ? <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">{p.students.admission_no}</span>
                          : p.students?.pre_admission_no
                          ? <span className="font-mono text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md">{p.students.pre_admission_no}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.profiles?.display_name || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setReceipt({
                            type: "student_fee",
                            receipt_no: p.receipt_no || undefined,
                            student_name: p.students?.name || undefined,
                            admission_no: p.students?.admission_no || p.students?.pre_admission_no || undefined,
                            payment_mode: p.payment_mode,
                            recorded_by: p.profiles?.display_name || undefined,
                            amount: p.amount,
                            payment_ref: p.transaction_ref,
                            payment_date: p.paid_at,
                          })}
                          className="flex items-center gap-1.5 rounded-lg border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                        >
                          <Receipt className="h-3.5 w-3.5" /> Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loadingStudent && !errorStudent && filteredStudents.length > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              Showing {filteredStudents.length} of {studentPmts.length} records
              <span className="ml-3 font-medium text-foreground">
                Total shown: {fmtAmount(filteredStudents.reduce((s, p) => s + (p.amount || 0), 0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
