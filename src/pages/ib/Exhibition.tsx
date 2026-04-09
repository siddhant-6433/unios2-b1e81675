import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, GripVertical, Users, Calendar, Lightbulb,
  BookOpen, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ExhibitionGroup {
  id: string;
  title: string;
  issue: string | null;
  central_idea: string | null;
  td_theme_id: string | null;
  td_theme_name: string | null;
  mentor_user_id: string | null;
  mentor_name: string | null;
  status: string;
  research_notes: string | null;
  action_plan: string | null;
  presentation_date: string | null;
  academic_year: string | null;
  created_at: string;
  students: { id: string; name: string }[];
}

interface TdTheme {
  id: string;
  name: string;
}

interface Teacher {
  user_id: string;
  display_name: string;
}

interface Student {
  id: string;
  name: string;
}

const STATUSES = ["planning", "research", "action", "presentation", "completed"] as const;

const STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  research: "Research",
  action: "Action",
  presentation: "Presentation",
  completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-pastel-blue text-foreground/70",
  research: "bg-pastel-purple text-foreground/70",
  action: "bg-pastel-yellow text-foreground/70",
  presentation: "bg-pastel-orange text-foreground/70",
  completed: "bg-pastel-green text-foreground/70",
};

const COLUMN_BG: Record<string, string> = {
  planning: "bg-pastel-blue/20",
  research: "bg-pastel-purple/20",
  action: "bg-pastel-yellow/20",
  presentation: "bg-pastel-orange/20",
  completed: "bg-pastel-green/20",
};

const TD_THEMES_FALLBACK = [
  "Who We Are",
  "Where We Are in Place and Time",
  "How We Express Ourselves",
  "How the World Works",
  "How We Organize Ourselves",
  "Sharing the Planet",
];

const INPUT_CLASS = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ────────────────────────────────────────────────────────────────

