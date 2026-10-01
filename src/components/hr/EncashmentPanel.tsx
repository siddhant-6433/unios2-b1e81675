// HR Leave Encashment — the approver's inbox and the payout queue.
//
// An employee requests to cash out unused paid leave; HR approves or rejects, and
// once approved payroll marks it paid. Each step is a database RPC, not a table
// write, so the entitlement reduction, the status move and the employee's
// notification all happen in one transaction.
//
// Rows come from the leave_encashments_inbox view, which already joins the leave
// type name and the employee's name/number — no N+1 profile lookups from the client.
//
// Permission split: decisions need hr:leave_approve; marking paid needs
// hr:payroll_run (it touches the entitlement). The UI mirrors the DB split rather
// than showing buttons that would fail.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, BadgeCheck, Inbox, Loader2 } from "lucide-react";
import {
  ENCASHMENT_FILTERS,
  encashmentStatusBadge,
  encashmentStatusLabel,
  formatDays,
  formatInr,
  summarizeEncashments,
  type EncashmentFilter,
  type EncashmentRow,
} from "@/lib/encashment";

const ENCASHMENT_COLUMNS =
  "id, employee_profile_id, leave_type_id, leave_year, days, amount, status, requested_at, decided_at, decision_note, payroll_cycle_id, paid_at, note, leave_type, employee_name, employee_number";

const FILTER_LABEL: Record<EncashmentFilter, string> = {
  all: "All",
  requested: "Pending",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const shortDate = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function EncashmentPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canDecide = can("hr", "leave_approve");
  const canPay = can("hr", "payroll_run");

  const [rows, setRows] = useState<EncashmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EncashmentFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<EncashmentRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const all: EncashmentRow[] = [];
    // The view has no hard row cap; page through it rather than trusting a limit.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (supabase.from("leave_encashments_inbox" as never) as never)
        .select(ENCASHMENT_COLUMNS)
        .order("requested_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        toast({ title: "Could not load encashment requests", description: error.message, variant: "destructive" });
        break;
      }
      if (!data?.length) break;
      all.push(...(data as EncashmentRow[]));
      if (data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const summary = useMemo(() => summarizeEncashments(rows), [rows]);
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "requested").length, [rows]);

  const decide = async (row: EncashmentRow, approve: boolean, note: string | null) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("decide_leave_encashment" as never, {
      _encashment_id: row.id,
      _approve: approve,
      _note: note,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: approve ? "Could not approve" : "Could not reject", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: approve ? "Encashment approved" : "Encashment rejected" });
    await fetchRows();
  };

  const pay = async (row: EncashmentRow) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("pay_leave_encashment" as never, {
      _encashment_id: row.id,
      _payroll_cycle_id: null,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not mark paid", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Encashment paid", description: "The leave balance has been reduced." });
    await fetchRows();
  };

  const submitReject = async () => {
    if (!rejecting) return;
    const row = rejecting;
    setRejecting(null);
    await decide(row, false, rejectNote.trim() || null);
    setRejectNote("");
  };

  const cards = [
    { label: "Awaiting decision", value: `₹${formatInr(summary.requestedAmount)}`, tone: "text-amber-600" },
    { label: "Approved", value: `₹${formatInr(summary.approvedAmount)}`, tone: "text-emerald-600" },
    { label: "Paid", value: `₹${formatInr(summary.paidAmount)}`, tone: "text-blue-600" },
    { label: "Requests", value: String(summary.total), tone: "text-foreground" },
  ];

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-card card-shadow p-4">
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-semibold mt-1 ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
        {ENCASHMENT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_LABEL[f]}
            {f === "requested" && pendingCount > 0 && (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === "requested" ? "No encashment requests awaiting a decision." : "No encashment requests here."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leave type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Year</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requested</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                {(canDecide || canPay) && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.employee_name || "Unnamed"}</div>
                    {r.employee_number && (
                      <div className="text-xs text-muted-foreground">{r.employee_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground">{r.leave_type || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.leave_year}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(r.days)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{shortDate(r.requested_at)}</div>
                    {r.status === "paid" && <div className="text-muted-foreground/80">Paid {shortDate(r.paid_at)}</div>}
                    {r.decision_note && r.status === "rejected" && (
                      <div className="text-muted-foreground/80 truncate max-w-[220px]">Note: {r.decision_note}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={encashmentStatusBadge(r.status)}>{encashmentStatusLabel(r.status)}</Badge>
                  </td>
                  {(canDecide || canPay) && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "requested" && canDecide && (
                          <>
                            <button
                              onClick={() => decide(r, true, null)}
                              disabled={busyId === r.id}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
                            </button>
                            <button
                              onClick={() => { setRejecting(r); setRejectNote(""); }}
                              disabled={busyId === r.id}
                              className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {r.status === "approved" && canPay && (
                          <button
                            onClick={() => pay(r)}
                            disabled={busyId === r.id}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />} Mark paid
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject encashment request</DialogTitle>
            <DialogDescription>
              {rejecting
                ? `${rejecting.employee_name || "Employee"} · ${rejecting.leave_type || "Leave"} · ${formatDays(rejecting.days)} day(s) · ₹${formatInr(rejecting.amount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Why is this being rejected? The employee will see this."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={submitReject} disabled={busyId === rejecting?.id}>
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
