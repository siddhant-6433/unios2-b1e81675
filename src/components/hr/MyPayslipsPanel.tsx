// Employee self-service payslips — the "My Payslips" tab in My HR.
//
// `my_payslips()` already narrows to the signed-in employee and to released
// (locked/paid) cycles, so there is nothing to filter here. The list shows the
// headline totals; the itemisation is fetched on demand by PayslipDialog or by
// the per-row download, so opening the tab never pulls component rows it will
// not show.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import { PayslipDialog } from "@/components/hr/PayslipDialog";
import {
  buildPayslipPdf,
  payslipFileName,
  payslipPeriodLabel,
  type PayslipComponent,
  type PayslipLine,
} from "@/lib/payslip";

interface MyPayslipRow {
  line_id: string;
  cycle_id: string;
  cycle_name: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  monthly_gross: number;
  total_days: number;
  payable_days: number;
  lop_days: number;
  gross_earnings: number;
  total_deductions: number;
  employer_cost: number;
  net_pay: number;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

// my_payslips / payslip_detail aren't in the generated Database types yet, so
// the RPCs are reached through an untyped signature rather than `any`.
const rpc = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** The RPC names the key `line_id`; the dialog speaks the table's `id`. */
const toLine = (r: MyPayslipRow): PayslipLine => ({
  id: r.line_id,
  period_start: r.period_start,
  period_end: r.period_end,
  cycle_name: r.cycle_name,
  status: r.status,
  monthly_gross: r.monthly_gross,
  total_days: r.total_days,
  payable_days: r.payable_days,
  lop_days: r.lop_days,
  gross_earnings: r.gross_earnings,
  total_deductions: r.total_deductions,
  employer_cost: r.employer_cost,
  net_pay: r.net_pay,
});

export function MyPayslipsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MyPayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PayslipLine | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpc("my_payslips");
    if (error) {
      toast({ title: "Could not load your payslips", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data as MyPayslipRow[]) ?? []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPayslip = (r: MyPayslipRow) => {
    setSelected(toLine(r));
    setDialogOpen(true);
  };

  const download = async (r: MyPayslipRow) => {
    setBusyId(r.line_id);
    const { data, error } = await rpc("payslip_detail", { _line_id: r.line_id });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not generate the PDF", description: error.message, variant: "destructive" });
      return;
    }
    const line = toLine(r);
    try {
      buildPayslipPdf({ components: (data as PayslipComponent[]) ?? [] }, line).save(payslipFileName(line));
    } catch (err) {
      toast({
        title: "Could not generate the PDF",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (loading) return <PageLoader className="min-h-[40vh]" label="Loading payslips…" />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No payslips released yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Payslips appear here once a payroll cycle is locked or marked paid.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Released payslips only. Open one to see the full earnings and deductions breakdown, or
        download it as a PDF.
      </p>

      <div className="rounded-xl border border-border overflow-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium text-right">Gross earnings</th>
              <th className="px-3 py-2 font-medium text-right">Deductions</th>
              <th className="px-3 py-2 font-medium text-right">Net pay</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const line = toLine(r);
              return (
                <tr
                  key={r.line_id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => openPayslip(r)}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-foreground">{payslipPeriodLabel(line)}</span>
                    {(r.period_start || r.period_end) && (
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        {r.period_start} → {r.period_end}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{inr(r.gross_earnings)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {inr(r.total_deductions)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{inr(r.net_pay)}</td>
                  <td className="px-3 py-2.5">
                    <Badge
                      variant="outline"
                      className={
                        r.status === "paid"
                          ? "border-emerald-600/30 text-emerald-700 capitalize"
                          : "border-primary/30 text-primary capitalize"
                      }
                    >
                      {r.status ?? "released"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === r.line_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void download(r);
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      {busyId === r.line_id ? "Preparing…" : "Download"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PayslipDialog line={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

export default MyPayslipsPanel;