const Exhibition = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [exhibitions, setExhibitions] = useState<ExhibitionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [academicYear, setAcademicYear] = useState("2026-27");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reference data
  const [tdThemes, setTdThemes] = useState<TdTheme[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [pyp5Students, setPyp5Students] = useState<Student[]>([]);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formIssue, setFormIssue] = useState("");
  const [formTdTheme, setFormTdTheme] = useState("");
  const [formCentralIdea, setFormCentralIdea] = useState("");
  const [formMentor, setFormMentor] = useState("");
  const [formStudentIds, setFormStudentIds] = useState<string[]>([]);

  const ACADEMIC_YEARS = ["2024-25", "2025-26", "2026-27"];

  // ── Fetch reference data ───────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // TD themes
      const { data: themes } = await (supabase as any).from("ib_td_themes").select("id, name");
      if (themes && themes.length) {
        setTdThemes(themes);
      } else {
        // Fallback: use hardcoded themes
        setTdThemes(TD_THEMES_FALLBACK.map((name, idx) => ({ id: String(idx), name })));
      }

      // Teachers (profiles with teacher-like roles)
      const { data: teacherProfiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .not("display_name", "is", null)
        .order("display_name");
      setTeachers((teacherProfiles || []).map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name || "Unknown",
      })));

      // PYP 5 students: find batch via course code
      const { data: pyp5Courses } = await supabase
        .from("courses")
        .select("id")
        .ilike("code", "%PYP5%");
      if (pyp5Courses && pyp5Courses.length) {
        const courseIds = pyp5Courses.map((c) => c.id);
        const { data: pyp5Batches } = await supabase
          .from("batches")
          .select("id")
          .in("course_id", courseIds);
        if (pyp5Batches && pyp5Batches.length) {
          const batchIds = pyp5Batches.map((b) => b.id);
          const { data: studs } = await supabase
            .from("students")
            .select("id, name")
            .in("batch_id", batchIds)
            .eq("status", "active")
            .order("name");
          setPyp5Students(studs || []);
        }
      }
    })();
  }, []);

  // ── Fetch exhibitions ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("ib_exhibitions")
        .select("*, ib_exhibition_students(student_id, students(id, name)), ib_td_themes(name)")
        .eq("academic_year", academicYear)
        .order("created_at");

      if (data) {
        // Also fetch mentor names
        const mentorIds = [...new Set(data.filter((d: any) => d.mentor_user_id).map((d: any) => d.mentor_user_id))];
        let mentorMap: Record<string, string> = {};
        if (mentorIds.length) {
          const { data: mentorProfiles } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", mentorIds as string[]);
          (mentorProfiles || []).forEach((p) => {
            mentorMap[p.user_id] = p.display_name || "Unknown";
          });
        }

        setExhibitions(
          data.map((d: any) => ({
            id: d.id,
            title: d.title,
            issue: d.issue,
            central_idea: d.central_idea,
            td_theme_id: d.td_theme_id,
            td_theme_name: d.ib_td_themes?.name || null,
            mentor_user_id: d.mentor_user_id,
            mentor_name: mentorMap[d.mentor_user_id] || d.mentor_name || null,
            status: d.status || "planning",
            research_notes: d.research_notes,
            action_plan: d.action_plan,
            presentation_date: d.presentation_date,
            academic_year: d.academic_year,
            created_at: d.created_at,
            students: (d.ib_exhibition_students || [])
              .map((es: any) => es.students)
              .filter(Boolean),
          })),
        );
      } else {
        setExhibitions([]);
      }
      setLoading(false);
    })();
  }, [academicYear]);

  // ── Create exhibition ──────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!formTitle) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    const mentorName = formMentor
      ? teachers.find((t) => t.user_id === formMentor)?.display_name || null
      : null;

    const { data: inserted, error } = await (supabase as any)
      .from("ib_exhibitions")
      .insert({
        title: formTitle,
        issue: formIssue || null,
        td_theme_id: formTdTheme || null,
        central_idea: formCentralIdea || null,
        mentor_user_id: formMentor || null,
        mentor_name: mentorName,
        status: "planning",
        academic_year: academicYear,
        created_by: user?.id,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      setSaving(false);
      toast({ title: "Failed to create exhibition", description: error?.message, variant: "destructive" });
      return;
    }

    // Add students
    if (formStudentIds.length) {
      await (supabase as any).from("ib_exhibition_students").insert(
        formStudentIds.map((sid) => ({
          exhibition_id: inserted.id,
          student_id: sid,
        })),
      );
    }

    setSaving(false);
    toast({ title: "Exhibition group created" });
    setShowCreate(false);
    resetForm();
    // Refresh
    setAcademicYear((prev) => prev);
    // Force re-fetch
    const { data: refreshed } = await (supabase as any)
      .from("ib_exhibitions")
      .select("*, ib_exhibition_students(student_id, students(id, name)), ib_td_themes(name)")
      .eq("academic_year", academicYear)
      .order("created_at");
    if (refreshed) {
      const mentorIds = [...new Set(refreshed.filter((d: any) => d.mentor_user_id).map((d: any) => d.mentor_user_id))];
      let mentorMap: Record<string, string> = {};
      if (mentorIds.length) {
        const { data: mp } = await supabase.from("profiles").select("user_id, display_name").in("user_id", mentorIds as string[]);
        (mp || []).forEach((p) => { mentorMap[p.user_id] = p.display_name || "Unknown"; });
      }
      setExhibitions(refreshed.map((d: any) => ({
        id: d.id, title: d.title, issue: d.issue, central_idea: d.central_idea,
        td_theme_id: d.td_theme_id, td_theme_name: d.ib_td_themes?.name || null,
        mentor_user_id: d.mentor_user_id, mentor_name: mentorMap[d.mentor_user_id] || d.mentor_name || null,
        status: d.status || "planning", research_notes: d.research_notes, action_plan: d.action_plan,
        presentation_date: d.presentation_date, academic_year: d.academic_year, created_at: d.created_at,
        students: (d.ib_exhibition_students || []).map((es: any) => es.students).filter(Boolean),
      })));
    }
  };

  const resetForm = () => {
    setFormTitle("");
    setFormIssue("");
    setFormTdTheme("");
    setFormCentralIdea("");
    setFormMentor("");
    setFormStudentIds([]);
  };

  // ── Update status ──────────────────────────────────────────────────────────

  const updateStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any)
      .from("ib_exhibitions")
      .update({ status })
      .eq("id", id);
    if (error) {
      toast({ title: "Failed to update status", variant: "destructive" });
    } else {
      setExhibitions((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));
    }
  };

  // ── Update expanded card fields ────────────────────────────────────────────

  const updateField = async (id: string, field: string, value: string) => {
    const { error } = await (supabase as any)
      .from("ib_exhibitions")
      .update({ [field]: value })
      .eq("id", id);
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      setExhibitions((prev) =>
        prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
      );
    }
  };

  // ── Toggle student selection ───────────────────────────────────────────────

  const toggleStudent = (sid: string) => {
    setFormStudentIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid],
    );
  };

  // ── Group by status for Kanban ─────────────────────────────────────────────

  const columns = STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    items: exhibitions.filter((e) => e.status === status),
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PYP 5 Exhibition</h1>
          <p className="text-sm text-muted-foreground mt-1">Plan and track exhibition groups</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={academicYear} onValueChange={setAcademicYear}>
            <SelectTrigger className="w-40 rounded-xl">
              <SelectValue placeholder="Academic year" />
            </SelectTrigger>
            <SelectContent>
              {ACADEMIC_YEARS.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreate(true)} className="rounded-xl gap-2">
            <Plus className="h-4 w-4" /> New Group
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        /* Kanban board */
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {columns.map((col) => (
            <div key={col.status} className={`rounded-xl p-3 ${COLUMN_BG[col.status]} min-h-[200px]`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                <Badge variant="secondary" className="text-xs rounded-md">{col.items.length}</Badge>
              </div>

              <div className="space-y-3">
                {col.items.map((ex) => {
                  const isExpanded = expandedId === ex.id;
                  return (
                    <Card
                      key={ex.id}
                      className="rounded-xl border-border bg-card shadow-sm cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-sm text-foreground leading-snug">{ex.title}</h4>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                        </div>

                        {/* Student names */}
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span className="truncate">
                            {ex.students.length
                              ? ex.students.map((s) => s.name.split(" ")[0]).join(", ")
                              : "No students"}
                          </span>
                        </div>

                        {/* Mentor */}
                        {ex.mentor_name && (
                          <p className="text-xs text-muted-foreground">
                            Mentor: {ex.mentor_name}
                          </p>
                        )}

                        {/* TD Theme */}
                        {ex.td_theme_name && (
                          <Badge variant="secondary" className="text-[10px] rounded-md">
                            {ex.td_theme_name}
                          </Badge>
                        )}

                        {/* Central idea preview */}
                        {ex.central_idea && !isExpanded && (
                          <p className="text-xs text-muted-foreground line-clamp-2 italic">
                            "{ex.central_idea}"
                          </p>
                        )}

                        {/* Expanded details */}
                        {isExpanded && (
                          <div
                            className="mt-2 space-y-3 border-t border-border pt-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ex.central_idea && (
                              <p className="text-xs text-foreground italic">"{ex.central_idea}"</p>
                            )}

                            {/* Status selector */}
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                              <Select
                                value={ex.status}
                                onValueChange={(v) => updateStatus(ex.id, v)}
                              >
                                <SelectTrigger className="rounded-xl h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUSES.map((s) => (
                                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Research notes */}
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1 block">Research Notes</label>
                              <textarea
                                className={`${INPUT_CLASS} min-h-[60px] resize-y text-xs`}
                                defaultValue={ex.research_notes || ""}
                                onBlur={(e) => updateField(ex.id, "research_notes", e.target.value)}
                                placeholder="Research notes..."
                              />
                            </div>

                            {/* Action plan */}
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1 block">Action Plan</label>
                              <textarea
                                className={`${INPUT_CLASS} min-h-[60px] resize-y text-xs`}
                                defaultValue={ex.action_plan || ""}
                                onBlur={(e) => updateField(ex.id, "action_plan", e.target.value)}
                                placeholder="Action plan..."
                              />
                            </div>

                            {/* Presentation date */}
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1 block">Presentation Date</label>
                              <input
                                type="date"
                                className={`${INPUT_CLASS} text-xs`}
                                defaultValue={ex.presentation_date || ""}
                                onChange={(e) => updateField(ex.id, "presentation_date", e.target.value)}
                              />
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

                {col.items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6 opacity-50">
                    No groups
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Exhibition Dialog ────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>New Exhibition Group</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Title</label>
              <input className={INPUT_CLASS} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Exhibition group title" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Issue / Topic</label>
              <input className={INPUT_CLASS} value={formIssue} onChange={(e) => setFormIssue(e.target.value)} placeholder="What issue are students exploring?" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Transdisciplinary Theme</label>
              <Select value={formTdTheme} onValueChange={setFormTdTheme}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  {tdThemes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Central Idea</label>
              <textarea className={`${INPUT_CLASS} min-h-[60px] resize-y`} value={formCentralIdea} onChange={(e) => setFormCentralIdea(e.target.value)} placeholder="The central idea for this exhibition..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Mentor</label>
              <Select value={formMentor} onValueChange={setFormMentor}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select mentor" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.user_id} value={t.user_id}>{t.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Students {pyp5Students.length > 0 ? `(PYP 5 — ${formStudentIds.length} selected)` : "(No PYP 5 students found)"}
              </label>
              {pyp5Students.length > 0 ? (
                <div className="max-h-40 overflow-y-auto border border-input rounded-xl p-2 space-y-1">
                  {pyp5Students.map((s) => {
                    const selected = formStudentIds.includes(s.id);
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${selected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
                        onClick={() => toggleStudent(s.id)}
                      >
                        <div className={`h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 ${selected ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                          {selected && <span className="text-[10px]">&#10003;</span>}
                        </div>
                        {s.name}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No PYP 5 students found. Ensure a course with code containing "PYP5" exists.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="rounded-xl gap-2" onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Exhibition;
