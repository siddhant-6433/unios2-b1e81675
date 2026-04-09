import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Search, FolderOpen, Users, Globe,
} from "lucide-react";

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

interface Project {
  id: string;
  student_id: string;
  batch_id: string;
  project_type: string;
  title: string;
  global_context_id: string | null;
  goal: string | null;
  supervisor: string | null;
  status: string;
  final_grade: number | null;
  academic_year: string;
  created_at: string;
  students: { name: string; admission_no: string | null } | null;
  ib_global_contexts: { name: string } | null;
}

interface GlobalContext {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

interface Batch {
  id: string;
  name: string;
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  proposal: { label: "Proposal", color: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-800" },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800" },
  presentation: { label: "Presentation", color: "bg-purple-100 text-purple-800" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800" },
};

const MYPProjects = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [projectType, setProjectType] = useState<"personal" | "community">("personal");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [academicYear, setAcademicYear] = useState("2026-27");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalContexts, setGlobalContexts] = useState<GlobalContext[]>([]);

  // New project dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [newStudentId, setNewStudentId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newGcId, setNewGcId] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newSupervisor, setNewSupervisor] = useState("");
  const [creating, setCreating] = useState(false);

  // Fetch batches
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("batches")
        .select("id, name")
        .order("name");
      if (data) {
        setBatches(data);
        if (data.length > 0 && !batchId) setBatchId(data[0].id);
        else if (!data.length) setLoading(false);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch global contexts
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ib_global_contexts")
        .select("*")
        .order("sort_order");
      if (data) setGlobalContexts(data as any);
    })();
  }, []);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_myp_projects")
      .select("*, students(name, admission_no), ib_global_contexts(name)")
      .eq("batch_id", batchId)
      .eq("project_type", projectType)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error loading projects", description: error.message, variant: "destructive" });
    }
    setProjects((data || []) as any);
    setLoading(false);
  }, [batchId, projectType, toast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Fetch students for dialog
  useEffect(() => {
    if (!batchId) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("batch_id", batchId)
        .eq("status", "active")
        .order("name");
      if (data) setStudents(data);
    })();
  }, [batchId]);

  const handleCreate = async () => {
    if (!newStudentId || !newTitle.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("ib_myp_projects").insert({
      student_id: newStudentId,
      batch_id: batchId,
      project_type: projectType,
      title: newTitle,
      global_context_id: newGcId || null,
      goal: newGoal || null,
      supervisor: newSupervisor || null,
      status: "proposal",
      academic_year: academicYear,
    });
    if (error) {
      toast({ title: "Error creating project", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Project created" });
      setCreateOpen(false);
      setNewTitle("");
      setNewGoal("");
      setNewSupervisor("");
      setNewGcId("");
      setNewStudentId("");
      fetchProjects();
    }
    setCreating(false);
  };

  const filtered = projects.filter((p) => {
    const name = p.students?.name || "";
    const title = p.title || "";
    const q = search.toLowerCase();
    const matchSearch = name.toLowerCase().includes(q) || title.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MYP Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track Personal and Community Projects.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={projectType} onValueChange={(v) => setProjectType(v as any)}>
        <TabsList>
          <TabsTrigger value="personal">Personal Projects</TabsTrigger>
          <TabsTrigger value="community">Community Projects</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
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
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Academic Year</label>
          <input
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className={INPUT_CLASS + " w-32"}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={INPUT_CLASS + " w-40"}
          >
            <option value="all">All Statuses</option>
            {Object.entries(statusConfig).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by student or title..."
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
          <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No projects found.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Student</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Global Context</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supervisor</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Grade</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const sc = statusConfig[p.status] || statusConfig.proposal;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/ib/projects/${p.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{p.students?.name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{p.students?.admission_no || ""}</p>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground max-w-[250px] truncate">
                        {p.title}
                      </td>
                      <td className="px-4 py-3">
                        {p.ib_global_contexts ? (
                          <Badge variant="outline" className="text-xs">
                            <Globe className="h-3 w-3 mr-1" />
                            {p.ib_global_contexts.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.supervisor || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge className={`${sc.color} border-0`}>{sc.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-foreground">
                        {p.final_grade ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              New {projectType === "personal" ? "Personal" : "Community"} Project
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Student</label>
              <select
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Select student...</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.admission_no ? `(${s.admission_no})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Project title"
                className={INPUT_CLASS}
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
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Goal</label>
              <textarea
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                rows={2}
                placeholder="What does the student aim to achieve?"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Supervisor
              </label>
              <input
                value={newSupervisor}
                onChange={(e) => setNewSupervisor(e.target.value)}
                placeholder="Supervisor name"
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newStudentId || !newTitle.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MYPProjects;
