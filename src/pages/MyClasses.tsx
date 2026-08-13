import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { GraduationCap, Users, ClipboardCheck, CalendarDays } from "lucide-react";

// A teacher's home. Lists the classes they are assigned to (as class teacher
// and/or subject teacher) and the students in each. RLS (teaches_student) is
// what actually enforces the scope — this page just makes it navigable.

interface ClassCard {
  batchId: string;
  label: string;
  section: string | null;
  asClassTeacher: boolean;
  subjects: string[];
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  section: string | null;
  batch_id: string | null;
}

const MyClasses = () => {
  const { user } = useAuth();
  const canMarkAttendance = usePermission("attendance", "mark");
  const [classes, setClasses] = useState<ClassCard[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (user?.id) void load(); }, [user?.id]);

  const load = async () => {
    setLoading(true);
    // Both tables are RLS-scoped to the current user (ct_self_select /
    // sa_self_select), so no explicit user filter is needed — but be explicit
    // anyway so an admin opening this page sees their own classes, not everyone's.
    const [ctRes, saRes] = await Promise.all([
      supabase.from("class_teachers")
        .select("batch_id, section").eq("teacher_user_id", user!.id).eq("active", true),
      supabase.from("subject_allocations")
        .select("batch_id, section, subject_id").eq("faculty_user_id", user!.id).eq("active", true),
    ]);

    const ct = (ctRes.data as { batch_id: string; section: string | null }[]) || [];
    const sa = (saRes.data as { batch_id: string | null; section: string | null; subject_id: string }[]) || [];

    const batchIds = Array.from(new Set([
      ...ct.map(r => r.batch_id),
      ...sa.map(r => r.batch_id).filter(Boolean) as string[],
    ]));

    if (batchIds.length === 0) {
      setClasses([]);
      setStudents([]);
      setLoading(false);
      return;
    }

    const subjectIds = Array.from(new Set(sa.map(r => r.subject_id)));
    const [batchRes, courseRes, subjRes, studentRes] = await Promise.all([
      supabase.from("batches").select("id, name, section, course_id").in("id", batchIds),
      supabase.from("courses").select("id, name"),
      subjectIds.length
        ? supabase.from("subjects").select("id, name").in("id", subjectIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase.from("students")
        .select("id, name, admission_no, pre_admission_no, section, batch_id")
        .in("batch_id", batchIds)
        .in("status", ["active", "pre_admitted"])
        .order("name"),
    ]);

    const courseName = Object.fromEntries(
      ((courseRes.data as { id: string; name: string }[]) || []).map(c => [c.id, c.name]));
    const subjectName = Object.fromEntries(
      ((subjRes.data as { id: string; name: string }[]) || []).map(s => [s.id, s.name]));

    const cards: ClassCard[] = ((batchRes.data as { id: string; name: string; section: string | null; course_id: string }[]) || [])
      .map(b => ({
        batchId: b.id,
        label: [courseName[b.course_id], b.name].filter(Boolean).join(" · ") || b.name,
        section: ct.find(r => r.batch_id === b.id)?.section ?? b.section,
        asClassTeacher: ct.some(r => r.batch_id === b.id),
        subjects: sa.filter(r => r.batch_id === b.id).map(r => subjectName[r.subject_id]).filter(Boolean),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    setClasses(cards);
    setStudents((studentRes.data as Student[]) || []);
    setSelected(prev => prev && cards.some(c => c.batchId === prev) ? prev : cards[0]?.batchId ?? null);
    setLoading(false);
  };

  const visibleStudents = useMemo(() => {
    if (!selected) return [];
    const card = classes.find(c => c.batchId === selected);
    return students.filter(s =>
      s.batch_id === selected && (!card?.section || s.section === card.section));
  }, [selected, students, classes]);

  if (loading) return <PageLoader />;

  if (classes.length === 0) {
    return (
      <div className="rounded-xl bg-card card-shadow p-12 text-center animate-fade-in">
        <GraduationCap className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">No classes assigned yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Ask an administrator to assign you a class in Admin Panel → Class Teachers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">My Classes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {classes.length} class{classes.length === 1 ? "" : "es"} · {students.length} students
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canMarkAttendance && (
            <Link to="/attendance"
              className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              <ClipboardCheck className="h-3.5 w-3.5" /> Mark Attendance
            </Link>
          )}
          <Link to="/timetable"
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            <CalendarDays className="h-3.5 w-3.5" /> Timetable
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 space-y-2">
          {classes.map(c => (
            <button
              key={c.batchId}
              onClick={() => setSelected(c.batchId)}
              className={`w-full text-left rounded-xl p-3.5 transition-colors ${
                selected === c.batchId ? "bg-primary/10 border border-primary/30" : "bg-card card-shadow hover:bg-muted/30"
              }`}
            >
              <p className="text-sm font-semibold text-foreground">
                {c.label}{c.section ? ` · ${c.section}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {c.asClassTeacher && (
                  <span className="rounded-full bg-success/15 text-success px-2 py-0.5 text-[10px] font-medium">Class Teacher</span>
                )}
                {c.subjects.map(s => (
                  <span key={s} className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px]">{s}</span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl bg-card card-shadow overflow-hidden">
            {visibleStudents.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No students in this class</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleStudents.map(s => (
                  <Link
                    key={s.id}
                    to={`/students/${s.admission_no || s.pre_admission_no || ""}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">
                      {s.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {s.admission_no || s.pre_admission_no || "—"}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyClasses;
