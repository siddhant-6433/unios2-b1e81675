// Holiday calendar settings.
//
// The `holidays` table is what MyHr's "upcoming holidays" card and the
// attendance calendar read, so this panel is the single place the academic and
// public holiday list is maintained. `institution_id`/`campus_id` are optional:
// NULL means the holiday applies everywhere.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  institution_id: string | null;
  campus_id: string | null;
  kind: string;
  notes: string | null;
}

interface Ref {
  id: string;
  name: string;
}

const KIND_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "restricted", label: "Restricted" },
  { value: "academic", label: "Academic" },
];

const KIND_STYLE: Record<string, string> = {
  public: "bg-primary/15 text-primary",
  restricted: "bg-amber-500/15 text-amber-700",
  academic: "bg-chart-2/15 text-chart-2",
};

const EMPTY_FORM = {
  name: "",
  holiday_date: "",
  kind: "public",
  institution_id: "",
  campus_id: "",
  notes: "",
};

const fmtDate = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function HolidayCalendarPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const { user } = useAuth();
  const canEdit = can("hr", "view");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [institutions, setInstitutions] = useState<Ref[]>([]);
  const [campuses, setCampuses] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [h, i, c] = await Promise.all([
      (supabase as any).from("holidays")
        .select("id, name, holiday_date, institution_id, campus_id, kind, notes")
        .order("holiday_date", { ascending: false })
        .limit(1000),
      supabase.from("institutions").select("id, name").order("name"),
      supabase.from("campuses").select("id, name").order("name"),
    ]);
    setHolidays((h.data as Holiday[]) ?? []);
    setInstitutions((i.data as Ref[]) ?? []);
    setCampuses((c.data as Ref[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const nameOf = (list: Ref[], id: string | null) =>
    id ? list.find((x) => x.id === id)?.name ?? "—" : "All";

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (holiday: Holiday) => {
    setEditing(holiday);
    setForm({
      name: holiday.name,
      holiday_date: holiday.holiday_date,
      kind: holiday.kind,
      institution_id: holiday.institution_id ?? "",
      campus_id: holiday.campus_id ?? "",
      notes: holiday.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.holiday_date) {
      toast({ title: "Name and date are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      holiday_date: form.holiday_date,
      kind: form.kind,
      institution_id: form.institution_id || null,
      campus_id: form.campus_id || null,
      notes: form.notes.trim() || null,
    };

    const result = editing
      ? await (supabase as any).from("holidays").update(payload).eq("id", editing.id)
      : await (supabase as any).from("holidays").insert({ ...payload, created_by: user?.id ?? null });
    setBusy(false);

    if (result.error) {
      toast({ title: "Could not save the holiday", description: result.error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Holiday updated" : "Holiday added" });
    setOpen(false);
    await fetchAll();
  };

  const remove = async (holiday: Holiday) => {
    if (!window.confirm(`Delete “${holiday.name}” on ${fmtDate(holiday.holiday_date)}?`)) return;
    setBusy(true);
    const { error } = await (supabase as any).from("holidays").delete().eq("id", holiday.id);
    setBusy(false);
    if (error) {
      toast({ title: "Could not delete the holiday", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Holiday deleted" });
    await fetchAll();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Holidays</h2>
          <Badge variant="outline" className="text-[11px]">{holidays.length}</Badge>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> Add holiday
          </Button>
        )}
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Institution</th>
              <th className="px-3 py-2 font-medium">Campus</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              {canEdit && <th className="px-3 py-2 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {holidays.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="px-3 py-10 text-center text-muted-foreground">
                  No holidays listed yet.
                </td>
              </tr>
            ) : holidays.map((holiday) => (
              <tr key={holiday.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(holiday.holiday_date)}</td>
                <td className="px-3 py-2 font-medium text-foreground">{holiday.name}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] capitalize ${KIND_STYLE[holiday.kind] ?? "bg-muted text-muted-foreground"}`}>
                    {holiday.kind}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{nameOf(institutions, holiday.institution_id)}</td>
                <td className="px-3 py-2 text-muted-foreground">{nameOf(campuses, holiday.campus_id)}</td>
                <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate" title={holiday.notes ?? ""}>{holiday.notes || "—"}</td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEdit(holiday)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={() => remove(holiday)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit holiday" : "Add holiday"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              Name
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Independence Day" className="mt-1 h-9 text-sm" />
            </label>
            <label className="block text-xs text-muted-foreground">
              Date
              <Input type="date" value={form.holiday_date}
                onChange={(e) => setForm({ ...form, holiday_date: e.target.value })} className="mt-1 h-9 text-sm" />
            </label>
            <SelectField
              label="Kind"
              value={form.kind}
              allowEmpty={false}
              onValueChange={(value) => setForm({ ...form, kind: value })}
              options={KIND_OPTIONS}
            />
            <SelectField
              label="Institution (optional)"
              value={form.institution_id}
              onValueChange={(value) => setForm({ ...form, institution_id: value })}
              options={institutions.map((x) => ({ value: x.id, label: x.name }))}
              placeholder="All institutions"
            />
            <SelectField
              label="Campus (optional)"
              value={form.campus_id}
              onValueChange={(value) => setForm({ ...form, campus_id: value })}
              options={campuses.map((x) => ({ value: x.id, label: x.name }))}
              placeholder="All campuses"
            />
            <label className="block text-xs text-muted-foreground">
              Notes
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional" className="mt-1 h-9 text-sm" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{editing ? "Save changes" : "Add holiday"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default HolidayCalendarPanel;
