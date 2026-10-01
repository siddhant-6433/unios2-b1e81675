// HR Full & Final settlements — the settlement desk.
//
// Every exit (other than a reverted one) is listed. An exit with no settlement
// row yet can be computed; computing itemises final-month salary, leave
// encashment, gratuity, notice recovery and outstanding advances in one RPC and
// opens the statement. HR then finalizes it (which notifies the employee) and,
// once the money has moved, marks it paid.
//
// The list is built by joining `employee_exits` to the `employee_settlements_inbox`
// view on `exit_id` in memory: the exits are the source of truth for "who is
// leaving", and an exit with no matching settlement is exactly the work still to
// be done. All money reads and writes are database-side so the statement cannot
// drift from the records it was computed from.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Calculator, CheckCircle2, BadgeCheck, Download, FileText, Inbox, Loader2, LogOut, Receipt,
} from "lucide-react";
import {
  earningsOf, deductionsOf, formatInr, settlementDayLabel,
  settlementNet, settlementStatusBadge, settlementStatusLabel,
  buildSettlementPdf, settlementFileName,
  type SettlementLine, type SettlementRow,
} from "@/lib/settlement";

export const EXIT_SELECT =
  "id, employee_profile_id, exit_type, resignation_date, last_working_day, status, employee_profiles(display_name, job_title)";
export const SETTLEMENT_SELECT =
  "id, employee_profile_id, exit_id, status, last_working_day, gross_earnings, total_deductions, net_settlement, computed_at, finalized_at, paid_at, note, employee_name, employee_number, job_title, exit_type";
export const SETTLEMENT_LINE_SELECT =
  "id, settlement_id, code, name, kind, amount, detail, display_order";

// The settlement RPCs aren't in the generated Database types yet, so they are
// reached through an untyped signature rather than `any`.
const rpc = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

interface ExitRow {
  id: string;
  employee_profile_id: string;
  exit_type: string;
  resignation_date: string | null;
  last_working_day: string | null;
  status: string;
  employee_profiles: { display_name: string | null; job_title: string | null } | null;
}

interface SettlementExit extends ExitRow {
  settlement: SettlementRow | null;
}

type Filter = "all" | "pending" | "finalized" | "paid";
const FILTERS: readonly Filter[] = ["all", "pending", "finalized", "paid"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  pending: "To compute",
  finalized: "Finalized",
  paid: "Paid",
};

const humanize = (s: string | null | undefined) => (s || "").replace(/_/g, " ");

/** Which filter bucket a row falls in. Draft and missing both mean "still to do". */
function bucketOf(row: SettlementExit): Filter {
  const status = row.settlement?.status;
  if (status === "finalized") return "finalized";
  if (status === "paid") return "paid";
  return "pending";
}

// ── Presentational breakdown, shared with the employee self-service panel ────

function Line({ label, amount }: { label: React.ReactNode; amount: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground tabular-nums">{formatInr(amount)}</span>
    </div>
  );
}

function Column({
  title, rows, total, totalLabel,
}: {
  title: string;
  rows: SettlementLine[];
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
          rows.map((l) => <Line key={l.id} label={l.name} amount={l.amount} />)
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">{totalLabel}</span>
        <span className="font-semibold text-foreground tabular-nums">{formatInr(total)}</span>
      </div>
    </div>
  );
}

/** Earnings vs deductions columns plus the net band, for one statement. */
export function SettlementBreakdown({ lines, net }: { lines: SettlementLine[]; net?: number }) {
  const earnings = useMemo(
    () => lines.filter((l) => l.kind === "earning").sort((a, b) => a.display_order - b.display_order),
    [lines],
  );
  const deductions = useMemo(
    () => lines.filter((l) => l.kind === "deduction").sort((a, b) => a.display_order - b.display_order),
    [lines],
  );
  const earned = earningsOf(lines);
  const withheld = deductionsOf(lines);
  const netValue = net ?? Math.max(0, earned - withheld);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Column title="Earnings" rows={earnings} total={earned} totalLabel="Total earnings" />
        <Column title="Deductions" rows={deductions} total={withheld} totalLabel="Total deductions" />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/10 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Net settlement</span>
        <span className="text-lg font-bold text-foreground tabular-nums">₹{formatInr(netValue)}</span>
      </div>
    </div>
  );
}

// ── Detail dialog (shared with the employee self-service panel) ──────────────

