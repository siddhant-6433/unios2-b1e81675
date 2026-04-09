import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Save, CheckCircle, Archive, Calendar, X, BookOpen,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface TdTheme {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

interface KeyConcept {
  id: string;
  name: string;
  description: string | null;
  programme: string;
  sort_order: number;
}

interface PoiEntry {
  id: string;
  poi_id: string;
  theme_id: string;
  course_id: string;
  central_idea: string | null;
  key_concepts: string[];
  related_concepts: string[];
  lines_of_inquiry: string[];
  duration_weeks: number | null;
  start_date: string | null;
  ib_td_themes: TdTheme | null;
}

interface Poi {
  id: string;
  institution_id: string;
  academic_year: string;
  status: string;
  created_at: string;
  ib_poi_entries: PoiEntry[];
}

interface PypCourse {
  id: string;
  name: string;
  code: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-pastel-yellow text-foreground/70",
  published: "bg-pastel-green text-foreground/70",
  archived: "bg-pastel-blue text-foreground/70",
};

const INPUT_CLS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

const ACADEMIC_YEARS = ["2025-26", "2026-27", "2027-28"];

function conceptName(concepts: KeyConcept[], id: string) {
  return concepts.find((c) => c.id === id)?.name ?? id;
}

// ── Component ───────────────────────────────────────────────────────────────

const ProgrammeOfInquiry = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [year, setYear] = useState("2026-27");
  const [themes, setThemes] = useState<TdTheme[]>([]);
  const [keyConcepts, setKeyConcepts] = useState<KeyConcept[]>([]);
  const [courses, setCourses] = useState<PypCourse[]>([]);
  const [poi, setPoi] = useState<Poi | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // edit dialog
  const [editEntry, setEditEntry] = useState<PoiEntry | null>(null);
  const [editForm, setEditForm] = useState({
    central_idea: "",
    key_concepts: [] as string[],
    related_concepts: [] as string[],
    lines_of_inquiry: ["", "", "", ""],
    duration_weeks: null as number | null,
    start_date: "",
  });
  const [newRelatedConcept, setNewRelatedConcept] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Fetch institution id ────────────────────────────────────────────────
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

  // ── Fetch reference data ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [tRes, kcRes, cRes] = await Promise.all([
        supabase.from("ib_td_themes").select("*").order("sort_order"),
        supabase.from("ib_key_concepts").select("*").eq("programme", "pyp").order("sort_order"),
        supabase.from("courses").select("id, name, code").like("code", "MES-PYP%").order("code"),
      ]);
      if (tRes.data) setThemes(tRes.data as TdTheme[]);
      if (kcRes.data) setKeyConcepts(kcRes.data as KeyConcept[]);
      if (cRes.data) setCourses(cRes.data as PypCourse[]);
    })();
  }, []);

  // ── Fetch POI for selected year ─────────────────────────────────────────
  const fetchPoi = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_poi")
      .select("*, ib_poi_entries(*, ib_td_themes(*))")
      .eq("institution_id", institutionId)
      .eq("academic_year", year)
      .maybeSingle();
    if (error) {
      toast({ title: "Error loading POI", description: error.message, variant: "destructive" });
    }
    setPoi((data as Poi) ?? null);
    setLoading(false);
  }, [institutionId, year, toast]);

  useEffect(() => {
    fetchPoi();
  }, [fetchPoi]);

  // ── Create POI ──────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!institutionId) return;
    setCreating(true);
    try {
      const { data: newPoi, error: poiErr } = await supabase
        .from("ib_poi")
        .insert({ institution_id: institutionId, academic_year: year, status: "draft" })
        .select()
        .single();
      if (poiErr) throw poiErr;

      // generate entries for every course x theme combination
      const entries: any[] = [];
      for (const course of courses) {
        for (const theme of themes) {
          entries.push({
            poi_id: (newPoi as any).id,
            course_id: course.id,
            theme_id: theme.id,
            central_idea: null,
            key_concepts: [],
            related_concepts: [],
            lines_of_inquiry: [],
            duration_weeks: null,
            start_date: null,
          });
        }
      }
      if (entries.length) {
        const { error: entryErr } = await supabase.from("ib_poi_entries").insert(entries);
        if (entryErr) throw entryErr;
      }

      toast({ title: "POI created", description: `Created for ${year} with ${entries.length} cells.` });
      await fetchPoi();
    } catch (err: any) {
      toast({ title: "Failed to create POI", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Publish POI ─────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!poi) return;
    setPublishing(true);
    const { error } = await supabase
      .from("ib_poi")
      .update({ status: "published" })
      .eq("id", poi.id);
    if (error) {
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Published", description: "POI is now published." });
      await fetchPoi();
    }
    setPublishing(false);
  };

  // ── Open edit dialog ────────────────────────────────────────────────────
  const openEdit = (entry: PoiEntry) => {
    setEditEntry(entry);
    const loi = [...(entry.lines_of_inquiry ?? [])];
    while (loi.length < 4) loi.push("");
    setEditForm({
      central_idea: entry.central_idea ?? "",
      key_concepts: entry.key_concepts ?? [],
      related_concepts: entry.related_concepts ?? [],
      lines_of_inquiry: loi,
      duration_weeks: entry.duration_weeks,
      start_date: entry.start_date ?? "",
    });
    setNewRelatedConcept("");
  };

  // ── Handle cell click — create entry on-the-fly if missing ────────────
  const handleCellClick = async (courseId: string, themeId: string) => {
    const existing = getEntry(courseId, themeId);
    if (existing) {
      openEdit(existing);
      return;
    }
    // No entry yet — create one
    if (!poi) return;
    const { data, error } = await supabase
      .from("ib_poi_entries")
      .insert({
        poi_id: poi.id,
        course_id: courseId,
        theme_id: themeId,
        central_idea: null,
        key_concepts: [],
        related_concepts: [],
        lines_of_inquiry: [],
        duration_weeks: null,
        start_date: null,
      } as any)
      .select("*, ib_td_themes(*)")
      .single();
    if (error) {
      toast({ title: "Error creating entry", description: error.message, variant: "destructive" });
      return;
    }
    if (data) openEdit(data as any);
    await fetchPoi();
  };

  // ── Save entry ──────────────────────────────────────────────────────────
  const handleSaveEntry = async () => {
    if (!editEntry) return;
    setSaving(true);
    const loi = editForm.lines_of_inquiry.filter((l) => l.trim() !== "");
    const { error } = await supabase
      .from("ib_poi_entries")
      .update({
        central_idea: editForm.central_idea || null,
        key_concepts: editForm.key_concepts,
        related_concepts: editForm.related_concepts,
        lines_of_inquiry: loi,
        duration_weeks: editForm.duration_weeks,
        start_date: editForm.start_date || null,
      })
      .eq("id", editEntry.id);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved" });
      setEditEntry(null);
      await fetchPoi();
    }
    setSaving(false);
  };

  // ── Toggle key concept ─────────────────────────────────────────────────
  const toggleKeyConcept = (id: string) => {
    setEditForm((f) => ({
      ...f,
      key_concepts: f.key_concepts.includes(id)
        ? f.key_concepts.filter((k) => k !== id)
        : [...f.key_concepts, id],
    }));
  };

  // ── Related concepts helpers ────────────────────────────────────────────
  const addRelatedConcept = () => {
    const val = newRelatedConcept.trim();
    if (!val || editForm.related_concepts.includes(val)) return;
    setEditForm((f) => ({ ...f, related_concepts: [...f.related_concepts, val] }));
    setNewRelatedConcept("");
  };

  const removeRelatedConcept = (c: string) => {
    setEditForm((f) => ({
      ...f,
      related_concepts: f.related_concepts.filter((r) => r !== c),
    }));
  };

  // ── Build grid helpers ──────────────────────────────────────────────────
  const getEntry = (courseId: string, themeId: string) =>
    poi?.ib_poi_entries?.find((e) => e.course_id === courseId && e.theme_id === themeId) ?? null;

  const courseSortLabel = (c: PypCourse) => {
    const m = c.code.match(/PYP(\d)/);
    return m ? `PYP ${m[1]}` : c.name;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-[#77966D]" />
            Programme of Inquiry
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            PYP Transdisciplinary Themes &times; Year Levels
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[140px] rounded-xl">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACADEMIC_YEARS.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {poi && (
            <Badge className={STATUS_COLORS[poi.status] ?? "bg-muted text-foreground"}>
              {poi.status}
            </Badge>
          )}

          {poi && poi.status === "draft" && (
            <Button
              size="sm"
              className="rounded-xl bg-[#77966D] hover:bg-[#6a8861] text-white"
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Publish
            </Button>
          )}

          {!poi && !loading && (
            <Button
              size="sm"
              className="rounded-xl bg-[#77966D] hover:bg-[#6a8861] text-white"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create POI
            </Button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !poi && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium text-foreground">No Programme of Inquiry for {year}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Create POI" to generate the grid.
          </p>
        </div>
      )}

      {/* POI Grid */}
      {!loading && poi && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-semibold text-foreground min-w-[100px]">
                  Year Level
                </th>
                {themes.map((theme) => (
                  <th
                    key={theme.id}
                    className="px-4 py-3 text-left font-semibold text-foreground min-w-[220px] border-l border-border"
                  >
                    <div className="text-xs font-bold uppercase tracking-wide text-[#77966D]">
                      {theme.name}
                    </div>
                    {theme.description && (
                      <div className="text-[11px] text-muted-foreground font-normal mt-0.5 line-clamp-2">
                        {theme.description}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-4 py-3 font-medium text-foreground whitespace-nowrap">
                    {courseSortLabel(course)}
                  </td>
                  {themes.map((theme) => {
                    const entry = getEntry(course.id, theme.id);
                    return (
                      <td
                        key={theme.id}
                        className="px-4 py-3 border-l border-border align-top cursor-pointer hover:bg-muted/40 transition-colors"
                        onClick={() => handleCellClick(course.id, theme.id)}
                      >
                        {entry?.central_idea ? (
                          <div className="space-y-2">
                            <p className="text-foreground leading-snug text-[13px]">
                              {entry.central_idea}
                            </p>
                            {entry.key_concepts?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {entry.key_concepts.map((kid) => (
                                  <Badge
                                    key={kid}
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 bg-[#77966D]/10 text-[#77966D]"
                                  >
                                    {conceptName(keyConcepts, kid)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {entry.lines_of_inquiry?.length > 0 && (
                              <ul className="text-[11px] text-muted-foreground list-disc list-inside space-y-0.5">
                                {entry.lines_of_inquiry.map((l, i) => (
                                  <li key={i}>{l}</li>
                                ))}
                              </ul>
                            )}
                            {entry.duration_weeks && (
                              <span className="text-[10px] text-muted-foreground">
                                {entry.duration_weeks} weeks
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs italic">
                            Click to add...
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Edit Entry Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Edit Unit of Inquiry
              {editEntry?.ib_td_themes && (
                <span className="text-[#77966D] ml-2 text-sm font-normal">
                  — {editEntry.ib_td_themes.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Central Idea */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Central Idea
              </label>
              <textarea
                className={INPUT_CLS + " min-h-[80px] resize-y"}
                value={editForm.central_idea}
                onChange={(e) => setEditForm((f) => ({ ...f, central_idea: e.target.value }))}
                placeholder="The central idea for this unit..."
              />
            </div>

            {/* Key Concepts */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Key Concepts
              </label>
              <div className="flex flex-wrap gap-2">
                {keyConcepts.map((kc) => {
                  const selected = editForm.key_concepts.includes(kc.id);
                  return (
                    <button
                      key={kc.id}
                      type="button"
                      onClick={() => toggleKeyConcept(kc.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-[#77966D] text-white border-[#77966D]"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {kc.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Related Concepts */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Related Concepts
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {editForm.related_concepts.map((c) => (
                  <Badge
                    key={c}
                    variant="secondary"
                    className="text-xs gap-1 cursor-pointer"
                    onClick={() => removeRelatedConcept(c)}
                  >
                    {c}
                    <X className="h-3 w-3" />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className={INPUT_CLS}
                  placeholder="Add a related concept..."
                  value={newRelatedConcept}
                  onChange={(e) => setNewRelatedConcept(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRelatedConcept())}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl shrink-0"
                  onClick={addRelatedConcept}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Lines of Inquiry */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Lines of Inquiry
              </label>
              <div className="space-y-2">
                {editForm.lines_of_inquiry.map((line, idx) => (
                  <input
                    key={idx}
                    type="text"
                    className={INPUT_CLS}
                    placeholder={`Line of inquiry ${idx + 1}`}
                    value={line}
                    onChange={(e) => {
                      const updated = [...editForm.lines_of_inquiry];
                      updated[idx] = e.target.value;
                      setEditForm((f) => ({ ...f, lines_of_inquiry: updated }));
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Duration & Start date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Duration (weeks)
                </label>
                <input
                  type="number"
                  className={INPUT_CLS}
                  min={1}
                  max={52}
                  value={editForm.duration_weeks ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      duration_weeks: e.target.value ? parseInt(e.target.value) : null,
                    }))
                  }
                  placeholder="e.g. 6"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={editForm.start_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditEntry(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-[#77966D] hover:bg-[#6a8861] text-white"
              onClick={handleSaveEntry}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProgrammeOfInquiry;
