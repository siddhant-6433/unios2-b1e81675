import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import {
  Search, Filter, IndianRupee, Download, Plus, CreditCard,
  FileText, BarChart3, AlertTriangle, CheckCircle, Clock,
  ArrowUpRight, ChevronRight, MoreHorizontal, Receipt, Wallet, Loader2,
  Globe,
} from "lucide-react";
import TransactionHistoryPanel from "@/components/admin/TransactionHistoryPanel";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
const modeBadge: Record<string, string> = {
  online: "bg-pastel-blue", cash: "bg-pastel-green", cheque: "bg-pastel-yellow",
  upi: "bg-pastel-purple", bank_transfer: "bg-pastel-mint",
};

const Finance = () => {
  const [tab, setTab] = useState<"ledger" | "receipts" | "online-transactions" | "structures" | "reports">("ledger");
  const [search, setSearch] = useState("");
  const [ledger, setLedger] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [structures, setStructures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const { selectedCampusId } = useCampus();

  useEffect(() => { fetchAll(); }, [selectedCampusId]);

  const fetchAll = async () => {
    setLoading(true);
    const [ledgerRes, paymentsRes, structRes] = await Promise.all([
      supabase.from("fee_ledger").select("*, students:student_id(name, admission_no, pre_admission_no, campus_id), fee_codes:fee_code_id(code, name, category)").order("due_date", { ascending: true }).limit(200),
      supabase.from("payments").select("*, students:student_id(name, admission_no, campus_id), profiles!recorded_by(display_name)").order("paid_at", { ascending: false }).limit(500),
      supabase.from("fee_structures").select("*, courses:course_id(name), admission_sessions:session_id(name), fee_structure_items(*, fee_codes:fee_code_id(code, name, category))").order("created_at", { ascending: false }),
    ]);
    if (ledgerRes.data) setLedger(ledgerRes.data);
    if (paymentsRes.data) setPayments(paymentsRes.data);
    if (structRes.data) setStructures(structRes.data);
    setLoading(false);
  };

  const filteredLedger = useMemo(() => ledger.filter((f: any) => {
    if (selectedCampusId !== "all" && f.students?.campus_id !== selectedCampusId) return false;
    const name = f.students?.name || "";
    const admNo = f.students?.admission_no || f.students?.pre_admission_no || "";
    return name.toLowerCase().includes(search.toLowerCase()) || admNo.toLowerCase().includes(search.toLowerCase());
  }), [ledger, search, selectedCampusId]);

  const filteredPayments = useMemo(() =>
    selectedCampusId === "all"
      ? payments
      : payments.filter((p: any) => p.students?.campus_id === selectedCampusId),
  [payments, selectedCampusId]);

  const totalCollected = filteredLedger.reduce((s: number, f: any) => s + Number(f.paid_amount || 0), 0);
  const totalDue = filteredLedger.reduce((s: number, f: any) => s + Number(f.balance || 0), 0);
  const totalOverdue = filteredLedger.filter((f: any) => f.status === "overdue").reduce((s: number, f: any) => s + Number(f.balance || 0), 0);
  const paidCount = filteredLedger.filter((f: any) => f.status === "paid").length;

  const tabs = [
    { id: "ledger" as const,               label: "Fee Ledger",          icon: FileText },
    { id: "receipts" as const,             label: "Receipts",            icon: CreditCard },
    { id: "online-transactions" as const,  label: "Online Transactions", icon: Globe },
    { id: "structures" as const,           label: "Fee Structures",      icon: Wallet },
    { id: "reports" as const,              label: "Reports",             icon: BarChart3 },
  ];

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <>
    <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Fee structures, ledger, payments & financial reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> Export</Button>
          <Button className="gap-2"><Plus className="h-4 w-4" /> Record Payment</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Collected", value: `₹${(totalCollected / 100000).toFixed(1)}L`, sub: `${paidCount} items paid`, icon: IndianRupee, iconBg: "bg-pastel-green" },
          { label: "Total Due", value: `₹${(totalDue / 100000).toFixed(1)}L`, sub: "Pending balance", icon: Clock, iconBg: "bg-pastel-yellow" },
          { label: "Overdue", value: `₹${(totalOverdue / 100000).toFixed(1)}L`, sub: "Action required", icon: AlertTriangle, iconBg: "bg-pastel-red" },
          { label: "Receipts", value: String(filteredPayments.length), sub: "Transactions", icon: Receipt, iconBg: "bg-pastel-blue" },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><ArrowUpRight className="h-4 w-4" /></Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

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
                        <td className="px-4 py-3 text-muted-foreground">{fee.term}</td>
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
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">All Receipts</CardTitle>
              <span className="text-xs text-muted-foreground">{filteredPayments.length} records</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Head</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mode</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transaction Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recorded By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Download</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No receipts recorded</td></tr>
                ) : filteredPayments.map((p: any) => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-primary font-semibold">{p.receipt_no || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.students?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.students?.admission_no || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{p.fee_description || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₹{Number(p.amount).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] font-medium border-0 capitalize ${modeBadge[p.payment_mode] || "bg-muted"}`}>{p.payment_mode.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.transaction_ref || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{p.profiles?.display_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(p.paid_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setReceipt({
                          type: "student_fee",
                          receipt_no: p.receipt_no || undefined,
                          student_name: p.students?.name || undefined,
                          admission_no: p.students?.admission_no || undefined,
                          payment_mode: p.payment_mode,
                          fee_description: p.fee_description || undefined,
                          recorded_by: p.profiles?.display_name || undefined,
                          amount: Number(p.amount),
                          payment_ref: p.transaction_ref,
                          payment_date: p.paid_at,
                        })}
                        className="flex items-center gap-1.5 rounded-lg border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                      >
                        <Receipt className="h-3.5 w-3.5" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "online-transactions" && <TransactionHistoryPanel />}

      {tab === "structures" && (
        <div className="space-y-4">
          {structures.length === 0 ? (
            <Card className="border-border/60"><CardContent className="py-16 text-center">
              <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No fee structures configured yet</p>
            </CardContent></Card>
          ) : structures.map((fs: any) => (
            <Card key={fs.id} className="border-border/60 shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{fs.courses?.name || "—"} — {fs.admission_sessions?.name || "—"}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">{fs.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[11px] border-0 ${fs.is_active ? "bg-pastel-green text-foreground/70" : "bg-muted text-muted-foreground"}`}>
                      {fs.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><MoreHorizontal className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-t border-border bg-muted/50">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Code</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Term</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fs.fee_structure_items || []).map((item: any, i: number) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{item.fee_codes?.code || "—"}</td>
                        <td className="px-4 py-2.5 text-foreground">{item.fee_codes?.name || "—"}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-[10px] font-medium border-0 capitalize ${categoryBadge[item.fee_codes?.category] || "bg-muted"}`}>
                            {item.fee_codes?.category || "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{item.term}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">₹{Number(item.amount).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-center text-muted-foreground">{item.due_day}th</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {(fs.fee_structure_items || []).length} fee items · Total yearly: ₹{(fs.fee_structure_items || []).reduce((s: number, i: any) => s + Number(i.amount), 0).toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "reports" && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Financial reports will be generated from live data</p>
          </CardContent>
        </Card>
      )}
    </div>
    </>
  );
};

export default Finance;
