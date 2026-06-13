import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { Users, Search, GraduationCap, MapPin, ChevronRight, Loader2, UserPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddStudentDialog } from "@/components/admissions/AddStudentDialog";
import { StudentDraftsPanel } from "@/components/admissions/StudentDraftsPanel";
import { BulkStudentImportDialog } from "@/components/admissions/BulkStudentImportDialog";
import { usePermissions } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";
import { classifyCourse } from "@/lib/courseSort";

interface StudentRow {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  status: string;
  phone: string | null;
  created_by: string | null;
  section: string | null;
  course_name?: string;
  course_code?: string | null;
  campus_name?: string;
  batch_name?: string;
  batch_section?: string | null;
  institution_type?: string | null;
  class_order?: number;
  is_school?: boolean;
}

interface StudentGroup {
  key: string;
  label: string;
  subtitle?: string;
  order: number;
  students?: StudentRow[];
  batches?: StudentGroup[];
}

interface StudentQueryRow {
  id: string;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  status: string;
  phone: string | null;
  created_by: string | null;
  section: string | null;
  courses?: {
    id: string;
    name: string | null;
    code: string | null;
    departments?: {
      institutions?: {
        name: string | null;
        type: string | null;
      } | null;
    } | null;
  } | null;
  batches?: {
    name: string | null;
    section: string | null;
  } | null;
  campuses?: {
    name: string | null;
  } | null;
  leads?: {
    counsellor_id: string | null;
  } | null;
}

const UNKNOWN_CLASS = "Unassigned Class";
const UNKNOWN_PROGRAM = "Unassigned Programme";
const UNKNOWN_BATCH = "Unassigned Batch";

const isSchoolCourse = (student: StudentRow) => {
  if (student.institution_type === "school") return true;
  const text = `${student.course_code || ""} ${student.course_name || ""}`.toLowerCase();
  return /\b(mes|bsa|bsav|eyp|pyp|myp|lkg|ukg|nursery|toddler|class|grade)\b/.test(text);
};

const batchLabel = (student: StudentRow) =>
  [student.batch_name, student.batch_section && `Section ${student.batch_section}`].filter(Boolean).join(" · ") || UNKNOWN_BATCH;

const sortByName = (a: StudentRow, b: StudentRow) => a.name.localeCompare(b.name);

