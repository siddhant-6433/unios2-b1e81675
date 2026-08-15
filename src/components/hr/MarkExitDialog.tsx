// Record a resignation or termination.
//
// The last working day is DERIVED from the contractual notice period rather than
// typed, because that is the number people get wrong and it decides the final
// salary. It stays editable — notice is shortened or waived all the time — but the
// default is the contract, and the dialog shows the arithmetic it used.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { LogOut, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: { id: string; name: string; employeeNumber?: string | null } | null;
  onSuccess?: () => void;
}

const EXIT_TYPES = [
  { value: "resignation", label: "Resignation" },
  { value: "termination", label: "Termination" },
  { value: "retirement", label: "Retirement" },
  { value: "end_of_contract", label: "End of contract" },
  { value: "absconded", label: "Absconded" },
];

const today = () => new Date().toISOString().slice(0, 10);

/** resignation date + n days, as a plain ISO date (no timezone drift). */
function addDays(iso: string, days: number): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function MarkExitDialog({ open, onOpenChange, employee, onSuccess }: Props) {
  const { toast } = useToast();
  const [exitType, setExitType] = useState("resignation");
  const [resignationDate, setResignationDate] = useState(today());
  const [noticeDays, setNoticeDays] = useState<number | null>(null);
  const [waived, setWaived] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [lwdTouched, setLwdTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !employee) return;
    setExitType("resignation"); setResignationDate(today()); setWaived(false);
    setReason(""); setLwdTouched(false);
    supabase.from("employee_profiles").select("notice_period_days").eq("id", employee.id).maybeSingle()
      .then(({ data }) => setNoticeDays(data?.notice_period_days ?? 0));
  }, [open, employee]);

  // Keep the derived date in step until HR overrides it, then leave it alone.
  const expected = waived ? resignationDate : addDays(resignationDate, noticeDays ?? 0);
  useEffect(() => {
    if (!lwdTouched) setLastWorkingDay(expected);
  }, [expected, lwdTouched]);

  const submit = async () => {
    if (!employee) return;
    setBusy(true);
    const { error } = await supabase.rpc("raise_employee_exit", {
      _employee_profile_id: employee.id,
      _exit_type: exitType,
      _resignation_date: resignationDate,
      _reason: reason.trim() || undefined,
      _last_working_day: lastWorkingDay || undefined,
      _notice_waived: waived,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not record the exit", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Exit recorded",
      // Says where it went. Previously the dialog just closed and the page looked
      // identical, which is why the record felt like it had vanished.
      description: "It is under review on their profile — approve it there to start the notice period.",
    });
    onOpenChange(false);
    onSuccess?.();
  };

  const shortened = lastWorkingDay && expected && lastWorkingDay < expected;
  const label = "block text-[11px] font-medium text-muted-foreground mb-1";
  const input = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5" /> Mark exit
          </DialogTitle>
        </DialogHeader>

        {employee && (
          <div className="space-y-4 py-1">
            <p className="text-sm text-foreground">
              {employee.name}
              {employee.employeeNumber && (
                <span className="font-mono text-xs text-muted-foreground"> · {employee.employeeNumber}</span>
              )}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Exit type</label>
                <select value={exitType} onChange={(e) => setExitType(e.target.value)} className={input}>
                  {EXIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>
                  {exitType === "termination" ? "Notice given on" : "Resignation date"}
                </label>
                <input type="date" value={resignationDate}
                  onChange={(e) => setResignationDate(e.target.value)} className={input} />
              </div>
            </div>

            <div className="rounded-xl border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={waived}
                  onChange={(e) => { setWaived(e.target.checked); setLwdTouched(false); }} />
                Waive notice period
              </label>
              <p className="text-[11px] text-muted-foreground">
                {waived
                  ? "Notice waived — last working day is the resignation date."
                  : `Notice period ${noticeDays ?? 0} days → expected last working day ${expected || "—"}.`}
              </p>
            </div>

            <div>
              <label className={label}>Last working day</label>
              <input type="date" value={lastWorkingDay}
                onChange={(e) => { setLastWorkingDay(e.target.value); setLwdTouched(true); }}
                className={input} />
              {shortened && (
                <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  Earlier than the {noticeDays}-day notice allows. Payroll will pro-rate to this date.
                </p>
              )}
            </div>

            <div>
              <label className={label}>Reason</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Optional" className={input} />
            </div>

            <p className="text-[11px] text-muted-foreground">
              They keep their access while serving notice. It is revoked and the account
              archived once the last working day passes.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !resignationDate || !lastWorkingDay}>
                {busy ? <ButtonOrb state="working" onFilled /> : null}
                {busy ? "Recording…" : "Record exit"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default MarkExitDialog;
