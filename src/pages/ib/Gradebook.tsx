import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Search, Download, Plus, BookOpen, GraduationCap,
  ChevronDown, MessageSquare, Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  name: string;
  course_id: string;
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
}

interface Assessment {
  id: string;
  title: string;
  type: string; // formative | summative
  grading_model: string;
  due_date: string | null;
  batch_id: string;
  max_points: number | null;
}

interface AssessmentResult {
  id?: string;
  assessment_id: string;
  student_id: string;
  rubric_level: string | null;
  points: number | null;
  comment: string | null;
}

interface MypCriterion {
  id: string;
  letter: string;
  name: string;
  subject_group_id: string;
  ib_myp_subject_groups: { name: string; code: string } | null;
}

interface SubjectGroup {
  id: string;
  name: string;
  code: string;
}

interface GradeBoundary {
  id: string;
  subject_group_id: string;
  academic_year: string;
  grade_1_min: number;
  grade_2_min: number;
  grade_3_min: number;
  grade_4_min: number;
  grade_5_min: number;
  grade_6_min: number;
  grade_7_min: number;
}

interface MypStudentRow {
  studentId: string;
  criteria: Record<string, number>; // letter -> score 0-8
  comment: string;
}

// ── PYP achievement levels ───────────────────────────────────────────────────

const PYP_LEVELS = ["Exceeding", "Meeting", "Approaching", "Beginning"] as const;
type PypLevel = typeof PYP_LEVELS[number];

