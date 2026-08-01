import { useEffect, useMemo, useState } from "react";
import { buildFeeSchedule, type FeeFrequency, type FeeInstallment } from "@/lib/customFeeSchedule";

export interface FeeCodeOption {
  id: string;
  code: string;
  name: string;
  category: string;
}

export interface CustomFeePayload {
  mode: "one_off" | "template";
  feeCodeId: string | null;
  newCode: string | null;
  newName: string | null;
  newCategory: string | null;
  installments: FeeInstallment[];
  lateFeeConfig: { grace_days: number; penalty_type: string; penalty_amount: number; max_cap: number | null } | null;
}

interface Props {
  feeCodes: FeeCodeOption[];
  anchorYear: number;
  /** Show the one_off/template mode toggle (per-student & bulk both use it). */
  allowTemplate: boolean;
  templateLabel: string; // e.g. "Whole course + session" or "Apply to future admissions too"
  onChange: (payload: CustomFeePayload | null) => void;
}

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const CATEGORIES = ["meal", "transport", "tuition", "hostel", "lab", "library", "exam", "enrollment", "other"];

// Academic-year order (Apr→Mar) but store calendar month numbers.
const MONTHS = [
  [4, "Apr"], [5, "May"], [6, "Jun"], [7, "Jul"], [8, "Aug"], [9, "Sep"],
  [10, "Oct"], [11, "Nov"], [12, "Dec"], [1, "Jan"], [2, "Feb"], [3, "Mar"],
] as const;
const QUARTERS = [[1, "Q1 · Apr"], [2, "Q2 · Jul"], [3, "Q3 · Oct"], [4, "Q4 · Jan"]] as const;

