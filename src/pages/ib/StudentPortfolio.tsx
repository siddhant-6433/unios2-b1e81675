import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
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
  Loader2, Plus, LayoutGrid, List, Filter, ChevronDown, ChevronUp,
  FileText, Image, Video, Presentation, File, Lightbulb, User,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface StudentInfo {
  id: string;
  name: string;
  admission_no: string | null;
  batch_id: string | null;
  batch_name: string | null;
}

interface PortfolioEntry {
  id: string;
  student_id: string;
  title: string;
  description: string | null;
  entry_type: string;
  file_url: string | null;
  atl_skills: string[];
  learner_profile_tags: string[];
  key_concepts: string[];
  visibility: string;
  teacher_comment: string | null;
  created_at: string;
  created_by: string | null;
}

const ENTRY_TYPES = [
  "artifact", "reflection", "photo", "video", "document", "presentation",
] as const;

const LEARNER_PROFILES = [
  "Inquirers", "Knowledgeable", "Thinkers", "Communicators", "Principled",
  "Open-minded", "Caring", "Risk-takers", "Balanced", "Reflective",
];

const ATL_SKILL_CATEGORIES = [
  { category: "Thinking", skills: ["Critical thinking", "Creative thinking", "Transfer"] },
  { category: "Social", skills: ["Collaboration"] },
  { category: "Communication", skills: ["Communication"] },
  { category: "Self-management", skills: ["Organisation", "Affective", "Reflection"] },
  { category: "Research", skills: ["Information literacy", "Media literacy"] },
];

const KEY_CONCEPTS = [
  "Form", "Function", "Causation", "Change", "Connection",
  "Perspective", "Responsibility", "Reflection",
];

const ENTRY_TYPE_ICONS: Record<string, typeof FileText> = {
  artifact: Lightbulb,
  reflection: FileText,
  photo: Image,
  video: Video,
  document: File,
  presentation: Presentation,
};

const ENTRY_TYPE_COLORS: Record<string, string> = {
  artifact: "bg-pastel-purple text-foreground/70",
  reflection: "bg-pastel-blue text-foreground/70",
  photo: "bg-pastel-green text-foreground/70",
  video: "bg-pastel-red text-foreground/70",
  document: "bg-pastel-yellow text-foreground/70",
  presentation: "bg-pastel-orange text-foreground/70",
};

const INPUT_CLASS = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ────────────────────────────────────────────────────────────────

