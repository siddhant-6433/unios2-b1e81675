import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Edit, Star, Archive, Eye, ChevronUp, ChevronDown, GripVertical,
} from "lucide-react";

const INPUT_CLASS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

interface Template {
  id: string;
  name: string;
  programme: string;
  academic_year: string;
  term: string | null;
  institution_id: string;
  is_default: boolean;
  status: string;
  sections: any;
  header_config: any;
  footer_text: string | null;
  created_at: string;
}

const DEFAULT_SECTIONS = [
  { key: "attendance", label: "Attendance", enabled: true },
  { key: "subjects", label: "Subject Results", enabled: true },
  { key: "atl_skills", label: "ATL Skills", enabled: true },
  { key: "learner_profile", label: "Learner Profile", enabled: true },
  { key: "portfolio_highlights", label: "Portfolio Highlights", enabled: false },
  { key: "comments", label: "Comments", enabled: true },
  { key: "custom_text", label: "Custom Text", enabled: false },
];

const ReportTemplates = () => {
  const { toast } = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [institutionId, setInstitutionId] = useState("");

  // New template dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProgramme, setNewProgramme] = useState<"PYP" | "MYP">("PYP");
  const [newYear, setNewYear] = useState("2026-27");
  const [newTerm, setNewTerm] = useState("Term 1");
  const [creating, setCreating] = useState(false);

  // Editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSections, setEditSections] = useState<typeof DEFAULT_SECTIONS>([]);
  const [editHeaderSchoolName, setEditHeaderSchoolName] = useState("Mirai Experiential School");
  const [editHeaderShowLogo, setEditHeaderShowLogo] = useState(true);
  const [editFooter, setEditFooter] = useState("");
  const [saving, setSaving] = useState(false);

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);

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

  const fetchTemplates = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    const { data } = await supabase
      .from("ib_report_templates")
      .select("*")
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false });
    if (data) setTemplates(data as any);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("ib_report_templates").insert({
      name: newName,
      programme: newProgramme,
      academic_year: newYear,
      term: newTerm,
      institution_id: institutionId,
      is_default: templates.length === 0,
      status: "active",
      sections: DEFAULT_SECTIONS,
      header_config: { school_name: "Mirai Experiential School", show_logo: true },
      footer_text: "",
    });
    if (error) {
      toast({ title: "Error creating template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Template created" });
      setCreateOpen(false);
      setNewName("");
      fetchTemplates();
    }
    setCreating(false);
  };

  const handleSetDefault = async (id: string) => {
    // Unset all, then set this one
    await supabase
      .from("ib_report_templates")
      .update({ is_default: false })
      .eq("institution_id", institutionId);
    await supabase
      .from("ib_report_templates")
      .update({ is_default: true })
      .eq("id", id);
    toast({ title: "Default template updated" });
    fetchTemplates();
  };

  const handleArchive = async (id: string) => {
    await supabase
      .from("ib_report_templates")
      .update({ status: "archived" })
      .eq("id", id);
    toast({ title: "Template archived" });
    fetchTemplates();
  };

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    const sections = Array.isArray(t.sections) ? t.sections : DEFAULT_SECTIONS;
    setEditSections(sections as typeof DEFAULT_SECTIONS);
    const hc = t.header_config as any;
    setEditHeaderSchoolName(hc?.school_name || "Mirai Experiential School");
    setEditHeaderShowLogo(hc?.show_logo !== false);
    setEditFooter(t.footer_text || "");
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const next = [...editSections];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setEditSections(next);
  };

  const toggleSection = (index: number) => {
    const next = [...editSections];
    next[index] = { ...next[index], enabled: !next[index].enabled };
    setEditSections(next);
  };

  const saveTemplate = async () => {
    if (!editingId) return;
    setSaving(true);
    const { error } = await supabase
      .from("ib_report_templates")
      .update({
        sections: editSections,
        header_config: { school_name: editHeaderSchoolName, show_logo: editHeaderShowLogo },
        footer_text: editFooter,
      })
      .eq("id", editingId);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Template saved" });
      setEditingId(null);
      fetchTemplates();
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage IB report card templates.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* Template List */}
      {templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No templates yet. Create your first template to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-border bg-card">
              {/* Template header row */}
              <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.programme} &middot; {t.term || "All Terms"} &middot; {t.academic_year}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge
                      variant={t.status === "active" ? "default" : "secondary"}
                      className={
                        t.status === "active"
                          ? "bg-green-100 text-green-800 border-0"
                          : "bg-gray-100 text-gray-600 border-0"
                      }
                    >
                      {t.status}
                    </Badge>
                    {t.is_default && (
                      <Badge className="bg-yellow-100 text-yellow-800 border-0">Default</Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(t)}
                    className="h-8 gap-1.5"
                  >
                    <Edit className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {!t.is_default && t.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetDefault(t.id)}
                      className="h-8 gap-1.5"
                    >
                      <Star className="h-3.5 w-3.5" /> Set Default
                    </Button>
                  )}
                  {t.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchive(t.id)}
                      className="h-8 gap-1.5"
                    >
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </Button>
                  )}
                </div>
              </div>

              {/* Editor (inline) */}
              {editingId === t.id && (
                <div className="border-t border-border p-4 space-y-5">
                  {/* Header Config */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Header Configuration</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          School Name
                        </label>
                        <input
                          value={editHeaderSchoolName}
                          onChange={(e) => setEditHeaderSchoolName(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-5">
                        <input
                          type="checkbox"
                          checked={editHeaderShowLogo}
                          onChange={(e) => setEditHeaderShowLogo(e.target.checked)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <label className="text-sm text-foreground">Show Logo</label>
                      </div>
                    </div>
                  </div>

                  {/* Sections */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Sections</h3>
                    <div className="space-y-2">
                      {editSections.map((section, idx) => (
                        <div
                          key={section.key}
                          className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                          <input
                            type="checkbox"
                            checked={section.enabled}
                            onChange={() => toggleSection(idx)}
                            className="h-4 w-4 rounded border-input"
                          />
                          <span className="text-sm text-foreground flex-1">{section.label}</span>
                          <div className="flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              disabled={idx === 0}
                              onClick={() => moveSection(idx, -1)}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              disabled={idx === editSections.length - 1}
                              onClick={() => moveSection(idx, 1)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Footer Text</h3>
                    <textarea
                      value={editFooter}
                      onChange={(e) => setEditFooter(e.target.value)}
                      rows={2}
                      className={INPUT_CLASS}
                      placeholder="Optional footer text for the report card..."
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setPreviewOpen(true)}
                      className="gap-1.5 text-sm"
                    >
                      <Eye className="h-4 w-4" /> Preview
                    </Button>
                    <Button variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button onClick={saveTemplate} disabled={saving}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                      Save Template
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Template Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Report Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Template Name
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. PYP Term 1 Report 2026-27"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Programme
              </label>
              <select
                value={newProgramme}
                onChange={(e) => setNewProgramme(e.target.value as "PYP" | "MYP")}
                className={INPUT_CLASS}
              >
                <option value="PYP">PYP</option>
                <option value="MYP">MYP</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Academic Year
              </label>
              <input
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Term</label>
              <select
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                className={INPUT_CLASS}
              >
                <option>Term 1</option>
                <option>Term 2</option>
                <option>Annual</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
          </DialogHeader>
          <div className="border border-border rounded-xl p-6 bg-white space-y-4">
            {/* Header Preview */}
            <div className="text-center border-b border-border pb-4">
              {editHeaderShowLogo && (
                <div className="h-12 w-12 rounded-full bg-muted mx-auto mb-2 flex items-center justify-center text-xs text-muted-foreground">
                  Logo
                </div>
              )}
              <h2 className="text-lg font-bold text-foreground">{editHeaderSchoolName}</h2>
              <p className="text-xs text-muted-foreground">IB World School</p>
            </div>

            {/* Sections Preview */}
            {editSections
              .filter((s) => s.enabled)
              .map((section) => (
                <div
                  key={section.key}
                  className="rounded-xl border border-dashed border-border p-4"
                >
                  <p className="text-sm font-medium text-muted-foreground">{section.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Content for {section.label.toLowerCase()} will appear here.
                  </p>
                </div>
              ))}

            {/* Footer Preview */}
            {editFooter && (
              <div className="border-t border-border pt-3 text-center">
                <p className="text-xs text-muted-foreground">{editFooter}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportTemplates;
