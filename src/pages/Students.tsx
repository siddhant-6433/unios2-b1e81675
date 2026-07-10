import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCampus } from "@/contexts/CampusContext";
import { Users, Search, GraduationCap, MapPin, ChevronRight, Loader2, UserPlus, Upload, Filter, BookOpen, Layers, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddStudentDialog } from "@/components/admissions/AddStudentDialog";
import { StudentDraftsPanel } from "@/components/admissions/StudentDraftsPanel";
import { BulkStudentImportDialog } from "@/components/admissions/BulkStudentImportDialog";
import { usePermissions } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";
import { exportRowsCsv } from "@/lib/xlsxExport";
import { getApplicationPhotoUrlsByLeadId } from "@/lib/applicationPhotos";

interface StudentRow {
  id: string;
  lead_id: string | null;
  name: string;
  admission_no: string | null;
  pre_admission_no: string | null;
  status: string;
  phone: string | null;
  photo_url: string | null;
  course_id: string | null;
  batch_id: string | null;
  session_id: string | null;
  campus_id?: string | null;
  joining_class: string | null;
  joining_academic_year: string | null;
  section: string | null;
  semester?: string | null;
  admission_date?: string | null;
  dob?: string | null;
  gender?: string | null;
  student_email?: string | null;
  email?: string | null;
  father_name?: string | null;
  father_phone?: string | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  course_name?: string;
  course_code?: string | null;
  course_type?: string | null;
  campus_name?: string;
  batch_name?: string;
  batch_section?: string | null;
  session_name?: string | null;
}

type SegregationMode = "class" | "program";

const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const GRADE_LABELS: Record<string, string> = {
  TOD: "Toddler",
  NUR: "Nursery",
  LKG: "LKG",
  UKG: "UKG",
  G1: "Grade I",
  G2: "Grade II",
  G3: "Grade III",
  G4: "Grade IV",
  G5: "Grade V",
  G6: "Grade VI",
  G7: "Grade VII",
  G8: "Grade VIII",
  G9: "Grade IX",
  G10: "Grade X",
  G11: "Grade XI",
  G12: "Grade XII",
};

const ROMAN_BY_NUMBER: Record<string, string> = {
  "1": "I",
  "2": "II",
  "3": "III",
  "4": "IV",
  "5": "V",
  "6": "VI",
  "7": "VII",
  "8": "VIII",
  "9": "IX",
  "10": "X",
  "11": "XI",
  "12": "XII",
};

const NUMBER_BY_ROMAN = Object.fromEntries(
  Object.entries(ROMAN_BY_NUMBER).map(([number, roman]) => [roman, number])
);

const gradeFromCourseCode = (code?: string | null) => {
  const suffix = clean(code)?.split("-").pop()?.toUpperCase();
  return suffix ? GRADE_LABELS[suffix] || null : null;
};

