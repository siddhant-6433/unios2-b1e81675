// One employee's payslip, in a dialog.
//
// The itemisation is read live from `payslip_detail` rather than reconstructed
// from the line totals: a released payslip's components are the snapshot the
// employee was paid against, so the detail view and the PDF must agree exactly.
// The line itself is passed in (payroll admin already has it; self-service gets
// it from `my_payslips`), which keeps this component free of any line query of
// its own.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import {
  buildPayslipPdf,
  deductionsOf,
  earningsOf,
  employerContribOf,
  netPayLabel,
  payslipFileName,
  payslipPeriodLabel,
  type PayslipComponent,
  type PayslipLine,
} from "@/lib/payslip";

export interface PayslipDialogProps {
  /** Payslip to show. `null` simply renders nothing. */
  line: PayslipLine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

// payslip_detail isn't in the generated Database types yet, so the RPC is
// reached through an untyped signature rather than `any`.
const rpc = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function Line({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-semibold text-foreground tabular-nums" : "text-foreground tabular-nums"}>
        {inr(amount)}
      </span>
    </div>
  );
}

function Column({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: PayslipComponent[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border/60 px-3">
        {rows.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">None</p>
        ) : (
          rows.map((c) => <Line key={`${c.component_code}-${c.display_order}`} label={c.component_name} amount={c.amount} />)
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">{totalLabel}</span>
        <span className="font-semibold text-foreground tabular-nums">{inr(total)}</span>
      </div>
    </div>
  );
}

export function PayslipDialog({ line, open, onOpenChange }: PayslipDialogProps) {
  const { toast } = useToast();
  const [components, setComponents] = useState<PayslipComponent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !line?.id) {
      setComponents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await rpc("payslip_detail", { _line_id: line.id });
      if (cancelled) return;
      if (error) {
        toast({ title: "Could not load the payslip", description: error.message, variant: "destructive" });
        setComponents([]);
      } else {
        setComponents((data as PayslipComponent[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, line?.id, toast]);

  const download = () => {
    if (!line) return;
    try {
      buildPayslipPdf({ components }, line).save(payslipFileName(line));
    } catch (err) {
      toast({
        title: "Could not generate the PDF",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  if (!line) return null;

  const earnings = components
    .filter((c) => c.kind === "earning")
    .sort((a, b) => a.display_order - b.display_order);
  const deductions = components
    .filter((c) => c.kind === "deduction")
    .sort((a, b) => a.display_order - b.display_order);
  const employer = components
    .filter((c) => c.kind === "employer_contribution")
    .sort((a, b) => a.display_order - b.display_order);

  const earned = earningsOf(components);
  const withheld = deductionsOf(components);
  const employerTotal = employerContribOf(components);
  const net = Number(line.net_pay ?? earned - withheld);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-x-2">
            Payslip
            <span className="text-sm font-normal text-muted-foreground">{payslipPeriodLabel(line)}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <PageLoader className="min-h-[30vh]" label="Loading payslip…" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-muted/30 p-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee</p>
                <p className="font-medium text-foreground">{line.employee_name || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee no.</p>
                <p className="font-medium text-foreground">{line.employee_number || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Designation</p>
                <p className="font-medium text-foreground">{line.designation || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Payable days</p>
                <p className="font-medium text-foreground">
                  {Number(line.payable_days ?? 0)} / {Number(line.total_days ?? 0)}
                  {Number(line.lop_days ?? 0) > 0 && (
                    <span className="text-amber-600"> · {Number(line.lop_days)} LOP</span>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Column title="Earnings" rows={earnings} total={earned} totalLabel="Total earnings" />
              <Column title="Deductions" rows={deductions} total={withheld} totalLabel="Total deductions" />
            </div>

            {employer.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Employer contributions
                </div>
                <div className="divide-y divide-border/60 px-3">
                  {employer.map((c) => (
                    <Line key={`${c.component_code}-${c.display_order}`} label={c.component_name} amount={c.amount} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">Total employer contribution</span>
                  <span className="font-semibold text-foreground tabular-nums">{inr(employerTotal)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/10 px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Net pay</span>
              <span className="text-lg font-bold text-foreground tabular-nums">{netPayLabel(net)}</span>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PayslipDialog;
