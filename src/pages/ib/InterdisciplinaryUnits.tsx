import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Search, ChevronDown, ChevronUp, Save, Globe, Users,
  BookOpen,
} from "lucide-react";

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

interface IDU {
  id: string;
  title: string;
  batch_id: string;
  statement_of_inquiry: string | null;
  global_context_id: string | null;
  subject_group_1_id: string | null;
  subject_group_2_id: string | null;
  key_concepts: string | null;
  assessment_task: string | null;
  status: string;
  academic_year: string;
  created_at: string;
  // Joined data
  sg1_name?: string;
  sg2_name?: string;
  gc_name?: string;
}

interface SubjectGroup {
  id: string;
  name: string;
  code: string;
}

interface GlobalContext {
  id: string;
  name: string;
}

interface Batch {
  id: string;
  name: string;
}

interface IDUResult {
  id: string;
  idu_id: string;
  student_id: string;
  criterion_a: number | null;
  criterion_b: number | null;
  criterion_c: number | null;
  total: number | null;
  comment: string | null;
  students: { name: string; admission_no: string | null } | null;
}

interface IDUTeacher {
  id: string;
  idu_id: string;
  teacher_name: string;
  subject_group_id: string | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  planning: { label: "Planning", color: "bg-gray-100 text-gray-700" },
  active: { label: "Active", color: "bg-blue-100 text-blue-800" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800" },
};

const InterdisciplinaryUnits = () => {
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [academicYear, setAcademicYear] = useState("2026-27");
  const [search, setSearch] = useState("");
  const [idus, setIdus] = useState<IDU[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectGroups, setSubjectGroups] = useState<SubjectGroup[]>([]);
  const [globalContexts, setGlobalContexts] = useState<GlobalContext[]>([]);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandResults, setExpandResults] = useState<IDUResult[]>([]);
  const [expandTeachers, setExpandTeachers] = useState<IDUTeacher[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);
  const [resultsSaving, setResultsSaving] = useState(false);

  // New IDU dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSoi, setNewSoi] = useState("");
  const [newGcId, setNewGcId] = useState("");
  const [newSg1Id, setNewSg1Id] = useState("");
  const [newSg2Id, setNewSg2Id] = useState("");
  const [newConcepts, setNewConcepts] = useState("");
  const [newTask, setNewTask] = useState("");
  const [creating, setCreating] = useState(false);

  // Teacher assignment
  const [newTeacherName, setNewTeacherName] = useState("");
  const [newTeacherSgId, setNewTeacherSgId] = useState("");

  // Fetch batches
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("batches").select("id, name").order("name");
      if (data) {
        setBatches(data);
        if (data.length > 0 && !batchId) setBatchId(data[0].id);
        else if (!data.length) setLoading(false);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch subject groups & global contexts
  useEffect(() => {
    (async () => {
      const [sgRes, gcRes] = await Promise.all([
        supabase.from("ib_myp_subject_groups").select("*").order("name"),
        supabase.from("ib_global_contexts").select("id, name").order("sort_order"),
      ]);
      if (sgRes.data) setSubjectGroups(sgRes.data as any);
      if (gcRes.data) setGlobalContexts(gcRes.data as any);
    })();
  }, []);

  // Fetch IDUs
  const fetchIdus = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);

    // Main query
    const { data, error } = await supabase
      .from("ib_interdisciplinary_units")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error loading IDUs", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Resolve subject group and global context names locally
    const sgMap = new Map(subjectGroups.map((sg) => [sg.id, sg.name]));
    const gcMap = new Map(globalContexts.map((gc) => [gc.id, gc.name]));

    const enriched: IDU[] = (data || []).map((d: any) => ({
      ...d,
      sg1_name: d.subject_group_1_id ? sgMap.get(d.subject_group_1_id) || "—" : "—",
      sg2_name: d.subject_group_2_id ? sgMap.get(d.subject_group_2_id) || "—" : "—",
      gc_name: d.global_context_id ? gcMap.get(d.global_context_id) || "—" : "—",
    }));

