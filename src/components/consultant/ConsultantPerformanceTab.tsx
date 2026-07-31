import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Search } from "lucide-react";

type Row = {
  consultant_id: string;
  consultant_name: string;
  phone: string | null;
  stage: string;
  payout_model: string | null;
  leads_entered: number;
  applications: number;
  token_paid: number;
  admissions: number;
  payout_total: number;
  payout_pending: number;
  payout_paid: number;
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export const ConsultantPerformanceTab = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await (supabase.from("consultant_performance" as any) as any)
        .select("*")
        .order("leads_entered", { ascending: false });
      setRows((data || []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () => rows.filter(r => !search || r.consultant_name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  const totals = useMemo(() => filtered.reduce((t, r) => ({
    leads_entered: t.leads_entered + r.leads_entered,
    applications: t.applications + r.applications,
    token_paid: t.token_paid + r.token_paid,
    admissions: t.admissions + r.admissions,
    payout_pending: t.payout_pending + Number(r.payout_pending),
  }), { leads_entered: 0, applications: 0, token_paid: 0, admissions: 0, payout_pending: 0 }), [filtered]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Search consultants..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Consultant</th>
                <th className="px-3 py-3 font-medium text-right">Leads Entered</th>
                <th className="px-3 py-3 font-medium text-right">Applications</th>
                <th className="px-3 py-3 font-medium text-right">Token Paid</th>
                <th className="px-3 py-3 font-medium text-right">Admissions</th>
                <th className="px-4 py-3 font-medium text-right">Payout Pending</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.consultant_id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{r.consultant_name}</span>
                    {r.phone && <span className="ml-2 text-xs text-muted-foreground">{r.phone}</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.leads_entered}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.applications}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.token_paid}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-foreground">{r.admissions}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{inr(r.payout_pending)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No consultants found</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t border-border/60 bg-muted/20 font-medium text-foreground">
                  <td className="px-4 py-3">Total ({filtered.length})</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.leads_entered}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.applications}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.token_paid}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{totals.admissions}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.payout_pending)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
};
