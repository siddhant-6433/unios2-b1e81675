import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";

interface FeeCode {
  id: string;
  code: string;
  name: string;
  category: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  onSuccess: () => void;
}

type Frequency = "monthly" | "quarterly";

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// A billing row to create: month-anchored term, the amount charged that month,
// and the due date (always the 10th of the anchor month).
interface PreviewRow {
  term: string;
  amount: number;
  due_date: string;
  label: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// startMonth is "YYYY-MM" from <input type="month">. Quarterly rows step 3
// months and charge 3× the monthly rate (e.g. Meal ₹3000/mo billed quarterly).
export function buildRows(startMonth: string, count: number, freq: Frequency, perMonth: number): PreviewRow[] {
  if (!startMonth || !count || !perMonth) return [];
  const [y, m] = startMonth.split("-").map(Number);
  if (!y || !m) return [];
  const step = freq === "quarterly" ? 3 : 1;
  const amount = freq === "quarterly" ? perMonth * 3 : perMonth;
  const rows: PreviewRow[] = [];
  for (let i = 0; i < count; i++) {
    const monthIdx = m - 1 + i * step;
    const year = y + Math.floor(monthIdx / 12);
    const month = (monthIdx % 12) + 1; // 1..12
    const mm = String(month).padStart(2, "0");
    rows.push({
      term: `m_${year}_${mm}`,
      amount,
      due_date: `${year}-${mm}-10`,
      label: `${MONTHS[month - 1]} ${year}`,
    });
  }
  return rows;
}

export function AddFeeHeadDialog({ open, onOpenChange, studentId, onSuccess }: Props) {
  const { toast } = useToast();
  const [feeCodes, setFeeCodes] = useState<FeeCode[]>([]);
  const [feeCodeId, setFeeCodeId] = useState("");
  const [freq, setFreq] = useState<Frequency>("monthly");
  const [perMonth, setPerMonth] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [count, setCount] = useState("12");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFeeCodeId("");
    setFreq("monthly");
    setPerMonth("");
    setStartMonth("");
    setCount("12");
    (async () => {
      const { data } = await supabase
        .from("fee_codes")
        .select("id, code, name, category")
        .in("category", ["transport", "other", "hostel", "lab", "library"])
        .order("name");
      if (data) setFeeCodes(data);
    })();
  }, [open]);

  const rows = useMemo(
    () => buildRows(startMonth, Number(count), freq, Number(perMonth)),
    [startMonth, count, freq, perMonth],
  );
  const rowTotal = rows.reduce((s, r) => s + r.amount, 0);

  const handleSave = async () => {
    if (!feeCodeId || rows.length === 0) {
      toast({ title: "Missing fields", description: "Pick a fee head, amount, start month and count.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("add_student_fee_ledger_rows", {
      _student_id: studentId,
      _fee_code_id: feeCodeId,
      _rows: rows.map(({ term, amount, due_date }) => ({ term, amount, due_date })),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add fee head", description: error.message, variant: "destructive" });
      return;
    }
    const created = Number(data ?? 0);
    toast({
      title: created > 0 ? "Fee head applied" : "Nothing to add",
      description: created > 0
        ? `${created} month${created === 1 ? "" : "s"} added to the ledger.`
        : "All selected months already exist for this fee head.",
    });
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add fee head</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Fee head</label>
            <select value={feeCodeId} onChange={e => setFeeCodeId(e.target.value)} className={inputCls}>
              <option value="">Select fee head...</option>
              {feeCodes.map(fc => (
                <option key={fc.id} value={fc.id}>{fc.name} ({fc.code})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Billing</label>
              <select value={freq} onChange={e => setFreq(e.target.value as Frequency)} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Amount / month (₹)</label>
              <input type="number" min={0} value={perMonth} onChange={e => setPerMonth(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {/* ponytail: native month input, no picker lib */}
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Start month</label>
              <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                {freq === "quarterly" ? "No. of quarters" : "No. of months"}
              </label>
              <input type="number" min={1} max={48} value={count} onChange={e => setCount(e.target.value)} className={inputCls} />
            </div>
          </div>

          {rows.length > 0 && (
            <div className="rounded-xl border border-border/60 overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-[11px] font-semibold text-muted-foreground flex justify-between">
                <span>{rows.length} installment{rows.length === 1 ? "" : "s"} · due 10th</span>
                <span>Total ₹{rowTotal.toLocaleString("en-IN")}</span>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-border/60">
                {rows.map(r => (
                  <div key={r.term} className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="text-foreground">₹{r.amount.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Months already added for this fee head are skipped, so you can extend later safely.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || rows.length === 0} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