const StudentPortfolio = () => {
  const { studentId } = useParams<{ studentId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"timeline" | "gallery">("timeline");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<string>("all");
  const [filterAtl, setFilterAtl] = useState<string>("all");
  const [filterLp, setFilterLp] = useState<string>("all");
  const [filterConcept, setFilterConcept] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Add Entry dialog
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [entryType, setEntryType] = useState<string>("artifact");
  const [entryFileUrl, setEntryFileUrl] = useState("");
  const [entryAtlSkills, setEntryAtlSkills] = useState<string[]>([]);
  const [entryLpTags, setEntryLpTags] = useState<string[]>([]);
  const [entryKeyConcepts, setEntryKeyConcepts] = useState<string[]>([]);
  const [entryVisibility, setEntryVisibility] = useState<string>("teachers");

  // ── Fetch student + entries ────────────────────────────────────────────────

  useEffect(() => {
    if (!studentId) return;
    (async () => {
      setLoading(true);
      const [studentRes, entriesRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, name, admission_no, batch_id, batches(name)")
          .eq("id", studentId)
          .single(),
        (supabase as any)
          .from("ib_portfolio_entries")
          .select("*")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false }),
      ]);

      if (studentRes.data) {
        const s = studentRes.data as any;
        setStudent({
          id: s.id,
          name: s.name,
          admission_no: s.admission_no,
          batch_id: s.batch_id,
          batch_name: s.batches?.name || null,
        });
      }
      setEntries(entriesRes.data || []);
      setLoading(false);
    })();
  }, [studentId]);

  // ── LP progress ────────────────────────────────────────────────────────────

  const lpProgress = useMemo(() => {
    const counts: Record<string, number> = {};
    LEARNER_PROFILES.forEach((lp) => (counts[lp] = 0));
    entries.forEach((e) => {
      (e.learner_profile_tags || []).forEach((tag) => {
        if (counts[tag] !== undefined) counts[tag] += 1;
      });
    });
    return counts;
  }, [entries]);

  const maxLpCount = Math.max(1, ...Object.values(lpProgress));

  // ── Filtered entries ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterType !== "all" && e.entry_type !== filterType) return false;
      if (filterAtl !== "all" && !(e.atl_skills || []).includes(filterAtl)) return false;
      if (filterLp !== "all" && !(e.learner_profile_tags || []).includes(filterLp)) return false;
      if (filterConcept !== "all" && !(e.key_concepts || []).includes(filterConcept)) return false;
      return true;
    });
  }, [entries, filterType, filterAtl, filterLp, filterConcept]);

  // ── Add entry ──────────────────────────────────────────────────────────────

  const handleAddEntry = async () => {
    if (!entryTitle) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("ib_portfolio_entries").insert({
      student_id: studentId,
      title: entryTitle,
      description: entryDescription,
      entry_type: entryType,
      file_url: entryFileUrl || null,
      atl_skills: entryAtlSkills,
      learner_profile_tags: entryLpTags,
      key_concepts: entryKeyConcepts,
      visibility: entryVisibility,
      created_by: user?.id,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Failed to add entry", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Portfolio entry added" });
      setShowAdd(false);
      resetForm();
      // Refresh entries
      const { data } = await (supabase as any)
        .from("ib_portfolio_entries")
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      setEntries(data || []);
    }
  };

  const resetForm = () => {
    setEntryTitle("");
    setEntryDescription("");
    setEntryType("artifact");
    setEntryFileUrl("");
    setEntryAtlSkills([]);
    setEntryLpTags([]);
    setEntryKeyConcepts([]);
    setEntryVisibility("teachers");
  };

  const toggleTag = (list: string[], setList: (v: string[]) => void, tag: string) => {
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!student) {
    return <div className="text-center py-20 text-muted-foreground">Student not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Student header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
            {student.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{student.name}</h1>
            <p className="text-sm text-muted-foreground">
              {student.admission_no && <span>{student.admission_no} &middot; </span>}
              {student.batch_name || "No batch"}
              <span className="ml-2 text-xs">&middot; {entries.length} entries</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === "timeline" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setView("timeline")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "gallery" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setView("gallery")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button onClick={() => setShowAdd(true)} className="rounded-xl gap-2">
            <Plus className="h-4 w-4" /> Add Entry
          </Button>
        </div>
      </div>

      {/* Learner Profile progress */}
      <Card className="rounded-xl border-border bg-card">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Learner Profile Progress</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {LEARNER_PROFILES.map((lp) => (
              <div key={lp} className="text-center">
                <div className="relative mx-auto h-10 w-10 mb-1">
                  <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                    <circle
                      cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
                      className="text-primary"
                      strokeDasharray={`${(lpProgress[lp] / maxLpCount) * 94.25} 94.25`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
                    {lpProgress[lp]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-tight">{lp}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
        {(filterType !== "all" || filterAtl !== "all" || filterLp !== "all" || filterConcept !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl text-xs"
            onClick={() => { setFilterType("all"); setFilterAtl("all"); setFilterLp("all"); setFilterConcept("all"); }}
          >
            Clear filters
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} entries</span>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="rounded-xl text-sm">
              <SelectValue placeholder="Entry type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ENTRY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterAtl} onValueChange={setFilterAtl}>
            <SelectTrigger className="rounded-xl text-sm">
              <SelectValue placeholder="ATL Skill" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ATL skills</SelectItem>
              {ATL_SKILL_CATEGORIES.flatMap((c) =>
                c.skills.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>),
              )}
            </SelectContent>
          </Select>
          <Select value={filterLp} onValueChange={setFilterLp}>
            <SelectTrigger className="rounded-xl text-sm">
              <SelectValue placeholder="Learner Profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All LP attributes</SelectItem>
              {LEARNER_PROFILES.map((lp) => (
                <SelectItem key={lp} value={lp}>{lp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterConcept} onValueChange={setFilterConcept}>
            <SelectTrigger className="rounded-xl text-sm">
              <SelectValue placeholder="Key Concept" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All concepts</SelectItem>
              {KEY_CONCEPTS.map((kc) => (
                <SelectItem key={kc} value={kc}>{kc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Entries list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No portfolio entries yet</p>
        </div>
      ) : view === "timeline" ? (
        <div className="space-y-3">
          {filtered.map((e) => {
            const Icon = ENTRY_TYPE_ICONS[e.entry_type] || FileText;
            const isExpanded = expandedId === e.id;
            return (
              <Card
                key={e.id}
                className="rounded-xl border-border bg-card cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setExpandedId(isExpanded ? null : e.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${ENTRY_TYPE_COLORS[e.entry_type] || "bg-muted"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium text-foreground">{e.title}</h4>
                        <Badge variant="outline" className="text-xs rounded-lg capitalize">{e.entry_type}</Badge>
                      </div>
                      {!isExpanded && e.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{e.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(e.key_concepts || []).map((kc) => (
                          <Badge key={kc} variant="secondary" className="text-[10px] rounded-md">{kc}</Badge>
                        ))}
                        {(e.atl_skills || []).map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px] rounded-md bg-primary/10 text-primary">{s}</Badge>
                        ))}
                        {(e.learner_profile_tags || []).map((lp) => (
                          <Badge key={lp} variant="secondary" className="text-[10px] rounded-md bg-chart-2/10 text-chart-2">{lp}</Badge>
                        ))}
                      </div>

                      {isExpanded && (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          {e.description && (
                            <p className="text-sm text-foreground whitespace-pre-wrap">{e.description}</p>
                          )}
                          {e.teacher_comment && (
                            <div className="bg-muted/50 rounded-lg p-3">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Teacher Comment</p>
                              <p className="text-sm text-foreground">{e.teacher_comment}</p>
                            </div>
                          )}
                          {e.file_url && (
                            <a
                              href={e.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary underline"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              View attached file
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Gallery view */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => {
            const Icon = ENTRY_TYPE_ICONS[e.entry_type] || FileText;
            return (
              <Card
                key={e.id}
                className="rounded-xl border-border bg-card hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${ENTRY_TYPE_COLORS[e.entry_type] || "bg-muted"}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <Badge variant="outline" className="text-xs rounded-lg capitalize">{e.entry_type}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h4 className="font-medium text-foreground text-sm">{e.title}</h4>
                  {e.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{e.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {(e.learner_profile_tags || []).slice(0, 3).map((lp) => (
                      <Badge key={lp} variant="secondary" className="text-[10px] rounded-md">{lp}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add Entry Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>Add Portfolio Entry</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Title</label>
              <input className={INPUT_CLASS} value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="Entry title" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Description</label>
              <textarea className={`${INPUT_CLASS} min-h-[80px] resize-y`} value={entryDescription} onChange={(e) => setEntryDescription(e.target.value)} placeholder="Describe this entry..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Entry Type</label>
              <Select value={entryType} onValueChange={setEntryType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTRY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">File URL</label>
              <input className={INPUT_CLASS} value={entryFileUrl} onChange={(e) => setEntryFileUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">ATL Skills</label>
              <div className="flex flex-wrap gap-1.5">
                {ATL_SKILL_CATEGORIES.flatMap((c) =>
                  c.skills.map((skill) => (
                    <Badge
                      key={skill}
                      variant={entryAtlSkills.includes(skill) ? "default" : "outline"}
                      className="cursor-pointer text-xs rounded-lg"
                      onClick={() => toggleTag(entryAtlSkills, setEntryAtlSkills, skill)}
                    >
                      {skill}
                    </Badge>
                  )),
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Learner Profile</label>
              <div className="flex flex-wrap gap-1.5">
                {LEARNER_PROFILES.map((lp) => (
                  <Badge
                    key={lp}
                    variant={entryLpTags.includes(lp) ? "default" : "outline"}
                    className="cursor-pointer text-xs rounded-lg"
                    onClick={() => toggleTag(entryLpTags, setEntryLpTags, lp)}
                  >
                    {lp}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Key Concepts</label>
              <div className="flex flex-wrap gap-1.5">
                {KEY_CONCEPTS.map((kc) => (
                  <Badge
                    key={kc}
                    variant={entryKeyConcepts.includes(kc) ? "default" : "outline"}
                    className="cursor-pointer text-xs rounded-lg"
                    onClick={() => toggleTag(entryKeyConcepts, setEntryKeyConcepts, kc)}
                  >
                    {kc}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Visibility</label>
              <Select value={entryVisibility} onValueChange={setEntryVisibility}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="teachers">Teachers Only</SelectItem>
                  <SelectItem value="parents">Parents & Teachers</SelectItem>
                  <SelectItem value="student">Student, Parents & Teachers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button className="rounded-xl gap-2" onClick={handleAddEntry} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentPortfolio;
