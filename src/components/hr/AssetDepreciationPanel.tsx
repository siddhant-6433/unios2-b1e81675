import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DepRow {
  asset_id: string;
  asset_tag: string;
  name: string;
  category: string | null;
  status: string;
  purchase_date: string | null;
  purchase_cost: number | null;
  salvage_value: number | null;
  depreciation_rate: number | null;
  years_elapsed: number | null;
  book_value: number | null;
}

const inr = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

/**
 * Straight-line written-down value of the asset register. Read-only.
 */
export function AssetDepreciationPanel() {
  const [rows, setRows] = useState<DepRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("hr_asset_depreciation" as never);
      setRows((data as DepRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <PageLoader />;

  const totalCost = rows.reduce((n, r) => n + Number(r.purchase_cost || 0), 0);
  const totalBook = rows.reduce((n, r) => n + Number(r.book_value || 0), 0);

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Depreciation</CardTitle>
          <div className="flex gap-2 text-xs">
            <Badge className="border-0 bg-pastel-blue text-foreground/80">Cost ₹{inr(totalCost)}</Badge>
            <Badge className="border-0 bg-pastel-green text-foreground/80">Book value ₹{inr(totalBook)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rate %/yr</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Age (yrs)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Book value</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No assets recorded yet</td></tr>
              ) : rows.map((r) => (
                <tr key={r.asset_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="text-xs text-muted-foreground"> · {r.asset_tag}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.category || "—"}</td>
                  <td className="px-4 py-2.5 text-right">{inr(r.purchase_cost)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{Number(r.depreciation_rate || 0)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{Number(r.years_elapsed || 0).toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{inr(r.book_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default AssetDepreciationPanel;
