import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { GraduationCap, Plus, Trash2, Search } from "lucide-react";

// Class-teacher assignments are the data behind teaches_student() — the RLS
// primitive that scopes a teacher to their own students, attendance and exam
// records. Without a row here a teacher's /students list is empty, so this
// panel is what makes the teacher role usable at all.
//
// Subject-level allocations (teacher x subject x batch) live in
// subject_allocations and are managed alongside subjects in the marks module;
// teaches_student() reads both.

interface ClassTeacher {
  id: string;
  teacher_user_id: string;
  batch_id: string | null;
  course_id: string | null;
  section: string | null;
  session_id: string | null;
  active: boolean;
}

interface Batch {
  id: string;
  name: string;
  section: string | null;
  course_id: string;
}

interface Course {
  id: string;
  name: string;
  code: string | null;
  type: string | null;
}

// A class is a college batch OR a school course (Grade IV). `batches` only
// covers the college side — every school student has batch_id NULL — so
// offering batches alone made it impossible to assign a class teacher to a
// grade, which is the main thing this panel exists for.
type ClassTarget =
  | { kind: "batch"; id: string; label: string }
  | { kind: "course"; id: string; label: string };

interface Teacher {
  user_id: string;
  display_name: string | null;
  role: string;
}

const TEACHING_ROLES = ["teacher", "faculty", "school_coordinator"];

