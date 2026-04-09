import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, ArrowLeft, Save, Plus, Globe, Calendar, User, BookOpen,
} from "lucide-react";

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

interface ProjectData {
  id: string;
  student_id: string;
  batch_id: string;
  project_type: string;
  title: string;
  global_context_id: string | null;
  goal: string | null;
  product_description: string | null;
  supervisor: string | null;
  status: string;
  final_grade: number | null;
  criterion_a: number | null;
  criterion_b: number | null;
  criterion_c: number | null;
  criterion_d: number | null;
  process_journal: any;
  supervisor_feedback: any;
  presentation_date: string | null;
  academic_year: string;
  students: { name: string; admission_no: string | null } | null;
  ib_global_contexts: { name: string; description: string | null } | null;
}

interface JournalEntry {
  date: string;
  text: string;
  evidence_url?: string;
}

interface FeedbackEntry {
  date: string;
  text: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  proposal: { label: "Proposal", color: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-800" },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800" },
  presentation: { label: "Presentation", color: "bg-purple-100 text-purple-800" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800" },
};

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Editable fields
  const [goal, setGoal] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [critA, setCritA] = useState<number>(0);
  const [critB, setCritB] = useState<number>(0);
  const [critC, setCritC] = useState<number>(0);
  const [critD, setCritD] = useState<number>(0);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [presentationDate, setPresentationDate] = useState("");

  // New journal entry
  const [newEntryText, setNewEntryText] = useState("");
  const [newEntryUrl, setNewEntryUrl] = useState("");

  // New feedback entry
  const [newFeedbackText, setNewFeedbackText] = useState("");

  const fetchProject = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_myp_projects")
      .select("*, students(name, admission_no), ib_global_contexts(name, description)")
      .eq("id", id)
      .single();
    if (error) {
      toast({ title: "Error loading project", description: error.message, variant: "destructive" });
    }
    if (data) {
      const p = data as any as ProjectData;
      setProject(p);
      setGoal(p.goal || "");
      setProductDesc(p.product_description || "");
      setCritA(p.criterion_a ?? 0);
      setCritB(p.criterion_b ?? 0);
      setCritC(p.criterion_c ?? 0);
      setCritD(p.criterion_d ?? 0);
      setJournal(Array.isArray(p.process_journal) ? p.process_journal : []);
      setFeedback(Array.isArray(p.supervisor_feedback) ? p.supervisor_feedback : []);
      setPresentationDate(p.presentation_date || "");
    }
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const totalScore = critA + critB + critC + critD;
  const maxScore = 32;
  const computedGrade = Math.min(7, Math.max(1, Math.round((totalScore / maxScore) * 7)));

