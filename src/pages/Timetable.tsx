import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { CalendarDays, UserCheck, X } from "lucide-react";

// Weekly timetable grid: periods down, weekdays across.
//
// Read access is open to all authenticated users at the RLS layer, so the
// filters here are about usefulness, not security. Writes (substitutions) are
// gated on timetable:substitute, which the te_/tsub_ policies also check.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Period { id: string; period_no: number; label: string; start_time: string; end_time: string; }
interface Entry {
  id: string;
  batch_id: string | null;
  period_id: string | null;
  day_of_week: number | null;
  subject_id: string | null;
  faculty_user_id: string | null;
  room: string | null;
}
interface Substitution {
  id: string;
  timetable_entry_id: string;
  on_date: string;
  substitute_user_id: string | null;
  reason: string | null;
}

const Timetable = () => {
  const { user } = useAuth();
  const canSubstitute = usePermission("timetable", "substitute");
  const { toast } = useToast();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [subs, setSubs] = useState<Substitution[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [batchId, setBatchId] = useState("");
  // Substitutions are per calendar date, so the grid needs a week anchor.
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [subDraft, setSubDraft] = useState<{ entry: Entry; date: string } | null>(null);
  const [subTeacher, setSubTeacher] = useState("");
  const [subReason, setSubReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load(); }, [weekStart]);

  const load = async () => {
    setLoading(true);
    const weekEnd = addDays(weekStart, 6);
    const [pRes, eRes, bRes, sRes, subRes] = await Promise.all([
      supabase.from("class_periods").select("id, period_no, label, start_time, end_time")
        .eq("active", true).order("period_no"),
      supabase.from("timetable_entries")
        .select("id, batch_id, period_id, day_of_week, subject_id, faculty_user_id, room"),
      supabase.from("batches").select("id, name").order("name"),
      supabase.from("subjects").select("id, name"),
      supabase.from("timetable_substitutions")
        .select("id, timetable_entry_id, on_date, substitute_user_id, reason")
        .gte("on_date", iso(weekStart)).lte("on_date", iso(weekEnd)),
    ]);

    setPeriods((pRes.data as Period[]) || []);
    setEntries((eRes.data as Entry[]) || []);
    setBatches((bRes.data as { id: string; name: string }[]) || []);
    setSubs((subRes.data as Substitution[]) || []);
    setSubjects(Object.fromEntries(((sRes.data as { id: string; name: string }[]) || []).map(s => [s.id, s.name])));

    const facultyIds = Array.from(new Set([
      ...((eRes.data as Entry[]) || []).map(e => e.faculty_user_id),
      ...((subRes.data as Substitution[]) || []).map(s => s.substitute_user_id),
    ].filter(Boolean) as string[]));
    if (facultyIds.length) {
      const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", facultyIds);
      setNames(Object.fromEntries(((data as { user_id: string; display_name: string | null }[]) || [])
        .map(p => [p.user_id, p.display_name || p.user_id.slice(0, 8)])));
    }
    setLoading(false);
  };

  const visible = useMemo(() => entries.filter(e => {
    if (scope === "mine" && e.faculty_user_id !== user?.id) return false;
    if (batchId && e.batch_id !== batchId) return false;
    return true;
  }), [entries, scope, batchId, user?.id]);

  const cellFor = (periodId: string, day: number) =>
    visible.filter(e => e.period_id === periodId && e.day_of_week === day);

  const subFor = (entryId: string, day: number) =>
    subs.find(s => s.timetable_entry_id === entryId && s.on_date === iso(addDays(weekStart, day - 1)));

  const submitSubstitution = async () => {
    if (!subDraft) return;
    setSaving(true);
    const { data, error } = await supabase.from("timetable_substitutions").insert({
      timetable_entry_id: subDraft.entry.id,
      on_date: subDraft.date,
      substitute_user_id: subTeacher || null,
      assigned_by: user?.id || null,
      reason: subReason.trim() || null,
    }).select().single();
    setSaving(false);
    if (error) {
      toast({ title: "Could not submit substitution", description: error.message, variant: "destructive" });
      return;
    }
    setSubs(prev => [...prev, data as Substitution]);
    setSubDraft(null);
    setSubTeacher("");
    setSubReason("");
    toast({ title: "Substitution recorded" });
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Timetable</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Week of {weekStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-input overflow-hidden">
            {(["mine", "all"] as const).map(s => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === s ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                }`}>
                {s === "mine" ? "My lectures" : "Whole school"}
              </button>
            ))}
          </div>
          <select value={batchId} onChange={e => setBatchId(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20">
            <option value="">All classes</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setWeekStart(d => addDays(d, -7))}>&larr;</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setWeekStart(mondayOf(new Date()))}>This week</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setWeekStart(d => addDays(d, 7))}>&rarr;</Button>
        </div>
      </div>

      {periods.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No class periods configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            An administrator needs to define the daily period structure before a timetable can be shown.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border w-32">Period</th>
                {DAYS.map((d, i) => (
                  <th key={d} className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border min-w-[150px]">
                    {d} <span className="font-normal text-muted-foreground/60">
                      {addDays(weekStart, i).getDate()}/{addDays(weekStart, i).getMonth() + 1}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} className="align-top">
                  <td className="px-3 py-2 border-b border-border/30">
                    <p className="font-medium text-foreground">{p.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.start_time?.slice(0, 5)}–{p.end_time?.slice(0, 5)}
                    </p>
                  </td>
                  {DAYS.map((_, i) => {
                    const day = i + 1; // 1 = Monday
                    const cells = cellFor(p.id, day);
                    return (
                      <td key={day} className="px-2 py-2 border-b border-l border-border/30">
                        {cells.length === 0 && <span className="text-muted-foreground/30">—</span>}
                        {cells.map(e => {
                          const sub = subFor(e.id, day);
                          return (
                            <div key={e.id} className="rounded-lg bg-muted/40 px-2 py-1.5 mb-1 last:mb-0">
                              <p className="font-medium text-foreground">
                                {e.subject_id ? subjects[e.subject_id] || "Subject" : "Lecture"}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {sub
                                  ? <span className="text-warning font-medium">
                                      Substitute: {sub.substitute_user_id ? names[sub.substitute_user_id] : "TBD"}
                                    </span>
                                  : e.faculty_user_id ? names[e.faculty_user_id] : "Unassigned"}
                                {e.room ? ` · ${e.room}` : ""}
                              </p>
                              {canSubstitute && !sub && (
                                <button
                                  onClick={() => setSubDraft({ entry: e, date: iso(addDays(weekStart, i)) })}
                                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                                >
                                  <UserCheck className="h-2.5 w-2.5" /> Substitute
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-lg space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Assign substitute</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {subDraft.entry.subject_id ? subjects[subDraft.entry.subject_id] : "Lecture"} on {subDraft.date}
                </p>
              </div>
              <button onClick={() => setSubDraft(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <select value={subTeacher} onChange={e => setSubTeacher(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20">
              <option value="">Substitute teacher…</option>
              {Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <input value={subReason} onChange={e => setSubReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSubDraft(null)}>Cancel</Button>
              <Button size="sm" className="h-8 text-xs" onClick={submitSubstitution} disabled={saving}>Submit</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function mondayOf(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sunday
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function iso(d: Date) {
  // Local date, not UTC — toISOString() would shift IST dates back a day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default Timetable;
