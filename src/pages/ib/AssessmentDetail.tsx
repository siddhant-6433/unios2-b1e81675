import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Save, CheckCircle, ArrowLeft, Calendar, Users,
  BookOpen, MessageSquare, Tag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

// ── Types ────────────────────────────────────────────────────────────────────

interface AssessmentFull {
  id: string;
  title: string;
  type: string;
  grading_model: string;
  due_date: string | null;
  max_points: number | null;
  status: string | null;
  batch_id: string;
  subject_group_id: string | null;
  rubric_levels: number | null;
  rubric_descriptors: Record<string, string> | null;
  batches: { name: string; course_id: string } | null;
  ib_myp_subject_groups: { name: string; code: string } | null;
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
}

interface ResultRow {
  id?: string;
  assessment_id: string;
  student_id: string;
  rubric_level: string | null;
  points: number | null;
  criterion_a: number | null;
  criterion_b: number | null;
  criterion_c: number | null;
  criterion_d: number | null;
  total: number | null;
  grade: number | null;
  checklist_complete: boolean | null;
  comment: string | null;
  atl_skills: string[] | null;
  learner_profile: string[] | null;
}

interface GradeBoundary {
  id: string;
  grade_1_min: number;
  grade_2_min: number;
  grade_3_min: number;
  grade_4_min: number;
  grade_5_min: number;
  grade_6_min: number;
  grade_7_min: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const RUBRIC_LEVELS = ["Beginning", "Approaching", "Meeting", "Exceeding"] as const;

const RUBRIC_COLORS: Record<string, string> = {
  Beginning: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  Approaching: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Meeting: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Exceeding: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const ATL_SKILLS = [
  "Communication", "Social", "Self-management", "Research", "Thinking",
] as const;

const LEARNER_PROFILE = [
  "Inquirers", "Knowledgeable", "Thinkers", "Communicators", "Principled",
  "Open-minded", "Caring", "Risk-takers", "Balanced", "Reflective",
] as const;

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

function fmtDate(d: string | null): string {
  if (!d) return "--";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function AssessmentDetail() {
  const { id: assessmentId } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [assessment, setAssessment] = useState<AssessmentFull | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [results, setResults] = useState<Record<string, ResultRow>>({});
  const [boundary, setBoundary] = useState<GradeBoundary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // ── Load assessment + students + results ───────────────────────────────────
  useEffect(() => {
    if (!assessmentId) return;
    (async () => {
      setLoading(true);

      // Load assessment
      const { data: ass, error: assErr } = await supabase
        .from("ib_assessments")
        .select("*, batches(name, course_id), ib_myp_subject_groups(name, code)")
        .eq("id", assessmentId)
        .single();

      if (assErr || !ass) {
        toast({ title: "Assessment not found", variant: "destructive" });
        setLoading(false);
        return;
      }
      setAssessment(ass);

      // Load students in batch
      const { data: stuData } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("batch_id", ass.batch_id)
        .eq("status", "active")
        .order("name");
      setStudents(stuData ?? []);

      // Load existing results
      const { data: resData } = await supabase
        .from("ib_assessment_results")
        .select("*")
        .eq("assessment_id", assessmentId);
      const map: Record<string, ResultRow> = {};
      for (const r of resData ?? []) {
        map[r.student_id] = r;
      }
      setResults(map);

      // Load grade boundary if MYP criteria model
      if (ass.grading_model === "criteria" && ass.subject_group_id) {
        const { data: bnd } = await supabase
          .from("ib_myp_grade_boundaries")
          .select("*")
          .eq("subject_group_id", ass.subject_group_id)
          .eq("academic_year", "2026-27")
          .single();
        setBoundary(bnd);
      }

      setLoading(false);
    })();
  }, [assessmentId]);

  // ── Filtered students ──────────────────────────────────────────────────────
  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.toLowerCase();
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.admission_no?.toLowerCase().includes(q),
    );
  }, [students, search]);

