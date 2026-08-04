// Per-row waiver/concession, applied from the Concession cell of the fee table.
//
// Replaces the header "Request Waiver / Concession" button, which opened a
// dialog asking the cashier to re-select the row they were already pointing at.
//
// The RPC pair is unchanged from the dialog this replaces: request_fee_concession
// records the request, and a super_admin's own request is immediately decided by
// decide_fee_concession. Both routes end at sync_fee_ledger_concessions(), which
// recomputes fee_ledger.concession from source — the old direct
// `fee_ledger.concession = amount` write ASSIGNED rather than summed and wiped
// offer waivers sitting on the same row.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";

interface Props {
  fee: any;
  onDone: () => void;
}

export function RowConcessionPopover({ fee, onDone }: Props) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"flat" | "percentage">("flat");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = role === "super_admin";
  const total = Number(fee.total_amount || 0);
  const amount = !value ? 0
    : type === "flat" ? Number(value)
    : Math.round((total * Number(value)) / 100);

  const reset = () => { setType("flat"); setValue(""); setReason(""); };

  const submit = async () => {
    if (!(Number(value) > 0)) {
      toast({ title: "Enter a concession value", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "A reason is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: id, error } = await (supabase.rpc as any)("request_fee_concession", {
      _student_id: fee.student_id,
      _fee_ledger_id: fee.id,
      _type: type,
      _value: Number(value),
      _reason: reason.trim(),
    });
    if (error) {
      setSaving(false);
      toast({ title: "Could not request the waiver", description: error.message, variant: "destructive" });
      return;
    }
    if (isSuperAdmin && id) {
      const { error: decErr } = await (supabase.rpc as any)("decide_fee_concession", {
        _id: id, _approve: true, _note: null,
      });
      if (decErr) {
        setSaving(false);
        toast({ title: "Requested, but could not auto-approve", description: decErr.message, variant: "destructive" });
        return;
      }
    }
    setSaving(false);
    toast({
      title: isSuperAdmin ? "Waiver applied" : "Waiver requested",
      description: isSuperAdmin
        ? `₹${amount.toLocaleString("en-IN")} off ${fee.fee_codes?.code || "this head"}.`
        : `₹${amount.toLocaleString("en-IN")} sent for super admin approval.`,
    });
    reset();
    setOpen(false);
    onDone();
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
          title="Add a waiver / concession on this head"
        >
          <Plus className="h-3 w-3" /> Waiver
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">{fee.fee_codes?.code || "Fee"}</p>
          <p className="text-[11px] text-muted-foreground">
            {fee.fee_codes?.name} · ₹{total.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-input">
            <button
              onClick={() => setType("flat")}
              className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${type === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >₹ Flat</button>
            <button
              onClick={() => setType("percentage")}
              className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${type === "percentage" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >% Pct</button>
          </div>
          <input
            type="number" min={0} max={type === "percentage" ? 100 : total}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={type === "flat" ? "Amount" : "Percent"}
            autoFocus
            className="w-0 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        {amount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            − ₹{amount.toLocaleString("en-IN")} ·{" "}
            <span className="font-semibold text-foreground">
              Effective ₹{Math.max(0, total - amount).toLocaleString("en-IN")}
            </span>
          </p>
        )}

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          className="min-h-[56px] w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
        />

        <p className="text-[10px] text-muted-foreground">
          {isSuperAdmin
            ? "Applied immediately."
            : "Goes to the super admin. The ledger is unchanged until approved."}
        </p>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {isSuperAdmin ? "Apply" : "Request"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
