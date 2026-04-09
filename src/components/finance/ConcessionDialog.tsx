import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, HandCoins, X } from "lucide-react";

interface ConcessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  feeItems: any[];
  onSuccess: () => void;
}

interface ItemConcession {
  feeId: string;
  type: "flat" | "percentage";
  value: string;
}

export function ConcessionDialog({ open, onOpenChange, studentId, feeItems, onSuccess }: ConcessionDialogProps) {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<ItemConcession[]>([]);
  const [reason, setReason] = useState("");

  const isSuperAdmin = role === "super_admin";
  const unpaidItems = feeItems.filter(f => Number(f.paid_amount) === 0 && Number(f.balance) > 0);

  const addItem = (feeId: string) => {
    if (items.find(i => i.feeId === feeId)) return;
    setItems(prev => [...prev, { feeId, type: "flat", value: "" }]);
  };

  const removeItem = (feeId: string) => {
    setItems(prev => prev.filter(i => i.feeId !== feeId));
  };

  const updateItem = (feeId: string, field: "type" | "value", val: string) => {
    setItems(prev => prev.map(i => i.feeId === feeId ? { ...i, [field]: val } : i));
  };

  const computeAmount = (ic: ItemConcession) => {
    const fee = feeItems.find(f => f.id === ic.feeId);
    if (!fee || !ic.value) return 0;
    const total = Number(fee.total_amount);
    return ic.type === "flat" ? Number(ic.value) : Math.round((total * Number(ic.value)) / 100);
  };

  const allValid = items.length > 0 && items.every(i => Number(i.value) > 0) && reason.trim().length > 0;

  const handleSubmit = async () => {
    if (!allValid) {
      toast({ title: "Missing fields", description: "Add concession values for each item and a reason", variant: "destructive" });
      return;
    }

    setSaving(true);
    const status = isSuperAdmin ? "approved" : "pending_principal";

    // Get profiles.id (FK target) from auth user.id
    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    const rows = items.map(ic => ({
      student_id: studentId,
      fee_ledger_id: ic.feeId,
      type: ic.type,
      value: Number(ic.value),
      reason: reason.trim(),
      status,
      requested_by: profileId,
      ...(isSuperAdmin ? {
        approved_by: profileId,
        approved_by_principal: user?.id || null,
        principal_decision_at: new Date().toISOString(),
        approved_by_super_admin: user?.id || null,
        super_admin_decision_at: new Date().toISOString(),
      } : {}),
    }));

    const { error } = await supabase.from("concessions").insert(rows as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // If super admin, apply concession to fee_ledger immediately
    if (isSuperAdmin) {
      for (const ic of items) {
        const feeItem = feeItems.find(f => f.id === ic.feeId);
        if (!feeItem) continue;
        const concessionAmount = computeAmount(ic);
        // Only update concession — balance is auto-generated (total - concession - paid)
        await supabase
          .from("fee_ledger")
          .update({ concession: concessionAmount } as any)
          .eq("id", ic.feeId);
      }
    }

    toast({
      title: isSuperAdmin ? "Concession applied" : "Concession requested",
      description: isSuperAdmin
        ? `Applied to ${items.length} item(s)`
        : `Sent for principal approval (${items.length} item(s))`,
    });

    setItems([]);
    setReason("");
    onOpenChange(false);
    onSuccess();
    setSaving(false);
  };

  const selectedIds = new Set(items.map(i => i.feeId));
  const availableItems = unpaidItems.filter(f => !selectedIds.has(f.id));

  const inp = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { onOpenChange(o); if (!o) { setItems([]); setReason(""); } } }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5" /> Request Concession
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Add fee items */}
          {availableItems.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Add fee item</label>
              <select
                className={`${inp} cursor-pointer`}
                value=""
                onChange={e => { if (e.target.value) addItem(e.target.value); }}
              >
                <option value="">Select a fee item to add...</option>
                {availableItems.map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.fee_codes?.code} — {f.term} — ₹{Number(f.total_amount).toLocaleString("en-IN")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Per-item concession rows */}
          {items.length > 0 && (
            <div className="space-y-2.5">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Concessions ({items.length} item{items.length !== 1 ? "s" : ""})
              </label>
              {items.map(ic => {
                const fee = feeItems.find(f => f.id === ic.feeId);
                if (!fee) return null;
                const amt = computeAmount(ic);
                return (
                  <div key={ic.feeId} className="rounded-xl border border-border p-3 space-y-2">
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-foreground">{fee.fee_codes?.code}</span>
                        <span className="text-xs text-muted-foreground">{fee.term}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-foreground font-medium">₹{Number(fee.total_amount).toLocaleString("en-IN")}</span>
                      </div>
                      <button onClick={() => removeItem(ic.feeId)} className="text-muted-foreground hover:text-destructive transition-colors p-0.5">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Type + Value row */}
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg border border-input overflow-hidden shrink-0">
                        <button
                          onClick={() => updateItem(ic.feeId, "type", "flat")}
                          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${ic.type === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                        >₹ Flat</button>
                        <button
                          onClick={() => updateItem(ic.feeId, "type", "percentage")}
                          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${ic.type === "percentage" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                        >% Pct</button>
                      </div>
                      <input
                        type="number"
                        className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        placeholder={ic.type === "flat" ? "Amount" : "Percent"}
                        value={ic.value}
                        onChange={e => updateItem(ic.feeId, "value", e.target.value)}
                        min={0}
                        max={ic.type === "percentage" ? 100 : Number(fee.total_amount)}
                      />
                      {amt > 0 && (
                        <span className="text-xs font-medium text-primary shrink-0 whitespace-nowrap">
                          − ₹{amt.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                    {/* Effective amount after concession */}
                    {amt > 0 && (
                      <div className="flex items-center justify-between text-[11px] px-0.5">
                        <span className="text-muted-foreground">
                          ₹{Number(fee.total_amount).toLocaleString("en-IN")} − ₹{amt.toLocaleString("en-IN")}
                        </span>
                        <span className="font-semibold text-foreground">
                          Effective: ₹{Math.max(0, Number(fee.total_amount) - amt).toLocaleString("en-IN")}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {items.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Select fee items above to configure concessions
            </div>
          )}

          {/* Reason (shared) */}
          {items.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                className={`${inp} min-h-[70px] resize-none`}
                placeholder="Why is this concession being requested?"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
          )}

          {/* Info badge */}
          {items.length > 0 && (
            isSuperAdmin ? (
              <div className="p-2.5 rounded-xl bg-success/10 text-success text-xs font-medium">
                As super admin, these concessions will be applied immediately.
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-medium">
                This request will be sent to the principal for approval, then to the super admin.
              </div>
            )
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !allValid} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
              {isSuperAdmin ? "Apply Concession" : "Submit Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