    setIdus(enriched);
    setLoading(false);
  }, [batchId, subjectGroups, globalContexts, toast]);

  useEffect(() => {
    if (subjectGroups.length > 0) fetchIdus();
  }, [fetchIdus, subjectGroups]);

  // Expand row to show details
  const toggleExpand = async (iduId: string) => {
    if (expandedId === iduId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(iduId);
    setExpandLoading(true);

    const [resultsRes, teachersRes] = await Promise.all([
      supabase
        .from("ib_idu_results")
        .select("*, students(name, admission_no)")
        .eq("idu_id", iduId),
      supabase
        .from("ib_idu_teachers")
        .select("*")
        .eq("idu_id", iduId),
    ]);

    setExpandResults((resultsRes.data || []) as any);
    setExpandTeachers((teachersRes.data || []) as any);
    setExpandLoading(false);
  };

  // Update a result inline
  const updateResult = (resultId: string, field: string, value: number | string) => {
    setExpandResults((prev) =>
      prev.map((r) => {
        if (r.id !== resultId) return r;
        const updated = { ...r, [field]: value };
        // Auto-calc total
        if (field.startsWith("criterion_")) {
          updated.total =
            (updated.criterion_a ?? 0) +
            (updated.criterion_b ?? 0) +
            (updated.criterion_c ?? 0);
        }
        return updated;
      })
    );
  };

  const saveResults = async () => {
    setResultsSaving(true);
    for (const r of expandResults) {
      await supabase
        .from("ib_idu_results")
        .update({
          criterion_a: r.criterion_a,
          criterion_b: r.criterion_b,
          criterion_c: r.criterion_c,
          total: r.total,
          comment: r.comment,
        })
        .eq("id", r.id);
    }
    toast({ title: "Results saved" });
    setResultsSaving(false);
  };

  const addTeacher = async () => {
    if (!expandedId || !newTeacherName.trim()) return;
    const { error } = await supabase.from("ib_idu_teachers").insert({
      idu_id: expandedId,
      teacher_name: newTeacherName,
      subject_group_id: newTeacherSgId || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Teacher assigned" });
      setNewTeacherName("");
      setNewTeacherSgId("");
      // Refresh teachers
      const { data } = await supabase
        .from("ib_idu_teachers")
        .select("*")
        .eq("idu_id", expandedId);
      if (data) setExpandTeachers(data as any);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("ib_interdisciplinary_units").insert({
      title: newTitle,
      batch_id: batchId,
      statement_of_inquiry: newSoi || null,
      global_context_id: newGcId || null,
      subject_group_1_id: newSg1Id || null,
      subject_group_2_id: newSg2Id || null,
      key_concepts: newConcepts || null,
      assessment_task: newTask || null,
      status: "planning",
      academic_year: academicYear,
    });
    if (error) {
      toast({ title: "Error creating IDU", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "IDU created" });
      setCreateOpen(false);
      setNewTitle("");
      setNewSoi("");
      setNewGcId("");
      setNewSg1Id("");
      setNewSg2Id("");
      setNewConcepts("");
      setNewTask("");
      fetchIdus();
    }
    setCreating(false);
  };

  const filtered = idus.filter((idu) => {
    const q = search.toLowerCase();
    return (
      idu.title.toLowerCase().includes(q) ||
      (idu.sg1_name || "").toLowerCase().includes(q) ||
      (idu.sg2_name || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Interdisciplinary Units</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage MYP interdisciplinary learning units.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> New IDU
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Academic Year</label>
          <input
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className={INPUT_CLASS + " w-32"}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className={INPUT_CLASS + " w-48"}
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by title or subject group..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={INPUT_CLASS + " pl-9"}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BookOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No interdisciplinary units found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((idu) => {
            const sc = statusConfig[idu.status] || statusConfig.planning;
            const isExpanded = expandedId === idu.id;
            return (
              <div key={idu.id} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Row */}
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggleExpand(idu.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{idu.title}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">SG1: {idu.sg1_name}</span>
                      <span className="text-xs text-muted-foreground">SG2: {idu.sg2_name}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="gap-1 shrink-0">
                    <Globe className="h-3 w-3" />
                    {idu.gc_name}
                  </Badge>
                  <Badge className={`${sc.color} border-0 shrink-0`}>{sc.label}</Badge>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border p-4 space-y-5">
                    {expandLoading ? (
                      <div className="flex h-20 items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        {/* Details */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          {idu.statement_of_inquiry && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Statement of Inquiry
                              </p>
                              <p className="text-foreground">{idu.statement_of_inquiry}</p>
                            </div>
                          )}
                          {idu.key_concepts && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Key Concepts
                              </p>
                              <p className="text-foreground">{idu.key_concepts}</p>
                            </div>
                          )}
                          {idu.assessment_task && (
                            <div className="md:col-span-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Assessment Task
                              </p>
                              <p className="text-foreground">{idu.assessment_task}</p>
                            </div>
                          )}
                        </div>

                        {/* Teachers */}
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-2">
                            Teacher Assignments
                          </h4>
                          <div className="space-y-2 mb-3">
                            {expandTeachers.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No teachers assigned.</p>
                            ) : (
                              expandTeachers.map((t) => (
                                <div
                                  key={t.id}
                                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                                >
                                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-sm text-foreground">{t.teacher_name}</span>
                                  {t.subject_group_id && (
                                    <Badge variant="outline" className="text-xs ml-auto">
                                      {subjectGroups.find((sg) => sg.id === t.subject_group_id)?.name || ""}
                                    </Badge>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <input
                                value={newTeacherName}
                                onChange={(e) => setNewTeacherName(e.target.value)}
                                placeholder="Teacher name"
                                className={INPUT_CLASS}
                              />
                            </div>
                            <div className="w-40">
                              <select
                                value={newTeacherSgId}
                                onChange={(e) => setNewTeacherSgId(e.target.value)}
                                className={INPUT_CLASS}
                              >
                                <option value="">Subject Group</option>
                                {subjectGroups.map((sg) => (
                                  <option key={sg.id} value={sg.id}>{sg.name}</option>
                                ))}
                              </select>
                            </div>
                            <Button
                              variant="outline"
                              onClick={addTeacher}
                              disabled={!newTeacherName.trim()}
                              className="gap-1 text-sm"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add
                            </Button>
                          </div>
                        </div>

                        {/* Student Results */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold text-foreground">Student Results</h4>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={saveResults}
                              disabled={resultsSaving}
                              className="gap-1.5 text-xs h-8"
                            >
                              {resultsSaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Save Results
                            </Button>
                          </div>
                          {expandResults.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No student results. Results are created when students are enrolled in the IDU.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">
                                      Student
                                    </th>
                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-20">
                                      A
                                    </th>
                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-20">
                                      B
                                    </th>
                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-20">
                                      C
                                    </th>
                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-20">
                                      Total
                                    </th>
                                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">
                                      Comment
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandResults.map((r) => (
                                    <tr key={r.id} className="border-b border-border last:border-0">
                                      <td className="px-2 py-2">
                                        <p className="font-medium text-foreground">
                                          {r.students?.name || "—"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {r.students?.admission_no || ""}
                                        </p>
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          type="number"
                                          min={0}
                                          max={8}
                                          value={r.criterion_a ?? ""}
                                          onChange={(e) =>
                                            updateResult(r.id, "criterion_a", Number(e.target.value))
                                          }
                                          className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring/20"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          type="number"
                                          min={0}
                                          max={8}
                                          value={r.criterion_b ?? ""}
                                          onChange={(e) =>
                                            updateResult(r.id, "criterion_b", Number(e.target.value))
                                          }
                                          className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring/20"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          type="number"
                                          min={0}
                                          max={8}
                                          value={r.criterion_c ?? ""}
                                          onChange={(e) =>
                                            updateResult(r.id, "criterion_c", Number(e.target.value))
                                          }
                                          className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring/20"
                                        />
                                      </td>
                                      <td className="px-2 py-2 text-center font-bold text-foreground">
                                        {r.total ?? "—"}
                                      </td>
                                      <td className="px-2 py-2">
                                        <input
                                          value={r.comment || ""}
                                          onChange={(e) =>
                                            updateResult(r.id, "comment", e.target.value)
                                          }
                                          className="w-full rounded-lg border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                                          placeholder="Comment..."
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New IDU Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Interdisciplinary Unit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="IDU title"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Statement of Inquiry
              </label>
              <textarea
                value={newSoi}
                onChange={(e) => setNewSoi(e.target.value)}
                rows={2}
                className={INPUT_CLASS}
                placeholder="The central idea of the unit..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Global Context
              </label>
              <select
                value={newGcId}
                onChange={(e) => setNewGcId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Select global context...</option>
                {globalContexts.map((gc) => (
                  <option key={gc.id} value={gc.id}>{gc.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Subject Group 1
                </label>
                <select
                  value={newSg1Id}
                  onChange={(e) => setNewSg1Id(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Select...</option>
                  {subjectGroups.map((sg) => (
                    <option key={sg.id} value={sg.id}>{sg.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Subject Group 2
                </label>
                <select
                  value={newSg2Id}
                  onChange={(e) => setNewSg2Id(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Select...</option>
                  {subjectGroups.map((sg) => (
                    <option key={sg.id} value={sg.id}>{sg.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Key Concepts
              </label>
              <input
                value={newConcepts}
                onChange={(e) => setNewConcepts(e.target.value)}
                placeholder="e.g. Change, Connection, Perspective"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Assessment Task
              </label>
              <textarea
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                rows={2}
                className={INPUT_CLASS}
                placeholder="Describe the assessment task..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Create IDU
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InterdisciplinaryUnits;
