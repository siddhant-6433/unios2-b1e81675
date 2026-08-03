// Shared "fee-head breakup" editor for payment collection. Staff split a total
// into variable amounts per fee head; the breakup rides on the payment and is
// mapped to the student's real fee_ledger heads at settlement/admission by
// provision_student_fees. Used by SendPaymentLinkDialog and OfflinePaymentDialog.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2 } from "lucide-react";

export interface FeeAllocation {
  fee_code_id: string;
  amount: number;
  label: string;
}

interface HeadOption {
  fee_code_id: string;
  label: string;
  due: number;        // outstanding balance across this head's ledger rows (0 for catalog heads)
  concession: number; // waiver/concession already applied on this head (offer waivers sync into fee_ledger.concession)
}

interface Props {
  open: boolean;
  studentId?: string | null;
  leadId?: string | null;
  value: FeeAllocation[];
  onChange: (rows: FeeAllocation[]) => void;
  /**
   * "add"  — start empty, staff add heads one at a time (offline collection).
   * "all"  — list every outstanding head pre-ticked at its due, each one
   *          editable or switched off. Used by Collect Fee, where the point is
   *          to show the whole fee structure and let the cashier trim it.
   */
  variant?: "add" | "all";
}

// No width class here — the row applies widths explicitly (a `w-full` in the
// base fights `flex-1`/`w-24` and collapses the select to just its chevron).
const inputCls =
  "rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// Fee-code categories worth billing ad-hoc (excludes token/exam/late_fee).
const CATALOG_CATEGORIES = ["transport", "other", "hostel", "lab", "library", "tuition", "enrollment"];