const groupStudents = (students: StudentRow[]) => {
  const schoolMap = new Map<string, StudentGroup>();
  const higherMap = new Map<string, StudentGroup>();

  for (const student of students) {
    if (student.is_school) {
      const label = student.course_name || UNKNOWN_CLASS;
      const key = student.course_code || label;
      const existing = schoolMap.get(key) ?? {
        key,
        label,
        subtitle: student.campus_name,
        order: student.class_order ?? 999,
        students: [],
      };
      existing.students?.push(student);
      schoolMap.set(key, existing);
      continue;
    }

    const programLabel = student.course_name || UNKNOWN_PROGRAM;
    const programKey = student.course_code || programLabel;
    const programGroup = higherMap.get(programKey) ?? {
      key: programKey,
      label: programLabel,
      subtitle: student.campus_name,
      order: 0,
      batches: [],
    };

    const studentBatchLabel = batchLabel(student);
    const studentBatchKey = `${programKey}:${student.batch_name || UNKNOWN_BATCH}:${student.batch_section || ""}`;
    let batchGroup = programGroup.batches?.find((batch) => batch.key === studentBatchKey);
    if (!batchGroup) {
      batchGroup = {
        key: studentBatchKey,
        label: studentBatchLabel,
        order: programGroup.batches?.length ?? 0,
        students: [],
      };
      programGroup.batches?.push(batchGroup);
    }
    batchGroup.students?.push(student);
    higherMap.set(programKey, programGroup);
  }

  const schoolGroups = Array.from(schoolMap.values())
    .map((group) => ({ ...group, students: [...(group.students ?? [])].sort(sortByName) }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const higherEdGroups = Array.from(higherMap.values())
    .map((program) => ({
      ...program,
      batches: [...(program.batches ?? [])]
        .map((batch) => ({ ...batch, students: [...(batch.students ?? [])].sort(sortByName) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { schoolGroups, higherEdGroups };
};

const Students = () => {
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const { selectedCampusId } = useCampus();
  const { can } = usePermissions();
  const { role, user, profile } = useAuth();
  const canCreateStudents = can("students", "create");

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select(`
        id,
        name,
        admission_no,
        pre_admission_no,
        status,
        phone,
        created_by,
        section,
        courses:course_id(
          id,
          name,
          code,
          departments:department_id(
            institutions:institution_id(name, type)
          )
        ),
        batches:batch_id(name, section),
        campuses:campus_id(name),
        leads:lead_id(counsellor_id)
      `)
      .order("name", { ascending: true })
      .limit(1000);
    if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);
    const { data } = await query;
    if (data) {
      const scopedRows = role === "counsellor"
        ? (data as StudentQueryRow[]).filter((s) => s.created_by === user?.id || s.leads?.counsellor_id === profile?.id)
        : data as StudentQueryRow[];

      setStudents(scopedRows.map((s) => {
        const course = s.courses;
        const institution = course?.departments?.institutions;
        const classification = classifyCourse({
          id: course?.id || s.id,
          name: course?.name || "",
          code: course?.code || null,
          institution_type: institution?.type || null,
        });
        const row: StudentRow = {
          ...s,
          course_name: course?.name || "—",
          course_code: course?.code || null,
          campus_name: s.campuses?.name || "—",
          batch_name: s.batches?.name || "",
          batch_section: s.batches?.section || null,
          institution_type: institution?.type || null,
          class_order: classification.orderInSection,
        };
        return { ...row, is_school: isSchoolCourse(row) };
      }));
    }
    setLoading(false);
  }, [profile?.id, role, selectedCampusId, user?.id]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.admission_no || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.pre_admission_no || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.course_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.batch_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (s.section || "").toLowerCase().includes(search.toLowerCase())
  );

  const { schoolGroups, higherEdGroups } = useMemo(() => groupStudents(filtered), [filtered]);

  const displayNo = (s: StudentRow) => s.admission_no || s.pre_admission_no || "—";

  const statusStyles: Record<string, string> = {
    active: "bg-pastel-green text-foreground/80",
    pre_admitted: "bg-pastel-yellow text-foreground/80",
    inactive: "bg-pastel-red text-foreground/80",
    alumni: "bg-pastel-blue text-foreground/80",
    dropped: "bg-pastel-red text-foreground/80",
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage student records.</p>
        </div>
        {canCreateStudents && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-1.5 text-sm">
              <Upload className="h-4 w-4" /> Bulk Import
            </Button>
            <Button onClick={() => setAddOpen(true)} className="gap-1.5 text-sm">
              <UserPlus className="h-4 w-4" /> Add Student
            </Button>
          </div>
        )}
      </div>

      {canCreateStudents && (
        <StudentDraftsPanel
          refreshKey={draftRefreshKey}
          onResume={(id) => { setResumeDraftId(id); setAddOpen(true); }}
        />
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Search by name, admission no, course..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      <div className="space-y-5">
        {filtered.length === 0 ? (
          <div className="rounded-xl bg-card card-shadow p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No students found</p>
          </div>
        ) : (
          <>
            {schoolGroups.length > 0 && (
              <StudentGroupSection
                title="School Classes"
                groups={schoolGroups}
                displayNo={displayNo}
                statusStyles={statusStyles}
              />
            )}

            {higherEdGroups.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Higher Education Programmes</h2>
                </div>
                {higherEdGroups.map((program) => (
                  <div key={program.key} className="rounded-xl bg-card card-shadow overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 bg-muted/20">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{program.label}</h3>
                        <p className="text-[11px] text-muted-foreground">{program.subtitle || "—"}</p>
                      </div>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {(program.batches ?? []).reduce((sum, batch) => sum + (batch.students?.length ?? 0), 0)} students
                      </span>
                    </div>
                    <div className="divide-y divide-border">
                      {(program.batches ?? []).map((batch) => (
                        <div key={batch.key}>
                          <div className="flex items-center justify-between bg-background/60 px-4 py-2">
                            <p className="text-xs font-semibold text-foreground">{batch.label}</p>
                            <span className="text-[11px] text-muted-foreground">{batch.students?.length ?? 0}</span>
                          </div>
                          <StudentRows students={batch.students ?? []} displayNo={displayNo} statusStyles={statusStyles} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {canCreateStudents && (
        <>
          <AddStudentDialog
            open={addOpen}
            onOpenChange={(o) => { setAddOpen(o); if (!o) setResumeDraftId(null); }}
            onSuccess={() => { fetchStudents(); setDraftRefreshKey(k => k + 1); }}
            resumeDraftId={resumeDraftId}
            onDraftChange={() => setDraftRefreshKey(k => k + 1)}
          />
          <BulkStudentImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onSuccess={fetchStudents} />
        </>
      )}
    </div>
  );
};

const StudentGroupSection = ({
  title,
  groups,
  displayNo,
  statusStyles,
}: {
  title: string;
  groups: StudentGroup[];
  displayNo: (student: StudentRow) => string;
  statusStyles: Record<string, string>;
}) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
    {groups.map((group) => (
      <div key={group.key} className="rounded-xl bg-card card-shadow overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 bg-muted/20">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
            <p className="text-[11px] text-muted-foreground">{group.subtitle || "—"}</p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">{group.students?.length ?? 0} students</span>
        </div>
        <StudentRows students={group.students ?? []} displayNo={displayNo} statusStyles={statusStyles} />
      </div>
    ))}
  </div>
);

const StudentRows = ({
  students,
  displayNo,
  statusStyles,
}: {
  students: StudentRow[];
  displayNo: (student: StudentRow) => string;
  statusStyles: Record<string, string>;
}) => (
  <div className="divide-y divide-border">
    {students.map((student) => (
      <Link key={student.id} to={`/students/${displayNo(student)}`}
        className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors group">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
          {student.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{student.name}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-[12px] text-muted-foreground">
            <span className="font-mono">{displayNo(student)}</span>
            <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{student.course_name}</span>
            {student.section && <span>Section {student.section}</span>}
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{student.campus_name}</span>
          </div>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${statusStyles[student.status] || "bg-muted text-foreground/80"}`}>
          {student.status.replace("_", " ")}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </Link>
    ))}
  </div>
);

export default Students;