const canonicalGradeLabel = (value?: string | null) => {
  const raw = clean(value);
  if (!raw) return null;

  const normalized = raw
    .replace(/\bclass\b/gi, "Grade")
    .replace(/\bstd\.?\b/gi, "Grade")
    .replace(/\s+/g, " ")
    .trim();

  const numberMatch = normalized.match(/\b(?:Grade\s*)?([0-9]{1,2})\b/i);
  if (numberMatch && ROMAN_BY_NUMBER[numberMatch[1]]) {
    return `Grade ${ROMAN_BY_NUMBER[numberMatch[1]]}`;
  }

  const romanMatch = normalized.match(/\b(?:Grade\s*)?(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\b/i);
  if (romanMatch) {
    const roman = romanMatch[1].toUpperCase();
    if (NUMBER_BY_ROMAN[roman]) return `Grade ${roman}`;
  }

  if (/^(toddler|nursery|lkg|ukg)$/i.test(normalized)) return normalized.toUpperCase() === normalized ? normalized : normalized.replace(/\b\w/g, c => c.toUpperCase());
  return normalized;
};

const isGradeLike = (value?: string | null) =>
  !!clean(value) && /^(grade|class|std)\s*[0-9ivx]+$|^(toddler|nursery|lkg|ukg)$/i.test(clean(value)!);

const isSchoolStudent = (student: StudentRow) =>
  student.course_type === "school" ||
  !!gradeFromCourseCode(student.course_code) ||
  isGradeLike(student.course_name) ||
  isGradeLike(student.joining_class);

const getClassLabel = (student: StudentRow) => {
  if (!isSchoolStudent(student)) return null;
  return gradeFromCourseCode(student.course_code) ||
    canonicalGradeLabel(student.course_name) ||
    canonicalGradeLabel(student.joining_class);
};

const getProgramLabel = (student: StudentRow) => clean(student.course_name);

const getBatchLabel = (student: StudentRow) => {
  const batchName = clean(student.batch_name);
  const batchSection = clean(student.batch_section);
  if (batchName && batchSection && !batchName.toLowerCase().includes(batchSection.toLowerCase())) {
    return `${batchName} (${batchSection})`;
  }
  return batchName || clean(student.section);
};

const getSessionLabel = (student: StudentRow) =>
  clean(student.session_name) || clean(student.joining_academic_year);

const getSectionLabel = (student: StudentRow) => {
  const section = clean(student.section);
  if (!section || isGradeLike(section)) return null;
  return section.toUpperCase().startsWith("SECTION") ? section : `Section ${section}`;
};

const getCurrentTermLabel = (student: StudentRow) => {
  const semester = clean(student.semester);
  if (!semester) return null;
  if (/^(sem|semester|year)\b/i.test(semester)) return semester;
  if (/^[0-9]+$/.test(semester)) return `Sem ${semester}`;
  return semester;
};

const getPrimaryAcademicLabel = (student: StudentRow, mode: SegregationMode) =>
  mode === "class" ? getClassLabel(student) : getProgramLabel(student);

const getSecondaryAcademicLabel = (student: StudentRow, mode: SegregationMode) =>
  mode === "class" ? getSessionLabel(student) : getBatchLabel(student);

const sortLabels = (labels: Array<string | null | undefined>) =>
  Array.from(new Set(labels.filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

const toggleSelection = (selected: string[], value: string) =>
  selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];

const matchesSelected = (selected: string[], value?: string | null) =>
  selected.length === 0 || (!!value && selected.includes(value));

const initialsForName = (name: string) =>
  name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

const multiSelectLabel = (selected: string[], emptyLabel: string) => {
  if (selected.length === 0) return emptyLabel;
  if (selected.length === 1) return selected[0];
  return `${selected.length} selected`;
};

const Students = () => {
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const [segregationMode, setSegregationMode] = useState<SegregationMode>("class");
  const [classFilters, setClassFilters] = useState<string[]>([]);
  const [programFilters, setProgramFilters] = useState<string[]>([]);
  const [batchFilters, setBatchFilters] = useState<string[]>([]);
  const [termFilters, setTermFilters] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const { selectedCampusId } = useCampus();
  const { can } = usePermissions();
  const { role } = useAuth();
  const canCreateStudents = can("students", "create");
  const canExportStudents = role === "super_admin" || role === "principal";

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const selectFields = "id, lead_id, name, admission_no, pre_admission_no, status, phone, photo_url, campus_id, course_id, batch_id, session_id, joining_class, joining_academic_year, section, semester, admission_date, dob, gender, student_email, email, father_name, father_phone, mother_name, mother_phone, guardian_name, guardian_phone, address, city, state, pincode, courses:course_id(name, code, type), campuses:campus_id(name), batches:batch_id(name, section), admission_sessions:session_id(name)";
    const fallbackSelectFields = selectFields.replace("section, semester,", "section,");

    const runQuery = (fields: string) => {
      let query = supabase
        .from("students")
        .select(fields)
        .order("created_at", { ascending: false })
        .limit(500);
      if (selectedCampusId !== "all") query = query.eq("campus_id", selectedCampusId);
      return query;
    };

    let { data, error } = await runQuery(selectFields);
    if (error && /semester/i.test(error.message || "")) {
      const fallback = await runQuery(fallbackSelectFields);
      data = fallback.data;
      error = fallback.error;
    }

    if (data) {
      const mappedStudents = data.map((s: any) => ({
        ...s,
        course_name: s.courses?.name || "—",
        course_code: s.courses?.code || null,
        course_type: s.courses?.type || null,
        campus_name: s.campuses?.name || "—",
        batch_name: s.batches?.name || null,
        batch_section: s.batches?.section || null,
        session_name: s.admission_sessions?.name || null,
      }));
      setStudents(mappedStudents);

      const missingPhotoLeadIds = mappedStudents
        .filter((student) => !student.photo_url && student.lead_id)
        .map((student) => student.lead_id as string);
      if (missingPhotoLeadIds.length > 0) {
        getApplicationPhotoUrlsByLeadId(missingPhotoLeadIds).then((photoByLead) => {
          if (photoByLead.size === 0) return;
          setStudents((current) => current.map((student) => (
            !student.photo_url && student.lead_id && photoByLead.has(student.lead_id)
              ? { ...student, photo_url: photoByLead.get(student.lead_id) || student.photo_url }
              : student
          )));
        });
      }
    }
    if (error) {
      console.error("[students] fetch failed", error);
      setLoadError(error.message || "Could not load students.");
      setStudents([]);
    }
    setLoading(false);
  }, [selectedCampusId]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const classOptions = useMemo(
    () => sortLabels(students.filter(isSchoolStudent).map(getClassLabel)),
    [students]
  );

  const programOptions = useMemo(
    () => sortLabels(students.filter(student => !isSchoolStudent(student)).map(getProgramLabel)),
    [students]
  );

  const batchOptions = useMemo(() => {
    const base = students.filter((student) => {
      if (segregationMode === "class" && !isSchoolStudent(student)) return false;
      if (segregationMode === "program" && isSchoolStudent(student)) return false;
      const selectedPrimary = segregationMode === "class" ? classFilters : programFilters;
      return matchesSelected(selectedPrimary, getPrimaryAcademicLabel(student, segregationMode));
    });
    return sortLabels(base.map(student => getSecondaryAcademicLabel(student, segregationMode)));
  }, [students, segregationMode, classFilters, programFilters]);

  const termOptions = useMemo(() => {
    if (segregationMode !== "program") return [];
    const base = students.filter((student) => {
      if (isSchoolStudent(student)) return false;
      if (!matchesSelected(programFilters, getProgramLabel(student))) return false;
      if (!matchesSelected(batchFilters, getBatchLabel(student))) return false;
      return true;
    });
    return sortLabels(base.map(getCurrentTermLabel));
  }, [students, segregationMode, programFilters, batchFilters]);

  useEffect(() => {
    setBatchFilters([]);
    setTermFilters([]);
  }, [segregationMode, classFilters, programFilters]);

  useEffect(() => {
    setTermFilters([]);
  }, [batchFilters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (segregationMode === "class" && !isSchoolStudent(s)) return false;
      if (segregationMode === "program" && isSchoolStudent(s)) return false;

      const classLabel = getClassLabel(s);
      const programLabel = getProgramLabel(s);
      const batchLabel = getBatchLabel(s);
      const sessionLabel = getSessionLabel(s);
      const secondaryLabel = getSecondaryAcademicLabel(s, segregationMode);
      const currentTermLabel = getCurrentTermLabel(s);

      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        (s.admission_no || "").toLowerCase().includes(q) ||
        (s.pre_admission_no || "").toLowerCase().includes(q) ||
        (programLabel || "").toLowerCase().includes(q) ||
        (classLabel || "").toLowerCase().includes(q) ||
        (batchLabel || "").toLowerCase().includes(q) ||
        (sessionLabel || "").toLowerCase().includes(q) ||
        (currentTermLabel || "").toLowerCase().includes(q);

      const matchesGroup = segregationMode === "class"
        ? matchesSelected(classFilters, classLabel)
        : matchesSelected(programFilters, programLabel);

      const matchesBatch = matchesSelected(batchFilters, secondaryLabel);
      const matchesTerm = segregationMode !== "program" ||
        matchesSelected(termFilters, currentTermLabel);

      return matchesSearch && matchesGroup && matchesBatch && matchesTerm;
    });
  }, [students, search, segregationMode, classFilters, programFilters, batchFilters, termFilters]);

  const hasActiveSegregation =
    classFilters.length > 0 ||
    programFilters.length > 0 ||
    batchFilters.length > 0 ||
    termFilters.length > 0;

  const clearSegregation = () => {
    setClassFilters([]);
    setProgramFilters([]);
    setBatchFilters([]);
    setTermFilters([]);
  };

  const exportStudents = async () => {
    if (!canExportStudents) return;
    setExporting(true);
    try {
      exportRowsCsv(filtered.map((student) => ({
        "Admission No": student.admission_no || "",
        "Pre Admission No": student.pre_admission_no || "",
        Name: student.name,
        Status: student.status,
        Phone: student.phone || "",
        "Student Email": student.student_email || student.email || "",
        Gender: student.gender || "",
        "Date of Birth": student.dob || "",
        Campus: student.campus_name || "",
        Type: isSchoolStudent(student) ? "School" : "Higher Ed",
        "Class / Grade": getClassLabel(student) || "",
        Program: getProgramLabel(student) || "",
        Session: getSessionLabel(student) || "",
        Batch: getBatchLabel(student) || "",
        "Current Semester / Year": getCurrentTermLabel(student) || "",
        Section: getSectionLabel(student) || student.section || "",
        "Admission Date": student.admission_date || "",
        "Joining Academic Year": student.joining_academic_year || "",
        "Father Name": student.father_name || "",
        "Father Phone": student.father_phone || "",
        "Mother Name": student.mother_name || "",
        "Mother Phone": student.mother_phone || "",
        "Guardian Name": student.guardian_name || "",
        "Guardian Phone": student.guardian_phone || "",
        Address: [student.address, student.city, student.state, student.pincode].filter(Boolean).join(", "),
        "Photo URL": student.photo_url || "",
      })), "students-details");
    } finally {
      setExporting(false);
    }
  };

  const displayNo = (s: StudentRow) => s.admission_no || s.pre_admission_no || "—";

  const statusStyles: Record<string, string> = {
    active: "bg-pastel-green text-foreground/80",
    pre_admitted: "bg-pastel-yellow text-foreground/80",
    inactive: "bg-pastel-red text-foreground/80",
    alumni: "bg-pastel-blue text-foreground/80",
    dropped: "bg-pastel-red text-foreground/80",
  };

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

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" placeholder="Search by name, admission no, course..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-input bg-background pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>

          {canExportStudents && (
            <Button type="button" variant="outline" onClick={exportStudents} disabled={exporting || filtered.length === 0} className="h-10 rounded-xl gap-1.5 sm:ml-auto">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download CSV
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-10 items-center rounded-xl border border-input bg-background p-1">
              <button
                type="button"
                aria-pressed={segregationMode === "class"}
                onClick={() => setSegregationMode("class")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${segregationMode === "class" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Class + Session
              </button>
              <button
                type="button"
                aria-pressed={segregationMode === "program"}
                onClick={() => setSegregationMode("program")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${segregationMode === "program" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                Program + Batch
              </button>
            </div>

            <MultiSelectDropdown
              icon={<Filter className="h-4 w-4 text-muted-foreground" />}
              label={multiSelectLabel(
                segregationMode === "class" ? classFilters : programFilters,
                segregationMode === "class" ? "All classes / grades" : "All programs"
              )}
              options={segregationMode === "class" ? classOptions : programOptions}
              selected={segregationMode === "class" ? classFilters : programFilters}
              onToggle={(option) => segregationMode === "class"
                ? setClassFilters((current) => toggleSelection(current, option))
                : setProgramFilters((current) => toggleSelection(current, option))}
              emptyText={segregationMode === "class" ? "No classes found" : "No programs found"}
            />

            <MultiSelectDropdown
              icon={<Layers className="h-4 w-4 text-muted-foreground" />}
              label={multiSelectLabel(batchFilters, segregationMode === "class" ? "All sessions" : "All batches")}
              options={batchOptions}
              selected={batchFilters}
              onToggle={(option) => setBatchFilters((current) => toggleSelection(current, option))}
              emptyText={segregationMode === "class" ? "No sessions found" : "No batches found"}
            />

            {segregationMode === "program" && termOptions.length > 0 && (
              <MultiSelectDropdown
                icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
                label={multiSelectLabel(termFilters, "All terms")}
                options={termOptions}
                selected={termFilters}
                onToggle={(option) => setTermFilters((current) => toggleSelection(current, option))}
                emptyText="No terms found"
                widthClassName="sm:w-40"
              />
            )}

            <Button type="button" variant="outline" size="sm" onClick={clearSegregation} disabled={!hasActiveSegregation} className="h-10 rounded-xl gap-1.5">
              <X className="h-4 w-4" />
              Reset
            </Button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{loading ? "Loading students..." : `Showing ${filtered.length} of ${students.length} students`}</span>
        </div>
      </div>

      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : loadError ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Could not load students</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={fetchStudents} className="mt-4">
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No students found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((student) => (
              <Link key={student.id} to={`/students/${displayNo(student)}`}
                className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors group">
                {student.photo_url ? (
                  <img src={student.photo_url} alt={student.name} className="h-10 w-10 rounded-xl border border-border object-cover shrink-0" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary shrink-0">
                    {initialsForName(student.name)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{student.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-[12px] text-muted-foreground">
                    <span className="font-mono">{displayNo(student)}</span>
                    {isSchoolStudent(student) ? (
                      <>
                        {getClassLabel(student) && <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{getClassLabel(student)}</span>}
                        {getSessionLabel(student) && <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{getSessionLabel(student)}</span>}
                        {getSectionLabel(student) && <span className="flex items-center gap-1">{getSectionLabel(student)}</span>}
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{student.course_name}</span>
                        {getBatchLabel(student) && <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{getBatchLabel(student)}</span>}
                        {getCurrentTermLabel(student) && <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{getCurrentTermLabel(student)}</span>}
                      </>
                    )}
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

const MultiSelectDropdown = ({
  icon,
  label,
  options,
  selected,
  onToggle,
  emptyText,
  widthClassName = "sm:w-56",
}: {
  icon: ReactNode;
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  emptyText: string;
  widthClassName?: string;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" className={`h-10 w-full justify-start rounded-xl font-normal ${widthClassName}`}>
        {icon}
        <span className="ml-2 truncate">{label}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
      <DropdownMenuLabel className="text-xs text-muted-foreground">Select one or more</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {options.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">{emptyText}</div>
      ) : options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={selected.includes(option)}
          onCheckedChange={() => onToggle(option)}
          onSelect={(event) => event.preventDefault()}
        >
          {option}
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export default Students;
