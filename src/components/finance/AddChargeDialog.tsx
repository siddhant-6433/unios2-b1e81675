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
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell, DatePickerField } from "@/components/ui/state-fields";
import { PlusCircle } from "lucide-react";
import { feeTermLabel, type FeeStructureMetadata } from "@/lib/feeTermLabels";

type TermOption = { term: string; due_date: string | null; rows: number };

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
  /** Period wording from the programme's active fee structure — D.AOTT's
   *  year_N terms are semesters. Threaded from StudentFeePanel, which has
   *  already resolved it, so each dialog need not re-query. */
  feeMeta?: FeeStructureMetadata;
  onAdded?: () => void;
}

export function AddChargeDialog({ open, onOpenChange, studentId, onAdded, feeMeta }: Props) {
  const { toast } = useToast();
  const [heads, setHeads] = useState<ChargeHead[]>([]);
  const [headId, setHeadId] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  // A recurring add-on (meal, transport) is billed with the quarters it belongs
  // to, not on a date of its own — so the charge can be hung off the student's
  // existing collection terms and inherit their due dates.
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = heads.find(h => h.id === headId) || null;

  useEffect(() => {
    if (!open || !studentId) return;
    setLoading(true);
    Promise.all([
      (supabase.rpc as any)("available_fee_charges", { _student_id: studentId, _lead_id: null }),
      (supabase.rpc as any)("student_fee_terms", { _student_id: studentId }),
    ]).then(([headsRes, termsRes]: any[]) => {
      if (headsRes.error) {
        toast({ title: "Could not load fee heads", description: headsRes.error.message, variant: "destructive" });
      }
      setHeads(headsRes.data || []);
      setTerms((termsRes.data || []) as TermOption[]);
      setLoading(false);
    });
  }, [open, studentId, toast]);

  const reset = () => {
    setHeadId("");
    setNote("");
    setSelectedTerms([]);
    setDueDate(new Date().toISOString().slice(0, 10));
  };

  const toggleTerm = (t: string) => {
    setSelectedTerms((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      // When exactly one term is selected we expose an editable due date,
      // prefilled to that term's own collection date. The cashier can then
      // shift it — e.g. bill a monthly add-on on 01 Aug under Q2 — while the
      // charge still groups under the quarter instead of "Other Charges".
      if (next.length === 1) {
        const only = terms.find((x) => x.term === next[0]);
        if (only?.due_date) setDueDate(only.due_date.slice(0, 10));
      } else if (next.length === 0) {
        setDueDate(new Date().toISOString().slice(0, 10));
      }
      return next;
    });
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
      // 0 or 1 term → the visible date is the intended one, send it. 2+ terms →
      // let each quarter inherit its own native date (a single date can't apply
      // to several), so send null.
      _due_date: selectedTerms.length <= 1 ? (dueDate || null) : null,
      _note: note.trim() || null,
      _terms: selectedTerms.length ? selectedTerms : null,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not add the charge", description: error.message, variant: "destructive" });
      return;
    }
    const each = Number(selected?.amount || 0).toLocaleString("en-IN");
    toast({
      title: "Charge added",
      description: selectedTerms.length
        ? `${selected?.name} of ₹${each} added to ${selectedTerms.length} term(s) — ₹${(Number(selected?.amount || 0) * selectedTerms.length).toLocaleString("en-IN")} total.`
        : `${selected?.name} of ₹${each} added to the ledger.`,
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
              <OrbLoader state="solving" />
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

              {/* Attach to existing collection terms so a recurring add-on is
                  billed on the same dates as the rest of that quarter. */}
              {terms.length > 0 && (
                <div className="rounded-lg border border-input bg-muted/20 p-3">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Apply to collection terms
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Tick one term to bill under it on the date below (editable — e.g. a
                    monthly instalment). Tick several to add one charge per term on each
                    term&rsquo;s own date. Leave all unticked for a one-off charge.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {terms.map((t) => (
                      <label
                        key={t.term}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTerms.includes(t.term)}
                          onChange={() => toggleTerm(t.term)}
                          className="h-3.5 w-3.5 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {feeTermLabel(t.term, feeMeta)}
                        </span>
                        {t.due_date && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {new Date(t.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  {selectedTerms.length > 0 && selected && (
                    <p className="mt-2 border-t border-border/60 pt-2 text-[11px] font-medium text-foreground">
                      {selectedTerms.length} × ₹{Number(selected.amount).toLocaleString("en-IN")} = ₹
                      {(Number(selected.amount) * selectedTerms.length).toLocaleString("en-IN")}
                    </p>
                  )}
                </div>
              )}

              {selectedTerms.length <= 1 && (
                <DatePickerField
                  label={selectedTerms.length === 1 ? "Due Date (under this term)" : "Due Date"}
                  value={dueDate}
                  onValueChange={setDueDate}
                  allowManualInput
                />
              )}

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
            {saving ? <ButtonOrb state="solving" onFilled /> : null}
            {saving ? "Adding…" : "Add Charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
