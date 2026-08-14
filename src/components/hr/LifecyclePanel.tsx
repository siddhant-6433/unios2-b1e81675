// Probation confirmations and exits.
//
// Both are lists that only matter because nothing surfaces them: 29 probations sat
// unconfirmed in Keka purely because no screen ever said "these are due". Overdue is
// shown first and coloured, because a probation nobody confirms silently becomes a
// permanent employment term.
//
// Completing an exit writes date_of_exit, which is what payroll's auto-population
// reads to stop paying someone. That link is enforced by a database trigger, so an
// exit recorded here cannot leave payroll still issuing salary.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCheck, LogOut, AlertTriangle } from "lucide-react";

interface Probationer {
  id: string;
  display_name: string | null;
  employee_number: string | null;
  job_title: string | null;
  date_of_joining: string | null;
  probation_end_date: string | null;
}

interface ExitRow {
  id: string;
  employee_profile_id: string;
  exit_type: string;
  resignation_date: string | null;
  last_working_day: string | null;
  expected_last_working_day: string | null;
  notice_period_days: number | null;
  notice_waived: boolean;
  reason: string | null;
  status: string;
  employee_profiles: { display_name: string | null; job_title: string | null; employee_number: string | null } | null;
}

// Keka's three buckets, and the order HR works them in.
const EXIT_BUCKETS = [
  { key: "under_review", label: "Under review", hint: "Resignations and terminations awaiting approval" },
  { key: "in_progress",  label: "Serving notice", hint: "Approved; still working" },
  { key: "completed",    label: "Exited", hint: "Last working day has passed; access revoked" },
] as const;

const today = () => new Date().toISOString().slice(0, 10);

