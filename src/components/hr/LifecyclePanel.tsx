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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserCheck, LogOut, AlertTriangle, Plus } from "lucide-react";

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
  reason: string | null;
  notice_waived: boolean;
  clearance: { notes?: string } | null;
  status: string;
  employee_profiles: { display_name: string | null; job_title: string | null } | null;
}

interface EmployeeOption {
  id: string;
  display_name: string | null;
  employee_number: string | null;
  job_title: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_EXIT = {
  employee_profile_id: "",
  exit_type: "resignation",
  resignation_date: today(),
  last_working_day: "",
  reason: "",
  notice_waived: false,
  clearance_notes: "",
};

const fmt = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function LifecyclePanel({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const [probation, setProbation] = useState<Probationer[]>([]);
  const [exits, setExits] = useState<ExitRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitForm, setExitForm] = useState(EMPTY_EXIT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingExit, setSavingExit] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [p, x, e, existing] = await Promise.all([
      supabase.from("employee_profiles")
        .select("id, display_name, employee_number, job_title, date_of_joining, probation_end_date")
        .eq("probation_status", "on_probation")
        .order("probation_end_date", { nullsFirst: false })
        .limit(500),
      supabase.from("employee_exits")
        .select("id, employee_profile_id, exit_type, resignation_date, last_working_day, reason, notice_waived, clearance, status, employee_profiles(display_name, job_title)")
        .neq("status", "reverted")
        .order("last_working_day", { ascending: false })
        .limit(200),
      supabase.from("employee_profiles")
        .select("id, display_name, employee_number, job_title")
        .eq("verification_status", "verified")
        .is("date_of_exit", null)
        .order("display_name")
        .limit(1000),
      supabase.from("employee_exits").select("employee_profile_id").limit(1000),
    ]);
    setProbation((p.data as Probationer[]) ?? []);
    setExits((x.data as unknown as ExitRow[]) ?? []);
    const alreadyHasExit = new Set((existing.data ?? []).map((row) => row.employee_profile_id));
    setEmployees(((e.data as EmployeeOption[]) ?? []).filter((employee) => !alreadyHasExit.has(employee.id)));
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

  const completeExit = async (id: string) => {
    setBusy(id);
    const { data, error } = await supabase
      .from("employee_exits").update({ status: "completed" }).eq("id", id).select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({ title: "Could not complete the exit", description: error?.message ?? "No permission", variant: "destructive" });
      return;
    }
    toast({ title: "Exit completed", description: "Payroll will no longer include them from their last working day." });
    await fetchAll();
    onChange?.();
  };

  const createExit = async () => {
    if (!exitForm.employee_profile_id || !exitForm.last_working_day) return;
    if (exitForm.resignation_date && exitForm.last_working_day < exitForm.resignation_date) {
      toast({ title: "Check the exit dates", description: "Last working day must be on or after the resignation date.", variant: "destructive" });
      return;
    }
    setSavingExit(true);
    const { data, error } = await supabase.from("employee_exits").insert({
      employee_profile_id: exitForm.employee_profile_id,
      exit_type: exitForm.exit_type,
      resignation_date: exitForm.resignation_date || null,
      last_working_day: exitForm.last_working_day,
      reason: exitForm.reason.trim() || null,
      notice_waived: exitForm.notice_waived,
      clearance: { notes: exitForm.clearance_notes.trim() },
      status: "in_progress",
    }).select("id").single();
    setSavingExit(false);
    if (error || !data) {
      toast({ title: "Could not record the exit", description: error?.message ?? "No permission", variant: "destructive" });
      return;
    }
    toast({ title: "Exit recorded", description: "It is now in progress. Completion updates the employee record and payroll." });
    setExitDialogOpen(false);
    setExitForm({ ...EMPTY_EXIT, resignation_date: today() });
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
          <Button size="sm" className="ml-auto" disabled={!employees.length} onClick={() => setExitDialogOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Record exit
          </Button>
        </div>

        {exits.length === 0 ? (
          <p className="rounded-xl bg-card card-shadow px-4 py-8 text-center text-xs text-muted-foreground">
            No exits recorded.
          </p>
        ) : (
          <div className="rounded-xl bg-card card-shadow divide-y divide-border">
            {exits.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{x.employee_profiles?.display_name || "Unnamed"}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {x.exit_type.replace(/_/g, " ")} · last day {fmt(x.last_working_day)}
                    {x.notice_waived ? " · notice waived" : ""}
                  </p>
                  {(x.reason || x.clearance?.notes) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {[x.reason, x.clearance?.notes].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${
                  x.status === "completed" ? "bg-emerald-600/15 text-emerald-700" : "bg-muted text-muted-foreground"
                }`}>
                  {x.status.replace(/_/g, " ")}
                </span>
                {x.status === "in_progress" && (
                  <Button size="sm" disabled={busy === x.id || !x.last_working_day}
                    title={x.last_working_day ? undefined : "Set a last working day first"}
                    onClick={() => completeExit(x.id)}>
                    Complete
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record employee exit</DialogTitle>
            <DialogDescription>
              Record the exit plan. The employee remains active until the exit is completed or the due-exit automation closes it on the last working day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Employee
              <select value={exitForm.employee_profile_id} onChange={(event) => setExitForm({ ...exitForm, employee_profile_id: event.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" required>
                <option value="">Select an employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {[employee.display_name || "Unnamed", employee.employee_number, employee.job_title].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Exit type
              <select value={exitForm.exit_type} onChange={(event) => setExitForm({ ...exitForm, exit_type: event.target.value })}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
                <option value="resignation">Resignation</option>
                <option value="termination">Termination</option>
                <option value="retirement">Retirement</option>
                <option value="end_of_contract">End of contract</option>
                <option value="absconded">Absconded</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Resignation / notice date
              <Input type="date" value={exitForm.resignation_date} onChange={(event) => setExitForm({ ...exitForm, resignation_date: event.target.value })} />
            </label>
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Last working day
              <Input type="date" value={exitForm.last_working_day} onChange={(event) => setExitForm({ ...exitForm, last_working_day: event.target.value })} required />
            </label>
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Reason
              <Textarea value={exitForm.reason} onChange={(event) => setExitForm({ ...exitForm, reason: event.target.value })} rows={2} />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={exitForm.notice_waived} onCheckedChange={(checked) => setExitForm({ ...exitForm, notice_waived: checked === true })} />
              Notice period waived
            </label>
            <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
              Clearance notes
              <Textarea value={exitForm.clearance_notes} onChange={(event) => setExitForm({ ...exitForm, clearance_notes: event.target.value })} rows={3} placeholder="Equipment, access, handover, or other clearance details" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExitDialogOpen(false)} disabled={savingExit}>Cancel</Button>
            <Button onClick={createExit} disabled={savingExit || !exitForm.employee_profile_id || !exitForm.last_working_day}>
              {savingExit ? "Saving…" : "Record exit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LifecyclePanel;
