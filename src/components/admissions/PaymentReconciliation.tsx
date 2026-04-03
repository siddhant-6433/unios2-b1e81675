import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, IndianRupee, Search } from "lucide-react";

interface PaymentRow {
  lead_id: string;
  name: string;
  phone: string;
  stage: string;
  course_id: string | null;
  campus_id: string | null;
  application_fee_paid: number;
  token_fee_paid: number;
  total_paid: number;
  offer_amount: number | null;
  token_amount: number | null;
  token_balance: number;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

export function PaymentReconciliation() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "pending">("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lead_payment_summary" as any)
        .select("*")
        .order("name");
      if (data) setRows(data as any);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((r) => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search);
    const matchFilter =
      filter === "all" ||
      (filter === "paid" && r.total_paid > 0) ||
      (filter === "pending" && r.total_paid === 0 && r.stage !== "rejected");
    return matchSearch && matchFilter;
  });

  const totals = filtered.reduce(
    (acc, r) => ({
      appFee: acc.appFee + Number(r.application_fee_paid),
      tokenFee: acc.tokenFee + Number(r.token_fee_paid),
      total: acc.total + Number(r.total_paid),
    }),
    { appFee: 0, tokenFee: 0, total: 0 }
  );

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{fmt(totals.appFee)}</p>
            <p className="text-xs text-muted-foreground">Application Fees Collected</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{fmt(totals.tokenFee)}</p>
            <p className="text-xs text-muted-foreground">Token Fees Collected</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{fmt(totals.total)}</p>
            <p className="text-xs text-muted-foreground">Total Collected</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex rounded-xl border border-input bg-card p-0.5">
          {(["all", "paid", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? `All (${rows.length})` : f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">App Fee</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Token Fee</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Paid</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Token Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.lead_id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/admissions/${r.lead_id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">{STAGE_LABELS[r.stage] || r.stage}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${Number(r.application_fee_paid) > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {Number(r.application_fee_paid) > 0 ? fmt(r.application_fee_paid) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${Number(r.token_fee_paid) > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {Number(r.token_fee_paid) > 0 ? fmt(r.token_fee_paid) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-foreground">{Number(r.total_paid) > 0 ? fmt(r.total_paid) : "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.token_amount && Number(r.token_amount) > 0 ? (
                      <span className={`font-medium ${Number(r.token_balance) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {Number(r.token_balance) > 0 ? fmt(r.token_balance) : "Paid"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No payment records found</td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-foreground" colSpan={2}>Total ({filtered.length} leads)</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{fmt(totals.appFee)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{fmt(totals.tokenFee)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{fmt(totals.total)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
