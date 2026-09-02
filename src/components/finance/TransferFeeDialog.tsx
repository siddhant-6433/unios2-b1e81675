// Moves already-paid money between fee heads (or head -> unallocated credit)
// via the transfer_fee_allocation RPC. Reason is mandatory — the RPC itself
// raises if it's empty, but we also gate the submit button client-side.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { ArrowLeftRight } from "lucide-react";
import { feeTermLabel, type FeeStructureMetadata } from "@/lib/feeTermLabels";

const TO_CREDIT = "__credit__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** Period wording from the programme's active fee structure — D.AOTT's
   *  year_N terms are semesters. Threaded from StudentFeePanel, which has
   *  already resolved it, so each dialog need not re-query. */
  feeMeta?: FeeStructureMetadata;
  fees: any[];
  onSuccess: () => void;
}

export function TransferFeeDialog({ open, onOpenChange, fees, onSuccess, feeMeta }: Props) {
  const { toast } = useToast();
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const fromOptions = fees.filter(f => Number(f.paid_amount || 0) > 0);
  const fromFee = fromOptions.find(f => f.id === fromId);
  const toOptions = fees.filter(f => f.id !== fromId);

  const canSubmit = fromId && toId && Number(amount) > 0 &&
    (!fromFee || Number(amount) <= Number(fromFee.paid_amount)) && reason.trim().length > 0;

  const reset = () => { setFromId(""); setToId(""); setAmount(""); setReason(""); };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("transfer_fee_allocation", {
      _from_fee_ledger_id: fromId,
      _to_fee_ledger_id: toId === TO_CREDIT ? null : toId,
      _amount: Number(amount),
      _reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Transferred",
      description: `₹${Number(data?.moved || amount).toLocaleString("en-IN")} moved${data?.to_credit ? " to unallocated credit" : ""}.`,
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
            <ArrowLeftRight className="h-4 w-4 text-primary" /> Transfer Fee Allocation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <SelectField
            value={fromId}
            onValueChange={(v) => { setFromId(v); setAmount(""); if (toId === v) setToId(""); }}
            options={fromOptions.map(f => ({
              value: f.id,
              label: `${f.fee_codes?.code || "Fee"} — ${feeTermLabel(f.term, feeMeta)} — ₹${Number(f.paid_amount).toLocaleString("en-IN")} paid`,
            }))}
            label="From"
            placeholder="Select source head"
          />

          <SelectField
            value={toId}
            onValueChange={setToId}
            options={[
              { value: TO_CREDIT, label: "→ Credit (unallocate)" },
              ...toOptions.map(f => ({
                value: f.id,
                label: `${f.fee_codes?.code || "Fee"} — ${feeTermLabel(f.term, feeMeta)} — ₹${Number(f.balance || 0).toLocaleString("en-IN")} due`,
              })),
            ]}
            label="To"
            placeholder="Select destination"
            disabled={!fromId}
          />

          <FieldShell label="Amount" required>
            <Input
              type="number" min="1" step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={fromFee ? `Up to ₹${Number(fromFee.paid_amount).toLocaleString("en-IN")}` : "0"}
              disabled={!fromId}
            />
          </FieldShell>

          <TextAreaField
            value={reason}
            onValueChange={setReason}
            label="Reason"
            required
            placeholder="Why is this being reallocated? (required)"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !canSubmit}>
            {saving ? <ButtonOrb state="working" onFilled /> : null}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
