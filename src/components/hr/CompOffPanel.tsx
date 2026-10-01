// HR Comp-off — grant credits and decide the pending ones.
//
// Time worked beyond the norm banks a comp-off credit. HR grants one here (or the
// overtime trigger does it automatically), and a pending credit is approved or
// rejected. Both actions are database RPCs, not table writes, so the status
// transition, the expiry window and the employee's notification all happen in one
// transaction.
//
// Credits are read straight from comp_off_credits with the employee_profiles FK
// embedded — the picker in the grant dialog is the only other profile read.

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
import { CalendarOff, Plus, Check, X, Loader2, Inbox } from "lucide-react";
import {
  COMP_OFF_FILTERS,
  COMP_OFF_SOURCES,
  compOffSourceLabel,
  compOffStatusBadge,
  compOffStatusLabel,
  formatDays,
  summarizeCompOff,
  type CompOffCredit,
  type CompOffFilter,
} from "@/lib/compOff";

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
}

interface CreditRow extends CompOffCredit {
  employee_profiles: { display_name: string | null; employee_number: string | null } | null;
}

const CREDIT_COLUMNS =
  "id, employee_profile_id, earned_on, days, used_days, remaining, reason, source, status, approved_at, expires_on, employee_profiles(display_name, employee_number)";

const FILTER_LABEL: Record<CompOffFilter, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  used: "Used",
  rejected: "Rejected",
  expired: "Expired",
};

const inputCls =
  "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

const todayIso = () => new Date().toISOString().slice(0, 10);

const EMPTY_DRAFT = { employee_profile_id: "", days: "", earned_on: "", reason: "", source: "manual" };

export function CompOffPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("hr", "attendance_edit");

  const [rows, setRows] = useState<CreditRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CompOffFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [granting, setGranting] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);

  const [rejecting, setRejecting] = useState<CreditRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const all: CreditRow[] = [];
    // The table has no hard row cap; page through it rather than trusting a limit.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (supabase.from("comp_off_credits" as never) as never)
        .select(CREDIT_COLUMNS)
        .order("earned_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        toast({ title: "Could not load comp-off credits", description: error.message, variant: "destructive" });
        break;
      }
      if (!data?.length) break;
      all.push(...(data as CreditRow[]));
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
    if (canEdit) fetchEmployees();
  }, [canEdit, fetchEmployees]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const summary = useMemo(() => summarizeCompOff(rows), [rows]);
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  const openGrant = () => {
    setDraft({ ...EMPTY_DRAFT, earned_on: todayIso() });
    setGranting(true);
  };

  const submitGrant = async () => {
    const days = Number(draft.days);
    if (!draft.employee_profile_id) {
      toast({ title: "Pick an employee", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Enter days greater than zero", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("grant_comp_off" as never, {
      _employee_profile_id: draft.employee_profile_id,
      _days: days,
      _earned_on: draft.earned_on || todayIso(),
      _reason: draft.reason.trim() || null,
      _source: draft.source,
      _attendance_overtime_id: null,
    } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Could not grant comp-off", description: error.message, variant: "destructive" });
      return;
    }
    setGranting(false);
    toast({ title: "Comp-off granted", description: "The employee has been notified." });
    await fetchRows();
  };

  const decide = async (row: CreditRow, approve: boolean, note: string | null) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("decide_comp_off" as never, {
      _credit_id: row.id,
      _approve: approve,
      _note: note,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: approve ? "Could not approve" : "Could not reject", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: approve ? "Comp-off approved" : "Comp-off rejected" });
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
    { label: "Pending", value: String(summary.pending), tone: "text-amber-600" },
    { label: "Available days", value: formatDays(summary.availableDays), tone: "text-emerald-600" },
    { label: "Used days", value: formatDays(summary.usedDays), tone: "text-foreground" },
    { label: "Total credits", value: String(summary.total), tone: "text-foreground" },
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
          {COMP_OFF_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {FILTER_LABEL[f]}
              {f === "pending" && pendingCount > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {canEdit && (
          <Button size="sm" onClick={openGrant}>
            <Plus className="h-4 w-4 mr-1.5" /> Grant comp-off
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === "pending" ? "No comp-off credits awaiting a decision." : "No comp-off credits here."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Earned on</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Remaining</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Expires</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                {canEdit && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.employee_profiles?.display_name || "Unnamed"}</div>
                    {r.employee_profiles?.employee_number && (
                      <div className="text-xs text-muted-foreground">{r.employee_profiles.employee_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{r.earned_on}</div>
                    {r.reason && <div className="text-muted-foreground/80 truncate max-w-[220px]">{r.reason}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(r.days)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(r.remaining)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{compOffSourceLabel(r.source)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.expires_on || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={compOffStatusBadge(r.status)}>{compOffStatusLabel(r.status)}</Badge>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "pending" && (
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
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Grant */}
      <Dialog open={granting} onOpenChange={(open) => { if (!open) setGranting(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant comp-off</DialogTitle>
            <DialogDescription>
              Credit an employee for extra time worked. The credit is approved immediately and expires on the configured window.
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
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Days</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={draft.days}
                  onChange={(e) => setDraft({ ...draft, days: e.target.value })}
                  placeholder="0"
                  className={`${inputCls} w-full`}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Earned on</span>
                <input
                  type="date"
                  value={draft.earned_on}
                  onChange={(e) => setDraft({ ...draft, earned_on: e.target.value })}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Source</span>
                <select
                  value={draft.source}
                  onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  className={`${inputCls} w-full`}
                >
                  {COMP_OFF_SOURCES.map((s) => (
                    <option key={s} value={s}>{compOffSourceLabel(s)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</span>
              <Textarea
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="e.g. Worked the annual-day event"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setGranting(false)}>Cancel</Button>
            <Button size="sm" onClick={submitGrant} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CalendarOff className="h-4 w-4 mr-1.5" />}
              Grant comp-off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject comp-off</DialogTitle>
            <DialogDescription>
              {rejecting
                ? `${rejecting.employee_profiles?.display_name || "Employee"} · ${formatDays(rejecting.days)} day(s) earned ${rejecting.earned_on}`
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
              Reject credit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
