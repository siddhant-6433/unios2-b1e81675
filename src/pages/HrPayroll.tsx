// Payroll — monthly cycles that build their own roster.
//
// The point of this screen is that nobody retypes 85 names a month. Opening a cycle
// calls populate_payroll_cycle(), which inserts a line for every verified employee of
// that legal entity who was employed for any part of the period, pro-rated for
// mid-month joiners and leavers.
//
// Amounts are computed here (src/lib/payroll.ts) and written back as a snapshot, so a
// later salary revision or profile edit cannot silently change a released payslip.
// Locking is enforced in the database as well as here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/state-fields";
import { Lock, Plus, RefreshCw, Calculator, IndianRupee, AlertTriangle, ArrowLeft, Upload } from "lucide-react";
import {
  computePayroll, ratesFromConfig, type SalaryComponent, type StatutoryRates,
} from "@/lib/payroll";
import { SalaryImportDialog } from "@/components/hr/SalaryImportDialog";

interface LegalEntity { id: string; name: string }

interface Cycle {
  id: string;
  legal_entity_id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "processing" | "locked" | "paid";
  /** Set when a month is paid in several runs ("Teaching staff", "Kotputli"). */
  name: string | null;
}

interface Uncovered {
  employee_profile_id: string;
  employee_name: string | null;
  designation: string | null;
  worker_type: string | null;
}

