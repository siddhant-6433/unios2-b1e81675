import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Clock, Users, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AttendanceRow {
  id?: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  status: "present" | "absent" | "late";
}

interface ClassOption { id: string; name: string }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const Attendance = () => {
  const { user, role } = useAuth();
  // School takes attendance class-wise — the class teacher marks the whole day
  // once. College takes it per lecture, so each faculty marks their own period
  // and a student can be present in one subject and absent in another.
  const canMarkDaily = usePermission("attendance", "mark_daily");
  const canMarkPeriod = usePermission("attendance", "mark_period");
  const canMark = canMarkDaily || canMarkPeriod;
  const [mode, setMode] = useState<"daily" | "period">(canMarkDaily ? "daily" : "period");
  const { toast } = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchId, setBatchId] = useState("");
  const [batches, setBatches] = useState<ClassOption[]>([]);
  const [periods, setPeriods] = useState<{ id: string; label: string; period_no: number }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Calendar state
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [attendanceDates, setAttendanceDates] = useState<Map<string, string>>(new Map());

  useEffect(() => { fetchBatches(); }, [role, mode]);
  useEffect(() => { if (batchId) fetchAttendance(); }, [batchId, date, mode, periodId, subjectId]);
  useEffect(() => { if (batchId) fetchMonthSummary(); }, [batchId, calMonth, calYear]);
  useEffect(() => { if (mode === "period") void fetchPeriodOptions(); }, [mode, batchId]);

  // Scope the class list to the role's own assignments. Daily marking belongs to
  // the class teacher, so it lists class_teachers batches; period marking belongs
  // to the subject teacher, so it lists subject_allocations batches. Listing
  // every batch would just offer classes whose students come back empty via RLS.
  const fetchBatches = async () => {
    // A class is a college batch ("batch:<id>") or a school course
    // ("course:<id>"). School students have batch_id NULL, so a batch-only list
    // would offer a school class teacher nothing to mark.
    const [batchRes, courseRes] = await Promise.all([
      supabase.from("batches").select("id, name").order("name"),
      supabase.from("courses").select("id, name").eq("type", "school").eq("is_active", true).order("display_order"),
    ]);

    let visible: ClassOption[] = [
      ...(((courseRes.data as { id: string; name: string }[]) || [])
        .map((c) => ({ id: `course:${c.id}`, name: c.name }))),
      ...(((batchRes.data as { id: string; name: string }[]) || [])
        .map((b) => ({ id: `batch:${b.id}`, name: b.name }))),
    ];

    if (role === "teacher" || role === "faculty") {
      const source = mode === "daily"
        ? supabase.from("class_teachers").select("batch_id, course_id").eq("active", true)
        : supabase.from("subject_allocations").select("batch_id").eq("active", true);
      const { data: rows } = await source;
      const mine = new Set(
        ((rows as { batch_id: string | null; course_id?: string | null }[]) || [])
          .flatMap((r) => [
            r.batch_id ? `batch:${r.batch_id}` : null,
            r.course_id ? `course:${r.course_id}` : null,
          ])
          .filter(Boolean) as string[],
      );
      visible = visible.filter((c) => mine.has(c.id));
    }

    setBatches(visible);
    setBatchId((prev) => (visible.some((b) => b.id === prev) ? prev : visible[0]?.id ?? ""));
    setLoading(false);
  };

  // Period mode needs a period + subject: they are what make the row distinct
  // under da_uniq_student_date_subject_period, so a whole-day row and a
  // per-lecture row for the same student and date can coexist.
  const fetchPeriodOptions = async () => {
    const [p, sa] = await Promise.all([
      supabase.from("class_periods").select("id, label, period_no").eq("active", true).order("period_no"),
      // Period marking is the college path, which is always batch-keyed.
      supabase.from("subject_allocations")
        .select("subject_id").eq("active", true)
        .eq("batch_id", batchId.startsWith("batch:")
          ? batchId.slice(6)
          : "00000000-0000-0000-0000-000000000000"),
    ]);
    setPeriods((p.data as { id: string; label: string; period_no: number }[]) || []);

    const ids = Array.from(new Set(((sa.data as { subject_id: string }[]) || []).map((r) => r.subject_id)));
    if (ids.length === 0) { setSubjects([]); setSubjectId(""); return; }
    const { data: subs } = await supabase.from("subjects").select("id, name").in("id", ids).order("name");
    const list = (subs as { id: string; name: string }[]) || [];
    setSubjects(list);
    setSubjectId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ""));
  };

  const fetchAttendance = async () => {
    setLoading(true);
    // batchId is "batch:<id>" or "course:<id>" — school classes are keyed by
    // course because those students have no batch.
    const [kind, targetId] = batchId.split(":");
    const { data: students } = await supabase.from("students")
      .select("id, name, admission_no, pre_admission_no")
      .eq(kind === "course" ? "course_id" : "batch_id", targetId)
      .in("status", ["active", "pre_admitted"])
      .order("name");

    if (!students || students.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    // Matched on student + date, not batch: a student who changed batch mid-year
    // still has one row per slot, and re-inserting would collide with
    // da_uniq_student_date_subject_period. The slot is the whole day
    // (subject_id/period_id NULL) or one lecture — matching the wrong slot would
    // make a subject teacher overwrite the class teacher's daily register.
    let existingQuery = supabase.from("daily_attendance")
      .select("id, student_id, status")
      .eq("date", date)
      .in("student_id", students.map(s => s.id));
    existingQuery = mode === "daily"
      ? existingQuery.is("subject_id", null).is("period_id", null)
      : existingQuery.eq("subject_id", subjectId).eq("period_id", periodId);
    const { data: existing } = await existingQuery;

    const existingMap = new Map((existing || []).map(a => [a.student_id, a]));

    setRecords(students.map(s => {
      const ex = existingMap.get(s.id);
      return {
        id: ex?.id,
        student_id: s.id,
        student_name: s.name,
        admission_no: s.admission_no || s.pre_admission_no || "—",
        status: (ex?.status as any) || "present",
      };
    }));
    setLoading(false);
  };

  const fetchMonthSummary = async () => {
    const startDate = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-01`;
    const endDay = new Date(calYear, calMonth + 1, 0).getDate();
    const endDate = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${endDay}`;

    const [sKind, sTarget] = batchId.split(":");
    let q = supabase.from("daily_attendance").select("date, status, students!inner(course_id)");
    q = sKind === "course" ? q.eq("students.course_id", sTarget) : q.eq("batch_id", sTarget);
    const { data } = await q
      .gte("date", startDate)
      .lte("date", endDate);

    const map = new Map<string, string>();
    (data || []).forEach(d => {
      if (!map.has(d.date) || d.status === "absent") map.set(d.date, d.status);
    });
    setAttendanceDates(map);
  };

  const toggleStatus = (studentId: string) => {
    setRecords(prev => prev.map(r => {
      if (r.student_id !== studentId) return r;
      const next = r.status === "present" ? "absent" : r.status === "absent" ? "late" : "present";
      return { ...r, status: next };
    }));
  };

  // Update rows that already exist, insert the rest. The previous
  // delete-then-insert-the-whole-batch could not work for a teacher — DELETE on
  // daily_attendance is restricted to super_admin/campus_admin, so the delete
  // silently removed nothing and the insert then collided with
  // da_uniq_student_date_subject_period. It also threw away period/subject
  // columns set by anyone else on the same day.
  const saveAttendance = async () => {
    if (mode === "period" && (!periodId || !subjectId)) {
      toast({ title: "Pick a period and subject first", variant: "destructive" });
      return;
    }
    setSaving(true);

    const existing = records.filter(r => r.id);
    const fresh = records.filter(r => !r.id);

    const results = await Promise.all([
      ...existing.map(r =>
        supabase.from("daily_attendance")
          .update({ status: r.status, marked_by: user?.id || null })
          .eq("id", r.id!)
          .select("id")),
      ...(fresh.length
        ? [supabase.from("daily_attendance").insert(fresh.map(r => ({
            student_id: r.student_id,
            batch_id: batchId.startsWith("batch:") ? batchId.slice(6) : null,
            date,
            status: r.status,
            marked_by: user?.id || null,
            ...(mode === "period" ? { subject_id: subjectId, period_id: periodId } : {}),
          }))).select("id")]
        : []),
    ]);

    const error = results.find(r => r.error)?.error;
    // An RLS-filtered update "succeeds" with zero rows — treat that as a failure
    // rather than telling the user their marking was saved.
    const silentlyDropped = !error && results.some(r => (r.data?.length ?? 0) === 0);

    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else if (silentlyDropped) toast({
      title: "Not saved",
      description: "You don't have permission to mark attendance for this class.",
      variant: "destructive",
    });
    else toast({ title: "Attendance saved" });

    setSaving(false);
    await fetchAttendance();
    await fetchMonthSummary();
  };

  const present = records.filter(r => r.status === "present").length;
  const absent = records.filter(r => r.status === "absent").length;
  const late = records.filter(r => r.status === "late").length;

  // Calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday start
    const cells: (number | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push(i);
    return cells;
  }, [calMonth, calYear]);

  const today = new Date();
  const isToday = (day: number) => day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
  const selectedDay = parseInt(date.split("-")[2]);
  const isSelected = (day: number) => day === selectedDay && calMonth === parseInt(date.split("-")[1]) - 1 && calYear === parseInt(date.split("-")[0]);

  const getColors = (name: string): string => {
    const colors = [
      "bg-primary/15 text-primary",
      "bg-chart-2/15 text-chart-2",
      "bg-chart-3/15 text-chart-3",
      "bg-destructive/15 text-destructive",
      "bg-chart-5/15 text-chart-5",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const statusIcon: Record<string, React.ReactNode> = {
    present: <Check className="h-3.5 w-3.5" />,
    absent: <X className="h-3.5 w-3.5" />,
    late: <Clock className="h-3.5 w-3.5" />,
  };

  const statusDot: Record<string, string> = {
    present: "bg-success",
    absent: "bg-destructive",
    late: "bg-warning",
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Attendance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "daily" ? "Whole-day register for your class" : "Per-lecture attendance for your own periods"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMarkDaily && canMarkPeriod && (
            <div className="flex rounded-lg border border-input overflow-hidden">
              {(["daily", "period"] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    mode === m ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
                  }`}>
                  {m === "daily" ? "Whole day" : "Per lecture"}
                </button>
              ))}
            </div>
          )}
          {mode === "period" && (
            <>
              <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                <option value="">Period…</option>
                {periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                <option value="">Subject…</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column: Calendar + Summary */}
          <div className="lg:col-span-1 space-y-4">
            {/* Calendar Card */}
            <div className="rounded-xl bg-card card-shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}
                  className="p-1 rounded-md hover:bg-muted transition-colors"><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>
                <span className="text-sm font-semibold text-foreground">{MONTHS[calMonth]} {calYear}</span>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}
                  className="p-1 rounded-md hover:bg-muted transition-colors"><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center">
                {DAYS.map(d => (
                  <div key={d} className="text-[10px] font-medium text-muted-foreground/60 py-1">{d}</div>
                ))}
                {calendarDays.map((day, i) => {
                  if (day === null) return <div key={`e-${i}`} />;
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const hasData = attendanceDates.has(dateStr);
                  return (
                    <button
                      key={i}
                      onClick={() => setDate(dateStr)}
                      className={`relative flex flex-col items-center justify-center rounded-lg py-1.5 text-xs transition-all
                        ${isSelected(day) ? "bg-primary text-primary-foreground font-bold shadow-sm" :
                          isToday(day) ? "bg-primary/10 text-primary font-semibold" :
                          "text-foreground hover:bg-muted/60"}`}
                    >
                      {day}
                      {hasData && !isSelected(day) && (
                        <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${attendanceDates.get(dateStr) === "absent" ? "bg-destructive" : "bg-success"}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary Bars */}
            <div className="rounded-xl bg-card card-shadow p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary for {new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</h3>
              <div className="space-y-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Present</span>
                    <span className="text-xs font-semibold text-foreground">{present}/{records.length}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-success transition-all" style={{ width: records.length > 0 ? `${(present / records.length) * 100}%` : "0%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Absent</span>
                    <span className="text-xs font-semibold text-foreground">{absent}/{records.length}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-destructive transition-all" style={{ width: records.length > 0 ? `${(absent / records.length) * 100}%` : "0%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Late</span>
                    <span className="text-xs font-semibold text-foreground">{late}/{records.length}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-warning transition-all" style={{ width: records.length > 0 ? `${(late / records.length) * 100}%` : "0%" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Student List */}
          <div className="lg:col-span-2">
            {records.length === 0 ? (
              <div className="rounded-xl bg-card card-shadow p-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No students in this batch</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-card card-shadow overflow-hidden">
                  <div className="divide-y divide-border">
                    {records.map((student) => (
                      <div key={student.student_id} onClick={() => canMark && toggleStatus(student.student_id)}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${canMark ? "cursor-pointer hover:bg-muted/30" : ""}`}>
                        {/* Colored Avatar */}
                        <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold shrink-0 ${getColors(student.student_name)}`}>
                          {student.student_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{student.student_name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{student.admission_no}</p>
                        </div>
                        {/* Status indicator */}
                        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors
                          ${student.status === "present" ? "bg-success/10 text-success" :
                            student.status === "absent" ? "bg-destructive/10 text-destructive" :
                            "bg-warning/10 text-warning"}`}>
                          {statusIcon[student.status]}
                          {student.status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {canMark && (
                  <div className="flex justify-end">
                    <Button onClick={saveAttendance} disabled={saving} className="gap-2 rounded-lg">
                      {saving ? <ButtonOrb state="working" onFilled /> : <Check className="h-4 w-4" />}
                      Save Attendance
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