export interface SettlementDetailDialogProps {
  settlementId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after finalize/mark-paid so the list behind the dialog can refresh. */
  onChanged?: () => void;
}

export function SettlementDetailDialog({
  settlementId, open, onOpenChange, onChanged,
}: SettlementDetailDialogProps) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("hr", "payroll_run") || can("hr", "employees_edit");

  const [row, setRow] = useState<SettlementRow | null>(null);
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"finalize" | "paid" | null>(null);

  const load = useCallback(async () => {
    if (!settlementId) return;
    setLoading(true);
    const [rowRes, lineRes] = await Promise.all([
      (supabase.from("employee_settlements_inbox" as any) as any)
        .select(SETTLEMENT_SELECT)
        .eq("id", settlementId)
        .maybeSingle(),
      (supabase.from("employee_settlement_lines" as any) as any)
        .select(SETTLEMENT_LINE_SELECT)
        .eq("settlement_id", settlementId)
        .order("display_order"),
    ]);
    if (rowRes.error) {
      toast({ title: "Could not load the settlement", description: rowRes.error.message, variant: "destructive" });
    }
    if (lineRes.error) {
      toast({ title: "Could not load the statement", description: lineRes.error.message, variant: "destructive" });
    }
    setRow((rowRes.data as SettlementRow) ?? null);
    setLines((lineRes.data as SettlementLine[]) ?? []);
    setLoading(false);
  }, [settlementId, toast]);

  useEffect(() => {
    if (open && settlementId) {
      void load();
    } else {
      setRow(null);
      setLines([]);
    }
  }, [open, settlementId, load]);

  const runAction = async (action: "finalize" | "paid") => {
    if (!settlementId) return;
    setBusy(action);
    const { error } = await rpc(
      action === "finalize" ? "finalize_exit_settlement" : "mark_exit_settlement_paid",
      { _settlement_id: settlementId },
    );
    setBusy(null);
    if (error) {
      toast({
        title: action === "finalize" ? "Could not finalize" : "Could not mark paid",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: action === "finalize" ? "Settlement finalized" : "Settlement marked paid",
      description: action === "finalize" ? "The employee has been notified." : undefined,
    });
    await load();
    onChanged?.();
  };

  const download = () => {
    if (!row) return;
    try {
      buildSettlementPdf(row, lines).save(settlementFileName(row));
    } catch (err) {
      toast({
        title: "Could not generate the PDF",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Full &amp; final settlement
            {row && (
              <Badge className={`capitalize ${settlementStatusBadge(row.status)}`}>
                {settlementStatusLabel(row.status)}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {row ? `${row.employee_name || "Employee"}${row.employee_number ? ` · ${row.employee_number}` : ""}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <PageLoader className="min-h-[30vh]" label="Loading statement…" />
        ) : !row ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Settlement not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-muted/30 p-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee</p>
                <p className="font-medium text-foreground">{row.employee_name || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee no.</p>
                <p className="font-medium text-foreground">{row.employee_number || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Designation</p>
                <p className="font-medium text-foreground">{row.job_title || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Exit type</p>
                <p className="font-medium capitalize text-foreground">{humanize(row.exit_type) || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Last working day</p>
                <p className="font-medium text-foreground">{settlementDayLabel(row.last_working_day)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Computed</p>
                <p className="font-medium text-foreground">
                  {row.computed_at ? new Date(row.computed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                </p>
              </div>
            </div>

            <SettlementBreakdown lines={lines} net={settlementNet(row)} />

            {row.note && (
              <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Note: {row.note}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
              </Button>
              {canManage && row.status === "draft" && (
                <Button size="sm" onClick={() => runAction("finalize")} disabled={busy !== null}>
                  {busy === "finalize" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Finalize
                </Button>
              )}
              {canManage && row.status === "finalized" && (
                <Button size="sm" onClick={() => runAction("paid")} disabled={busy !== null}>
                  {busy === "paid" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5 mr-1.5" />}
                  Mark paid
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The settlement desk ─────────────────────────────────────────────────────

export function SettlementPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("hr", "payroll_run") || can("hr", "employees_edit");

  const [exits, setExits] = useState<ExitRow[]>([]);
  const [settlementByExit, setSettlementByExit] = useState<Map<string, SettlementRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [exitRes, settleRes] = await Promise.all([
      supabase
        .from("employee_exits")
        .select(EXIT_SELECT)
        .neq("status", "reverted")
        .order("last_working_day", { ascending: false, nullsFirst: false })
        .limit(500),
      (supabase.from("employee_settlements_inbox" as any) as any)
        .select(SETTLEMENT_SELECT)
        .order("computed_at", { ascending: false })
        .limit(1000),
    ]);

    if (exitRes.error) {
      toast({ title: "Could not load exits", description: exitRes.error.message, variant: "destructive" });
    }
    if (settleRes.error) {
      toast({ title: "Could not load settlements", description: settleRes.error.message, variant: "destructive" });
    }

    const settlements = (settleRes.data as SettlementRow[]) ?? [];
    setExits((exitRes.data as unknown as ExitRow[]) ?? []);
    setSettlementByExit(new Map(settlements.map((s) => [s.exit_id, s])));
    setLoading(false);
  }, [toast]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const merged = useMemo<SettlementExit[]>(
    () => exits.map((e) => ({ ...e, settlement: settlementByExit.get(e.id) ?? null })),
    [exits, settlementByExit],
  );

  const counts = useMemo(() => {
    const pending = merged.filter((r) => bucketOf(r) === "pending").length;
    const finalized = merged.filter((r) => bucketOf(r) === "finalized").length;
    const paid = merged.filter((r) => bucketOf(r) === "paid").length;
    return { pending, finalized, paid };
  }, [merged]);

  const totalNet = useMemo(
    () => merged.reduce((acc, r) => (r.settlement ? acc + settlementNet(r.settlement) : acc), 0),
    [merged],
  );

  const visible = useMemo(
    () => (filter === "all" ? merged : merged.filter((r) => bucketOf(r) === filter)),
    [merged, filter],
  );

  const compute = async (exit: ExitRow) => {
    setBusyId(exit.id);
    const { data, error } = await rpc("compute_exit_settlement", { _exit_id: exit.id });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not compute the settlement", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Settlement computed", description: "Review the statement before finalizing." });
    await fetchAll();
    const id = typeof data === "string" ? data : null;
    if (id) {
      setDetailId(id);
      setDetailOpen(true);
    }
  };

  const openDetail = (settlement: SettlementRow) => {
    setDetailId(settlement.id);
    setDetailOpen(true);
  };

  const cards = [
    { label: "Exits", value: String(merged.length), tone: "text-foreground" },
    { label: "To compute", value: String(counts.pending), tone: "text-amber-600" },
    { label: "Finalized", value: String(counts.finalized), tone: "text-blue-600" },
    { label: "Paid", value: String(counts.paid), tone: "text-emerald-600" },
    { label: "Net payable", value: `₹${formatInr(totalNet)}`, tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-card card-shadow p-4">
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-semibold mt-1 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_LABEL[f]}
            {f === "pending" && counts.pending > 0 && (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                {counts.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader />
      ) : merged.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <LogOut className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No exits recorded.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Record an exit on an employee's Job tab before settling their dues.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nothing in this bucket.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Exit</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last working day</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net settlement</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const settlement = r.settlement;
                const canCompute = !settlement || settlement.status === "draft";
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.employee_profiles?.display_name || "Unnamed"}</div>
                      {r.employee_profiles?.job_title && (
                        <div className="text-xs text-muted-foreground">{r.employee_profiles.job_title}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                      {humanize(r.exit_type) || "—"}
                      <div className="text-[11px] text-muted-foreground/70 capitalize">exit {humanize(r.status)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{settlementDayLabel(r.last_working_day)}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {settlement ? `₹${formatInr(settlementNet(settlement))}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {settlement ? (
                        <Badge className={`capitalize ${settlementStatusBadge(settlement.status)}`}>
                          {settlementStatusLabel(settlement.status)}
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">Not computed</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {canManage && canCompute && (
                          <button
                            onClick={() => compute(r)}
                            disabled={busyId === r.id}
                            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calculator className="h-3 w-3" />}
                            {settlement ? "Recompute" : "Compute"}
                          </button>
                        )}
                        {settlement && (
                          <button
                            onClick={() => openDetail(settlement)}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                          >
                            <Receipt className="h-3 w-3" /> View
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SettlementDetailDialog
        settlementId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={fetchAll}
      />

      {!canManage && !loading && merged.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> You can review statements; finalizing and marking paid need payroll or
          employee-edit permission.
        </p>
      )}
    </div>
  );
}

export default SettlementPanel;