const fmt = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function LifecyclePanel({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const [probation, setProbation] = useState<Probationer[]>([]);
  const [exits, setExits] = useState<ExitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [p, x] = await Promise.all([
      supabase.from("employee_profiles")
        .select("id, display_name, employee_number, job_title, date_of_joining, probation_end_date")
        .eq("probation_status", "on_probation")
        .order("probation_end_date", { nullsFirst: false })
        .limit(500),
      supabase.from("employee_exits")
        .select("id, employee_profile_id, exit_type, resignation_date, last_working_day, expected_last_working_day, notice_period_days, notice_waived, reason, status, employee_profiles(display_name, job_title, employee_number)")
        .neq("status", "reverted")
        .order("last_working_day", { ascending: false })
        .limit(200),
    ]);
    setProbation((p.data as Probationer[]) ?? []);
    setExits((x.data as unknown as ExitRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const setProbationStatus = async (id: string, status: "confirmed" | "extended") => {
    setBusy(id);
    const { data, error } = await supabase
      .from("employee_profiles")
      .update(status === "confirmed"
        ? { probation_status: "confirmed", confirmed_on: today() }
        : { probation_status: "extended" })
      .eq("id", id)
      .select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({ title: "Could not update", description: error?.message ?? "No permission", variant: "destructive" });
      return;
    }
    toast({ title: status === "confirmed" ? "Employment confirmed" : "Probation extended" });
    await fetchAll();
    onChange?.();
  };

  const setExitStatus = async (id: string, status: string) => {
    if (status === "reverted" && !window.confirm(
      "Revert this exit?\n\nThe employee returns to active, and their access and login are restored."
    )) return;

    setBusy(id);
    const patch: Record<string, unknown> = { status };
    if (status === "in_progress") {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = (await supabase.auth.getUser()).data.user?.id ?? null;
    }
    const { data, error } = await supabase
      .from("employee_exits").update(patch as never).eq("id", id).select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({ title: "Could not update the exit", description: error?.message ?? "No permission", variant: "destructive" });
      return;
    }
    toast({
      title: status === "in_progress" ? "Exit approved — notice period started"
           : status === "completed"   ? "Exit completed"
           : status === "reverted"    ? "Exit reverted — access restored"
           : "Exit rejected",
      description: status === "completed"
        ? "Payroll excludes them from the last working day, and their login is archived."
        : undefined,
    });
    await fetchAll();
    onChange?.();
  };

  /** Close out anyone whose last working day has passed, the way Keka's bucket does. */
  const closeDue = async () => {
    setBusy("sweep");
    const { data, error } = await supabase.rpc("close_due_employee_exits");
    setBusy(null);
    if (error) {
      toast({ title: "Could not close exits", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: (data ?? 0) === 0 ? "Nobody is due to exit yet" : `${data} exits closed` });
    await fetchAll();
    onChange?.();
  };

  if (loading) return <PageLoader />;

  const overdue = probation.filter((p) => p.probation_end_date && p.probation_end_date < today());

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Probation</h2>
          <Badge variant="outline" className="text-[11px]">{probation.length}</Badge>
          {overdue.length > 0 && (
            <Badge variant="outline" className="text-[11px] text-destructive border-destructive/30 gap-1">
              <AlertTriangle className="h-3 w-3" /> {overdue.length} overdue
            </Badge>
          )}
        </div>

        {probation.length === 0 ? (
          <p className="rounded-xl bg-card card-shadow px-4 py-8 text-center text-xs text-muted-foreground">
            Nobody is on probation. Set a probation end date on an employee's Job tab to track one.
          </p>
        ) : (
          <div className="rounded-xl bg-card card-shadow divide-y divide-border">
            {probation.map((p) => {
              const late = p.probation_end_date && p.probation_end_date < today();
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{p.display_name || "Unnamed"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {p.job_title || "No designation"} · joined {fmt(p.date_of_joining)}
                    </p>
                  </div>
                  <span className={`text-xs ${late ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {late ? "Due " : "Ends "}{fmt(p.probation_end_date)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={busy === p.id}
                      onClick={() => setProbationStatus(p.id, "extended")}>Extend</Button>
                    <Button size="sm" disabled={busy === p.id}
                      onClick={() => setProbationStatus(p.id, "confirmed")}>Confirm</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <LogOut className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Exits</h2>
          <Badge variant="outline" className="text-[11px]">{exits.length}</Badge>
          <div className="flex-1" />
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={closeDue}
            title="Close out anyone whose last working day has passed">
            Close due exits
          </Button>
        </div>

        {exits.length === 0 ? (
          <p className="rounded-xl bg-card card-shadow px-4 py-8 text-center text-xs text-muted-foreground">
            No exits recorded. Open an employee and use “Mark exit” to record a resignation.
          </p>
        ) : EXIT_BUCKETS.map((bucket) => {
          const rows = exits.filter((x) => x.status === bucket.key);
          if (rows.length === 0) return null;
          return (
            <div key={bucket.key} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-xs font-semibold text-foreground">{bucket.label}</h3>
                <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
                <span className="text-[11px] text-muted-foreground">{bucket.hint}</span>
              </div>

              <div className="rounded-xl bg-card card-shadow divide-y divide-border">
                {rows.map((x) => {
                  // Shown because a shortened notice is the thing HR needs to notice —
                  // it changes the final salary.
                  const shortened = x.last_working_day && x.expected_last_working_day
                    && x.last_working_day < x.expected_last_working_day;
                  return (
                    <div key={x.id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">
                          {x.employee_profiles?.display_name || "Unnamed"}
                          {x.employee_profiles?.employee_number && (
                            <span className="font-mono text-[11px] text-muted-foreground"> · {x.employee_profiles.employee_number}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {x.exit_type.replace(/_/g, " ")}
                          {x.resignation_date && <> · notified {fmt(x.resignation_date)}</>}
                          {" · last day "}{fmt(x.last_working_day)}
                          {x.notice_waived
                            ? " · notice waived"
                            : shortened
                              ? ` · shortened from ${fmt(x.expected_last_working_day)}`
                              : x.notice_period_days ? ` · ${x.notice_period_days}d notice` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {x.status === "under_review" && (
                          <>
                            <Button size="sm" variant="outline" disabled={busy === x.id}
                              onClick={() => setExitStatus(x.id, "rejected")}>Reject</Button>
                            <Button size="sm" disabled={busy === x.id}
                              onClick={() => setExitStatus(x.id, "in_progress")}>Approve</Button>
                          </>
                        )}
                        {x.status === "in_progress" && (
                          <>
                            <Button size="sm" variant="ghost" disabled={busy === x.id}
                              onClick={() => setExitStatus(x.id, "reverted")}>Revert</Button>
                            <Button size="sm" disabled={busy === x.id || !x.last_working_day}
                              title={x.last_working_day ? undefined : "Set a last working day first"}
                              onClick={() => setExitStatus(x.id, "completed")}>Complete</Button>
                          </>
                        )}
                        {x.status === "completed" && (
                          <Button size="sm" variant="ghost" disabled={busy === x.id}
                            onClick={() => setExitStatus(x.id, "reverted")}>Revert</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default LifecyclePanel;
