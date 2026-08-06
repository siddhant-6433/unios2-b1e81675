import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import {
  Search, IndianRupee, Download, Plus, CreditCard,
  FileText, BarChart3, AlertTriangle, CheckCircle, Clock,
  Receipt, HandCoins, Settings2, Lock,
} from "lucide-react";
import TransactionHistoryPanel from "@/components/admin/TransactionHistoryPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeeStructureViewer } from "@/components/finance/FeeStructureViewer";
import { ConcessionApprovalPanel } from "@/components/finance/ConcessionApprovalPanel";
import { FinanceOverview } from "@/components/finance/FinanceOverview";
import { OfferWaiverApprovalPanel } from "@/components/finance/OfferWaiverApprovalPanel";
import { LateFeeConfigPanel } from "@/components/finance/LateFeeConfigPanel";
import { PaymentAuditLog } from "@/components/finance/PaymentAuditLog";
import { DayCloserDialog } from "@/components/finance/DayCloserDialog";
import FeeCollections from "./FeeCollections";
import { CashierConsole } from "@/components/finance/CashierConsole";
import { CustomFeeHeadsPanel } from "@/components/finance/CustomFeeHeadsPanel";
import { defaultFeeTermLabel } from "@/lib/feeTermLabels";
import { matchesCampus } from "@/lib/campusFilter";
import { usePermissions } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";

const statusStyles: Record<string, string> = {
  paid: "bg-pastel-green text-foreground/80",
  due: "bg-pastel-yellow text-foreground/80",
  overdue: "bg-pastel-red text-foreground/80",
};
const statusIcons: Record<string, typeof CheckCircle> = { paid: CheckCircle, due: Clock, overdue: AlertTriangle };
const categoryBadge: Record<string, string> = {
  tuition: "bg-pastel-blue text-foreground/70", lab: "bg-pastel-purple text-foreground/70",
  enrollment: "bg-pastel-orange text-foreground/70", library: "bg-pastel-green text-foreground/70",
  token: "bg-primary/15 text-primary", hostel: "bg-pastel-mint text-foreground/70",
  transport: "bg-pastel-yellow text-foreground/70", other: "bg-muted text-foreground/70",
};
type TabId = "collect" | "ledger" | "receipts" | "approvals" | "setup" | "reports";

