import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Search, Filter, BookOpen, Calendar, GraduationCap,
  ArrowRight, Clock,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface UnitRow {
  id: string;
  institution_id: string;
  programme: string;
  title: string;
  central_idea: string | null;
  statement_of_inquiry: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  key_concept_ids: string[];
  subject_focus: string | null;
  batch_id: string | null;
  poi_entry_id: string | null;
  created_at: string;
  batches: { name: string } | null;
  ib_myp_subject_groups: { name: string } | null;
}

interface Batch {
  id: string;
  name: string;
  course_id: string;
}

interface PoiEntry {
  id: string;
  central_idea: string | null;
  td_theme_id: string;
  course_id: string;
}

interface KeyConcept {
  id: string;
  name: string;
  programme: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["planning", "teaching", "reflecting", "completed"] as const;

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-pastel-yellow text-foreground/70",
  teaching: "bg-pastel-blue text-foreground/70",
  reflecting: "bg-pastel-purple text-foreground/70",
  completed: "bg-pastel-green text-foreground/70",
};

const INPUT_CLS =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ───────────────────────────────────────────────────────────────

const UnitPlanner = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [programme, setProgramme] = useState<"pyp" | "myp">("pyp");
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");

  // reference data
  const [batches, setBatches] = useState<Batch[]>([]);
  const [poiEntries, setPoiEntries] = useState<PoiEntry[]>([]);
  const [keyConcepts, setKeyConcepts] = useState<KeyConcept[]>([]);

  // create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    batch_id: "",
    poi_entry_id: "",
    subject_focus: "",
    start_date: "",
    end_date: "",
  });
  const [creating, setCreating] = useState(false);

  // ── Fetch institution ───────────────────────────────────────────────────
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
    if (!institutionId) return;
    (async () => {
      const prefix = programme === "pyp" ? "MES-PYP%" : "MES-MYP%";
      const [bRes, kcRes] = await Promise.all([
        supabase
          .from("batches")
          .select("id, name, course_id, courses!inner(code)")
          .like("courses.code", prefix),
        supabase
          .from("ib_key_concepts")
          .select("id, name, programme")
          .eq("programme", programme)
          .order("sort_order"),
      ]);
      if (bRes.data) setBatches(bRes.data as any);
      if (kcRes.data) setKeyConcepts(kcRes.data as KeyConcept[]);
    })();
  }, [institutionId, programme]);

  // ── Fetch POI entries for PYP create dialog ─────────────────────────────
  useEffect(() => {
    if (programme !== "pyp" || !institutionId) return;
    (async () => {
      const { data } = await supabase
        .from("ib_poi_entries")
        .select("id, central_idea, td_theme_id, course_id, ib_poi!inner(institution_id, academic_year, status)")
        .eq("ib_poi.institution_id", institutionId)
        .eq("ib_poi.status", "published");
      if (data) setPoiEntries(data as any);
    })();
  }, [institutionId, programme]);

  // ── Fetch units ─────────────────────────────────────────────────────────
  const fetchUnits = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("ib_units")
      .select("*, batches(name), ib_myp_subject_groups(name)")
      .eq("institution_id", institutionId)
      .eq("programme", programme)
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error loading units", description: error.message, variant: "destructive" });
    }
    setUnits((data as UnitRow[]) ?? []);
    setLoading(false);
  }, [institutionId, programme, toast]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  // ── Create unit ─────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!institutionId || !createForm.title.trim()) return;
    setCreating(true);
    try {
      const payload: any = {
        institution_id: institutionId,
        programme,
        title: createForm.title.trim(),
        status: "planning",
        batch_id: createForm.batch_id || null,
        poi_entry_id: createForm.poi_entry_id || null,
        subject_focus: createForm.subject_focus || null,
        start_date: createForm.start_date || null,
        end_date: createForm.end_date || null,
        key_concept_ids: [],
        related_concepts: [],
        atl_skill_ids: [],
        learner_profile_ids: [],
      };
      const { error } = await supabase.from("ib_units").insert(payload);
      if (error) throw error;
      toast({ title: "Unit created" });
      setShowCreate(false);
      setCreateForm({ title: "", batch_id: "", poi_entry_id: "", subject_focus: "", start_date: "", end_date: "" });
      await fetchUnits();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Filter units ────────────────────────────────────────────────────────
  const filtered = units.filter((u) => {
    if (statusFilter !== "all" && u.status !== statusFilter) return false;
    if (batchFilter !== "all" && u.batch_id !== batchFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = [u.title, u.central_idea, u.statement_of_inquiry, u.subject_focus]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ── Helpers ─────────────────────────────────────────────────────────────
  const conceptName = (id: string) => keyConcepts.find((c) => c.id === id)?.name ?? id;

  const poiEntriesForBatch = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return poiEntries;
    return poiEntries.filter((e) => e.course_id === batch.course_id);
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-[#77966D]" />
            Unit Planner
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan and manage IB units of inquiry
          </p>
        </div>
        <Button
          size="sm"
          className="rounded-xl bg-[#77966D] hover:bg-[#6a8861] text-white"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Unit
        </Button>
      </div>

      {/* Programme Tabs */}
      <Tabs value={programme} onValueChange={(v) => setProgramme(v as "pyp" | "myp")}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="pyp" className="rounded-xl">PYP</TabsTrigger>
          <TabsTrigger value="myp" className="rounded-xl">MYP</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            className={INPUT_CLS + " pl-9"}
            placeholder="Search units..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] rounded-xl">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={batchFilter} onValueChange={setBatchFilter}>
          <SelectTrigger className="w-[160px] rounded-xl">
            <SelectValue placeholder="Batch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Batches</SelectItem>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium text-foreground">No units found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {units.length > 0 ? "Try adjusting your filters." : "Click \"New Unit\" to get started."}
          </p>
        </div>
      )}

      {/* Unit Cards Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((unit) => (
            <div
              key={unit.id}
              className="rounded-xl border border-border bg-card p-5 cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/ib/units/${unit.id}`)}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="font-semibold text-foreground text-sm leading-snug line-clamp-2 flex-1">
                  {unit.title}
                </h3>
                <Badge className={STATUS_COLORS[unit.status] ?? "bg-muted text-foreground"}>
                  {unit.status}
                </Badge>
              </div>

              {(unit.central_idea || unit.statement_of_inquiry) && (
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                  {unit.central_idea || unit.statement_of_inquiry}
                </p>
              )}

              {unit.key_concept_ids?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {unit.key_concept_ids.slice(0, 4).map((kid) => (
                    <Badge
                      key={kid}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 bg-[#77966D]/10 text-[#77966D]"
                    >
                      {conceptName(kid)}
                    </Badge>
                  ))}
                  {unit.key_concept_ids.length > 4 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      +{unit.key_concept_ids.length - 4}
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {unit.batches?.name && (
                  <span className="flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    {unit.batches.name}
                  </span>
                )}
                {unit.subject_focus && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    {unit.subject_focus}
                  </span>
                )}
                {(unit.start_date || unit.end_date) && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {fmtDate(unit.start_date)}
                    {unit.start_date && unit.end_date && " – "}
                    {fmtDate(unit.end_date)}
                  </span>
                )}
              </div>

              <div className="flex justify-end mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="h-4 w-4 text-[#77966D]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Unit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">New {programme.toUpperCase()} Unit</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Title *</label>
              <input
                type="text"
                className={INPUT_CLS}
                placeholder="Unit title"
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Batch</label>
              <Select
                value={createForm.batch_id}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, batch_id: v, poi_entry_id: "" }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {programme === "pyp" && createForm.batch_id && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  POI Entry (optional)
                </label>
                <Select
                  value={createForm.poi_entry_id}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, poi_entry_id: v }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Link to POI entry" />
                  </SelectTrigger>
                  <SelectContent>
                    {poiEntriesForBatch(createForm.batch_id).map((pe) => (
                      <SelectItem key={pe.id} value={pe.id}>
                        {pe.central_idea ? pe.central_idea.slice(0, 60) + (pe.central_idea.length > 60 ? "..." : "") : `Entry ${pe.id.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Subject Focus
              </label>
              <input
                type="text"
                className={INPUT_CLS}
                placeholder="e.g. Science, Language, Mathematics"
                value={createForm.subject_focus}
                onChange={(e) => setCreateForm((f) => ({ ...f, subject_focus: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={createForm.start_date}
                  onChange={(e) => setCreateForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  className={INPUT_CLS}
                  value={createForm.end_date}
                  onChange={(e) => setCreateForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-[#77966D] hover:bg-[#6a8861] text-white"
              onClick={handleCreate}
              disabled={creating || !createForm.title.trim()}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UnitPlanner;
