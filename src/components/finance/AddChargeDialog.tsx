// AddChargeDialog — levy an ad-hoc charge (Sports, Transfer Certificate,
// Arrear Fee…) onto a student's fee ledger.
//
// The catalog of heads and their amounts is configured by a super_admin in
// Finance → Setup → Custom Heads. The cashier picks a head; the amount comes
// from the server (levy_fee_charge reads it from the catalog row and ignores
// anything the client might send).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { Loader2, PlusCircle } from "lucide-react";

export type ChargeHead = {
  id: string;
  fee_code_id: string;
  code: string;
  name: string;
  amount: number;
  notes: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studentId: string;
  onAdded?: () => void;
}

export function AddChargeDialog({ open, onOpenChange, studentId, onAdded }: Props) {
  const { toast } = useToast();
  const [heads, setHeads] = useState<ChargeHead[]>([]);
  const [headId, setHeadId] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = heads.find(h => h.id === headId) || null;

  useEffect(() => {
    if (!open || !studentId) return;
    setLoading(true);
    (supabase.rpc as any)("available_fee_charges", { _student_id: studentId, _lead_id: null })
      .then(({ data, error }: { data: ChargeHead[] | null; error: { message: string } | null }) => {
        if (error) toast({ title: "Could not load fee heads", description: error.message, variant: "destructive" });
        setHeads(data || []);
        setLoading(false);
      });
  }, [open, studentId, toast]);

  const reset = () => {
    setHeadId("");
    setNote("");
    setDueDate(new Date().toISOString().slice(0, 10));
  };

  const handleSubmit = async () => {
    if (!headId) {
      toast({ title: "Select a fee head", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase.rpc as any)("levy_fee_charge", {
      _student_id: studentId,
      _head_id: headId,
      _due_date: dueDate || null,
      _note: note.trim() || null,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not add the charge", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Charge added",
      description: `${selected?.name} of ₹${Number(selected?.amount || 0).toLocaleString("en-IN")} added to the ledger.`,
    });
    reset();
    onOpenChange(false);
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4 text-primary" />
            Add Charge
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : heads.length === 0 ? (
            <p className="rounded-lg border border-input bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
              No custom fee heads are enabled for this student. A super admin can add them
              under Finance → Setup → Custom Heads.
            </p>
          ) : (
            <>
              <SelectField
                value={headId}
                onValueChange={setHeadId}
                options={[
                  { value: "", label: "Select a fee head" },
                  ...heads.map(h => ({ value: h.id, label: `${h.name} — ₹${Number(h.amount).toLocaleString("en-IN")}` })),
                ]}
                label="Fee Head"
                placeholder="Select a fee head"
              />

              <FieldShell label="Amount (₹)">
                <Input value={selected ? Number(selected.amount).toLocaleString("en-IN") : ""} readOnly placeholder="—" />
              </FieldShell>
              <p className="-mt-1 text-[11px] text-muted-foreground">
                Fixed by the super admin who enabled this head.
              </p>

              <FieldShell label="Due Date">
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </FieldShell>

              <TextAreaField
                value={note}
                onValueChange={setNote}
                label="Note (optional)"
                placeholder="Why is this charge being added?"
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !headId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {saving ? "Adding…" : "Add Charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
