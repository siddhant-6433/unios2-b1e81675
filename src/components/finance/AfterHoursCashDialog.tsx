// After-hours cash — only a super_admin can waive the 9 AM–6 PM cash-receipt
// window for a campus on a chosen IST date. This does not override a closed day.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { DatePickerField, SelectField, parseIsoDate } from "@/components/ui/state-fields";
import { Clock } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}

type ExceptionRow = { campus_id: string | null; campus_name: string | null; allowed_date: string };

function todayIstDate(): string {
  const off = 330 * 60 * 1000;
  const ist = new Date(Date.now() + off);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function AfterHoursCashDialog({ open, onOpenChange, onChanged }: Props) {
  const { campuses } = useCampus();
  const { toast } = useToast();

  const today = todayIstDate();
  const [selected, setSelected] = useState<string>("all");
  const [date, setDate] = useState(today);
  const [submitting, setSubmitting] = useState<"allow" | "revoke" | null>(null);
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [dayClosed, setDayClosed] = useState(false);

  const options = useMemo(() => ([
    { value: "all", label: "All campuses" },
    ...campuses.map((c) => ({ value: c.id, label: c.name })),
  ]), [campuses]);

  useEffect(() => {
    if (!open) return;
    setSelected("all");
    setDate(todayIstDate());
  }, [open]);

  useEffect(() => {
    if (!open || !date) { setRows([]); setDayClosed(false); return; }
    let cancelled = false;
    (async () => {
      const campusId = selected === "all" ? null : selected;
      const [{ data }, closed] = await Promise.all([
        (supabase.rpc as any)("list_after_hours_cash", { _date: date }),
        date === todayIstDate()
          ? (supabase.rpc as any)("is_day_closed", { _campus_id: campusId })
          : Promise.resolve({ data: false }),
      ]);
      if (cancelled) return;
      setRows(((data as ExceptionRow[] | null) || []));
      setDayClosed(!!closed.data);
    })();
    return () => { cancelled = true; };
  }, [open, date, selected]);

  const globalGrant = rows.some((r) => r.campus_id == null);
  const campusGrant = selected !== "all" && rows.some((r) => r.campus_id === selected);
  const covered = globalGrant || (selected === "all" ? rows.length > 0 : campusGrant);
  const alreadyFullyCovered = globalGrant || (selected !== "all" && campusGrant);
  const canRevoke = covered && (selected === "all" || !globalGrant);

  const allowedLabels = rows.map((r) => r.campus_name || "All campuses");

  const run = async (fn: "allow_after_hours_cash" | "revoke_after_hours_cash") => {
    const action = fn === "allow_after_hours_cash" ? "allow" : "revoke";
    setSubmitting(action);
    const isAll = selected === "all";
    const { error } = await (supabase.rpc as any)(fn, isAll
      ? { _all: true, _date: date }
      : { _campus_ids: [selected], _date: date });
    setSubmitting(null);
    if (error) {
      toast({
        title: action === "allow" ? "Could not allow after-hours cash" : "Could not revoke after-hours cash",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: action === "allow" ? "After-hours cash allowed" : "After-hours cash revoked",
      description: action === "allow"
        ? "Non-admin cashiers can record cash outside 9 AM–6 PM on this date (unless the day is closed)."
        : "The 9 AM–6 PM window applies again for this campus on this date.",
    });
    onOpenChange(false);
    onChanged?.();
  };

  const todayDate = parseIsoDate(today) ?? new Date();
  const maxDate = parseIsoDate(addDaysIso(today, 30)) ?? undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> After-hours cash
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <SelectField
            value={selected}
            onValueChange={setSelected}
            options={options}
            label="Allow after-hours cash for"
            allowEmpty={false}
          />

          <DatePickerField
            value={date}
            onValueChange={setDate}
            label="Date"
            minDate={todayDate}
            maxDate={maxDate}
          />

          {allowedLabels.length > 0 && (
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs space-y-1">
              <p className="font-medium text-foreground">Already allowed on this date</p>
              <p className="text-muted-foreground">{allowedLabels.join(", ")}</p>
            </div>
          )}

          {globalGrant && selected !== "all" && (
            <p className="text-[11px] text-muted-foreground">
              An all-campuses grant already covers this campus. Revoke it from “All campuses”.
            </p>
          )}

          {dayClosed && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              The cash desk is closed for today. After-hours permission does not reopen a closed day.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Lets cashiers record cash outside 9 AM–6 PM on this date for{" "}
            {selected === "all" ? "all campuses" : "this campus"}. Only a super admin can grant this.
            Closing the day still blocks cash until 9 AM the next morning.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!submitting}>Cancel</Button>
          <div className="flex gap-2">
            {canRevoke && (
              <Button variant="outline" onClick={() => run("revoke_after_hours_cash")} disabled={!!submitting}>
                {submitting === "revoke" ? <ButtonOrb state="working" /> : null}
                Revoke
              </Button>
            )}
            <Button onClick={() => run("allow_after_hours_cash")} disabled={!!submitting || alreadyFullyCovered}>
              {submitting === "allow" ? <ButtonOrb state="solving" onFilled /> : <Clock className="h-4 w-4 mr-2" />}
              {submitting === "allow" ? "Saving…" : alreadyFullyCovered ? "Allowed" : "Allow after hours"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
