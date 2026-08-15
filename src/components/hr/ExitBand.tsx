// The exit, on the employee it belongs to.
//
// Marking an exit used to leave no trace on the profile — the dialog closed and the
// page looked identical, so the only way to find the record was a tab called
// "Probation & exits" on a different page. This puts the record, and the actions on
// it, where you raised it.

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { LogOut, CalendarClock } from "lucide-react";
import {
  actionsFor, applyExitTransition, EXIT_STATUS_LABEL, EXIT_TYPE_LABEL, type ExitAction,
} from "@/lib/exitTransitions";
import { daysUntil } from "@/lib/employmentBadges";

export interface ExitRow {
  id: string;
  status: string;
  exit_type: string | null;
  resignation_date: string | null;
  last_working_day: string | null;
  expected_last_working_day: string | null;
  notice_waived: boolean | null;
  notice_period_days: number | null;
  reason: string | null;
}

interface Props {
  exit: ExitRow;
  canEdit: boolean;
  onChanged: () => void;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const TONE: Record<string, string> = {
  under_review: "border-warning/40 bg-warning/5",
  in_progress: "border-warning/40 bg-warning/5",
  completed: "border-destructive/40 bg-destructive/5",
  rejected: "border-border bg-muted/30",
  reverted: "border-border bg-muted/30",
};

export function ExitBand({ exit, canEdit, onChanged }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const act = async (spec: { status: ExitAction; confirm?: string }) => {
    if (spec.confirm && !window.confirm(spec.confirm)) return;
    setBusy(true);
    const result = await applyExitTransition(exit.id, spec.status);
    setBusy(false);
    toast({
      title: result.title,
      description: result.ok ? result.description : result.error,
      variant: result.ok ? undefined : "destructive",
    });
    if (result.ok) onChanged();
  };

  const left = daysUntil(exit.last_working_day);
  const actions = canEdit ? actionsFor(exit.status) : [];

  return (
    <div className={`rounded-2xl border p-4 ${TONE[exit.status] ?? "border-border"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {EXIT_TYPE_LABEL[exit.exit_type ?? ""] ?? "Exit"}
            </p>
            <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {EXIT_STATUS_LABEL[exit.status] ?? exit.status}
            </span>
            {exit.notice_waived && (
              <span className="rounded-md bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                Notice waived
              </span>
            )}
          </div>

          <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <Field label="Resigned on" value={fmt(exit.resignation_date)} />
            <Field label="Last working day" value={fmt(exit.last_working_day)} />
            <Field
              label="Notice period"
              value={exit.notice_waived
                ? "Waived"
                : `${exit.notice_period_days ?? "—"} days`}
            />
          </div>

          {exit.reason && (
            <p className="mt-2 text-xs text-muted-foreground">Reason: {exit.reason}</p>
          )}

          {exit.status === "under_review" && (
            <p className="mt-2 text-[11px] text-warning">
              Waiting for approval. Approving starts the notice period — until then
              nothing changes for them.
            </p>
          )}
          {exit.status === "in_progress" && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
              <CalendarClock className="h-3.5 w-3.5" />
              {left === null ? "Serving notice."
                : left > 0 ? `Serving notice — ${left} day${left === 1 ? "" : "s"} left. They keep their access until the last working day.`
                : "The last working day has passed — complete the exit to revoke their access."}
            </p>
          )}
          {exit.status === "completed" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Access revoked and the account archived.
            </p>
          )}
        </div>

        {actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions.map((a) => (
              <Button key={a.status} size="sm" variant={a.variant} disabled={busy}
                onClick={() => act(a)}>
                {busy ? <ButtonOrb state="working" onFilled={a.variant === "default"} /> : null}
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className="text-foreground">{value}</span>
  </div>
);

export default ExitBand;
