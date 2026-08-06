// Day Closer — an accountant / super_admin closes the cash desk for the day,
// optionally per campus. Closing (a) blocks further cash receipts until 9 AM
// tomorrow via close_day(), and (b) invokes day-closer-report to email the
// day's offline collection to accountants + super_admins.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/state-fields";
import { Lock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onClosed?: () => void;
}

// Start of today in IST, as a UTC ISO string.
function todayIstStartIso(): string {
  const off = 330 * 60 * 1000;
  const ist = new Date(Date.now() + off);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - off).toISOString();
}

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function DayCloserDialog({ open, onOpenChange, onClosed }: Props) {
  const { role } = useAuth();
  const { campuses } = useCampus();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";

  const [selected, setSelected] = useState<string>("all");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ cash: number; other: number; count: number } | null>(null);

  const options = useMemo(() => ([
    { value: "all", label: isSuperAdmin ? "All campuses" : "All my campuses" },
    ...campuses.map((c) => ({ value: c.id, label: c.name })),
  ]), [campuses, isSuperAdmin]);

  useEffect(() => { if (open) setSelected("all"); }, [open]);

  // Preview today's offline collection for the chosen scope (RLS-respecting read).
  useEffect(() => {
    if (!open) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      let q = supabase
        .from("v_all_payments" as any)
        .select("amount, payment_mode, campus_id")
        .eq("gateway", "offline")
        .gte("paid_at", todayIstStartIso());
      if (selected !== "all") q = q.eq("campus_id", selected);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data as any[] | null) || [];
      const cash = rows.filter((r) => r.payment_mode === "cash").reduce((s, r) => s + Number(r.amount || 0), 0);
      const other = rows.filter((r) => r.payment_mode !== "cash").reduce((s, r) => s + Number(r.amount || 0), 0);
      setPreview({ cash, other, count: rows.length });
    })();
    return () => { cancelled = true; };
  }, [open, selected]);

  const handleClose = async () => {
    setSubmitting(true);
    const isAll = selected === "all";
    const { data, error } = await (supabase.rpc as any)("close_day", isAll ? { _all: true } : { _campus_ids: [selected] });
    if (error) {
      setSubmitting(false);
      toast({ title: "Could not close the day", description: error.message, variant: "destructive" });
      return;
    }
    // Scope the report to what was actually closed (null = a global close).
    const ids = ((data as any[] | null) || []).map((r) => r.campus_id);
    const campus_ids = ids.some((id) => id == null) ? null : ids.filter(Boolean);
    const { error: mailErr } = await supabase.functions.invoke("day-closer-report", { body: { campus_ids } });
    setSubmitting(false);

    if (mailErr) {
      toast({
        title: "Day closed — report email failed",
        description: `${mailErr.message}. Cash receipts are disabled until 9 AM tomorrow.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Day closed",
        description: "Cash receipts are disabled until 9 AM tomorrow. Report emailed to accountants & super admins.",
      });
    }
    onOpenChange(false);
    onClosed?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Day Closer
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <SelectField
            value={selected}
            onValueChange={setSelected}
            options={options}
            label="Close cash desk for"
            allowEmpty={false}
          />

          {preview && (
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash collected today</span>
                <span className="font-semibold text-foreground">{inr(preview.cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Other offline today</span>
                <span className="text-foreground">{inr(preview.other)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground/80">
                <span>Receipts</span><span>{preview.count}</span>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Closing disables new cash receipts for {selected === "all" ? "these campuses" : "this campus"} until 9 AM
            tomorrow (super admins are unaffected) and emails today's collection report to accountants & super admins.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleClose} disabled={submitting}>
            {submitting ? <ButtonOrb state="solving" onFilled /> : <Lock className="h-4 w-4 mr-2" />}
            {submitting ? "Closing…" : "Close Day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
