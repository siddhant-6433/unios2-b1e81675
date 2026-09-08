// Moves already-paid money between fee heads (or head -> unallocated credit)
// via the transfer_fee_allocation RPC, which also relocates fee_ledger_payments
// so the source head does not stay "Paid" against a leftover link / no receipt.
// Reason is mandatory — the RPC itself raises if it's empty, but we also gate
// the submit button client-side.

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
  // A fully-paid dest has no room; the RPC would overflow the whole amount to
  // credit and a later Apply Credit (auto) can put it straight back on the
  // source — Uniform 2026 is often the next-earliest unpaid head. Destinations
  // must have a due balance; unallocating is the explicit Credit option.
  const toOptions = fees.filter(f => f.id !== fromId && Number(f.balance || 0) > 0);
  const toFee = toOptions.find(f => f.id === toId);
  const destRoom = toId && toId !== TO_CREDIT ? Number(toFee?.balance || 0) : 0;
  const amt = Number(amount) || 0;
  const overflow = toId && toId !== TO_CREDIT && amt > destRoom ? amt - destRoom : 0;

  const canSubmit = fromId && toId && amt > 0 &&
    (!fromFee || amt <= Number(fromFee.paid_amount)) && reason.trim().length > 0;

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
    const moved = Number(data?.moved || amount);
    const toHead = Number(data?.to_head || 0);
    const toCredit = Number(data?.to_credit || 0);
    toast({
      title: "Transferred",
      description: toCredit > 0 && toHead > 0
        ? `₹${toHead.toLocaleString("en-IN")} applied to the destination, ₹${toCredit.toLocaleString("en-IN")} to credit.`
        : toCredit > 0
          ? `₹${moved.toLocaleString("en-IN")} moved to unallocated credit.`
          : `₹${moved.toLocaleString("en-IN")} moved.`,
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

          {overflow > 0 && (
            <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              Destination only has ₹{destRoom.toLocaleString("en-IN")} due. ₹{overflow.toLocaleString("en-IN")} will
              go to unallocated credit — pick Credit if that is the intent.
            </p>
          )}

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