interface Line {
  id: string;
  employee_profile_id: string;
  employee_name: string | null;
  employee_number: string | null;
  designation: string | null;
  monthly_gross: number;
  total_days: number;
  payable_days: number;
  lop_days: number;
  gross_earnings: number;
  total_deductions: number;
  employer_cost: number;
  net_pay: number;
  adhoc_earnings: number;
  adhoc_deductions: number;
  on_hold: boolean;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const monthLabel = (start: string) =>
  new Date(`${start}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** Month bounds as plain ISO dates — never via toISOString(), which shifts by timezone. */
function monthBounds(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

const STATUS_STYLE: Record<Cycle["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  processing: "bg-chart-2/15 text-chart-2",
  locked: "bg-primary/15 text-primary",
  paid: "bg-emerald-600/15 text-emerald-700",
};

export default function HrPayroll() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canRun = can("hr", "payroll_run");

  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [entityId, setEntityId] = useState("");
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [openCycle, setOpenCycle] = useState<Cycle | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [rates, setRates] = useState<StatutoryRates | null>(null);
  const [unassigned, setUnassigned] = useState(0);
  const [uncovered, setUncovered] = useState<Uncovered[]>([]);
  const [workerType, setWorkerType] = useState("");
  const [runName, setRunName] = useState("");
  const [salaryImportOpen, setSalaryImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Reference data: entities, the component definitions, and the statutory rates.
  // Components come from the DB rather than code so the rates can be corrected against
  // the payroll spreadsheet without a deploy.
  useEffect(() => {
    (async () => {
      const [ent, comp, cfg, orphan] = await Promise.all([
        supabase.from("legal_entities").select("id, name").eq("is_active", true).order("name"),
        supabase.from("salary_components")
          .select("code, name, kind, calculation, basis_code, prorates, display_order")
          .eq("is_active", true).order("display_order"),
        supabase.from("payroll_statutory_config").select("key, numeric_value"),
        supabase.from("employee_profiles")
          .select("id", { count: "exact", head: true })
          .is("legal_entity_id", null).eq("verification_status", "verified"),
      ]);

      const list = (ent.data as LegalEntity[]) ?? [];
      setEntities(list);
      setEntityId((prev) => prev || list[0]?.id || "");
      // `value` is per-structure; until structures are configured every component
      // carries 0 and only fixed/statutory ones contribute.
      setComponents(((comp.data as Omit<SalaryComponent, "value">[]) ?? []).map((c) => ({ ...c, value: 0 })));
      setRates(ratesFromConfig((cfg.data as { key: string; numeric_value: number }[]) ?? []));
      setUnassigned(orphan.count ?? 0);
      setLoading(false);
    })();
  }, []);

  const fetchCycles = useCallback(async () => {
    if (!entityId) return;
    const { data } = await supabase
      .from("payroll_cycles")
      .select("id, legal_entity_id, period_start, period_end, status, name")
      .eq("legal_entity_id", entityId)
      .order("period_start", { ascending: false })
      .limit(36);
    setCycles((data as Cycle[]) ?? []);
  }, [entityId]);

  useEffect(() => { fetchCycles(); }, [fetchCycles]);

  const fetchLines = useCallback(async (cycleId: string) => {
    const all: Line[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("payroll_lines")
        .select("id, employee_profile_id, employee_name, employee_number, designation, monthly_gross, total_days, payable_days, lop_days, gross_earnings, total_deductions, employer_cost, net_pay, adhoc_earnings, adhoc_deductions, on_hold")
        .eq("payroll_cycle_id", cycleId)
        .order("employee_name")
        .range(from, from + 999);
      if (!data?.length) break;
      all.push(...(data as Line[]));
      if (data.length < 1000) break;
    }
    setLines(all);
  }, []);

  /**
   * Who is still unpaid for this month across every run. Partial payroll makes
   * "did we miss anyone?" the easy mistake, so the answer is always on screen.
   */
  const fetchUncovered = useCallback(async (cycle: Cycle) => {
    const { data } = await supabase.rpc("payroll_uncovered_employees", {
      _legal_entity_id: cycle.legal_entity_id,
      _period_start: cycle.period_start,
      _period_end: cycle.period_end,
    });
    setUncovered((data as Uncovered[]) ?? []);
  }, []);

  const open = async (cycle: Cycle) => {
    setOpenCycle(cycle);
    setLines([]);
    setUncovered([]);
    await Promise.all([fetchLines(cycle.id), fetchUncovered(cycle)]);
  };

  const createCycle = async () => {
    if (!entityId) return;
    // Default to the month before today — payroll is run in arrears.
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const { start, end } = monthBounds(prev.getFullYear(), prev.getMonth() + 1);

    setBusy("create");
    const { data, error } = await supabase
      .from("payroll_cycles")
      .insert({ legal_entity_id: entityId, period_start: start, period_end: end,
                name: runName.trim() || null })
      .select("id, legal_entity_id, period_start, period_end, status, name")
      .single();
    setBusy(null);

    if (error) {
      toast({ title: "Could not create the run", description: error.message, variant: "destructive" });
      return;
    }
    setRunName("");
    await fetchCycles();
    await open(data as Cycle);
  };

  /** The headline feature: build the roster from active employees. */
  const populate = async () => {
    if (!openCycle) return;
    setBusy("populate");
    const { data, error } = await supabase.rpc("populate_payroll_cycle", {
      _cycle_id: openCycle.id,
      _worker_types: workerType ? [workerType] : undefined,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not load employees", description: error.message, variant: "destructive" });
      return;
    }
    await fetchLines(openCycle.id);
    await fetchUncovered(openCycle);
    toast({
      title: `${data ?? 0} employees added`,
      description: (data ?? 0) === 0
        ? "Everyone matching is already covered by this run or another one this month."
        : undefined,
    });
  };

  /** Compute every line and store the result as a snapshot. */
  const computeAll = async () => {
    if (!openCycle || !rates) return;
    setBusy("compute");
    try {
      for (const line of lines) {
        if (line.on_hold) continue;
        const result = computePayroll({
          monthlyGross: Number(line.monthly_gross),
          totalDays: Number(line.total_days),
          payableDays: Number(line.payable_days),
          lopDays: Number(line.lop_days),
          components,
          rates,
          adhocEarnings: Number(line.adhoc_earnings),
          adhocDeductions: Number(line.adhoc_deductions),
        });

        const { error } = await supabase
          .from("payroll_lines")
          .update({
            gross_earnings: result.grossEarnings,
            total_deductions: result.totalDeductions,
            employer_cost: result.employerCost,
            net_pay: result.netPay,
            payable_days: result.payableDays,
          })
          .eq("id", line.id);
        if (error) throw error;

        // Replace the itemisation wholesale — simpler and safer than diffing.
        await supabase.from("payroll_line_components").delete().eq("payroll_line_id", line.id);
        if (result.components.length) {
          await supabase.from("payroll_line_components").insert(
            result.components.map((c) => ({
              payroll_line_id: line.id,
              component_code: c.code,
              component_name: c.name,
              kind: c.kind,
              amount: c.amount,
              display_order: c.display_order,
            })),
          );
        }
      }
      await fetchLines(openCycle.id);
      toast({ title: "Payroll calculated" });
    } catch (err) {
      toast({
        title: "Calculation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: Cycle["status"]) => {
    if (!openCycle) return;
    setBusy(status);
    const patch: { status: Cycle["status"]; locked_at?: string; locked_by?: string } = { status };
    if (status === "locked") {
      patch.locked_at = new Date().toISOString();
      patch.locked_by = (await supabase.auth.getUser()).data.user?.id;
    }
    const { data, error } = await supabase
      .from("payroll_cycles").update(patch).eq("id", openCycle.id)
      .select("id, legal_entity_id, period_start, period_end, status, name").single();
    setBusy(null);

    if (error || !data) {
      toast({ title: "Could not update the cycle", description: error?.message, variant: "destructive" });
      return;
    }
    setOpenCycle(data as Cycle);
    await fetchCycles();
  };

  const totals = useMemo(() => lines.reduce((acc, l) => ({
    gross: acc.gross + Number(l.gross_earnings),
    deductions: acc.deductions + Number(l.total_deductions),
    net: acc.net + Number(l.net_pay),
    cost: acc.cost + Number(l.gross_earnings) + Number(l.employer_cost),
  }), { gross: 0, deductions: 0, net: 0, cost: 0 }), [lines]);

  const noSalary = lines.filter((l) => Number(l.monthly_gross) <= 0).length;
  const editable = openCycle?.status === "draft" || openCycle?.status === "processing";

  if (loading) return <PageLoader />;

  if (!canRun) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">Payroll is restricted</p>
        <p className="text-xs text-muted-foreground mt-1">You need the “Run payroll” permission.</p>
      </div>
    );
  }

  // ── Cycle list ────────────────────────────────────────────────────────
  if (!openCycle) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Each cycle builds its own list of active employees.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SelectField
              value={entityId}
              onValueChange={setEntityId}
              options={entities.map((e) => ({ value: e.id, label: e.name }))}
              ariaLabel="Legal entity"
              placeholder="Legal entity"
            />
            <input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Run name (optional)"
              title="Name a run when paying a month in parts, e.g. “Teaching staff”"
              className="w-44 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => setSalaryImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Import salaries
            </Button>
            <Button size="sm" onClick={createCycle} disabled={busy === "create"}>
              <Plus className="h-4 w-4 mr-1.5" /> New run
            </Button>
          </div>
        </div>

        {unassigned > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>{unassigned}</strong> employees have no legal entity and will be left out of
              every payroll run. Set one on their profile before the next cycle.
            </span>
          </div>
        )}

        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          {cycles.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted-foreground text-sm">
              No payroll runs yet. “New run” creates one for the previous month.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {cycles.map((c) => (
                <button
                  key={c.id}
                  onClick={() => open(c)}
                  className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {monthLabel(c.period_start)}
                      {c.name && <span className="text-muted-foreground font-normal"> · {c.name}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.period_start} → {c.period_end}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLE[c.status]}`}>
                    {c.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <SalaryImportDialog
          open={salaryImportOpen}
          onOpenChange={setSalaryImportOpen}
          onSuccess={() => { if (openCycle) fetchLines(openCycle.id); }}
        />
      </div>
    );
  }

  // ── Single cycle ──────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setOpenCycle(null); fetchCycles(); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {monthLabel(openCycle.period_start)}
              {openCycle.name && <span className="text-muted-foreground font-normal"> · {openCycle.name}</span>}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {lines.length} employees · {openCycle.period_start} → {openCycle.period_end}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLE[openCycle.status]}`}>
            {openCycle.status}
          </span>
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={workerType}
              onChange={(e) => setWorkerType(e.target.value)}
              aria-label="Limit this run to a worker type"
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
            >
              <option value="">Everyone not yet covered</option>
              <option value="Permanent">Permanent only</option>
              <option value="Contract">Contract only</option>
              <option value="Probation">Probation only</option>
              <option value="Intern">Interns only</option>
            </select>
            <Button size="sm" variant="outline" onClick={populate} disabled={busy !== null}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Load employees
            </Button>
            <Button size="sm" variant="outline" onClick={computeAll} disabled={busy !== null || lines.length === 0}>
              <Calculator className="h-4 w-4 mr-1.5" /> Calculate
            </Button>
            <Button size="sm" onClick={() => setStatus("locked")} disabled={busy !== null || totals.net <= 0}>
              <Lock className="h-4 w-4 mr-1.5" /> Lock
            </Button>
          </div>
        )}
        {openCycle.status === "locked" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStatus("processing")}>Reopen</Button>
            <Button size="sm" onClick={() => setStatus("paid")}>Mark paid</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Gross earnings", value: totals.gross },
          { label: "Deductions", value: totals.deductions },
          { label: "Net payable", value: totals.net },
          { label: "Total cost to employer", value: totals.cost },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-card card-shadow p-4">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="text-lg font-semibold text-foreground mt-1 flex items-center">
              <IndianRupee className="h-4 w-4" />{inr(s.value)}
            </p>
          </div>
        ))}
      </div>

      {uncovered.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p>
                <strong>{uncovered.length}</strong> employees are not on any run for
                {" "}{monthLabel(openCycle.period_start)} yet.
              </p>
              <p className="text-muted-foreground mt-1">
                {uncovered.slice(0, 8).map((u) => u.employee_name || "Unnamed").join(", ")}
                {uncovered.length > 8 && ` +${uncovered.length - 8} more`}
              </p>
            </div>
          </div>
        </div>
      ) : lines.length > 0 && (
        <p className="text-[11px] text-emerald-700">
          Everyone employed in {monthLabel(openCycle.period_start)} is covered by a run.
        </p>
      )}

      {noSalary > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            <strong>{noSalary}</strong> employees have no salary on record and will calculate to zero.
            Set their salary before locking.
          </span>
        </div>
      )}

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[820px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium text-right">Monthly gross</th>
              <th className="px-3 py-2 font-medium text-right">Days</th>
              <th className="px-3 py-2 font-medium text-right">LOP</th>
              <th className="px-3 py-2 font-medium text-right">Earnings</th>
              <th className="px-3 py-2 font-medium text-right">Deductions</th>
              <th className="px-3 py-2 font-medium text-right">Net pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  Nobody on this cycle yet — “Load active employees” builds the list.
                </td>
              </tr>
            ) : lines.map((l) => (
              <tr key={l.id} className={l.on_hold ? "opacity-50" : ""}>
                <td className="px-3 py-2">
                  <span className="font-medium text-foreground">{l.employee_name || "Unnamed"}</span>
                  {l.designation && <span className="text-muted-foreground"> · {l.designation}</span>}
                </td>
                <td className="px-3 py-2 text-right">{inr(Number(l.monthly_gross))}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {Number(l.payable_days)}/{Number(l.total_days)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{Number(l.lop_days) || "—"}</td>
                <td className="px-3 py-2 text-right">{inr(Number(l.gross_earnings))}</td>
                <td className="px-3 py-2 text-right">{inr(Number(l.total_deductions))}</td>
                <td className="px-3 py-2 text-right font-medium">{inr(Number(l.net_pay))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openCycle.status !== "draft" && (
        <p className="text-[11px] text-muted-foreground">
          A locked cycle cannot be edited — the database rejects changes to its lines. Corrections
          belong in a later cycle as arrears.
        </p>
      )}
    </div>
  );
}
