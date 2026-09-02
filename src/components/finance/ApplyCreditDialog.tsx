// Applies a student's unallocated general fee credit onto a fee head via the
// apply_student_credit RPC. Auto-picks the earliest-due head unless the user
// picks a specific one.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { Wallet } from "lucide-react";
import { feeTermLabel, type FeeStructureMetadata } from "@/lib/feeTermLabels";

const AUTO = "__auto__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId?: string;
  /** Period wording from the programme's active fee structure — D.AOTT's
   *  year_N terms are semesters. Threaded from StudentFeePanel, which has
   *  already resolved it, so each dialog need not re-query. */
  feeMeta?: FeeStructureMetadata;
  leadId?: string;
  fees: any[];
  availableCredit: number;
  onSuccess: () => void;
}

export function ApplyCreditDialog({ open, onOpenChange, studentId, leadId, fees, availableCredit, onSuccess, feeMeta }: Props) {
  const { toast } = useToast();
  const [feeLedgerId, setFeeLedgerId] = useState<string>(AUTO);
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const payableFees = fees.filter(f => Number(f.balance || 0) > 0);
  const chosen = feeLedgerId !== AUTO ? payableFees.find(f => f.id === feeLedgerId) : null;
  const maxAmount = chosen ? Math.min(availableCredit, Number(chosen.balance || 0)) : availableCredit;

  const reset = () => { setFeeLedgerId(AUTO); setAmount(""); setReason(""); };

  const handleSubmit = async () => {
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("apply_student_credit", {
      _id: studentId || leadId,
      _fee_ledger_id: feeLedgerId === AUTO ? null : feeLedgerId,
      _amount: amount.trim() ? Number(amount) : null,
      _reason: reason.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not apply credit", description: error.message, variant: "destructive" });
      return;
    }
    const applied = Number(data?.applied || 0);
    if (applied <= 0) {
      toast({ title: "No credit applied", description: data?.note || "No available credit.", variant: "destructive" });
      return;
    }
    toast({
      title: "Credit applied",
      description: `₹${applied.toLocaleString("en-IN")} applied. ₹${Number(data?.remaining_credit || 0).toLocaleString("en-IN")} credit remaining.`,
    });
    reset();
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Apply Credit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">Available credit: </span>
            <span className="font-semibold text-foreground">₹{availableCredit.toLocaleString("en-IN")}</span>
          </div>

          <SelectField
            value={feeLedgerId}
            onValueChange={setFeeLedgerId}
            options={[
              { value: AUTO, label: "Auto (earliest due first)" },
              ...payableFees.map(f => ({
                value: f.id,
                label: `${f.fee_codes?.code || "Fee"} — ${feeTermLabel(f.term, feeMeta)} — ₹${Number(f.balance).toLocaleString("en-IN")} due`,
              })),
            ]}
            label="Apply to"
            allowEmpty={false}
          />

          <FieldShell label="Amount (optional — defaults to max available)">
            <Input
              type="number" min="1" step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={`Up to ₹${maxAmount.toLocaleString("en-IN")}`}
            />
          </FieldShell>

          <TextAreaField
            value={reason}
            onValueChange={setReason}
            label="Reason (optional)"
            placeholder="Internal note"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || availableCredit <= 0}>
            {saving ? <ButtonOrb state="working" onFilled /> : null}
            Apply Credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
