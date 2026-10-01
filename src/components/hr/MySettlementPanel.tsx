// My settlement — the employee's own Full & Final statement, for the My HR tab.
//
// The self-read RLS policy only exposes a settlement once it is finalized or
// paid, and only lines belonging to such a settlement. So this panel asks the
// view for those two statuses and lets the database decide whose rows come back;
// there is nothing to filter client-side. The statement is the snapshot HR
// finalised, itemised, and downloadable as a PDF.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Download, FileText, LogOut } from "lucide-react";
import {
  buildSettlementPdf, formatInr, settlementDayLabel, settlementFileName,
  settlementNet, settlementStatusBadge, settlementStatusLabel,
  type SettlementLine, type SettlementRow,
} from "@/lib/settlement";
import {
  SettlementBreakdown, SETTLEMENT_LINE_SELECT, SETTLEMENT_SELECT,
} from "@/components/hr/SettlementPanel";

interface MySettlement extends SettlementRow {
  lines: SettlementLine[];
}

export function MySettlementPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MySettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase.from("employee_settlements_inbox" as any) as any)
      .select(SETTLEMENT_SELECT)
      .in("status", ["finalized", "paid"])
      .order("last_working_day", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      toast({ title: "Could not load your settlement", description: error.message, variant: "destructive" });
      setRows([]);
      setLoading(false);
      return;
    }

    const settlements = (data as SettlementRow[]) ?? [];
    const ids = settlements.map((s) => s.id);
    let linesBySettlement = new Map<string, SettlementLine[]>();

    if (ids.length > 0) {
      const { data: lineData, error: lineError } = await (supabase.from("employee_settlement_lines" as any) as any)
        .select(SETTLEMENT_LINE_SELECT)
        .in("settlement_id", ids)
        .order("display_order");

      if (lineError) {
        toast({ title: "Could not load the statement", description: lineError.message, variant: "destructive" });
      } else {
        linesBySettlement = ((lineData as SettlementLine[]) ?? []).reduce((map, line) => {
          const list = map.get(line.settlement_id) ?? [];
          list.push(line);
          map.set(line.settlement_id, list);
          return map;
        }, new Map<string, SettlementLine[]>());
      }
    }

    setRows(settlements.map((s) => ({ ...s, lines: linesBySettlement.get(s.id) ?? [] })));
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const download = (row: MySettlement) => {
    setBusyId(row.id);
    try {
      buildSettlementPdf(row, row.lines).save(settlementFileName(row));
    } catch (err) {
      toast({
        title: "Could not generate the PDF",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const total = useMemo(
    () => rows.reduce((acc, r) => acc + settlementNet(r), 0),
    [rows],
  );

  if (loading) return <PageLoader className="min-h-[40vh]" label="Loading your settlement…" />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <LogOut className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No full &amp; final settlement yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Your statement appears here once HR finalises it at exit.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Your full &amp; final statement. Expand it to see the earnings and deductions breakdown, or download the PDF.
        </p>
        <div className="rounded-xl bg-card card-shadow px-4 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Net settlement</p>
          <p className="text-lg font-bold text-foreground tabular-nums">₹{formatInr(total)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const isOpen = expanded.has(row.id);
          return (
            <div key={row.id} className="rounded-xl bg-card card-shadow overflow-hidden">
              <button
                onClick={() => toggle(row.id)}
                className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <span className="text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Last working day {settlementDayLabel(row.last_working_day)}
                  </span>
                  <span className="block text-[11px] capitalize text-muted-foreground">
                    {humanize(row.exit_type) || "Exit"}
                  </span>
                </span>
                <Badge className={`capitalize ${settlementStatusBadge(row.status)}`}>
                  {settlementStatusLabel(row.status)}
                </Badge>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  ₹{formatInr(settlementNet(row))}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <SettlementBreakdown lines={row.lines} net={settlementNet(row)} />
                  {row.note && (
                    <p className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Note: {row.note}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => download(row)}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      {busyId === row.id ? "Preparing…" : "Download PDF"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="h-3.5 w-3.5" /> Amounts are a snapshot taken when the settlement was computed.
      </p>
    </div>
  );
}

const humanize = (s: string | null | undefined) => (s || "").replace(/_/g, " ");

export default MySettlementPanel;