export default function ClassTeacherPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ClassTeacher[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // target is "batch:<id>" or "course:<id>" — one select covering both kinds.
  const [draft, setDraft] = useState({ teacher_user_id: "", target: "", section: "" });

  useEffect(() => { void fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [ctRes, batchRes, roleRes, courseRes] = await Promise.all([
      supabase.from("class_teachers").select("*").order("created_at", { ascending: false }),
      supabase.from("batches").select("id, name, section, course_id").order("name"),
      supabase.from("user_roles").select("user_id, role").in("role", TEACHING_ROLES as never[]),
      supabase.from("courses").select("id, name, code, type").eq("is_active", true).order("display_order"),
    ]);

    setRows((ctRes.data as ClassTeacher[]) || []);
    setBatches((batchRes.data as Batch[]) || []);
    setCourses((courseRes.data as Course[]) || []);
    setCourseNames(Object.fromEntries(((courseRes.data as Course[]) || [])
      .map((c) => [c.id, c.name])));

    // Names live on profiles, roles on user_roles — two queries, joined here.
    const ids = ((roleRes.data as { user_id: string; role: string }[]) || []).map((r) => r.user_id);
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles").select("user_id, display_name").in("user_id", ids);
      const nameById = Object.fromEntries(((profs as { user_id: string; display_name: string | null }[]) || [])
        .map((p) => [p.user_id, p.display_name]));
      setTeachers((roleRes.data as { user_id: string; role: string }[]).map((r) => ({
        user_id: r.user_id, role: r.role, display_name: nameById[r.user_id] ?? null,
      })).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")));
    } else {
      setTeachers([]);
    }
    setLoading(false);
  };

  const teacherName = (id: string) =>
    teachers.find((t) => t.user_id === id)?.display_name || id.slice(0, 8);

  const batchLabel = (b: Batch | undefined) => {
    if (!b) return "—";
    const course = courseNames[b.course_id];
    return [course, b.name, b.section].filter(Boolean).join(" · ");
  };

  // School courses are the grades (Grade IV); everything else is a programme
  // whose classes are batches. Both are offered, school first.
  const targets = useMemo<ClassTarget[]>(() => {
    const schoolCourses = courses
      .filter((c) => c.type === "school")
      .map<ClassTarget>((c) => ({ kind: "course", id: c.id, label: c.name }));
    const batchTargets = batches.map<ClassTarget>((b) => ({
      kind: "batch", id: b.id, label: batchLabel(b),
    }));
    return [...schoolCourses, ...batchTargets];
  }, [courses, batches, courseNames]);

  const rowLabel = (r: ClassTeacher) =>
    r.course_id
      ? courseNames[r.course_id] || "—"
      : batchLabel(batches.find((b) => b.id === r.batch_id));

  const visible = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) =>
      teacherName(r.teacher_user_id).toLowerCase().includes(q) ||
      rowLabel(r).toLowerCase().includes(q));
  }, [rows, filter, teachers, batches, courseNames]);

  const add = async () => {
    if (!draft.teacher_user_id || !draft.target) {
      toast({ title: "Pick a teacher and a class", variant: "destructive" });
      return;
    }
    const [kind, id] = draft.target.split(":");
    setSaving("new");
    const { data, error } = await supabase
      .from("class_teachers")
      .insert({
        teacher_user_id: draft.teacher_user_id,
        // class_teachers_one_target enforces exactly one of these.
        batch_id: kind === "batch" ? id : null,
        course_id: kind === "course" ? id : null,
        section: draft.section.trim() || null,
      })
      .select()
      .single();
    setSaving(null);
    if (error) {
      toast({
        title: "Could not assign",
        // 23505 = the (teacher, batch, section, session) unique index.
        description: error.code === "23505" ? "That teacher is already assigned to this class." : error.message,
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => [data as ClassTeacher, ...prev]);
    setDraft({ teacher_user_id: "", target: "", section: "" });
    toast({ title: "Class teacher assigned" });
  };

  const toggleActive = async (row: ClassTeacher) => {
    setSaving(row.id);
    const { error } = await supabase
      .from("class_teachers").update({ active: !row.active }).eq("id", row.id);
    setSaving(null);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r)));
  };

  const remove = async (row: ClassTeacher) => {
    setSaving(row.id);
    const { error } = await supabase.from("class_teachers").delete().eq("id", row.id);
    setSaving(null);
    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Class Teachers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            A teacher sees the students, attendance and exam records of the classes assigned here — and nothing else.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="rounded-lg border border-input bg-background py-1.5 pl-9 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20 w-48"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <select
          value={draft.teacher_user_id}
          onChange={(e) => setDraft({ ...draft, teacher_user_id: e.target.value })}
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs min-w-[200px] focus:outline-none focus:ring-1 focus:ring-ring/20"
        >
          <option value="">Select teacher…</option>
          {teachers.map((t) => (
            <option key={t.user_id} value={t.user_id}>
              {t.display_name || t.user_id.slice(0, 8)} ({t.role})
            </option>
          ))}
        </select>
        <select
          value={draft.target}
          onChange={(e) => setDraft({ ...draft, target: e.target.value })}
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs min-w-[240px] focus:outline-none focus:ring-1 focus:ring-ring/20"
        >
          <option value="">Select class / batch…</option>
          {targets.map((t) => (
            <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.label}</option>
          ))}
        </select>
        <input
          value={draft.section}
          onChange={(e) => setDraft({ ...draft, section: e.target.value })}
          placeholder="Section (blank = whole batch)"
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs w-52 focus:outline-none focus:ring-1 focus:ring-ring/20"
        />
        <Button size="sm" className="h-8 text-xs" onClick={add} disabled={saving === "new"}>
          {saving === "new" ? <ButtonOrb state="working" onFilled /> : <><Plus className="h-3.5 w-3.5 mr-1" /> Assign</>}
        </Button>
      </div>

      {teachers.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">
          No users hold the teacher, faculty or school coordinator role yet — assign one in Users &amp; Roles first.
        </p>
      )}

      <div className="rounded-xl border border-border overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Teacher</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Class</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Section</th>
              <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Status</th>
              <th className="w-10 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 border-b border-border/30 text-foreground">{teacherName(r.teacher_user_id)}</td>
                <td className="px-3 py-2 border-b border-border/30 text-muted-foreground">
                  {rowLabel(r)}
                </td>
                <td className="px-3 py-2 border-b border-border/30 text-muted-foreground">{r.section || "All"}</td>
                <td className="px-3 py-2 border-b border-border/30">
                  <button
                    onClick={() => toggleActive(r)}
                    disabled={saving === r.id}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      r.active
                        ? "bg-success/15 text-success hover:bg-success/25"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {r.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-3 py-2 border-b border-border/30 text-right">
                  <button
                    onClick={() => remove(r)}
                    disabled={saving === r.id}
                    className="text-muted-foreground/40 hover:text-destructive transition-colors"
                    title="Remove assignment"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  <GraduationCap className="h-5 w-5 mx-auto mb-2 opacity-40" />
                  No class teachers assigned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
