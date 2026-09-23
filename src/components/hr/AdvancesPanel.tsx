// HR Advances — the advance ledger.
//
// An advance is money paid before the expense; HR issues it here and recovers it
// later, either partially or in full. Both actions are database RPCs, not table
// writes, so the balance update, the status transition and the employee's
// notification all happen in one transaction.
//
// Rows come from the expense_advances_inbox view, which already joins the
// employee's name/number — no N+1 profile lookups from the client. The picker
// in the issue dialog is the one place we read employee_profiles directly.

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
import { HandCoins, Plus, RotateCcw, Loader2, Wallet } from "lucide-react";
import {
  advanceStatusBadge,
  formatInr,
  isFullyRecovered,
  outstandingOf,
  summarizeAdvances,
  type AdvanceRow,
} from "@/lib/advances";

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
}

const ADVANCE_COLUMNS =
  "id, employee_profile_id, amount, recovered_amount, outstanding, issued_on, purpose, status, payroll_cycle_id, settled_at, notes, employee_name, employee_number";

const inputCls =
  "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

const EMPTY_DRAFT = { employee_profile_id: "", amount: "", purpose: "" };

export function AdvancesPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  // Issue is hr:expenses_manage; recovery is hr:expenses_approve. The DB enforces
  // the split, so the UI mirrors it rather than showing buttons that would fail.
  const canManage = can("hr", "expenses_manage");
  const canApprove = can("hr", "expenses_approve");

  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);

  const [recovering, setRecovering] = useState<AdvanceRow | null>(null);
  const [recoverAmount, setRecoverAmount] = useState("");
  const [recoverNote, setRecoverNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const all: AdvanceRow[] = [];
    // The view has no hard row cap; page through it rather than trusting a limit.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (supabase.from("expense_advances_inbox" as never) as never)
        .select(ADVANCE_COLUMNS)
        .order("issued_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        toast({ title: "Could not load advances", description: error.message, variant: "destructive" });
        break;
      }
      if (!data?.length) break;
      all.push(...(data as AdvanceRow[]));
      if (data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }, [toast]);

  const fetchEmployees = useCallback(async () => {
    const { data, error } = await (supabase.from("employee_profiles" as never) as never)
      .select("id, display_name, employee_number")
      .order("display_name");
    if (error) {
      toast({ title: "Could not load employees", description: error.message, variant: "destructive" });
      return;
    }
    setEmployees((data as EmployeeOption[]) ?? []);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    if (canManage) fetchEmployees();
  }, [canManage, fetchEmployees]);

  const summary = useMemo(() => summarizeAdvances(rows), [rows]);

  const openIssue = () => {
    setDraft({ ...EMPTY_DRAFT });
    setIssuing(true);
  };

  const submitIssue = async () => {
    const amount = Number(draft.amount);
    if (!draft.employee_profile_id) {
      toast({ title: "Pick an employee", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter an amount greater than zero", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("issue_advance" as never, {
      _employee_profile_id: draft.employee_profile_id,
      _amount: amount,
      _purpose: draft.purpose.trim() || null,
    } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Could not issue the advance", description: error.message, variant: "destructive" });
      return;
    }
    setIssuing(false);
    toast({ title: "Advance issued", description: "The employee has been notified." });
    await fetchRows();
  };

  const openRecover = (row: AdvanceRow) => {
    setRecoverAmount(String(outstandingOf(row)));
    setRecoverNote("");
    setRecovering(row);
  };

  const submitRecover = async () => {
    if (!recovering) return;
    const row = recovering;
    const amount = Number(recoverAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a recovery amount greater than zero", variant: "destructive" });
      return;
    }
    const willFullyRecover = amount >= outstandingOf(row);
    setBusyId(row.id);
    const { error } = await supabase.rpc("settle_advance" as never, {
      _advance_id: row.id,
      _amount: amount,
      _payroll_cycle_id: null,
      _note: recoverNote.trim() || null,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not recover", description: error.message, variant: "destructive" });
      return;
    }
    setRecovering(null);
    toast({
      title: willFullyRecover ? "Advance fully recovered" : "Recovery recorded",
    });
    await fetchRows();
  };

  const cards = [
    { label: "Open advances", value: String(summary.open), tone: "text-foreground" },
    { label: "Outstanding", value: `₹${formatInr(summary.outstanding)}`, tone: "text-amber-600" },
    { label: "Recovered", value: `₹${formatInr(summary.recovered)}`, tone: "text-emerald-600" },
    { label: "Total issued", value: `₹${formatInr(summary.total)}`, tone: "text-foreground" },
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

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Advances paid to employees, recovered from payroll or at settlement.
        </p>
        {canManage && (
          <Button size="sm" onClick={openIssue}>
            <Plus className="h-4 w-4 mr-1.5" /> Issue advance
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No advances issued yet.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Purpose</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issued on</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recovered</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Outstanding</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                {canApprove && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.employee_name || "Unnamed"}</div>
                    {r.employee_number && (
                      <div className="text-xs text-muted-foreground">{r.employee_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    <div className="text-foreground truncate">{r.purpose || "—"}</div>
                    {r.notes && <div className="text-xs text-muted-foreground truncate">{r.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.issued_on}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">₹{formatInr(r.recovered_amount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(outstandingOf(r))}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize ${advanceStatusBadge(r.status)}`}>
                      {r.status === "open" ? "Open" : r.status === "recovered" ? "Recovered" : "Cancelled"}
                    </Badge>
                  </td>
                  {canApprove && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {r.status === "open" && !isFullyRecovered(r) && (
                          <button
                            onClick={() => openRecover(r)}
                            disabled={busyId === r.id}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Recover
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

      {/* Issue */}
      <Dialog open={issuing} onOpenChange={(open) => { if (!open) setIssuing(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue advance</DialogTitle>
            <DialogDescription>
              Pay an employee before the expense. This is recovered later from payroll or settlement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Employee</span>
              <select
                value={draft.employee_profile_id}
                onChange={(e) => setDraft({ ...draft, employee_profile_id: e.target.value })}
                className={`${inputCls} w-full`}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.display_name || "Unnamed"}{emp.employee_number ? ` · ${emp.employee_number}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount (₹)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0"
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Purpose</span>
              <Textarea
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                placeholder="What is this advance for?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIssuing(false)}>Cancel</Button>
            <Button size="sm" onClick={submitIssue} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <HandCoins className="h-4 w-4 mr-1.5" />}
              Issue advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recover */}
      <Dialog open={!!recovering} onOpenChange={(open) => { if (!open) setRecovering(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recover advance</DialogTitle>
            <DialogDescription>
              {recovering
                ? `${recovering.employee_name || "Employee"} · outstanding ₹${formatInr(outstandingOf(recovering))}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount to recover (₹)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={recoverAmount}
                onChange={(e) => setRecoverAmount(e.target.value)}
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Note</span>
              <Textarea
                value={recoverNote}
                onChange={(e) => setRecoverNote(e.target.value)}
                placeholder="e.g. Recovered from September payroll"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRecovering(null)}>Cancel</Button>
            <Button size="sm" onClick={submitRecover} disabled={busyId === recovering?.id}>
              {busyId === recovering?.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Record recovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
