// Leave plans, their types, and granting a year's entitlement.
//
// NIMT runs five distinct policies (teaching, non-teaching, Seralis, executive), which
// a flat per-user balance table cannot express. A plan owns its leave types; an
// employee is assigned to a plan; granting a year writes each person's entitlement.
//
// The seeded day counts are conventional Indian defaults, NOT NIMT's actual policy —
// they are editable here precisely because nobody should assume 12/12/15 is right.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarRange, Users, Save } from "lucide-react";

interface Plan { id: string; name: string; description: string | null; is_default: boolean }
interface LeaveType {
  id: string; leave_plan_id: string; code: string; name: string;
  annual_days: number; accrual: string; carry_forward_max: number; is_paid: boolean; display_order: number;
}

export function LeavePlansPanel() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [p, t, e] = await Promise.all([
      supabase.from("leave_plans").select("id, name, description, is_default").eq("is_active", true).order("name"),
      supabase.from("leave_types")
        .select("id, leave_plan_id, code, name, annual_days, accrual, carry_forward_max, is_paid, display_order")
        .order("display_order"),
      supabase.from("employee_profiles").select("leave_plan_id").not("leave_plan_id", "is", null),
    ]);

    const list = (p.data as Plan[]) ?? [];
    setPlans(list);
    setTypes((t.data as LeaveType[]) ?? []);
    const tally: Record<string, number> = {};
    for (const row of (e.data as { leave_plan_id: string }[]) ?? []) {
      tally[row.leave_plan_id] = (tally[row.leave_plan_id] ?? 0) + 1;
    }
    setCounts(tally);
    setSelected((prev) => prev || list.find((x) => x.is_default)?.id || list[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const planTypes = types.filter((t) => t.leave_plan_id === selected);

  const editType = (id: string, patch: Partial<LeaveType>) => {
    setTypes((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirty(true);
  };

  const saveTypes = async () => {
    setBusy(true);
    let failed = 0;
    for (const t of planTypes) {
      const { data, error } = await supabase
        .from("leave_types")
        .update({
          annual_days: t.annual_days,
          carry_forward_max: t.carry_forward_max,
          accrual: t.accrual,
        })
        .eq("id", t.id)
        .select("id");
      if (error || !data?.length) failed++;
    }
    setBusy(false);
    setDirty(false);
    if (failed) toast({ title: `${failed} types could not be saved`, description: "You may not have leave approval permission.", variant: "destructive" });
    else toast({ title: "Leave types saved" });
  };

  const grant = async () => {
    if (!selected) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("grant_leave_entitlements", {
      _leave_plan_id: selected, _leave_year: year,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not grant entitlements", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `${data ?? 0} entitlements granted for ${year}`,
      description: (data ?? 0) === 0
        ? "Nobody is assigned to this plan yet — set a leave plan on employee profiles first."
        : undefined,
    });
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {plans.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              selected === p.id ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"
            }`}
          >
            {p.name}
            <span className="ml-1.5 text-muted-foreground">{counts[p.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {counts[selected] ?? 0} employees on this plan
        </span>
        <div className="flex-1" />
        <label className="text-xs text-muted-foreground">Leave year</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-24 rounded-lg border border-input bg-background px-2 py-1 text-xs"
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={grant}>
          <CalendarRange className="h-4 w-4 mr-1.5" /> Grant entitlements
        </Button>
        <Button size="sm" disabled={busy || !dirty} onClick={saveTypes}>
          <Save className="h-4 w-4 mr-1.5" /> Save
        </Button>
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[620px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Leave type</th>
              <th className="px-3 py-2 font-medium">Days / year</th>
              <th className="px-3 py-2 font-medium">Accrual</th>
              <th className="px-3 py-2 font-medium">Carry forward max</th>
              <th className="px-3 py-2 font-medium">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {planTypes.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No leave types on this plan.</td></tr>
            ) : planTypes.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="text-muted-foreground"> · {t.code}</span>
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.5" value={t.annual_days}
                    onChange={(e) => editType(t.id, { annual_days: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-xs" />
                </td>
                <td className="px-3 py-2">
                  <select value={t.accrual} onChange={(e) => editType(t.id, { accrual: e.target.value })}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs">
                    <option value="annual">All at year start</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.5" value={t.carry_forward_max}
                    onChange={(e) => editType(t.id, { carry_forward_max: Number(e.target.value) })}
                    className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-xs" />
                </td>
                <td className="px-3 py-2">
                  {t.is_paid ? <Badge variant="outline" className="text-[10px]">Paid</Badge>
                            : <Badge variant="outline" className="text-[10px] text-muted-foreground">Unpaid</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Day counts are conventional defaults, not NIMT's policy — set them from the real policy
        document before granting a year. Granting is idempotent: re-running updates entitlement
        without touching leave already taken.
      </p>
    </div>
  );
}

export default LeavePlansPanel;
