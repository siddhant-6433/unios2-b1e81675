// My Leave Encashment — employee self-service, meant to be embedded in My HR.
//
// Balances come from my_leave_balances(), the entitlements engine's own view, so
// the form can only ever offer a leave type that actually has days to encash. The
// request itself is an RPC (request_leave_encashment) because it also needs the
// employee's salary to compute the amount — the client must not guess at that.
//
// The employee_profiles row is resolved from the auth user id; if the account has
// no linked employee record there is nothing to request against, so we say so.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, Plus, Loader2 } from "lucide-react";
import {
  availableFor,
  balancesWithAvailable,
  encashmentStatusBadge,
  encashmentStatusLabel,
  formatDays,
  formatInr,
  type LeaveBalance,
} from "@/lib/encashment";

interface MyEncashmentRow {
  id: string;
  leave_year: number;
  days: number | string;
  amount: number | string;
  status: string;
  requested_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  paid_at: string | null;
  note: string | null;
  leave_types: { name: string | null; code: string | null } | null;
}

const ENCASHMENT_COLUMNS =
  "id, leave_type_id, leave_year, days, amount, status, requested_at, decided_at, decision_note, paid_at, note, leave_types(name, code)";

const inputCls =
  "rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20";

const shortDate = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const balanceKey = (b: LeaveBalance) => `${b.leave_type_id}|${b.leave_year}`;

export function MyEncashmentPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [rows, setRows] = useState<MyEncashmentRow[]>([]);
  const [draft, setDraft] = useState({ key: "", days: "", note: "" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const profileRes = await (supabase.from("employee_profiles" as never) as never)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const resolvedProfileId = (profileRes.data as { id: string } | null)?.id ?? null;
    setProfileId(resolvedProfileId);

    const balanceRes = await supabase.rpc("my_leave_balances" as never);
    if (balanceRes.error) {
      toast({ title: "Could not load your leave balances", description: balanceRes.error.message, variant: "destructive" });
    }
    setBalances((balanceRes.data as LeaveBalance[]) ?? []);

    if (!resolvedProfileId) {
      setRows([]);
      setLoading(false);
      return;
    }

    const encRes = await (supabase.from("leave_encashments" as never) as never)
      .select(ENCASHMENT_COLUMNS)
      .eq("employee_profile_id", resolvedProfileId)
      .order("requested_at", { ascending: false });

    if (encRes.error) {
      toast({ title: "Could not load your encashments", description: encRes.error.message, variant: "destructive" });
    }
    setRows((encRes.data as MyEncashmentRow[]) ?? []);
    setLoading(false);
  }, [user?.id, toast]);

  useEffect(() => { load(); }, [load]);

  const eligible = useMemo(() => balancesWithAvailable(balances), [balances]);
  const selected = useMemo(
    () => eligible.find((b) => balanceKey(b) === draft.key) ?? null,
    [eligible, draft.key],
  );

  const submit = async () => {
    if (!selected) {
      toast({ title: "Pick a leave type", variant: "destructive" });
      return;
    }
    const days = Number(draft.days);
    const available = availableFor(balances, selected.leave_type_id, selected.leave_year);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Enter days greater than zero", variant: "destructive" });
      return;
    }
    if (days > available) {
      toast({ title: `Only ${formatDays(available)} day(s) available`, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc("request_leave_encashment" as never, {
      _leave_type_id: selected.leave_type_id,
      _days: days,
      _leave_year: selected.leave_year,
      _note: draft.note.trim() || null,
    } as never);
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not request encashment", description: error.message, variant: "destructive" });
      return;
    }
    setDraft({ key: "", days: "", note: "" });
    toast({ title: "Encashment requested", description: "HR will review it shortly." });
    await load();
  };

  if (loading) return <PageLoader />;

  if (!profileId) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center">
        <Banknote className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-foreground">No employee record linked to your account</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask HR to link your login to your employee profile before encashing leave.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {balances.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {balances.slice(0, 8).map((b) => (
            <div key={balanceKey(b)} className="rounded-xl bg-card card-shadow p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                {b.leave_type} · {b.leave_year}
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">{formatDays(b.available)}</p>
              <p className="text-[10px] text-muted-foreground">of {formatDays(b.entitled)} days available</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Request encashment</p>
        </div>
        {eligible.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            You have no leave balance available to encash right now.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Leave type</span>
                <select
                  value={draft.key}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  className={`${inputCls} min-w-[200px]`}
                >
                  <option value="">Select…</option>
                  {eligible.map((b) => (
                    <option key={balanceKey(b)} value={balanceKey(b)}>
                      {b.leave_type} · {b.leave_year} — {formatDays(b.available)} day(s)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Days</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  max={selected ? Number(selected.available) : undefined}
                  value={draft.days}
                  onChange={(e) => setDraft({ ...draft, days: e.target.value })}
                  placeholder="0"
                  className={`${inputCls} w-28`}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Note</span>
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="Optional"
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Banknote className="h-4 w-4 mr-1.5" />}
                Request encashment
              </Button>
            </div>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Banknote className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No encashment requests yet</p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leave type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Year</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Days</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requested</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-foreground">
                    <div>{r.leave_types?.name || r.leave_types?.code || "Leave"}</div>
                    {r.decision_note && r.status === "rejected" && (
                      <div className="text-muted-foreground/80 truncate max-w-[240px]">Note: {r.decision_note}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.leave_year}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{formatDays(r.days)}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{shortDate(r.requested_at)}</div>
                    {r.status === "paid" && <div className="text-muted-foreground/80">Paid {shortDate(r.paid_at)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={encashmentStatusBadge(r.status)}>{encashmentStatusLabel(r.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