const PYP_LEVEL_COLORS: Record<PypLevel, string> = {
  Exceeding: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Meeting: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Approaching: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Beginning: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeGrade(total: number, boundary: GradeBoundary | null): number {
  if (!boundary) return 0;
  if (total >= boundary.grade_7_min) return 7;
  if (total >= boundary.grade_6_min) return 6;
  if (total >= boundary.grade_5_min) return 5;
  if (total >= boundary.grade_4_min) return 4;
  if (total >= boundary.grade_3_min) return 3;
  if (total >= boundary.grade_2_min) return 2;
  if (total >= boundary.grade_1_min) return 1;
  return 1;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Gradebook() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"pyp" | "myp">("pyp");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">IB Gradebook</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage PYP and MYP student assessments and grades
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "pyp" | "myp")}>
        <TabsList>
          <TabsTrigger value="pyp" className="gap-1.5">
            <BookOpen className="h-4 w-4" /> PYP Gradebook
          </TabsTrigger>
          <TabsTrigger value="myp" className="gap-1.5">
            <GraduationCap className="h-4 w-4" /> MYP Gradebook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pyp">
          <PypGradebook />
        </TabsContent>
        <TabsContent value="myp">
          <MypGradebook />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PYP GRADEBOOK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function PypGradebook() {
  const { toast } = useToast();

  // State
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [students, setStudents] = useState<Student[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [results, setResults] = useState<Record<string, Record<string, AssessmentResult>>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(true);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editCell, setEditCell] = useState<{ studentId: string; assessmentId: string } | null>(null);
  const [editLevel, setEditLevel] = useState<string>("");
  const [editComment, setEditComment] = useState("");
  const [saving, setSaving] = useState(false);

  // Add assessment dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"formative" | "summative">("formative");
  const [newDueDate, setNewDueDate] = useState("");
  const [addingSaving, setAddingSaving] = useState(false);

  // ── Load PYP batches ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingBatches(true);
      const { data: inst } = await supabase
        .from("institutions")
        .select("id")
        .eq("code", "GZ1-MES")
        .single();
      if (!inst) { setLoadingBatches(false); return; }

      const { data: courses } = await supabase
        .from("courses")
        .select("id")
        .eq("institution_id", inst.id)
        .like("code", "MES-PYP%");
      if (!courses?.length) { setLoadingBatches(false); return; }

      const courseIds = courses.map((c: any) => c.id);
      const { data: batchData } = await supabase
        .from("batches")
        .select("id, name, course_id")
        .in("course_id", courseIds)
        .order("name");

      setBatches(batchData ?? []);
      if (batchData?.length) setSelectedBatch(batchData[0].id);
      setLoadingBatches(false);
    })();
  }, []);

  // ── Load students + assessments when batch changes ─────────────────────────
  useEffect(() => {
    if (!selectedBatch) return;
    (async () => {
      setLoading(true);
      const [stuRes, assRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, name, admission_no")
          .eq("batch_id", selectedBatch)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("ib_assessments")
          .select("*")
          .eq("batch_id", selectedBatch)
          .order("due_date"),
      ]);
      setStudents(stuRes.data ?? []);
      setAssessments(assRes.data ?? []);

      // Load all results for these assessments
      const assIds = (assRes.data ?? []).map((a: any) => a.id);
      if (assIds.length) {
        const { data: resData } = await supabase
          .from("ib_assessment_results")
          .select("*")
          .in("assessment_id", assIds);
        const map: Record<string, Record<string, AssessmentResult>> = {};
        for (const r of resData ?? []) {
          if (!map[r.assessment_id]) map[r.assessment_id] = {};
          map[r.assessment_id][r.student_id] = r;
        }
        setResults(map);
      } else {
        setResults({});
      }
      setLoading(false);
    })();
  }, [selectedBatch]);

  // ── Filtered students ──────────────────────────────────────────────────────
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.toLowerCase();
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.admission_no?.toLowerCase().includes(q),
    );
  }, [students, search]);

  // ── Class averages ─────────────────────────────────────────────────────────
  const classAverages = useMemo(() => {
    const avg: Record<string, string> = {};
    for (const a of assessments) {
      const assResults = results[a.id] ?? {};
      const levels = Object.values(assResults)
        .map((r) => r.rubric_level)
        .filter(Boolean) as string[];
      if (!levels.length) { avg[a.id] = "-"; continue; }
      const counts: Record<string, number> = {};
      for (const l of levels) counts[l] = (counts[l] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      avg[a.id] = top ? top[0] : "-";
    }
    return avg;
  }, [assessments, results]);

  // ── Open edit dialog ───────────────────────────────────────────────────────
  function openEdit(studentId: string, assessmentId: string) {
    const existing = results[assessmentId]?.[studentId];
    setEditCell({ studentId, assessmentId });
    setEditLevel(existing?.rubric_level ?? "");
    setEditComment(existing?.comment ?? "");
    setEditOpen(true);
  }

  // ── Save edit ──────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!editCell) return;
    setSaving(true);
    const existing = results[editCell.assessmentId]?.[editCell.studentId];
    const payload = {
      assessment_id: editCell.assessmentId,
      student_id: editCell.studentId,
      rubric_level: editLevel || null,
      comment: editComment || null,
    };

    let error: any;
    if (existing?.id) {
      ({ error } = await supabase
        .from("ib_assessment_results")
        .update(payload)
        .eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("ib_assessment_results").insert(payload));
    }

    if (error) {
      toast({ title: "Error saving result", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved" });
      // Update local state
      setResults((prev) => {
        const next = { ...prev };
        if (!next[editCell.assessmentId]) next[editCell.assessmentId] = {};
        next[editCell.assessmentId] = {
          ...next[editCell.assessmentId],
          [editCell.studentId]: { ...payload, id: existing?.id },
        };
        return next;
      });
      setEditOpen(false);
    }
    setSaving(false);
  }

  // ── Add assessment ─────────────────────────────────────────────────────────
  async function addAssessment() {
    if (!newTitle.trim() || !selectedBatch) return;
    setAddingSaving(true);
    const { error } = await supabase.from("ib_assessments").insert({
      title: newTitle.trim(),
      type: newType,
      grading_model: "rubric",
      batch_id: selectedBatch,
      due_date: newDueDate || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Assessment created" });
      setAddOpen(false);
      setNewTitle("");
      setNewDueDate("");
      // Reload assessments
      const { data } = await supabase
        .from("ib_assessments")
        .select("*")
        .eq("batch_id", selectedBatch)
        .order("due_date");
      setAssessments(data ?? []);
    }
    setAddingSaving(false);
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  function exportCsv() {
    const header = ["Student", "Admission No", ...assessments.map((a) => a.title)];
    const rows = filteredStudents.map((s) => [
      s.name,
      s.admission_no ?? "",
      ...assessments.map((a) => results[a.id]?.[s.id]?.rubric_level ?? ""),
    ]);
    console.log("PYP Gradebook CSV Export:", [header, ...rows]);
    toast({ title: "Exported", description: "CSV data logged to console" });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingBatches) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(e.target.value)}
            className={INPUT_CLASS + " pr-8 min-w-[180px]"}
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students..."
            className={INPUT_CLASS + " pl-9"}
          />
        </div>

        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add Assessment
        </Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground sticky left-0 bg-muted/50 min-w-[200px]">
                  Student
                </th>
                {assessments.map((a) => (
                  <th key={a.id} className="text-center px-3 py-3 font-medium text-foreground min-w-[130px]">
                    <div className="truncate max-w-[120px] mx-auto" title={a.title}>{a.title}</div>
                    <Badge variant="secondary" className="text-[10px] mt-1">
                      {a.type}
                    </Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((s) => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 sticky left-0 bg-card">
                    <div className="font-medium text-foreground">{s.name}</div>
                    {s.admission_no && (
                      <div className="text-xs text-muted-foreground">{s.admission_no}</div>
                    )}
                  </td>
                  {assessments.map((a) => {
                    const res = results[a.id]?.[s.id];
                    const level = res?.rubric_level as PypLevel | undefined;
                    return (
                      <td
                        key={a.id}
                        className="text-center px-2 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => openEdit(s.id, a.id)}
                      >
                        {level ? (
                          <Badge className={PYP_LEVEL_COLORS[level] + " text-xs border-0"}>
                            {level}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">--</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Summary row */}
              {filteredStudents.length > 0 && assessments.length > 0 && (
                <tr className="bg-muted/30 font-medium">
                  <td className="px-4 py-2.5 sticky left-0 bg-muted/30 text-muted-foreground">
                    Class Average (Mode)
                  </td>
                  {assessments.map((a) => (
                    <td key={a.id} className="text-center px-2 py-2 text-xs text-muted-foreground">
                      {classAverages[a.id] !== "-" ? (
                        <Badge
                          className={
                            (PYP_LEVEL_COLORS[classAverages[a.id] as PypLevel] ?? "bg-muted text-muted-foreground") +
                            " text-[10px] border-0"
                          }
                        >
                          {classAverages[a.id]}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>

          {filteredStudents.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No students found
            </div>
          )}
        </div>
      )}

      {/* Edit result dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Assessment Result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Achievement Level
              </label>
              <div className="flex flex-wrap gap-2">
                {PYP_LEVELS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setEditLevel(l)}
                    className={
                      "rounded-xl px-3 py-1.5 text-sm font-medium border transition-all " +
                      (editLevel === l
                        ? PYP_LEVEL_COLORS[l] + " border-transparent ring-2 ring-ring/30"
                        : "border-border text-muted-foreground hover:bg-muted")
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Anecdotal Comment
              </label>
              <textarea
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
                placeholder="Teacher observation or comment..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add assessment dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add PYP Assessment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className={INPUT_CLASS}
                placeholder="e.g. Unit of Inquiry: Where We Are in Place and Time"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "formative" | "summative")}
                className={INPUT_CLASS}
              >
                <option value="formative">Formative</option>
                <option value="summative">Summative</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Due Date</label>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addAssessment} disabled={addingSaving || !newTitle.trim()}>
              {addingSaving && <Loader2 className="h-4 w-4 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MYP GRADEBOOK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function MypGradebook() {
  const { toast } = useToast();

  // State
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [subjectGroups, setSubjectGroups] = useState<SubjectGroup[]>([]);
  const [selectedSg, setSelectedSg] = useState<string>("");
  const [students, setStudents] = useState<Student[]>([]);
  const [boundary, setBoundary] = useState<GradeBoundary | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Criteria scores: studentId -> { A: n, B: n, C: n, D: n }
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  // Comments: studentId -> string
  const [comments, setComments] = useState<Record<string, string>>({});

  // ── Load MYP batches ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingBatches(true);
      const { data: inst } = await supabase
        .from("institutions")
        .select("id")
        .eq("code", "GZ1-MES")
        .single();
      if (!inst) { setLoadingBatches(false); return; }

      const { data: courses } = await supabase
        .from("courses")
        .select("id")
        .eq("institution_id", inst.id)
        .like("code", "MES-MYP%");
      if (!courses?.length) { setLoadingBatches(false); return; }

      const courseIds = courses.map((c: any) => c.id);
      const { data: batchData } = await supabase
        .from("batches")
        .select("id, name, course_id")
        .in("course_id", courseIds)
        .order("name");

      setBatches(batchData ?? []);
      if (batchData?.length) setSelectedBatch(batchData[0].id);

      // Load subject groups
      const { data: sgData } = await supabase
        .from("ib_myp_subject_groups")
        .select("id, name, code")
        .order("name");
      setSubjectGroups(sgData ?? []);
      if (sgData?.length) setSelectedSg(sgData[0].id);

      setLoadingBatches(false);
    })();
  }, []);

  // ── Load students when batch changes ───────────────────────────────────────
  useEffect(() => {
    if (!selectedBatch) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("batch_id", selectedBatch)
        .eq("status", "active")
        .order("name");
      setStudents(data ?? []);
      setScores({});
      setComments({});
      setLoading(false);
    })();
  }, [selectedBatch]);

  // ── Load grade boundary when subject group changes ─────────────────────────
  useEffect(() => {
    if (!selectedSg) return;
    (async () => {
      const { data } = await supabase
        .from("ib_myp_grade_boundaries")
        .select("*")
        .eq("subject_group_id", selectedSg)
        .eq("academic_year", "2026-27")
        .single();
      setBoundary(data);
    })();
  }, [selectedSg]);

  // ── Filtered students ──────────────────────────────────────────────────────
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.toLowerCase();
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.admission_no?.toLowerCase().includes(q),
    );
  }, [students, search]);

  // ── Score helpers ──────────────────────────────────────────────────────────
  function getScore(studentId: string, letter: string): number {
    return scores[studentId]?.[letter] ?? 0;
  }

  function setScore(studentId: string, letter: string, val: number) {
    const clamped = Math.max(0, Math.min(8, isNaN(val) ? 0 : val));
    setScores((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? {}), [letter]: clamped },
    }));
  }

  function getTotal(studentId: string): number {
    const s = scores[studentId] ?? {};
    return (s.A ?? 0) + (s.B ?? 0) + (s.C ?? 0) + (s.D ?? 0);
  }

  function getGrade(studentId: string): number {
    return computeGrade(getTotal(studentId), boundary);
  }

  // ── Submit term grades ─────────────────────────────────────────────────────
  async function submitTermGrades() {
    if (!selectedBatch || !selectedSg) return;
    setSubmitting(true);

    const snapshots = filteredStudents.map((s) => ({
      student_id: s.id,
      batch_id: selectedBatch,
      subject_group_id: selectedSg,
      academic_year: "2026-27",
      criterion_a: getScore(s.id, "A"),
      criterion_b: getScore(s.id, "B"),
      criterion_c: getScore(s.id, "C"),
      criterion_d: getScore(s.id, "D"),
      total: getTotal(s.id),
      grade: getGrade(s.id),
      comment: comments[s.id] || null,
    }));

    const { error } = await supabase.from("ib_gradebook_snapshots").insert(snapshots);
    if (error) {
      toast({ title: "Error submitting grades", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Term grades submitted", description: `${snapshots.length} student grades saved` });
    }
    setSubmitting(false);
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  function exportCsv() {
    const header = ["Student", "Admission No", "A", "B", "C", "D", "Total", "Grade", "Comment"];
    const rows = filteredStudents.map((s) => [
      s.name,
      s.admission_no ?? "",
      getScore(s.id, "A"),
      getScore(s.id, "B"),
      getScore(s.id, "C"),
      getScore(s.id, "D"),
      getTotal(s.id),
      getGrade(s.id),
      comments[s.id] ?? "",
    ]);
    console.log("MYP Gradebook CSV Export:", [header, ...rows]);
    toast({ title: "Exported", description: "CSV data logged to console" });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingBatches) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(e.target.value)}
            className={INPUT_CLASS + " pr-8 min-w-[180px]"}
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={selectedSg}
            onChange={(e) => setSelectedSg(e.target.value)}
            className={INPUT_CLASS + " pr-8 min-w-[220px]"}
          >
            {subjectGroups.map((sg) => (
              <option key={sg.id} value={sg.id}>{sg.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students..."
            className={INPUT_CLASS + " pl-9"}
          />
        </div>

        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
        <Button size="sm" onClick={submitTermGrades} disabled={submitting || !filteredStudents.length}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Submit Term Grades
        </Button>
      </div>

      {/* Grade boundary info */}
      {boundary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Grade boundaries (min total):</span>
          {([7, 6, 5, 4, 3, 2, 1] as const).map((g) => (
            <Badge key={g} variant="outline" className="text-[10px]">
              {g}: {boundary[`grade_${g}_min` as keyof GradeBoundary]}
            </Badge>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground sticky left-0 bg-muted/50 min-w-[200px]">
                  Student
                </th>
                {(["A", "B", "C", "D"] as const).map((letter) => (
                  <th key={letter} className="text-center px-3 py-3 font-semibold text-foreground w-[80px]">
                    Criterion {letter}
                    <div className="text-[10px] font-normal text-muted-foreground">(0-8)</div>
                  </th>
                ))}
                <th className="text-center px-3 py-3 font-semibold text-foreground w-[70px]">Total</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground w-[70px]">Grade</th>
                <th className="text-left px-3 py-3 font-semibold text-foreground min-w-[200px]">Comment</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((s) => {
                const total = getTotal(s.id);
                const grade = getGrade(s.id);
                return (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 sticky left-0 bg-card">
                      <div className="font-medium text-foreground">{s.name}</div>
                      {s.admission_no && (
                        <div className="text-xs text-muted-foreground">{s.admission_no}</div>
                      )}
                    </td>
                    {(["A", "B", "C", "D"] as const).map((letter) => (
                      <td key={letter} className="text-center px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          max={8}
                          value={getScore(s.id, letter)}
                          onChange={(e) => setScore(s.id, letter, parseInt(e.target.value, 10))}
                          className="w-14 mx-auto rounded-lg border border-input bg-background px-2 py-1.5 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </td>
                    ))}
                    <td className="text-center px-2 py-2 font-semibold text-foreground">
                      {total}
                    </td>
                    <td className="text-center px-2 py-2">
                      <Badge
                        className={
                          grade >= 5
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0"
                            : grade >= 3
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0"
                            : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0"
                        }
                      >
                        {grade}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={comments[s.id] ?? ""}
                        onChange={(e) =>
                          setComments((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        placeholder="Teacher comment..."
                        className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredStudents.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No students found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
