import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";

interface FeeCodeOption {
  id: string;
  code: string;
  name: string;
  category: string;
}

export interface EditableFeeItem {
  id: string;
  fee_code_id: string;
  term: string;
  amount: number;
  due_day: number;
  due_month: number | null;
  due_year_offset: number;
  due_date: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeStructureId: string;
  feeCodes: FeeCodeOption[];
  item?: EditableFeeItem | null;
  onSaved: () => void;
}

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

export function FeeStructureEditDialog({ open, onOpenChange, feeStructureId, feeCodes, item, onSaved }: Props) {
  const { toast } = useToast();
  const [feeCodeId, setFeeCodeId] = useState("");
  const [term, setTerm] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("10");
  const [dueMonth, setDueMonth] = useState("");
  const [dueYearOffset, setDueYearOffset] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFeeCodeId(item?.fee_code_id || "");
    setTerm(item?.term || "");
    setAmount(item ? String(item.amount) : "");
    setDueDay(item ? String(item.due_day ?? 10) : "10");
    setDueMonth(item?.due_month != null ? String(item.due_month) : "");
    setDueYearOffset(item ? String(item.due_year_offset ?? 0) : "0");
    setDueDate(item?.due_date ? item.due_date.slice(0, 10) : "");
  }, [open, item]);

  const handleSave = async () => {
    if (!feeCodeId || !term.trim() || !amount) {
      toast({ title: "Missing fields", description: "Fee code, term and amount are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("upsert_fee_structure_item", {
      _fee_structure_id: feeStructureId,
      _fee_code_id: feeCodeId,
      _term: term.trim(),
      _amount: Number(amount),
      _due_day: Number(dueDay) || 10,
      _item_id: item?.id || null,
      _due_month: dueMonth === "" ? null : Number(dueMonth),
      _due_year_offset: Number(dueYearOffset) || 0,
      _due_date: dueDate === "" ? null : dueDate,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save fee item", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: item ? "Fee item updated" : "Fee item added" });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit fee item" : "Add fee item"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Fee code</label>
            <select value={feeCodeId} onChange={e => setFeeCodeId(e.target.value)} className={inputCls}>
              <option value="">Select fee code...</option>
              {feeCodes.map(fc => (
                <option key={fc.id} value={fc.id}>{fc.name} ({fc.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Term</label>
            <input type="text" value={term} onChange={e => setTerm(e.target.value)} placeholder="e.g. q1, annual, year_1" className={inputCls} />
          </div>

          {/* ponytail: native date input, no picker lib */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Due date (exact)</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            <p className="text-[10px] text-muted-foreground mt-1">
              {dueDate ? "This exact date is used (late fines compute off it)." : "Optional. When set, it overrides the fallback below."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Amount (₹)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Due day</label>
              <input type="number" value={dueDay} onChange={e => setDueDay(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <p className="text-[10px] text-muted-foreground">Fallback if no exact date set</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Due month</label>
                <select value={dueMonth} onChange={e => setDueMonth(e.target.value)} className={inputCls}>
                  <option value="">Auto</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Year offset</label>
                <input type="number" min={0} value={dueYearOffset} onChange={e => setDueYearOffset(e.target.value)} className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">years after admission year</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <ButtonOrb state="working" onFilled /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
