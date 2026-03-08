import { useState } from "react";
import { mockFees } from "@/data/mockData";
import { Search, Filter, IndianRupee, Download } from "lucide-react";

const statusStyles: Record<string, string> = {
  Paid: "bg-pastel-green text-foreground/80",
  Due: "bg-pastel-yellow text-foreground/80",
  Overdue: "bg-pastel-red text-foreground/80",
};

const Finance = () => {
  const [tab, setTab] = useState<"ledger" | "payments" | "reports">("ledger");
  const [search, setSearch] = useState("");

  const filtered = mockFees.filter(
    (f) => f.studentName.toLowerCase().includes(search.toLowerCase()) || f.admissionNo.toLowerCase().includes(search.toLowerCase())
  );

  const totalCollected = mockFees.reduce((s, f) => s + f.paidAmount, 0);
  const totalDue = mockFees.reduce((s, f) => s + f.balance, 0);
  const totalOverdue = mockFees.filter((f) => f.status === "Overdue").reduce((s, f) => s + f.balance, 0);

  const tabs = [
    { id: "ledger" as const, label: "Fee Ledger" },
    { id: "payments" as const, label: "Payments" },
    { id: "reports" as const, label: "Reports" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Finance</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage fees, payments & financial reports.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-card p-5 card-shadow">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-green">
              <IndianRupee className="h-5 w-5 text-foreground/70" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Collected</p>
              <p className="text-xl font-bold text-foreground">₹{totalCollected.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-card p-5 card-shadow">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-yellow">
              <IndianRupee className="h-5 w-5 text-foreground/70" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Due</p>
              <p className="text-xl font-bold text-foreground">₹{totalDue.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-card p-5 card-shadow">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pastel-red">
              <IndianRupee className="h-5 w-5 text-foreground/70" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Overdue</p>
              <p className="text-xl font-bold text-foreground">₹{totalOverdue.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ledger" && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by student name or admission no..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <button className="flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors">
              <Filter className="h-4 w-4" />
              Filter
            </button>
            <button className="flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>

          <div className="rounded-xl bg-card card-shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Adm. No</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Term</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((fee) => (
                  <tr key={fee.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{fee.studentName}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fee.admissionNo}</td>
                    <td className="px-4 py-3 text-foreground">{fee.feeCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fee.term}</td>
                    <td className="px-4 py-3 text-right text-foreground">₹{fee.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-foreground">₹{fee.paidAmount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₹{fee.balance.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fee.dueDate}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-md px-2.5 py-1 text-xs font-medium ${statusStyles[fee.status]}`}>
                        {fee.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "payments" && (
        <div className="rounded-xl bg-card p-12 card-shadow text-center">
          <IndianRupee className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-foreground">Payment Collection</h3>
          <p className="text-sm text-muted-foreground mt-1">Record and manage fee payments here.</p>
        </div>
      )}

      {tab === "reports" && (
        <div className="rounded-xl bg-card p-12 card-shadow text-center">
          <Download className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-foreground">Financial Reports</h3>
          <p className="text-sm text-muted-foreground mt-1">Generate and download financial reports.</p>
        </div>
      )}
    </div>
  );
};

export default Finance;