export function FeeHeadAllocationField({ open, studentId, leadId, value, onChange, variant = "add" }: Props) {
  const [heads, setHeads] = useState<HeadOption[]>([]);
  const [hasLedger, setHasLedger] = useState(false);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!open) { prefilled.current = false; return; }
    let cancelled = false;
    (async () => {
      // Resolve student from lead if only leadId was given.
      let sid = studentId || null;
      if (!sid && leadId) {
        const { data: s } = await supabase.from("students").select("id").eq("lead_id", leadId).maybeSingle();
        sid = s?.id || null;
      }

      if (sid) {
        // Post-admission: the student's actual ledger heads (one entry per fee_code),
        // carrying the outstanding due (Σ balance) so the amount can default to it.
        const { data: rows } = await supabase
          .from("fee_ledger")
          .select("fee_code_id, term, balance, concession, fee_codes:fee_code_id(code, name)")
          .eq("student_id", sid)
          .order("due_date");
        if (cancelled) return;
        const byCode = new Map<string, HeadOption>();
        for (const r of (rows || []) as any[]) {
          if (!r.fee_code_id) continue;
          const name = r.fee_codes?.name || r.fee_codes?.code || "Fee";
          const bal = Math.max(0, Number(r.balance || 0));
          const conc = Math.max(0, Number(r.concession || 0));
          const existing = byCode.get(r.fee_code_id);
          if (existing) {
            existing.due += bal;
            existing.concession += conc;
          } else {
            byCode.set(r.fee_code_id, {
              fee_code_id: r.fee_code_id,
              label: `${name} (${r.fee_codes?.code || "—"})`,
              due: bal,
              concession: conc,
            });
          }
        }
        if (byCode.size > 0) {
          setHasLedger(true);
          // Hide heads already paid in full (nothing left to collect). The due
          // shown is net of any waiver/concession (fee_ledger.balance already
          // subtracts concession).
          setHeads([...byCode.values()].filter((h) => h.due > 0));
          return;
        }
      }

      // Pre-admission (no ledger yet): the fee-code catalog. Mapped once the
      // ledger is provisioned at admission.
      const { data: codes } = await supabase
        .from("fee_codes")
        .select("id, code, name, category")
        .in("category", CATALOG_CATEGORIES)
        .order("name");
      if (cancelled) return;
      setHasLedger(false);
      setHeads((codes || []).map((c: any) => ({ fee_code_id: c.id, label: `${c.name} (${c.code})`, due: 0, concession: 0 })));
    })();
    return () => { cancelled = true; };
  }, [open, studentId, leadId]);

  // variant="all": tick every head at its outstanding due the first time they
  // load. Runs once per open so the cashier's edits are never overwritten.
  useEffect(() => {
    if (variant !== "all" || prefilled.current || heads.length === 0) return;
    prefilled.current = true;
    if (value.length > 0) return; // caller already seeded a breakup
    onChange(heads.filter((h) => h.due > 0).map((h) => ({
      fee_code_id: h.fee_code_id, amount: h.due, label: h.label,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heads, variant]);

  const total = useMemo(() => value.reduce((s, r) => s + (Number(r.amount) || 0), 0), [value]);

  // A head is "on" when it has a row in value; toggling off drops the row so the
  // wire format stays exactly the enabled heads.
  const rowFor = (feeCodeId: string) => value.find((r) => r.fee_code_id === feeCodeId) || null;
  const toggleHead = (h: HeadOption, on: boolean) =>
    onChange(on
      ? [...value, { fee_code_id: h.fee_code_id, amount: h.due, label: h.label }]
      : value.filter((r) => r.fee_code_id !== h.fee_code_id));
  const setHeadAmount = (feeCodeId: string, amount: number) =>
    onChange(value.map((r) => (r.fee_code_id === feeCodeId ? { ...r, amount } : r)));

  const addRow = () => onChange([...value, { fee_code_id: "", amount: 0, label: "" }]);
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<FeeAllocation>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  if (heads.length === 0) return null;

  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">
          Fee head breakup {hasLedger ? "" : "(mapped at admission)"}
        </p>
        {variant === "add" && (
          <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add head
          </button>
        )}
      </div>

      {variant === "all" && heads.map((h) => {
        const row = rowFor(h.fee_code_id);
        const on = !!row;
        return (
          <div key={h.fee_code_id} className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => toggleHead(h, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-primary"
                title={on ? "Exclude this head" : "Include this head"}
              />
              <span className={`min-w-0 flex-1 truncate text-sm ${on ? "text-foreground" : "text-muted-foreground line-through"}`}>
                {h.label}
              </span>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                value={on ? (row!.amount || "") : ""}
                onChange={(e) => setHeadAmount(h.fee_code_id, Math.max(0, Number(e.target.value) || 0))}
                disabled={!on}
                placeholder="₹"
                className={`${inputCls} w-24 shrink-0 disabled:opacity-50`}
              />
            </div>
            {(h.due > 0 || h.concession > 0) && (
              <div className="flex flex-wrap gap-x-3 pl-6 text-[10px] text-muted-foreground">
                {h.due > 0 && <span>₹{h.due.toLocaleString("en-IN")} due</span>}
                {h.concession > 0 && (
                  <span className="text-success">− ₹{h.concession.toLocaleString("en-IN")} waived (offer/concession)</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {variant === "add" && value.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Optional — split the amount across specific heads so it maps correctly. Leave empty to use the default routing.
        </p>
      )}

      {variant === "add" && value.map((row, i) => {
        const head = heads.find((x) => x.fee_code_id === row.fee_code_id);
        return (
          <div key={i} className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <select
                value={row.fee_code_id}
                onChange={(e) => {
                  const h = heads.find((x) => x.fee_code_id === e.target.value);
                  // Default the amount to the head's outstanding due (editable). Catalog
                  // heads have no ledger yet → 0.
                  updateRow(i, { fee_code_id: e.target.value, label: h?.label || "", amount: h?.due ?? 0 });
                }}
                className={`${inputCls} w-0 min-w-0 flex-1 truncate`}
              >
                <option value="">Select head…</option>
                {heads.map((h) => (
                  <option key={h.fee_code_id} value={h.fee_code_id}>{h.label}</option>
                ))}
              </select>
              <input
                type="number" min="0" step="1" inputMode="numeric"
                value={row.amount || ""}
                onChange={(e) => updateRow(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
                placeholder="₹"
                className={`${inputCls} w-24 shrink-0`}
              />
              <button type="button" onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Due + already-applied waiver/concession (read-only). Due is net of the waiver. */}
            {head && (head.due > 0 || head.concession > 0) && (
              <div className="flex flex-wrap gap-x-3 pl-0.5 text-[10px] text-muted-foreground">
                {head.due > 0 && <span>₹{head.due.toLocaleString("en-IN")} due</span>}
                {head.concession > 0 && (
                  <span className="text-success">− ₹{head.concession.toLocaleString("en-IN")} waived (offer/concession)</span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {value.length > 0 && (
        <div className="flex justify-between border-t border-border/60 pt-2 text-xs font-semibold text-foreground">
          <span>{variant === "all" ? "Total to collect" : "Breakup total"}</span>
          <span>₹{total.toLocaleString("en-IN")}</span>
        </div>
      )}
    </div>
  );
}
