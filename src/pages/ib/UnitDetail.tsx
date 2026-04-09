import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, ArrowLeft, Save, Plus, Trash2, X, BookOpen,
  GraduationCap, Lightbulb, ClipboardList, CheckCircle,
  MessageSquare, Link2, ExternalLink,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface UnitData {
  id: string;
  institution_id: string;
  programme: string;
  title: string;
  central_idea: string | null;
  statement_of_inquiry: string | null;
  key_concept_ids: string[];
  related_concepts: string[];
  atl_skill_ids: string[];
  learner_profile_ids: string[];
  subject_focus: string | null;
  global_context: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  batch_id: string | null;
  poi_entry_id: string | null;
  teacher_questions: string | null;
  inquiry_questions: Record<string, string[]> | null;
  lines_of_inquiry: string[] | null;
  learning_experiences: LearningExperience[] | null;
  resources: Resource[] | null;
  action_strategies: string | null;
  summative_assessment: string | null;
  formative_assessments: string[] | null;
  reflection: string | null;
  collaborators: string[] | null;
  created_at: string;
}

interface LearningExperience {
  title: string;
  description: string;
  week: number | null;
}

interface Resource {
  title: string;
  url: string;
  type: string;
}

interface KeyConcept {
  id: string;
  name: string;
  programme: string;
}

interface AtlSkill {
  id: string;
  name: string;
  category: string;
}

interface LearnerProfile {
  id: string;
  name: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["planning", "teaching", "reflecting", "completed"] as const;

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-pastel-yellow text-foreground/70",
  teaching: "bg-pastel-blue text-foreground/70",
  reflecting: "bg-pastel-purple text-foreground/70",
  completed: "bg-pastel-green text-foreground/70",
};

const QUESTION_TYPES = ["factual", "conceptual", "debatable"] as const;

const GLOBAL_CONTEXTS = [
  "Identities and relationships",
  "Orientation in space and time",
  "Personal and cultural expression",
  "Scientific and technical innovation",
  "Globalization and sustainability",
  "Fairness and development",
];

const RESOURCE_TYPES = ["book", "video", "website", "document", "other"];

const INPUT_CLS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ───────────────────────────────────────────────────────────────

const UnitDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [unit, setUnit] = useState<UnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // reference data
  const [keyConcepts, setKeyConcepts] = useState<KeyConcept[]>([]);
  const [atlSkills, setAtlSkills] = useState<AtlSkill[]>([]);
  const [learnerProfiles, setLearnerProfiles] = useState<LearnerProfile[]>([]);

  // inline edit state for tag inputs
  const [newRelatedConcept, setNewRelatedConcept] = useState("");
  const [newCollaborator, setNewCollaborator] = useState("");
  const [newFormativeAssessment, setNewFormativeAssessment] = useState("");

  // inquiry question add
  const [newQuestionType, setNewQuestionType] = useState<string>("factual");
  const [newQuestionText, setNewQuestionText] = useState("");

  // ── Fetch unit ──────────────────────────────────────────────────────────
  const fetchUnit = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_units")
      .select("*")
      .eq("id", id)
      .single();
    if (error) {
      toast({ title: "Error loading unit", description: error.message, variant: "destructive" });
    }
    setUnit((data as UnitData) ?? null);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    fetchUnit();
  }, [fetchUnit]);

  // ── Fetch reference data once we know the programme ─────────────────────
  useEffect(() => {
    if (!unit) return;
    (async () => {
      const [kcRes, atlRes, lpRes] = await Promise.all([
        supabase
          .from("ib_key_concepts")
          .select("id, name, programme")
          .eq("programme", unit.programme)
          .order("sort_order"),
        supabase.from("ib_atl_skills").select("id, name, category").order("category, sort_order"),
        supabase.from("ib_learner_profile").select("id, name").order("sort_order"),
      ]);
      if (kcRes.data) setKeyConcepts(kcRes.data as KeyConcept[]);
      if (atlRes.data) setAtlSkills(atlRes.data as AtlSkill[]);
      if (lpRes.data) setLearnerProfiles(lpRes.data as LearnerProfile[]);
    })();
  }, [unit?.programme]);

  // ── Save helper ─────────────────────────────────────────────────────────
  const saveField = async (patch: Partial<UnitData>) => {
    if (!unit) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_units")
      .update(patch as any)
      .eq("id", unit.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setUnit((u) => (u ? { ...u, ...patch } : u));
    }
    setSaving(false);
  };

  // ── Updater that batches local state + saves on blur ────────────────────
  const updateLocal = (patch: Partial<UnitData>) => {
    setUnit((u) => (u ? { ...u, ...patch } : u));
  };

  const handleBlur = (field: keyof UnitData) => {
    if (!unit) return;
    saveField({ [field]: (unit as any)[field] });
  };

  // ── Toggle helpers for multi-select arrays ──────────────────────────────
  const toggleArrayItem = (field: "key_concept_ids" | "atl_skill_ids" | "learner_profile_ids", itemId: string) => {
    if (!unit) return;
    const current: string[] = (unit as any)[field] ?? [];
    const next = current.includes(itemId)
      ? current.filter((x) => x !== itemId)
      : [...current, itemId];
    updateLocal({ [field]: next } as any);
    saveField({ [field]: next } as any);
  };

  // ── Learning experiences helpers ────────────────────────────────────────
  const addLearningExperience = () => {
    const exps = [...(unit?.learning_experiences ?? []), { title: "", description: "", week: null }];
    updateLocal({ learning_experiences: exps });
  };

  const updateLearningExperience = (idx: number, patch: Partial<LearningExperience>) => {
    const exps = [...(unit?.learning_experiences ?? [])];
    exps[idx] = { ...exps[idx], ...patch };
    updateLocal({ learning_experiences: exps });
  };

  const removeLearningExperience = (idx: number) => {
    const exps = (unit?.learning_experiences ?? []).filter((_, i) => i !== idx);
    updateLocal({ learning_experiences: exps });
    saveField({ learning_experiences: exps } as any);
  };

  // ── Resources helpers ───────────────────────────────────────────────────
  const addResource = () => {
    const res = [...(unit?.resources ?? []), { title: "", url: "", type: "other" }];
    updateLocal({ resources: res });
  };

  const updateResource = (idx: number, patch: Partial<Resource>) => {
    const res = [...(unit?.resources ?? [])];
    res[idx] = { ...res[idx], ...patch };
    updateLocal({ resources: res });
  };

  const removeResource = (idx: number) => {
    const res = (unit?.resources ?? []).filter((_, i) => i !== idx);
    updateLocal({ resources: res });
    saveField({ resources: res } as any);
  };

  // ── Inquiry questions helpers ───────────────────────────────────────────
  const addInquiryQuestion = () => {
    if (!newQuestionText.trim()) return;
    const qs = { ...(unit?.inquiry_questions ?? {}) };
    if (!qs[newQuestionType]) qs[newQuestionType] = [];
    qs[newQuestionType] = [...qs[newQuestionType], newQuestionText.trim()];
    updateLocal({ inquiry_questions: qs });
    saveField({ inquiry_questions: qs } as any);
    setNewQuestionText("");
  };

  const removeInquiryQuestion = (type: string, idx: number) => {
    const qs = { ...(unit?.inquiry_questions ?? {}) };
    qs[type] = (qs[type] ?? []).filter((_, i) => i !== idx);
    if (qs[type].length === 0) delete qs[type];
    updateLocal({ inquiry_questions: qs });
    saveField({ inquiry_questions: qs } as any);
  };

  // ── Tag array helpers ──────────────────────────────────────────────────
  const addToArray = (field: "related_concepts" | "collaborators" | "formative_assessments", value: string, setter: (v: string) => void) => {
    const trimmed = value.trim();
    if (!trimmed || !unit) return;
    const current: string[] = (unit as any)[field] ?? [];
    if (current.includes(trimmed)) return;
    const next = [...current, trimmed];
    updateLocal({ [field]: next } as any);
    saveField({ [field]: next } as any);
    setter("");
  };

  const removeFromArray = (field: "related_concepts" | "collaborators" | "formative_assessments", value: string) => {
    if (!unit) return;
    const next = ((unit as any)[field] ?? []).filter((x: string) => x !== value);
    updateLocal({ [field]: next } as any);
    saveField({ [field]: next } as any);
  };

  // ── Lines of inquiry helpers ────────────────────────────────────────────
  const updateLoi = (idx: number, val: string) => {
    const loi = [...(unit?.lines_of_inquiry ?? [])];
    loi[idx] = val;
    updateLocal({ lines_of_inquiry: loi });
  };

  const addLoi = () => {
    const loi = [...(unit?.lines_of_inquiry ?? []), ""];
    updateLocal({ lines_of_inquiry: loi });
  };

  const removeLoi = (idx: number) => {
    const loi = (unit?.lines_of_inquiry ?? []).filter((_, i) => i !== idx);
    updateLocal({ lines_of_inquiry: loi });
    saveField({ lines_of_inquiry: loi } as any);
  };

  // ── Concept name lookup ─────────────────────────────────────────────────
  const conceptName = (id: string) => keyConcepts.find((c) => c.id === id)?.name ?? id;
  const atlName = (id: string) => atlSkills.find((s) => s.id === id)?.name ?? id;
  const lpName = (id: string) => learnerProfiles.find((p) => p.id === id)?.name ?? id;

  // ── Loading / not found ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-lg font-medium text-foreground">Unit not found</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={() => navigate("/ib/units")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Units
        </Button>
      </div>
    );
  }

  // ── Section wrapper ─────────────────────────────────────────────────────
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );

  // ── Chip toggle button ──────────────────────────────────────────────────
  const ChipToggle = ({
    label, selected, onClick,
  }: { label: string; selected: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-xs font-medium border transition-colors ${
        selected
          ? "bg-[#77966D] text-white border-[#77966D]"
          : "bg-background text-foreground border-border hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl shrink-0"
            onClick={() => navigate("/ib/units")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">{unit.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={STATUS_COLORS[unit.status] ?? "bg-muted text-foreground"}>
                {unit.status}
              </Badge>
              <span className="text-xs text-muted-foreground uppercase">
                {unit.programme}
              </span>
              {unit.subject_focus && (
                <span className="text-xs text-muted-foreground">
                  / {unit.subject_focus}
                </span>
              )}
            </div>
          </div>
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="rounded-xl flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="overview" className="rounded-xl text-xs gap-1">
            <BookOpen className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="inquiry" className="rounded-xl text-xs gap-1">
            <Lightbulb className="h-3.5 w-3.5" /> Inquiry
          </TabsTrigger>
          <TabsTrigger value="teaching" className="rounded-xl text-xs gap-1">
            <GraduationCap className="h-3.5 w-3.5" /> Teaching &amp; Learning
          </TabsTrigger>
          <TabsTrigger value="assessment" className="rounded-xl text-xs gap-1">
            <ClipboardList className="h-3.5 w-3.5" /> Assessment
          </TabsTrigger>
          <TabsTrigger value="reflection" className="rounded-xl text-xs gap-1">
            <MessageSquare className="h-3.5 w-3.5" /> Reflection
          </TabsTrigger>
        </TabsList>

        {/* ────────────────────────── OVERVIEW ────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <Section title="Unit Details">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                className={INPUT_CLS}
                value={unit.title}
                onChange={(e) => updateLocal({ title: e.target.value })}
                onBlur={() => handleBlur("title")}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {unit.programme === "pyp" ? "Central Idea" : "Statement of Inquiry"}
              </label>
              <textarea
                className={INPUT_CLS + " min-h-[80px] resize-y"}
                value={(unit.programme === "pyp" ? unit.central_idea : unit.statement_of_inquiry) ?? ""}
                onChange={(e) =>
                  updateLocal(
                    unit.programme === "pyp"
                      ? { central_idea: e.target.value }
                      : { statement_of_inquiry: e.target.value }
                  )
                }
                onBlur={() => handleBlur(unit.programme === "pyp" ? "central_idea" : "statement_of_inquiry")}
                placeholder={unit.programme === "pyp" ? "The central idea..." : "Statement of inquiry..."}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Subject Focus</label>
                <input
                  className={INPUT_CLS}
                  value={unit.subject_focus ?? ""}
                  onChange={(e) => updateLocal({ subject_focus: e.target.value })}
                  onBlur={() => handleBlur("subject_focus")}
                  placeholder="e.g. Science"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <Select
                  value={unit.status}
                  onValueChange={(v) => {
                    updateLocal({ status: v });
                    saveField({ status: v });
                  }}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {unit.programme === "myp" && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Global Context</label>
                <Select
                  value={unit.global_context ?? ""}
                  onValueChange={(v) => {
                    updateLocal({ global_context: v });
                    saveField({ global_context: v });
                  }}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select global context" />
                  </SelectTrigger>
                  <SelectContent>
                    {GLOBAL_CONTEXTS.map((gc) => (
                      <SelectItem key={gc} value={gc}>{gc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Start Date</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={unit.start_date ?? ""}
                  onChange={(e) => updateLocal({ start_date: e.target.value })}
                  onBlur={() => handleBlur("start_date")}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">End Date</label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={unit.end_date ?? ""}
                  onChange={(e) => updateLocal({ end_date: e.target.value })}
                  onBlur={() => handleBlur("end_date")}
                />
              </div>
            </div>
          </Section>

          <Section title="Key Concepts">
            <div className="flex flex-wrap gap-2">
              {keyConcepts.map((kc) => (
                <ChipToggle
                  key={kc.id}
                  label={kc.name}
                  selected={(unit.key_concept_ids ?? []).includes(kc.id)}
                  onClick={() => toggleArrayItem("key_concept_ids", kc.id)}
                />
              ))}
            </div>
          </Section>

          <Section title="Related Concepts">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(unit.related_concepts ?? []).map((c) => (
                <Badge
                  key={c}
                  variant="secondary"
                  className="text-xs gap-1 cursor-pointer"
                  onClick={() => removeFromArray("related_concepts", c)}
                >
                  {c} <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={INPUT_CLS}
                placeholder="Add related concept..."
                value={newRelatedConcept}
                onChange={(e) => setNewRelatedConcept(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addToArray("related_concepts", newRelatedConcept, setNewRelatedConcept))}
              />
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl shrink-0"
                onClick={() => addToArray("related_concepts", newRelatedConcept, setNewRelatedConcept)}
              >
                Add
              </Button>
            </div>
          </Section>

          <Section title="Approaches to Learning (ATL) Skills">
            <div className="flex flex-wrap gap-2">
              {atlSkills.map((s) => (
                <ChipToggle
                  key={s.id}
                  label={s.name}
                  selected={(unit.atl_skill_ids ?? []).includes(s.id)}
                  onClick={() => toggleArrayItem("atl_skill_ids", s.id)}
                />
              ))}
              {atlSkills.length === 0 && (
                <p className="text-xs text-muted-foreground">No ATL skills configured yet.</p>
              )}
            </div>
          </Section>

          <Section title="Learner Profile Attributes">
            <div className="flex flex-wrap gap-2">
              {learnerProfiles.map((lp) => (
                <ChipToggle
                  key={lp.id}
                  label={lp.name}
                  selected={(unit.learner_profile_ids ?? []).includes(lp.id)}
                  onClick={() => toggleArrayItem("learner_profile_ids", lp.id)}
                />
              ))}
              {learnerProfiles.length === 0 && (
                <p className="text-xs text-muted-foreground">No learner profile attributes configured yet.</p>
              )}
            </div>
          </Section>
        </TabsContent>

        {/* ────────────────────────── INQUIRY ─────────────────────────────── */}
        <TabsContent value="inquiry" className="space-y-4 mt-4">
          <Section title="Teacher Questions">
            <textarea
              className={INPUT_CLS + " min-h-[100px] resize-y"}
              value={unit.teacher_questions ?? ""}
              onChange={(e) => updateLocal({ teacher_questions: e.target.value })}
              onBlur={() => handleBlur("teacher_questions")}
              placeholder="What questions will drive teacher planning for this unit?"
            />
          </Section>

          <Section title="Inquiry Questions">
            {QUESTION_TYPES.map((type) => {
              const questions = (unit.inquiry_questions ?? {})[type] ?? [];
              return (
                <div key={type} className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground capitalize">{type}</h4>
                  {questions.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No {type} questions yet.</p>
                  )}
                  {questions.map((q, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-sm text-foreground flex-1">{q}</span>
                      <button
                        type="button"
                        onClick={() => removeInquiryQuestion(type, idx)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
              <Select value={newQuestionType} onValueChange={setNewQuestionType}>
                <SelectTrigger className="w-[130px] rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                className={INPUT_CLS + " flex-1"}
                placeholder="Add a question..."
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addInquiryQuestion())}
              />
              <Button size="sm" variant="outline" className="rounded-xl shrink-0" onClick={addInquiryQuestion}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </Section>

          <Section title="Lines of Inquiry">
            <div className="space-y-2">
              {(unit.lines_of_inquiry ?? []).map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    className={INPUT_CLS + " flex-1"}
                    value={line}
                    onChange={(e) => updateLoi(idx, e.target.value)}
                    onBlur={() => saveField({ lines_of_inquiry: unit.lines_of_inquiry } as any)}
                    placeholder={`Line of inquiry ${idx + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeLoi(idx)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={addLoi}>
              <Plus className="h-4 w-4 mr-1" /> Add Line of Inquiry
            </Button>
          </Section>
        </TabsContent>

        {/* ────────────────────── TEACHING & LEARNING ─────────────────────── */}
        <TabsContent value="teaching" className="space-y-4 mt-4">
          <Section title="Learning Experiences">
            <div className="space-y-3">
              {(unit.learning_experiences ?? []).map((exp, idx) => (
                <div key={idx} className="rounded-xl border border-border p-4 space-y-3 relative">
                  <button
                    type="button"
                    onClick={() => removeLearningExperience(idx)}
                    className="absolute top-3 right-3 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="grid grid-cols-[1fr_80px] gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Title</label>
                      <input
                        className={INPUT_CLS}
                        value={exp.title}
                        onChange={(e) => updateLearningExperience(idx, { title: e.target.value })}
                        onBlur={() => saveField({ learning_experiences: unit.learning_experiences } as any)}
                        placeholder="Activity title"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Week</label>
                      <input
                        type="number"
                        className={INPUT_CLS}
                        value={exp.week ?? ""}
                        onChange={(e) =>
                          updateLearningExperience(idx, { week: e.target.value ? parseInt(e.target.value) : null })
                        }
                        onBlur={() => saveField({ learning_experiences: unit.learning_experiences } as any)}
                        min={1}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Description</label>
                    <textarea
                      className={INPUT_CLS + " min-h-[60px] resize-y"}
                      value={exp.description}
                      onChange={(e) => updateLearningExperience(idx, { description: e.target.value })}
                      onBlur={() => saveField({ learning_experiences: unit.learning_experiences } as any)}
                      placeholder="Describe this learning experience..."
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={addLearningExperience}>
              <Plus className="h-4 w-4 mr-1" /> Add Experience
            </Button>
          </Section>

          <Section title="Resources">
            <div className="space-y-3">
              {(unit.resources ?? []).map((res, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="flex-1 grid grid-cols-[1fr_1fr_100px] gap-2">
                    <input
                      className={INPUT_CLS}
                      value={res.title}
                      onChange={(e) => updateResource(idx, { title: e.target.value })}
                      onBlur={() => saveField({ resources: unit.resources } as any)}
                      placeholder="Title"
                    />
                    <input
                      className={INPUT_CLS}
                      value={res.url}
                      onChange={(e) => updateResource(idx, { url: e.target.value })}
                      onBlur={() => saveField({ resources: unit.resources } as any)}
                      placeholder="URL"
                    />
                    <Select
                      value={res.type}
                      onValueChange={(v) => {
                        updateResource(idx, { type: v });
                        saveField({ resources: [...(unit.resources ?? []).map((r, i) => (i === idx ? { ...r, type: v } : r))] } as any);
                      }}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RESOURCE_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeResource(idx)}
                    className="text-muted-foreground hover:text-destructive mt-2.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={addResource}>
              <Plus className="h-4 w-4 mr-1" /> Add Resource
            </Button>
          </Section>

          <Section title="Action / Teaching Strategies">
            <textarea
              className={INPUT_CLS + " min-h-[100px] resize-y"}
              value={unit.action_strategies ?? ""}
              onChange={(e) => updateLocal({ action_strategies: e.target.value })}
              onBlur={() => handleBlur("action_strategies")}
              placeholder="Describe teaching strategies and student action..."
            />
          </Section>
        </TabsContent>

        {/* ────────────────────────── ASSESSMENT ──────────────────────────── */}
        <TabsContent value="assessment" className="space-y-4 mt-4">
          <Section title="Summative Assessment">
            <textarea
              className={INPUT_CLS + " min-h-[100px] resize-y"}
              value={unit.summative_assessment ?? ""}
              onChange={(e) => updateLocal({ summative_assessment: e.target.value })}
              onBlur={() => handleBlur("summative_assessment")}
              placeholder="Describe the summative assessment for this unit..."
            />
          </Section>

          <Section title="Formative Assessments">
            <div className="space-y-2 mb-3">
              {(unit.formative_assessments ?? []).map((fa, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                  <CheckCircle className="h-3.5 w-3.5 text-[#77966D] shrink-0" />
                  <span className="text-sm text-foreground flex-1">{fa}</span>
                  <button
                    type="button"
                    onClick={() => removeFromArray("formative_assessments", fa)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {(unit.formative_assessments ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No formative assessments added.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className={INPUT_CLS}
                placeholder="Add formative assessment..."
                value={newFormativeAssessment}
                onChange={(e) => setNewFormativeAssessment(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (e.preventDefault(), addToArray("formative_assessments", newFormativeAssessment, setNewFormativeAssessment))
                }
              />
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl shrink-0"
                onClick={() => addToArray("formative_assessments", newFormativeAssessment, setNewFormativeAssessment)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </Section>
        </TabsContent>

        {/* ────────────────────────── REFLECTION ──────────────────────────── */}
        <TabsContent value="reflection" className="space-y-4 mt-4">
          <Section title="Teacher Reflection">
            <textarea
              className={INPUT_CLS + " min-h-[140px] resize-y"}
              value={unit.reflection ?? ""}
              onChange={(e) => updateLocal({ reflection: e.target.value })}
              onBlur={() => handleBlur("reflection")}
              placeholder="Reflect on what worked, what didn't, and what you would change..."
            />
          </Section>

          <Section title="Unit Collaborators">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(unit.collaborators ?? []).map((c) => (
                <Badge
                  key={c}
                  variant="secondary"
                  className="text-xs gap-1 cursor-pointer"
                  onClick={() => removeFromArray("collaborators", c)}
                >
                  {c} <X className="h-3 w-3" />
                </Badge>
              ))}
              {(unit.collaborators ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No collaborators added.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className={INPUT_CLS}
                placeholder="Add collaborator name or email..."
                value={newCollaborator}
                onChange={(e) => setNewCollaborator(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (e.preventDefault(), addToArray("collaborators", newCollaborator, setNewCollaborator))
                }
              />
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl shrink-0"
                onClick={() => addToArray("collaborators", newCollaborator, setNewCollaborator)}
              >
                Add
              </Button>
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default UnitDetail;