  const saveOverview = async () => {
    if (!project) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_myp_projects")
      .update({ goal, product_description: productDesc })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Overview saved" });
    }
    setSaving(false);
  };

  const addJournalEntry = () => {
    if (!newEntryText.trim()) return;
    const entry: JournalEntry = {
      date: new Date().toISOString().split("T")[0],
      text: newEntryText,
      evidence_url: newEntryUrl || undefined,
    };
    setJournal([entry, ...journal]);
    setNewEntryText("");
    setNewEntryUrl("");
  };

  const saveJournal = async () => {
    if (!project) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_myp_projects")
      .update({ process_journal: journal })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Process journal saved" });
    }
    setSaving(false);
  };

  const saveAssessment = async () => {
    if (!project) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_myp_projects")
      .update({
        criterion_a: critA,
        criterion_b: critB,
        criterion_c: critC,
        criterion_d: critD,
        final_grade: computedGrade,
        supervisor_feedback: feedback,
      })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Assessment saved" });
    }
    setSaving(false);
  };

  const addFeedback = () => {
    if (!newFeedbackText.trim()) return;
    const entry: FeedbackEntry = {
      date: new Date().toISOString().split("T")[0],
      text: newFeedbackText,
    };
    setFeedback([entry, ...feedback]);
    setNewFeedbackText("");
  };

  const savePresentation = async () => {
    if (!project) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_myp_projects")
      .update({ presentation_date: presentationDate || null })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Presentation details saved" });
    }
    setSaving(false);
  };

  const updateStatus = async (newStatus: string) => {
    if (!project) return;
    const { error } = await supabase
      .from("ib_myp_projects")
      .update({ status: newStatus })
      .eq("id", project.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Status updated to ${newStatus.replace("_", " ")}` });
      fetchProject();
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/ib/projects")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Projects
        </Button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Project not found.</p>
        </div>
      </div>
    );
  }

  const sc = statusConfig[project.status] || statusConfig.proposal;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back */}
      <Button variant="ghost" onClick={() => navigate("/ib/projects")} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </Button>

      {/* Project Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-foreground">{project.title}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="gap-1">
                <User className="h-3 w-3" />
                {project.students?.name || "—"}
              </Badge>
              <Badge
                variant="outline"
                className="capitalize"
              >
                {project.project_type} Project
              </Badge>
              {project.ib_global_contexts && (
                <Badge variant="outline" className="gap-1">
                  <Globe className="h-3 w-3" />
                  {project.ib_global_contexts.name}
                </Badge>
              )}
              <Badge className={`${sc.color} border-0`}>{sc.label}</Badge>
            </div>
          </div>
          {project.final_grade && (
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{project.final_grade}</p>
              <p className="text-xs text-muted-foreground">Final Grade</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="journal">Process Journal</TabsTrigger>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="presentation">Presentation</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Goal</label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
                placeholder="Describe the project goal..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Product Description
              </label>
              <textarea
                value={productDesc}
                onChange={(e) => setProductDesc(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
                placeholder="Describe the product or outcome..."
              />
            </div>
            {project.ib_global_contexts && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Global Context
                </label>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium text-foreground">
                    {project.ib_global_contexts.name}
                  </p>
                  {project.ib_global_contexts.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {project.ib_global_contexts.description}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Supervisor
              </label>
              <p className="text-sm text-foreground">{project.supervisor || "Not assigned"}</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveOverview} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Process Journal Tab */}
        <TabsContent value="journal">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            {/* Add Entry */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Add Journal Entry</h3>
              <textarea
                value={newEntryText}
                onChange={(e) => setNewEntryText(e.target.value)}
                rows={2}
                className={INPUT_CLASS}
                placeholder="What did the student work on today?"
              />
              <input
                value={newEntryUrl}
                onChange={(e) => setNewEntryUrl(e.target.value)}
                placeholder="Evidence URL (optional)"
                className={INPUT_CLASS}
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={addJournalEntry}
                  disabled={!newEntryText.trim()}
                  className="gap-1.5 text-sm"
                >
                  <Plus className="h-4 w-4" /> Add Entry
                </Button>
              </div>
            </div>

            {/* Journal Timeline */}
            {journal.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No journal entries yet.
              </p>
            ) : (
              <div className="space-y-3">
                {journal.map((entry, i) => (
                  <div key={i} className="rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">{entry.date}</span>
                    </div>
                    <p className="text-sm text-foreground">{entry.text}</p>
                    {entry.evidence_url && (
                      <a
                        href={entry.evidence_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                      >
                        View Evidence
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={saveJournal} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Journal
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Assessment Tab */}
        <TabsContent value="assessment">
          <div className="rounded-xl border border-border bg-card p-6 space-y-6">
            {/* Criterion Scores */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Criterion Scores (0-8)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Criterion A", value: critA, setter: setCritA },
                  { label: "Criterion B", value: critB, setter: setCritB },
                  { label: "Criterion C", value: critC, setter: setCritC },
                  { label: "Criterion D", value: critD, setter: setCritD },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {label}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={value}
                      onChange={(e) => setter(Math.min(8, Math.max(0, Number(e.target.value))))}
                      className={INPUT_CLASS}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Total & Grade */}
            <div className="flex gap-6 items-center">
              <div className="rounded-xl border border-border p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{totalScore}</p>
                <p className="text-xs text-muted-foreground">Total / {maxScore}</p>
              </div>
              <div className="rounded-xl border border-border p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{computedGrade}</p>
                <p className="text-xs text-muted-foreground">Final Grade (1-7)</p>
              </div>
            </div>

            {/* Supervisor Feedback */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Supervisor Feedback</h3>
              <div className="flex gap-2 mb-3">
                <textarea
                  value={newFeedbackText}
                  onChange={(e) => setNewFeedbackText(e.target.value)}
                  rows={2}
                  className={INPUT_CLASS + " flex-1"}
                  placeholder="Add feedback..."
                />
                <Button
                  variant="outline"
                  onClick={addFeedback}
                  disabled={!newFeedbackText.trim()}
                  className="self-end"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">No feedback yet.</p>
              ) : (
                <div className="space-y-2">
                  {feedback.map((f, i) => (
                    <div key={i} className="rounded-xl border border-border p-3">
                      <p className="text-xs text-muted-foreground mb-1">{f.date}</p>
                      <p className="text-sm text-foreground">{f.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={saveAssessment} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Assessment
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Presentation Tab */}
        <TabsContent value="presentation">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Presentation Date
              </label>
              <input
                type="date"
                value={presentationDate}
                onChange={(e) => setPresentationDate(e.target.value)}
                className={INPUT_CLASS + " w-48"}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Status Actions
              </label>
              <div className="flex gap-2 flex-wrap">
                {project.status !== "presentation" && (
                  <Button
                    variant="outline"
                    onClick={() => updateStatus("presentation")}
                    className="gap-1.5 text-sm"
                  >
                    <BookOpen className="h-4 w-4" /> Mark as Presented
                  </Button>
                )}
                {project.status !== "completed" && (
                  <Button
                    onClick={() => updateStatus("completed")}
                    className="gap-1.5 text-sm"
                  >
                    Mark as Completed
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={savePresentation} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProjectDetail;
