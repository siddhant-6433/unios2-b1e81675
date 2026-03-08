import { useState } from "react";
import { mockFees, mockPayments, mockFeeStructures } from "@/data/mockData";
import {
  Search, Filter, IndianRupee, Download, Plus, CreditCard,
  FileText, BarChart3, AlertTriangle, CheckCircle, Clock,
  ArrowUpRight, ChevronRight, MoreHorizontal, Receipt, Wallet
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusStyles: Record<string, string> = {
  Paid: "bg-pastel-green text-foreground/80",
  Due: "bg-pastel-yellow text-foreground/80",
  Overdue: "bg-pastel-red text-foreground/80",
};

const statusIcons: Record<string, typeof CheckCircle> = {
  Paid: CheckCircle,
  Due: Clock,
  Overdue: AlertTriangle,
};

const categoryBadge: Record<string, string> = {
  tuition: "bg-pastel-blue text-foreground/70",
  lab: "bg-pastel-purple text-foreground/70",
  enrollment: "bg-pastel-orange text-foreground/70",
  library: "bg-pastel-green text-foreground/70",
  token: "bg-primary/15 text-primary",
  hostel: "bg-pastel-mint text-foreground/70",
  transport: "bg-pastel-yellow text-foreground/70",
  other: "bg-muted text-foreground/70",
};

const modeBadge: Record<string, string> = {
  online: "bg-pastel-blue",
  cash: "bg-pastel-green",
  cheque: "bg-pastel-yellow",
  upi: "bg-pastel-purple",
  bank_transfer: "bg-pastel-mint",
};

const Finance = () => {
  const [tab, setTab] = useState<"ledger" | "payments" | "structures" | "reports">("ledger");
  const [search, setSearch] = useState("");

  const filtered = mockFees.filter(
    (f) => f.studentName.toLowerCase().includes(search.toLowerCase()) || f.admissionNo.toLowerCase().includes(search.toLowerCase())
  );

  const totalCollected = mockFees.reduce((s, f) => s + f.paidAmount, 0);
  const totalDue = mockFees.reduce((s, f) => s + f.balance, 0);
  const totalOverdue = mockFees.filter((f) => f.status === "Overdue").reduce((s, f) => s + f.balance, 0);
  const paidCount = mockFees.filter(f => f.status === "Paid").length;

  const tabs = [
    { id: "ledger" as const, label: "Fee Ledger", icon: FileText },
    { id: "payments" as const, label: "Payments", icon: CreditCard },
    { id: "structures" as const, label: "Fee Structures", icon: Wallet },
    { id: "reports" as const, label: "Reports", icon: BarChart3 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Fee structures, ledger, payments & financial reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> Record Payment
          </Button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Collected", value: `₹${(totalCollected / 100000).toFixed(1)}L`, sub: `${paidCount} items paid`, icon: IndianRupee, iconBg: "bg-pastel-green" },
          { label: "Total Due", value: `₹${(totalDue / 100000).toFixed(1)}L`, sub: "Pending balance", icon: Clock, iconBg: "bg-pastel-yellow" },
          { label: "Overdue", value: `₹${(totalOverdue / 100000).toFixed(1)}L`, sub: "Action required", icon: AlertTriangle, iconBg: "bg-pastel-red" },
          { label: "Payments Today", value: mockPayments.length.toString(), sub: "Transactions", icon: Receipt, iconBg: "bg-pastel-blue" },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Fee Ledger Tab ── */}
      {tab === "ledger" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by student name or admission no..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" /> Filter
            </Button>
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
                  {filtered.map((fee) => {
                    const StatusIcon = statusIcons[fee.status];
                    return (
                      <tr key={fee.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{fee.studentName}</td>
                        <td className="px-4 py-3">
                          <span className={`font-mono text-xs ${fee.admissionNo.includes("PRE") ? "text-primary/70" : "text-muted-foreground"}`}>
                            {fee.admissionNo}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{fee.feeCode}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[10px] font-medium border-0 capitalize ${categoryBadge[fee.feeCategory] || "bg-muted"}`}>
                            {fee.feeCategory}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{fee.term}</td>
                        <td className="px-4 py-3 text-right text-foreground">₹{fee.totalAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-foreground">₹{fee.paidAmount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">₹{fee.balance.toLocaleString()}</td>
                        <td className="px-4 py-3 text-muted-foreground">{fee.dueDate}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[11px] font-medium border-0 gap-1 ${statusStyles[fee.status]}`}>
                            <StatusIcon className="h-3 w-3" />
                            {fee.status}
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

      {/* ── Payments Tab ── */}
      {tab === "payments" && (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Recent Payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Code</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mode</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {mockPayments.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-primary font-semibold">{p.receiptNo}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{p.studentName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.admissionNo}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.feeCode}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₹{p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] font-medium border-0 capitalize ${modeBadge[p.mode] || "bg-muted"}`}>
                        {p.mode.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.transactionRef || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.paidAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ── Fee Structures Tab ── */}
      {tab === "structures" && (
        <div className="space-y-4">
          {mockFeeStructures.map((fs) => (
            <Card key={fs.id} className="border-border/60 shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{fs.course} — {fs.session}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">{fs.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[11px] border-0 ${fs.isActive ? "bg-pastel-green text-foreground/70" : "bg-muted text-muted-foreground"}`}>
                      {fs.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
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
                    {fs.items.map((item, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{item.feeCode}</td>
                        <td className="px-4 py-2.5 text-foreground">{item.feeName}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-[10px] font-medium border-0 capitalize ${categoryBadge[item.category] || "bg-muted"}`}>
                            {item.category}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{item.term}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">₹{item.amount.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-center text-muted-foreground">{item.dueDay}th</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t border-border bg-muted/30 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {fs.items.length} fee items · Total yearly: ₹{fs.items.reduce((s, i) => s + i.amount, 0).toLocaleString()}
                  </span>
                  <Button variant="link" size="sm" className="text-primary gap-1 px-0 text-xs">
                    Edit structure <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Reports Tab ── */}
      {tab === "reports" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/60 shadow-none">
            <CardHeader><CardTitle className="text-base font-semibold">Collection by Category</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { cat: "Tuition", amount: 205000, total: 355000, color: "bg-primary" },
                { cat: "Lab", amount: 15000, total: 30000, color: "bg-chart-2" },
                { cat: "Token", amount: 55000, total: 55000, color: "bg-chart-3" },
                { cat: "Enrollment", amount: 0, total: 8000, color: "bg-chart-5" },
              ].map((item) => (
                <div key={item.cat} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{item.cat}</span>
                    <span className="text-muted-foreground">₹{item.amount.toLocaleString()} / ₹{item.total.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} style={{ width: `${(item.amount / item.total) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-none">
            <CardHeader><CardTitle className="text-base font-semibold">Fee → Attendance Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="rounded-xl bg-muted/50 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">College Students</h4>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>PAN (Token/10%)</span><Badge className="bg-pastel-yellow text-foreground/70 text-[10px] border-0">Pre-admitted</Badge></div>
                    <div className="flex justify-between"><span>AN (25% paid)</span><Badge className="bg-pastel-green text-foreground/70 text-[10px] border-0">Attendance enabled</Badge></div>
                    <div className="flex justify-between"><span>+90 days (50%)</span><Badge className="bg-pastel-orange text-foreground/70 text-[10px] border-0">Else block</Badge></div>
                    <div className="flex justify-between"><span>+180 days (75%)</span><Badge className="bg-pastel-red text-foreground/70 text-[10px] border-0">Escalation</Badge></div>
                    <div className="flex justify-between"><span>+270 days (100%)</span><Badge className="bg-destructive text-destructive-foreground text-[10px] border-0">Mandatory</Badge></div>
                  </div>
                </div>
                <div className="rounded-xl bg-muted/50 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">School Students</h4>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Q1 (Apr–Jun)</span><span>Due by 10th</span></div>
                    <div className="flex justify-between"><span>Q2 (Jul–Sep)</span><span>Due by 10th</span></div>
                    <div className="flex justify-between"><span>Q3 (Oct–Dec)</span><span>Due by 10th</span></div>
                    <div className="flex justify-between"><span>Q4 (Jan–Mar)</span><span>Due by 10th</span></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Finance;
