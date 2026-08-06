// Per-row waiver/concession, applied from the Concession cell of the fee table.
//
// Replaces the header "Request Waiver / Concession" button, which opened a
// dialog asking the cashier to re-select the row they were already pointing at.
//
// Adds, and now also EDITS / REDUCES / REMOVES, the per-row concessions on this
// ledger head. Direction rules (server-enforced too):
//   - reduce / remove  → super_admin, accountant, counsellor — applied at once.
//   - increase / add   → super_admin applies immediately; others go for approval.
// Every add funnels through request_fee_concession (+ decide_fee_concession for a
// super_admin), every edit/remove through edit_fee_concession / remove_fee_concession.
// All routes end at sync_fee_ledger_concessions(), which recomputes
// fee_ledger.concession from source, so an offer-waiver share on the same row
// survives. Edit/remove additionally write a concession_audit row.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

interface Props {
  fee: any;
  onDone: () => void;
}

interface Concession {
  id: string;
  type: "flat" | "percentage";
  value: number;
  reason: string | null;
  status: string;
}

const effectiveAmount = (type: string, value: number, total: number) =>
  type === "flat" ? value : Math.round((total * value) / 100);

export function RowConcessionPopover({ fee, onDone }: Props) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"flat" | "percentage">("flat");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<Concession[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const isSuperAdmin = role === "super_admin";
  // Reduce / remove is open to the cashier and counsellor; increase is not.
  const canEdit = ["super_admin", "accountant", "counsellor"].includes(role || "");
  const total = Number(fee.total_amount || 0);
  const amount = !value ? 0 : effectiveAmount(type, Number(value), total);

  const reset = () => { setType("flat"); setValue(""); setReason(""); setEditingId(null); };

  const fetchExisting = async () => {
    const { data } = await supabase
      .from("concessions")
      .select("id, type, value, reason, status")
      .eq("fee_ledger_id", fee.id)
      .in("status", ["approved", "pending_principal", "pending_super_admin"])
      .order("created_at", { ascending: true });
    setExisting(((data as Concession[]) || []).filter((c) => c.type === "flat" || c.type === "percentage"));
  };

  useEffect(() => {
    if (open) fetchExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const afterWrite = async () => {
    setSaving(false);
    reset();
    await fetchExisting();
    onDone();
  };

  // ── add a new concession ──────────────────────────────────────────────
  const submitAdd = async () => {
    if (!(Number(value) > 0)) { toast({ title: "Enter a concession value", variant: "destructive" }); return; }
    if (!reason.trim()) { toast({ title: "A reason is required", variant: "destructive" }); return; }
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
      const { error: decErr } = await (supabase.rpc as any)("decide_fee_concession", { _id: id, _approve: true, _note: null });
      if (decErr) {
        setSaving(false);
        toast({ title: "Requested, but could not auto-approve", description: decErr.message, variant: "destructive" });
        return;
      }
    }
    toast({
      title: isSuperAdmin ? "Waiver applied" : "Waiver requested",
      description: isSuperAdmin
        ? `₹${amount.toLocaleString("en-IN")} off ${fee.fee_codes?.code || "this head"}.`
        : `₹${amount.toLocaleString("en-IN")} sent for super admin approval.`,
    });
    await afterWrite();
  };

  // ── edit / reduce an existing concession ──────────────────────────────
  const submitEdit = async (c: Concession) => {
    if (!(Number(value) > 0)) { toast({ title: "Enter a concession value", variant: "destructive" }); return; }
    if (!reason.trim()) { toast({ title: "A reason is required", variant: "destructive" }); return; }
    const oldAmt = effectiveAmount(c.type, Number(c.value), total);
    if (amount > oldAmt && !isSuperAdmin) {
      toast({ title: "Only a super admin can increase a waiver", description: "You can reduce it, or add a new one for approval.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase.rpc as any)("edit_fee_concession", {
      _id: c.id, _type: type, _value: Number(value), _reason: reason.trim(),
    });
    if (error) {
      setSaving(false);
      toast({ title: "Could not update the waiver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Waiver updated", description: `Now ₹${amount.toLocaleString("en-IN")} off ${fee.fee_codes?.code || "this head"}.` });
    await afterWrite();
  };

  const removeConcession = async (c: Concession) => {
    setSaving(true);
    const { error } = await (supabase.rpc as any)("remove_fee_concession", {
      _id: c.id, _reason: reason.trim() || null,
    });
    if (error) {
      setSaving(false);
      toast({ title: "Could not remove the waiver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Waiver removed" });
    await afterWrite();
  };

  const startEdit = (c: Concession) => {
    setEditingId(c.id);
    setType(c.type);
    setValue(String(c.value));
    setReason("");
  };

  const editingConcession = existing.find((c) => c.id === editingId) || null;
  const showAddForm = !editingId;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-primary focus-visible:text-primary"
          title="Waivers / concessions on this head"
          aria-label="Manage waivers on this head"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">{fee.fee_codes?.code || "Fee"}</p>
          <p className="text-[11px] text-muted-foreground">
            {fee.fee_codes?.name} · ₹{total.toLocaleString("en-IN")}
          </p>
        </div>

        {/* Existing per-row concessions, each editable / removable. */}
        {existing.length > 0 && (
          <div className="space-y-1.5">
            {existing.map((c) => {
              const amt = effectiveAmount(c.type, Number(c.value), total);
              const pending = c.status !== "approved";
              return (
                <div key={c.id} className="rounded-lg border border-input px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-success">−₹{amt.toLocaleString("en-IN")}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {c.type === "percentage" ? `${c.value}%` : "flat"}{pending ? " · pending" : ""}
                      </span>
                      {/* Staff-only. The student ledger renders fee_ledger.concession
                          (the amount) and never reads this table, so the reason
                          stays internal. */}
                      {c.reason && (
                        <p className="truncate text-[10px] text-muted-foreground" title={c.reason}>
                          {c.reason}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          onClick={() => (editingId === c.id ? reset() : startEdit(c))}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
                          title="Edit / reduce" aria-label="Edit or reduce this waiver"
                        ><Pencil className="h-3 w-3" /></button>
                        <button
                          onClick={() => removeConcession(c)}
                          disabled={saving}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                          title="Remove" aria-label="Remove this waiver"
                        ><Trash2 className="h-3 w-3" /></button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* One shared form: add a new concession, or edit the one being edited. */}
        {(showAddForm || editingConcession) && (
          <div className="space-y-2.5 border-t border-border pt-2.5">
            <p className="text-[11px] font-medium text-foreground">
              {editingConcession ? "Edit waiver" : "Add a waiver"}
            </p>
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

            {!editingConcession && (
              <p className="text-[10px] text-muted-foreground">
                {isSuperAdmin ? "Applied immediately." : "Goes to the super admin. The ledger is unchanged until approved."}
              </p>
            )}
            {editingConcession && !isSuperAdmin && (
              <p className="text-[10px] text-muted-foreground">You can only reduce this waiver.</p>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => (editingConcession ? reset() : setOpen(false))} disabled={saving}>
                {editingConcession ? "Cancel" : "Close"}
              </Button>
              <Button size="sm" onClick={() => (editingConcession ? submitEdit(editingConcession) : submitAdd())} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {editingConcession ? "Save" : isSuperAdmin ? "Apply" : "Request"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