  // ── Result accessor helpers ────────────────────────────────────────────────
  function getResult(studentId: string): ResultRow {
    return (
      results[studentId] ?? {
        assessment_id: assessmentId!,
        student_id: studentId,
        rubric_level: null,
        points: null,
        criterion_a: null,
        criterion_b: null,
        criterion_c: null,
        criterion_d: null,
        total: null,
        grade: null,
        checklist_complete: null,
        comment: null,
        atl_skills: null,
        learner_profile: null,
      }
    );
  }

  function updateResult(studentId: string, patch: Partial<ResultRow>) {
    setResults((prev) => ({
      ...prev,
      [studentId]: { ...getResult(studentId), ...patch },
    }));
  }

  // ── Criteria auto-compute ──────────────────────────────────────────────────
  function setCriterion(studentId: string, letter: "a" | "b" | "c" | "d", val: number) {
    const clamped = Math.max(0, Math.min(8, isNaN(val) ? 0 : val));
    const r = getResult(studentId);
    const updated: Partial<ResultRow> = { [`criterion_${letter}`]: clamped };
    const a = letter === "a" ? clamped : (r.criterion_a ?? 0);
    const b = letter === "b" ? clamped : (r.criterion_b ?? 0);
    const c = letter === "c" ? clamped : (r.criterion_c ?? 0);
    const d = letter === "d" ? clamped : (r.criterion_d ?? 0);
    const total = a + b + c + d;
    updated.total = total;
    updated.grade = computeGrade(total, boundary);
    updateResult(studentId, updated);
  }

  // ── Tag toggles ────────────────────────────────────────────────────────────
  function toggleAtl(studentId: string, skill: string) {
    const r = getResult(studentId);
    const current = r.atl_skills ?? [];
    const next = current.includes(skill)
      ? current.filter((s) => s !== skill)
      : [...current, skill];
    updateResult(studentId, { atl_skills: next });
  }

  function toggleLp(studentId: string, attr: string) {
    const r = getResult(studentId);
    const current = r.learner_profile ?? [];
    const next = current.includes(attr)
      ? current.filter((a) => a !== attr)
      : [...current, attr];
    updateResult(studentId, { learner_profile: next });
  }

  // ── Save all ───────────────────────────────────────────────────────────────
  async function saveAll() {
    if (!assessmentId) return;
    setSaving(true);

    const toUpsert = students.map((s) => {
      const r = getResult(s.id);
      return {
        ...(r.id ? { id: r.id } : {}),
        assessment_id: assessmentId,
        student_id: s.id,
        rubric_level: r.rubric_level,
        points: r.points,
        criterion_a: r.criterion_a,
        criterion_b: r.criterion_b,
        criterion_c: r.criterion_c,
        criterion_d: r.criterion_d,
        total: r.total,
        grade: r.grade,
        checklist_complete: r.checklist_complete,
        comment: r.comment,
        atl_skills: r.atl_skills,
        learner_profile: r.learner_profile,
      };
    });

    const { error } = await supabase
      .from("ib_assessment_results")
      .upsert(toUpsert, { onConflict: "assessment_id,student_id" });

    if (error) {
      toast({ title: "Error saving results", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "All results saved", description: `${toUpsert.length} students updated` });
      // Reload to get IDs
      const { data: resData } = await supabase
        .from("ib_assessment_results")
        .select("*")
        .eq("assessment_id", assessmentId);
      const map: Record<string, ResultRow> = {};
      for (const r of resData ?? []) map[r.student_id] = r;
      setResults(map);
    }
    setSaving(false);
  }

