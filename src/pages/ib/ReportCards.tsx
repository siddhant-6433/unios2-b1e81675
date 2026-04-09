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
  Loader2, FileText, Eye, Edit, Send, Users, FilePlus, CheckCircle,
  Clock, FileCheck, Search,
} from "lucide-react";

interface ReportCard {
  id: string;
  student_id: string;
  batch_id: string;
  term: string;
  academic_year: string;
  status: string;
  homeroom_comment: string | null;
  coordinator_comment: string | null;
  principal_comment: string | null;
  template_id: string | null;
  students: { name: string; admission_no: string | null } | null;
  ib_report_templates: { name: string } | null;
}

interface Batch {
  id: string;
  name: string;
  course_id: string;
}

interface Template {
  id: string;
  name: string;
  programme: string;
  is_default: boolean;
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
}

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-yellow-100 text-yellow-800" },
  teacher_review: { label: "Teacher Review", color: "bg-blue-100 text-blue-800" },
  coordinator_review: { label: "Coordinator Review", color: "bg-purple-100 text-purple-800" },
  published: { label: "Published", color: "bg-green-100 text-green-800" },
};

const ReportCards = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [programme, setProgramme] = useState<"PYP" | "MYP">("PYP");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [term, setTerm] = useState("Term 1");
  const [academicYear, setAcademicYear] = useState("2026-27");
  const [reports, setReports] = useState<ReportCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [institutionId, setInstitutionId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [search, setSearch] = useState("");

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<ReportCard | null>(null);
  const [editHomeroom, setEditHomeroom] = useState("");
  const [editCoordinator, setEditCoordinator] = useState("");
  const [editPrincipal, setEditPrincipal] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch institution
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("institutions")
        .select("id")
        .eq("code", "GZ1-MES")
        .single();
      if (data) setInstitutionId(data.id);
      else setLoading(false);
    })();
  }, []);

  // Fetch batches when programme changes
  useEffect(() => {
    if (!institutionId) return;
    (async () => {
      const progFilter = programme === "PYP" ? "PYP" : "MYP";
      const { data } = await supabase
        .from("batches")
        .select("id, name, course_id, courses!inner(code)")
        .order("name");
      if (data) {
        const filtered = data.filter(
          (b: any) => b.courses?.code?.includes(progFilter)
        );
        setBatches(filtered as any);
        if (filtered.length > 0 && !filtered.find((b: any) => b.id === batchId)) {
          setBatchId(filtered[0].id);
        }
      }
    })();
  }, [institutionId, programme]);

  // Fetch templates
  useEffect(() => {
    if (!institutionId) return;
    (async () => {
      const { data } = await supabase
        .from("ib_report_templates")
        .select("*")
        .eq("institution_id", institutionId)
        .eq("programme", programme);
      if (data) setTemplates(data as any);
    })();
  }, [institutionId, programme]);

  // Fetch report cards
  const fetchReports = useCallback(async () => {
    if (!batchId || !term || !academicYear) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_report_cards")
      .select("*, students(name, admission_no), ib_report_templates(name)")
      .eq("batch_id", batchId)
      .eq("term", term)
      .eq("academic_year", academicYear)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error loading reports", description: error.message, variant: "destructive" });
    } else {
      setReports((data || []) as any);
    }
    setLoading(false);
  }, [batchId, term, academicYear, toast]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Summary counts
  const total = reports.length;
  const draftCount = reports.filter((r) => r.status === "draft").length;
  const reviewCount = reports.filter((r) =>
    r.status === "teacher_review" || r.status === "coordinator_review"
  ).length;
  const publishedCount = reports.filter((r) => r.status === "published").length;

  // Generate reports for all students in batch
  const handleGenerate = async () => {
    if (!batchId) return;
    setGenerating(true);
    // Fetch active students in batch
    const { data: students } = await supabase
      .from("students")
      .select("id, name, admission_no")
      .eq("batch_id", batchId)
      .eq("status", "active")
      .order("name");

    if (!students || students.length === 0) {
      toast({ title: "No active students found in this batch" });
      setGenerating(false);
      return;
    }

    const defaultTemplate = templates.find((t) => t.is_default) || templates[0];
    const existingIds = new Set(reports.map((r) => r.student_id));
    const newRecords = students
      .filter((s) => !existingIds.has(s.id))
      .map((s) => ({
        student_id: s.id,
        batch_id: batchId,
        term,
        academic_year: academicYear,
        status: "draft",
        template_id: defaultTemplate?.id || null,
      }));

    if (newRecords.length === 0) {
      toast({ title: "All students already have report cards for this term" });
      setGenerating(false);
      return;
    }

    const { error } = await supabase.from("ib_report_cards").insert(newRecords);
    if (error) {
      toast({ title: "Error generating reports", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Generated ${newRecords.length} report cards` });
      fetchReports();
    }
    setGenerating(false);
  };

  // Publish all in-review reports
  const handlePublishAll = async () => {
    setPublishing(true);
    const reviewIds = reports
      .filter((r) => r.status === "teacher_review" || r.status === "coordinator_review")
      .map((r) => r.id);

    if (reviewIds.length === 0) {
      toast({ title: "No reports in review to publish" });
      setPublishing(false);
      return;
    }

    const { error } = await supabase
      .from("ib_report_cards")
      .update({ status: "published" })
      .in("id", reviewIds);
    if (error) {
      toast({ title: "Error publishing", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Published ${reviewIds.length} report cards` });
      fetchReports();
    }
    setPublishing(false);
  };

  // Edit dialog
  const openEdit = (report: ReportCard) => {
    setEditingReport(report);
    setEditHomeroom(report.homeroom_comment || "");
    setEditCoordinator(report.coordinator_comment || "");
    setEditPrincipal(report.principal_comment || "");
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editingReport) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_report_cards")
      .update({
        homeroom_comment: editHomeroom,
        coordinator_comment: editCoordinator,
        principal_comment: editPrincipal,
      })
      .eq("id", editingReport.id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Comments saved" });
      setEditOpen(false);
      fetchReports();
    }
    setSaving(false);
  };

  const filtered = reports.filter((r) => {
    const name = r.students?.name || "";
    const admNo = r.students?.admission_no || "";
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || admNo.toLowerCase().includes(q);
  });

  const summaryCards = [
    { label: "Total Students", count: total, icon: Users, color: "text-blue-600 bg-blue-50" },
    { label: "Draft", count: draftCount, icon: FileText, color: "text-yellow-600 bg-yellow-50" },
    { label: "In Review", count: reviewCount, icon: Clock, color: "text-purple-600 bg-purple-50" },
    { label: "Published", count: publishedCount, icon: CheckCircle, color: "text-green-600 bg-green-50" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">IB Report Cards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and manage student report cards.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePublishAll}
            disabled={publishing || reviewCount === 0}
            className="gap-1.5 text-sm"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish All
          </Button>
          <Button onClick={handleGenerate} disabled={generating} className="gap-1.5 text-sm">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
            Generate Reports
          </Button>
        </div>
      </div>

      {/* Programme Tabs */}
      <Tabs value={programme} onValueChange={(v) => setProgramme(v as "PYP" | "MYP")}>
        <TabsList>
          <TabsTrigger value="PYP">PYP</TabsTrigger>
          <TabsTrigger value="MYP">MYP</TabsTrigger>
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
          <label className="block text-xs font-medium text-muted-foreground mb-1">Term</label>
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className={INPUT_CLASS + " w-36"}
          >
            <option>Term 1</option>
            <option>Term 2</option>
            <option>Annual</option>
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
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search by name or admission no..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={INPUT_CLASS + " pl-9"}
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className={`rounded-lg p-2 ${card.color}`}>
              <card.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{card.count}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            No report cards found. Click "Generate Reports" to create them for this batch.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Admission No</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Homeroom Comment</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const sc = statusConfig[r.status] || statusConfig.draft;
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {r.students?.name || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.students?.admission_no || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`${sc.color} border-0`}>{sc.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[250px] truncate">
                        {r.homeroom_comment || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(r)}
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/ib/reports/${r.student_id}/${r.term}`)}
                            className="h-8 w-8 p-0"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={r.status === "published"}
                            onClick={async () => {
                              await supabase
                                .from("ib_report_cards")
                                .update({ status: "published" })
                                .eq("id", r.id);
                              toast({ title: "Report published" });
                              fetchReports();
                            }}
                            className="h-8 w-8 p-0"
                          >
                            <FileCheck className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Comments Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Comments — {editingReport?.students?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Homeroom Teacher Comment
              </label>
              <textarea
                value={editHomeroom}
                onChange={(e) => setEditHomeroom(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Coordinator Comment
              </label>
              <textarea
                value={editCoordinator}
                onChange={(e) => setEditCoordinator(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Principal Comment
              </label>
              <textarea
                value={editPrincipal}
                onChange={(e) => setEditPrincipal(e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportCards;
