import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/hrReports";
import {
  HEADLINE_METRICS,
  metricValue,
  metricLabel,
  formatMetric,
  funnelMatrix,
  acceptanceTone,
  defaultRange,
  type MetricRow,
  type FunnelRow,
} from "@/lib/recruitmentMetrics";

export function RecruitmentAnalyticsPanel() {
  const { can } = usePermissions();
  const canView = can("hr", "view");
  const [range, setRange] = useState(() => defaultRange());
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [m, f] = await Promise.all([
        supabase.rpc("hr_recruitment_metrics" as never, { _from: range.from, _to: range.to } as never),
        supabase.rpc("hr_recruitment_funnel" as never, { _from: range.from, _to: range.to } as never),
      ]);
      if (cancelled) return;
      setMetrics((m.data as MetricRow[]) ?? []);
      setFunnel((f.data as FunnelRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [canView, range.from, range.to]);

  const { statuses, sources, cell } = useMemo(() => funnelMatrix(funnel), [funnel]);
  const statusTotals = useMemo(
    () => statuses.map((s) => funnel.filter((r) => r.status === s).reduce((n, r) => n + Number(r.applicants || 0), 0)),
    [statuses, funnel],
  );

  if (!canView) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center text-sm text-muted-foreground">
        You need HR view access to see recruitment analytics.
      </div>
    );
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="ml-2 rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="ml-2 rounded-lg border border-input bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {HEADLINE_METRICS.map((key) => {
          const value = metricValue(metrics, key);
          const isPct = key === "offer_acceptance_pct";
          return (
            <div key={key} className="rounded-xl bg-card card-shadow p-3.5">
              <p className="text-[11px] text-muted-foreground">{metricLabel(key)}</p>
              <p className="mt-1 text-xl font-bold text-foreground">
                {isPct ? (
                  <Badge className={`border-0 ${acceptanceTone(value)}`}>{formatMetric(key, value)}</Badge>
                ) : (
                  formatMetric(key, value)
                )}
              </p>
            </div>
          );
        })}
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Pipeline funnel</CardTitle>
            <Button
              size="sm" variant="outline" className="gap-1.5"
              disabled={funnel.length === 0}
              onClick={() => downloadCsv(
                `recruitment-funnel-${range.from}_${range.to}.csv`,
                funnel.map((r) => ({ status: r.status, source: r.source ?? "unknown", applicants: r.applicants })),
              )}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  {sources.map((s) => (
                    <th key={s} className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">{s}</th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody>
                {statuses.length === 0 ? (
                  <tr><td colSpan={sources.length + 2} className="px-4 py-10 text-center text-muted-foreground">No applicants in this range</td></tr>
                ) : statuses.map((status, i) => (
                  <tr key={status} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 capitalize font-medium text-foreground">{status.replace(/_/g, " ")}</td>
                    {sources.map((s) => (
                      <td key={s} className="px-4 py-2.5 text-right text-muted-foreground">{cell(status, s) || "—"}</td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-semibold text-foreground">{statusTotals[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default RecruitmentAnalyticsPanel;
