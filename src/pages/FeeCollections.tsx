import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import {
  Search, IndianRupee, Plus, Loader2, Receipt, CheckCircle,
  Clock, AlertTriangle, Filter, Calendar,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const modeBadge: Record<string, string> = {
  online: "bg-pastel-blue", cash: "bg-pastel-green", cheque: "bg-pastel-yellow",
  upi: "bg-pastel-purple", bank_transfer: "bg-pastel-mint",
};

const FeeCollections = () => {
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [modeFilter, setModeFilter] = useState("all");
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const { selectedCampusId } = useCampus();

  useEffect(() => {
    fetchPayments();
  }, [selectedCampusId, dateFilter]);

  const fetchPayments = async () => {
    setLoading(true);
    const startOfDay = `${dateFilter}T00:00:00`;
    const endOfDay = `${dateFilter}T23:59:59`;

    const { data } = await supabase
      .from("payments")
      .select("*, students:student_id(name, admission_no, campus_id), profiles!recorded_by(display_name)")
      .gte("paid_at", startOfDay)
      .lte("paid_at", endOfDay)
      .order("paid_at", { ascending: false })
      .limit(500);

    if (data) setPayments(data);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = payments;
    if (selectedCampusId !== "all") {
      result = result.filter((p: any) => p.students?.campus_id === selectedCampusId);
    }
    if (modeFilter !== "all") {
      result = result.filter((p: any) => p.payment_mode === modeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p: any) =>
        (p.students?.name || "").toLowerCase().includes(q) ||
        (p.students?.admission_no || "").toLowerCase().includes(q) ||
        (p.receipt_no || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [payments, selectedCampusId, modeFilter, search]);

  const todayTotal = filtered.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const cashTotal = filtered.filter((p: any) => p.payment_mode === "cash").reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const onlineTotal = filtered.filter((p: any) => p.payment_mode !== "cash").reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  const isToday = dateFilter === new Date().toISOString().slice(0, 10);

  return (
    <>
      <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Fee Collections</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isToday ? "Today's" : new Date(dateFilter).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} collections and receipts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="gap-2"><Plus className="h-4 w-4" /> Record Payment</Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-green mb-4">
                <IndianRupee className="h-5 w-5 text-foreground/70" />
              </div>
              <p className="text-3xl font-bold text-foreground">₹{(todayTotal / 1000).toFixed(1)}K</p>
              <p className="text-sm text-muted-foreground mt-0.5">{isToday ? "Today's" : "Day's"} Collections</p>
              <p className="text-xs font-medium mt-1 text-primary">{filtered.length} transactions</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-blue mb-4">
                <Receipt className="h-5 w-5 text-foreground/70" />
              </div>
              <p className="text-3xl font-bold text-foreground">₹{(cashTotal / 1000).toFixed(1)}K</p>
              <p className="text-sm text-muted-foreground mt-0.5">Cash</p>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-pastel-purple mb-4">
                <CheckCircle className="h-5 w-5 text-foreground/70" />
              </div>
              <p className="text-3xl font-bold text-foreground">₹{(onlineTotal / 1000).toFixed(1)}K</p>
              <p className="text-sm text-muted-foreground mt-0.5">Online / UPI</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text" placeholder="Search student, admission no, receipt..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
                className="rounded-xl border border-input bg-card py-2.5 pl-10 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <select
              value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}
              className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">All Modes</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Head</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        {isToday ? "No collections recorded today yet" : "No collections on this date"}
                      </td>
                    </tr>
                  ) : filtered.map((p: any) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.students?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.students?.admission_no || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.fee_description || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">₹{Number(p.amount).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-[10px] font-medium border-0 capitalize ${modeBadge[p.payment_mode] || "bg-muted"}`}>
                          {(p.payment_mode || "").replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-primary font-semibold">{p.receipt_no || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(p.paid_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                      </td>
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
      </div>
    </>
  );
};

export default FeeCollections;