const Finance = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [ledger, setLedger] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [structures, setStructures] = useState<any[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingWaiverCount, setPendingWaiverCount] = useState(0);
  const [pendingConcessionCount, setPendingConcessionCount] = useState(0);
  const [receiptsView, setReceiptsView] = useState<"receipts" | "online">("receipts");
  const [setupView, setSetupView] = useState<"structures" | "late-fees" | "heads">("structures");
  const [reportsView, setReportsView] = useState<"overview" | "audit">("overview");
  const { selectedCampusId } = useCampus();
  const { can } = usePermissions();
  const { role, hasPermission } = useAuth();
  const canCreateFinance = can("finance", "create");
  const isSuperAdmin = role === "super_admin";
  const canManageSetup = isSuperAdmin || hasPermission("fee_structure:manage");
  const canCloseDay = isSuperAdmin || role === "accountant" || role === "office_admin";
  const [dayCloserOpen, setDayCloserOpen] = useState(false);

  const tabs = useMemo(() => {
    const all: { id: TabId; label: string; icon: typeof FileText; badge: number; show: boolean }[] = [
      { id: "collect",   label: "Collect",   icon: IndianRupee, badge: 0, show: true },
      { id: "receipts",  label: "Receipts",  icon: CreditCard,  badge: 0, show: true },
      { id: "ledger",    label: "Ledger",    icon: FileText,    badge: 0, show: true },
      { id: "approvals", label: "Approvals", icon: HandCoins,   badge: pendingWaiverCount + pendingConcessionCount, show: true },
      { id: "setup",     label: "Setup",     icon: Settings2,   badge: 0, show: canManageSetup },
      { id: "reports",   label: "Reports",   icon: BarChart3,   badge: 0, show: true },
    ];
    return all.filter(t => t.show);
  }, [pendingWaiverCount, pendingConcessionCount, canManageSetup]);

  // The cashier lives in Collect; everyone else opens on Receipts.
  const defaultTab: TabId = role === "accountant" || role === "office_admin" ? "collect" : "receipts";
  const urlTab = searchParams.get("tab") as TabId | null;
  const tab: TabId = tabs.some(t => t.id === urlTab) ? (urlTab as TabId) : defaultTab;
  const setTab = useCallback((next: TabId) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("tab", next);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => { fetchAll(); }, [selectedCampusId]);

  const fetchAll = async () => {
    setLoading(true);
    const [ledgerRes, paymentsRes, structRes, waiverRes, concessionRes, summaryRes] = await Promise.all([
      supabase.from("fee_ledger").select("*, students:student_id(name, admission_no, pre_admission_no, campus_id), fee_codes:fee_code_id(code, name, category)").order("due_date", { ascending: true }).limit(200),
      // v_all_payments unifies pre-admission lead_payments (token / application
      // fees confirmed before AN issuance) with post-admission payments. Without
      // this UNION, Diya's ₹5000 token fee — confirmed in lead_payments — was
      // invisible here. The view exposes flat student fields (person_name,
      // admission_no, campus_id) since lead_payments don't have a student row;
      // we reshape into the legacy {students:{...}} structure so render code
      // below stays unchanged.
      supabase.from("v_all_payments" as any).select("*").order("paid_at", { ascending: false }).limit(500),
      supabase.from("fee_structures").select("*, courses:course_id(name), admission_sessions:session_id(name), fee_structure_items(*, fee_codes:fee_code_id(code, name, category))").order("created_at", { ascending: false }).limit(200),
      // Counts stay count:"planned" — a cheap planner estimate. src/test/
      // hot-list-database-load.test.ts bans exact counts on this page because
      // they force a full scan under RLS. The badge is therefore approximate
      // (~45 against 49 actual); the panels themselves show real, RLS-filtered
      // lists, which is where the precision has to be.
      supabase.from("offer_waivers").select("id", { count: "planned", head: true }).eq("status", "pending"),
      supabase.from("concessions").select("id", { count: "planned", head: true }).in("status", ["pending_principal", "pending_super_admin"]),
      // Header totals come from the server. Summing the .limit(200) ledger slice
      // below reported whatever the first 200 rows by due date happened to add
      // up to, which is not "Total Due".
      (supabase.rpc as any)("finance_summary", {
        _campus_ids: selectedCampusId === "all" ? null : [selectedCampusId],
      }),
    ]);
    if (ledgerRes.data) setLedger(ledgerRes.data);
    if (paymentsRes.data) {
      // Backfill recorded_by display names + reshape to {students,profiles} shape
      const rawPayments = paymentsRes.data as any[];
      const recorderIds = [...new Set(rawPayments.map((p) => p.recorded_by).filter(Boolean))];
      const profMap: Record<string, string> = {};
      if (recorderIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", recorderIds);
        (profs || []).forEach((pr: any) => { profMap[pr.id] = pr.display_name; });
      }
      setPayments(rawPayments.map((p) => ({
        ...p,
        students: { name: p.person_name, admission_no: p.admission_no, campus_id: p.campus_id },
        profiles: p.recorded_by ? { display_name: profMap[p.recorded_by] || null } : null,
      })));
    }
    if (structRes.data) setStructures(structRes.data);
    setPendingWaiverCount(waiverRes.count ?? 0);
    setPendingConcessionCount(concessionRes.count ?? 0);
    if (summaryRes?.data) setSummary(summaryRes.data as Record<string, number>);
    setLoading(false);
  };

  const filteredLedger = useMemo(() => ledger.filter((f: any) => {
    if (!matchesCampus(f.students?.campus_id, selectedCampusId)) return false;
    const name = f.students?.name || "";
    const admNo = f.students?.admission_no || f.students?.pre_admission_no || "";
    return name.toLowerCase().includes(search.toLowerCase()) || admNo.toLowerCase().includes(search.toLowerCase());
  }), [ledger, search, selectedCampusId]);

  const filteredPayments = useMemo(
    () => payments.filter((p: any) => matchesCampus(p.students?.campus_id, selectedCampusId)),
    [payments, selectedCampusId],
  );

  const totalCollected = Number(summary?.collected ?? 0);
  const totalDue = Number(summary?.due ?? 0);
  const totalOverdue = Number(summary?.overdue ?? 0);
  const paidCount = Number(summary?.paid_items ?? 0);

  // CSV of whatever table is on screen — the old Export button did nothing.
  const exportCsv = () => {
    const rows: (string | number)[][] = tab === "ledger"
      ? [["Student", "Admission No", "Fee Code", "Term", "Total", "Paid", "Balance", "Due Date", "Status"],
         ...filteredLedger.map((f: any) => [
           f.students?.name || "", f.students?.admission_no || f.students?.pre_admission_no || "",
           f.fee_codes?.code || "", f.term, f.total_amount, f.paid_amount, f.balance ?? 0, f.due_date, f.status,
         ])]
      : [["Receipt No", "Student", "Admission No", "Amount", "Mode", "Gateway", "Ref", "Recorded By", "Date"],
         ...filteredPayments.map((p: any) => [
           p.receipt_no || "", p.students?.name || "", p.students?.admission_no || "",
           p.amount, p.payment_mode || "", p.gateway || "", p.transaction_ref || "",
           p.profiles?.display_name || "", p.paid_at,
         ])];
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <PageLoader />;

  return (
    <>
    {canCloseDay && <DayCloserDialog open={dayCloserOpen} onOpenChange={setDayCloserOpen} onClosed={fetchAll} />}
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Fee structures, ledger, payments & financial reports</p>
        </div>
        <div className="flex items-center gap-2">
          {(tab === "ledger" || tab === "receipts") && (
            <Button variant="outline" className="gap-2" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export
            </Button>
          )}
          {canCloseDay && (
            <Button variant="outline" className="gap-2" onClick={() => setDayCloserOpen(true)}>
              <Lock className="h-4 w-4" /> Close Day
            </Button>
          )}
          {canCreateFinance && (
            <Button className="gap-2" onClick={() => setTab("collect")}>
              <Plus className="h-4 w-4" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Collected", value: `₹${(totalCollected / 100000).toFixed(1)}L`, sub: `${paidCount} items paid`, icon: IndianRupee, iconBg: "bg-pastel-green" },
          { label: "Total Due", value: `₹${(totalDue / 100000).toFixed(1)}L`, sub: "Pending balance", icon: Clock, iconBg: "bg-pastel-yellow" },
          { label: "Overdue", value: `₹${(totalOverdue / 100000).toFixed(1)}L`, sub: "Action required", icon: AlertTriangle, iconBg: "bg-pastel-red" },
          { label: "Concession", value: `₹${(Number(summary?.concession ?? 0) / 100000).toFixed(1)}L`, sub: `${Number(summary?.total_items ?? 0)} fee items`, icon: Receipt, iconBg: "bg-pastel-blue" },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              {/* the drill-down chevron here never did anything — removed */}
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                <stat.icon className="h-5 w-5 text-foreground/70" />
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" />{t.label}
            {t.badge > 0 && (
              <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${tab === t.id ? "bg-white/20 text-white" : "bg-warning/10 text-warning-foreground"}`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "collect" && <CashierConsole />}

      {tab === "ledger" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="text" placeholder="Search by student name or admission no..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
          </div>
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Adm. No</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Code</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Term</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paid</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLedger.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No fee records found</td></tr>
                  ) : filteredLedger.map((fee: any) => {
                    const StatusIcon = statusIcons[fee.status] || Clock;
                    const admNo = fee.students?.admission_no || fee.students?.pre_admission_no || "—";
                    return (
                      <tr key={fee.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{fee.students?.name || "—"}</td>
                        <td className="px-4 py-3"><span className={`font-mono text-xs ${admNo.includes("PRE") ? "text-primary/70" : "text-muted-foreground"}`}>{admNo}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{fee.fee_codes?.code || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[10px] font-medium border-0 capitalize ${categoryBadge[fee.fee_codes?.category] || "bg-muted"}`}>{fee.fee_codes?.category || "—"}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{defaultFeeTermLabel(fee.term)}</td>
                        <td className="px-4 py-3 text-right text-foreground">₹{Number(fee.total_amount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-foreground">₹{Number(fee.paid_amount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">₹{Number(fee.balance || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 text-muted-foreground">{fee.due_date}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[11px] font-medium border-0 gap-1 capitalize ${statusStyles[fee.status] || "bg-muted"}`}>
                            <StatusIcon className="h-3 w-3" />{fee.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {tab === "receipts" && (
        <SubTabs
          value={receiptsView}
          onChange={(v) => setReceiptsView(v as "receipts" | "online")}
          options={[
            { value: "receipts", label: "Receipts" },
            { value: "online", label: "Online attempts" },
          ]}
        />
      )}

      {tab === "receipts" && receiptsView === "online" && <TransactionHistoryPanel />}

      {tab === "receipts" && receiptsView === "receipts" && <FeeCollections embedded />}

      {tab === "approvals" && (
        <div className="space-y-8">
          <ConcessionApprovalPanel />
          <OfferWaiverApprovalPanel />
        </div>
      )}

      {tab === "setup" && (
        <>
          <SubTabs
            value={setupView}
            onChange={(v) => setSetupView(v as "structures" | "late-fees" | "heads")}
            options={[
              { value: "structures", label: "Fee Structures" },
              { value: "late-fees", label: "Late Fees" },
              { value: "heads", label: "Custom Heads" },
            ]}
          />
          {setupView === "structures" && <FeeStructureViewer showFilter />}
          {setupView === "late-fees" && <LateFeeConfigPanel />}
          {setupView === "heads" && <CustomFeeHeadsPanel />}
        </>
      )}

      {tab === "reports" && (
        <>
          {isSuperAdmin && (
            <SubTabs
              value={reportsView}
              onChange={(v) => setReportsView(v as "overview" | "audit")}
              options={[
                { value: "overview", label: "Overview" },
                { value: "audit", label: "Audit Log" },
              ]}
            />
          )}
          {reportsView === "audit" && isSuperAdmin ? <PaymentAuditLog /> : <FinanceOverview />}
        </>
      )}
    </div>
    </>
  );
};

function SubTabs({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-input bg-card p-1 w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default Finance;