  // ── Mark as completed ──────────────────────────────────────────────────────
  async function markCompleted() {
    if (!assessmentId) return;
    const allGraded = students.every((s) => {
      const r = results[s.id];
      if (!r) return false;
      if (assessment?.grading_model === "rubric") return !!r.rubric_level;
      if (assessment?.grading_model === "criteria") return r.total != null && r.total > 0;
      if (assessment?.grading_model === "points") return r.points != null;
      if (assessment?.grading_model === "checklist") return r.checklist_complete != null;
      if (assessment?.grading_model === "anecdotal") return !!r.comment;
      return true;
    });

    if (!allGraded) {
      toast({ title: "Not all students graded", description: "Please grade all students before marking complete", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from("ib_assessments")
      .update({ status: "completed" })
      .eq("id", assessmentId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setAssessment((prev) => prev ? { ...prev, status: "completed" } : prev);
      toast({ title: "Assessment marked as completed" });
    }
  }

  // ── Grading model badge color ──────────────────────────────────────────────
  const modelBadge: Record<string, string> = {
    rubric: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    criteria: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    anecdotal: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    points: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    checklist: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Assessment not found
      </div>
    );
  }

  const model = assessment.grading_model;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              to="/ib/gradebook"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-foreground">{assessment.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className={modelBadge[model] ?? "bg-muted text-foreground"}>
              {model}
            </Badge>
            <Badge variant="secondary">{assessment.type}</Badge>
            {assessment.status === "completed" && (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                <CheckCircle className="h-3 w-3 mr-1" /> Completed
              </Badge>
            )}
            {assessment.batches && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {assessment.batches.name}
              </span>
            )}
            {assessment.ib_myp_subject_groups && (
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" /> {assessment.ib_myp_subject_groups.name}
              </span>
            )}
            {assessment.due_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Due {fmtDate(assessment.due_date)}
              </span>
            )}
            {model === "points" && assessment.max_points && (
              <span>Max: {assessment.max_points} pts</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {assessment.status !== "completed" && (
            <Button variant="outline" size="sm" onClick={markCompleted}>
              <CheckCircle className="h-4 w-4" /> Mark Completed
            </Button>
          )}
          <Button size="sm" onClick={saveAll} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save All
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students..."
          className={INPUT_CLASS + " pl-9"}
        />
        <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      </div>

      {/* Student list */}
      <div className="space-y-3">
        {filteredStudents.map((student) => (
          <StudentGradingCard
            key={student.id}
            student={student}
            model={model}
            result={getResult(student.id)}
            assessment={assessment}
            boundary={boundary}
            onUpdateResult={(patch) => updateResult(student.id, patch)}
            onSetCriterion={(letter, val) => setCriterion(student.id, letter, val)}
            onToggleAtl={(skill) => toggleAtl(student.id, skill)}
            onToggleLp={(attr) => toggleLp(student.id, attr)}
          />
        ))}

        {filteredStudents.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm rounded-xl border border-border bg-card">
            No students found
          </div>
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STUDENT GRADING CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface StudentCardProps {
  student: Student;
  model: string;
  result: ResultRow;
  assessment: AssessmentFull;
  boundary: GradeBoundary | null;
  onUpdateResult: (patch: Partial<ResultRow>) => void;
  onSetCriterion: (letter: "a" | "b" | "c" | "d", val: number) => void;
  onToggleAtl: (skill: string) => void;
  onToggleLp: (attr: string) => void;
}

function StudentGradingCard({
  student,
  model,
  result,
  assessment,
  boundary,
  onUpdateResult,
  onSetCriterion,
  onToggleAtl,
  onToggleLp,
}: StudentCardProps) {
  const [showTags, setShowTags] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Student header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">{student.name}</div>
          {student.admission_no && (
            <div className="text-xs text-muted-foreground">{student.admission_no}</div>
          )}
        </div>
        <button
          onClick={() => setShowTags(!showTags)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <Tag className="h-3.5 w-3.5" /> {showTags ? "Hide" : "Show"} Tags
        </button>
      </div>

      {/* Grading area based on model */}
      <div className="space-y-3">
        {/* RUBRIC model */}
        {model === "rubric" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              Achievement Level
            </label>
            <div className="flex flex-wrap gap-2">
              {RUBRIC_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => onUpdateResult({ rubric_level: level })}
                  className={
                    "rounded-xl px-3 py-1.5 text-sm font-medium border transition-all " +
                    (result.rubric_level === level
                      ? RUBRIC_COLORS[level] + " border-transparent ring-2 ring-ring/30"
                      : "border-border text-muted-foreground hover:bg-muted")
                  }
                >
                  {level}
                </button>
              ))}
            </div>
            {assessment.rubric_descriptors && result.rubric_level && (
              <p className="mt-2 text-xs text-muted-foreground italic">
                {(assessment.rubric_descriptors as Record<string, string>)[result.rubric_level] ?? ""}
              </p>
            )}
          </div>
        )}

        {/* CRITERIA model (MYP) */}
        {model === "criteria" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
            {(["a", "b", "c", "d"] as const).map((letter) => (
              <div key={letter}>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Criterion {letter.toUpperCase()} (0-8)
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={result[`criterion_${letter}` as keyof ResultRow] as number ?? 0}
                  onChange={(e) => onSetCriterion(letter, parseInt(e.target.value, 10))}
                  className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Total</label>
              <div className="rounded-lg bg-muted px-2 py-1.5 text-center text-sm font-semibold text-foreground">
                {result.total ?? 0}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Grade</label>
              <div className="rounded-lg bg-muted px-2 py-1.5 text-center text-sm font-bold text-foreground">
                <Badge
                  className={
                    (result.grade ?? 0) >= 5
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0"
                      : (result.grade ?? 0) >= 3
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0"
                  }
                >
                  {result.grade ?? 0}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* ANECDOTAL model */}
        {model === "anecdotal" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Teacher Observation
            </label>
            <textarea
              value={result.comment ?? ""}
              onChange={(e) => onUpdateResult({ comment: e.target.value })}
              rows={3}
              className={INPUT_CLASS}
              placeholder="Describe student performance, observations, and growth areas..."
            />
          </div>
        )}

        {/* POINTS model */}
        {model === "points" && (
          <div className="flex items-end gap-3">
            <div className="w-32">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Points Earned
              </label>
              <input
                type="number"
                min={0}
                max={assessment.max_points ?? 100}
                value={result.points ?? ""}
                onChange={(e) =>
                  onUpdateResult({
                    points: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            {assessment.max_points && (
              <span className="text-sm text-muted-foreground pb-1.5">
                / {assessment.max_points}
              </span>
            )}
            {result.points != null && assessment.max_points && (
              <span className="text-sm font-medium text-foreground pb-1.5">
                ({Math.round((result.points / assessment.max_points) * 100)}%)
              </span>
            )}
          </div>
        )}

        {/* CHECKLIST model */}
        {model === "checklist" && (
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                onUpdateResult({ checklist_complete: !result.checklist_complete })
              }
              className={
                "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-all " +
                (result.checklist_complete
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                  : "border-border text-muted-foreground hover:bg-muted")
              }
            >
              <CheckCircle className="h-4 w-4" />
              {result.checklist_complete ? "Complete" : "Incomplete"}
            </button>
          </div>
        )}

        {/* Teacher comment (for non-anecdotal models) */}
        {model !== "anecdotal" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
              Teacher Comment
            </label>
            <textarea
              value={result.comment ?? ""}
              onChange={(e) => onUpdateResult({ comment: e.target.value })}
              rows={2}
              className={INPUT_CLASS}
              placeholder="Optional comment..."
            />
          </div>
        )}

        {/* Tags section */}
        {showTags && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                ATL Skills
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ATL_SKILLS.map((skill) => {
                  const active = result.atl_skills?.includes(skill);
                  return (
                    <button
                      key={skill}
                      onClick={() => onToggleAtl(skill)}
                      className={
                        "rounded-full px-2.5 py-1 text-xs font-medium border transition-all " +
                        (active
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                          : "border-border text-muted-foreground hover:bg-muted")
                      }
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Learner Profile
              </label>
              <div className="flex flex-wrap gap-1.5">
                {LEARNER_PROFILE.map((attr) => {
                  const active = result.learner_profile?.includes(attr);
                  return (
                    <button
                      key={attr}
                      onClick={() => onToggleLp(attr)}
                      className={
                        "rounded-full px-2.5 py-1 text-xs font-medium border transition-all " +
                        (active
                          ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                          : "border-border text-muted-foreground hover:bg-muted")
                      }
                    >
                      {attr}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