export function CustomFeeForm({ feeCodes, anchorYear, allowTemplate, templateLabel, onChange }: Props) {
  const [mode, setMode] = useState<"one_off" | "template">("one_off");
  const [headMode, setHeadMode] = useState<"existing" | "new">("new");
  const [feeCodeId, setFeeCodeId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("meal");

  const [frequency, setFrequency] = useState<FeeFrequency>("quarterly");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [periods, setPeriods] = useState<number[]>([1, 2, 3, 4]);
  const [years, setYears] = useState("1");

  const [lateOn, setLateOn] = useState(false);
  const [graceDays, setGraceDays] = useState("0");
  const [penaltyType, setPenaltyType] = useState("daily");
  const [penaltyAmount, setPenaltyAmount] = useState("");
  const [maxCap, setMaxCap] = useState("");

  // Per-row overrides to amount / due_date the generated schedule.
  const [overrides, setOverrides] = useState<Record<number, Partial<FeeInstallment>>>({});

  const selectedPeriods = useMemo(() => {
    if (frequency === "annually") {
      const n = Math.max(1, Math.min(Number(years) || 1, 8));
      return Array.from({ length: n }, (_, i) => i + 1);
    }
    if (frequency === "one_time") return [];
    return periods;
  }, [frequency, periods, years]);

  const baseRows = useMemo(() => {
    const amt = Number(monthlyAmount);
    if (!amt || amt <= 0) return [] as FeeInstallment[];
    if (frequency !== "one_time" && frequency !== "annually" && selectedPeriods.length === 0) return [];
    return buildFeeSchedule({ frequency, monthlyAmount: amt, periods: selectedPeriods, anchorYear });
  }, [frequency, monthlyAmount, selectedPeriods, anchorYear]);

  // Reset overrides whenever the base schedule shape changes.
  useEffect(() => { setOverrides({}); }, [frequency, monthlyAmount, selectedPeriods.join(","), anchorYear]);

  const installments = useMemo(
    () => baseRows.map((r, i) => ({ ...r, ...overrides[i] })),
    [baseRows, overrides],
  );

  const togglePeriod = (n: number) =>
    setPeriods((prev) => (prev.includes(n) ? prev.filter((p) => p !== n) : [...prev, n]));

  // Emit the ready-to-send payload (or null if incomplete) to the parent.
  useEffect(() => {
    const headOk = headMode === "existing" ? !!feeCodeId : !!(newCode.trim() && newName.trim() && newCategory);
    const rowsOk = installments.length > 0 && installments.every((r) => Number(r.amount) >= 0 && r.term);
    if (!headOk || !rowsOk) { onChange(null); return; }

    const lateFeeConfig = lateOn && Number(penaltyAmount) > 0
      ? {
          grace_days: Number(graceDays) || 0,
          penalty_type: penaltyType,
          penalty_amount: Number(penaltyAmount),
          max_cap: maxCap.trim() === "" ? null : Number(maxCap),
        }
      : null;

    onChange({
      mode: allowTemplate ? mode : "one_off",
      feeCodeId: headMode === "existing" ? feeCodeId : null,
      newCode: headMode === "new" ? newCode.trim() : null,
      newName: headMode === "new" ? newName.trim() : null,
      newCategory: headMode === "new" ? newCategory : null,
      installments,
      lateFeeConfig,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, headMode, feeCodeId, newCode, newName, newCategory, installments, lateOn, graceDays, penaltyType, penaltyAmount, maxCap, allowTemplate]);

  const amountLabel = frequency === "one_time" ? "Amount (₹)"
    : frequency === "monthly" ? "Amount per month (₹)"
    : frequency === "quarterly" ? "Amount per month (₹) — billed ×3 per quarter"
    : "Amount per month (₹) — billed ×12 per year";

  return (
    <div className="space-y-4">
      {/* Fee head */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Fee head</label>
        <div className="flex rounded-lg border border-input overflow-hidden w-fit mb-2">
          {(["new", "existing"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setHeadMode(m)}
              className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${headMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {m === "new" ? "New head" : "Existing head"}
            </button>
          ))}
        </div>
        {headMode === "existing" ? (
          <select value={feeCodeId} onChange={(e) => setFeeCodeId(e.target.value)} className={inputCls}>
            <option value="">Select fee head…</option>
            {feeCodes.map((fc) => <option key={fc.id} value={fc.id}>{fc.name} ({fc.code})</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code e.g. MEAL" className={inputCls} />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name e.g. Meal Add-on" className={`${inputCls} col-span-1`} />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Frequency + amount */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as FeeFrequency)} className={inputCls}>
            <option value="one_time">One-time</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">{amountLabel}</label>
          <input type="number" min={0} value={monthlyAmount} onChange={(e) => setMonthlyAmount(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* Period selection */}
      {frequency === "monthly" && (
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Months ({anchorYear}–{anchorYear + 1})</label>
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map(([n, lbl]) => (
              <button key={n} type="button" onClick={() => togglePeriod(n)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${periods.includes(n) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}
      {frequency === "quarterly" && (
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Quarters</label>
          <div className="flex flex-wrap gap-1.5">
            {QUARTERS.map(([n, lbl]) => (
              <button key={n} type="button" onClick={() => togglePeriod(n)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${periods.includes(n) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}
      {frequency === "annually" && (
        <div className="w-32">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Number of years</label>
          <input type="number" min={1} max={8} value={years} onChange={(e) => setYears(e.target.value)} className={inputCls} />
        </div>
      )}

      {/* Installment preview (editable amount + due date) */}
      {installments.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="px-3 py-2 bg-muted/40 text-[11px] font-medium text-muted-foreground">
            {installments.length} charge{installments.length !== 1 ? "s" : ""} · total ₹
            {installments.reduce((s, r) => s + Number(r.amount || 0), 0).toLocaleString("en-IN")}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {installments.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-2 text-xs font-medium text-foreground w-24">{r.term}</td>
                  <td className="px-3 py-2">
                    <input type="number" value={r.amount}
                      onChange={(e) => setOverrides((o) => ({ ...o, [i]: { ...o[i], amount: Number(e.target.value) } }))}
                      className="w-28 rounded-lg border border-input bg-background px-2 py-1 text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={r.due_date}
                      onChange={(e) => setOverrides((o) => ({ ...o, [i]: { ...o[i], due_date: e.target.value } }))}
                      className="rounded-lg border border-input bg-background px-2 py-1 text-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Late fine */}
      <div className="rounded-xl border border-border/60 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
          <input type="checkbox" checked={lateOn} onChange={(e) => setLateOn(e.target.checked)} />
          Add a late fine to this fee
        </label>
        {lateOn && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Grace days</label>
              <input type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Penalty type</label>
              <select value={penaltyType} onChange={(e) => setPenaltyType(e.target.value)} className={inputCls}>
                <option value="daily">Per day</option>
                <option value="flat">Flat (once)</option>
                <option value="percentage">% of balance</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">
                {penaltyType === "percentage" ? "Percent" : "Amount (₹)"}
              </label>
              <input type="number" min={0} value={penaltyAmount} onChange={(e) => setPenaltyAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Max cap (₹, optional)</label>
              <input type="number" min={0} value={maxCap} onChange={(e) => setMaxCap(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* Mode toggle */}
      {allowTemplate && (
        <div className="flex rounded-lg border border-input overflow-hidden w-fit">
          {(["one_off", "template"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {m === "one_off" ? "Selected students only" : templateLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
