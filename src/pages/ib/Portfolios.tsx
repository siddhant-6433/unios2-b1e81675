import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  Search, Plus, Loader2, FolderOpen, User, Calendar,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  name: string;
}

interface Student {
  id: string;
  name: string;
  admission_no: string | null;
}

interface StudentWithCount extends Student {
  entryCount: number;
  lastEntryDate: string | null;
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

const INPUT_CLASS = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

// ── Component ────────────────────────────────────────────────────────────────

const Portfolios = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState<string>("");
  const [students, setStudents] = useState<StudentWithCount[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Add Entry dialog
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryStudentId, setEntryStudentId] = useState("");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [entryType, setEntryType] = useState<string>("artifact");
  const [entryFileUrl, setEntryFileUrl] = useState("");
  const [entryAtlSkills, setEntryAtlSkills] = useState<string[]>([]);
  const [entryLpTags, setEntryLpTags] = useState<string[]>([]);
  const [entryKeyConcepts, setEntryKeyConcepts] = useState<string[]>([]);
  const [entryVisibility, setEntryVisibility] = useState<string>("teachers");

  // ── Fetch batches ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("batches").select("id, name").order("name");
      if (data && data.length) {
        setBatches(data);
        setBatchId(data[0].id);
      }
      setLoading(false);
    })();
  }, []);

  // ── Fetch students + portfolio counts ──────────────────────────────────────

  useEffect(() => {
    if (!batchId) return;
    (async () => {
      setLoading(true);
      const { data: studs } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .eq("batch_id", batchId)
        .eq("status", "active")
        .order("name");

      if (!studs || !studs.length) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const ids = studs.map((s) => s.id);
      const { data: entries } = await (supabase as any)
        .from("ib_portfolio_entries")
        .select("student_id, id, created_at")
        .in("student_id", ids);

      const countMap: Record<string, { count: number; last: string | null }> = {};
      (entries || []).forEach((e: any) => {
        if (!countMap[e.student_id]) countMap[e.student_id] = { count: 0, last: null };
        countMap[e.student_id].count += 1;
        if (!countMap[e.student_id].last || e.created_at > countMap[e.student_id].last!)
          countMap[e.student_id].last = e.created_at;
      });

      setStudents(
        studs.map((s) => ({
          ...s,
          entryCount: countMap[s.id]?.count || 0,
          lastEntryDate: countMap[s.id]?.last || null,
        })),
      );
      setLoading(false);
    })();
  }, [batchId]);

  // ── Add entry ──────────────────────────────────────────────────────────────

  const handleAddEntry = async () => {
    if (!entryStudentId || !entryTitle) {
      toast({ title: "Student and title are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("ib_portfolio_entries").insert({
      student_id: entryStudentId,
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
      // refresh
      setBatchId((prev) => prev);
    }
  };

  const resetForm = () => {
    setEntryStudentId("");
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

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.admission_no || "").toLowerCase().includes(search.toLowerCase()),
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Student Portfolios</h1>
          <p className="text-sm text-muted-foreground mt-1">IB PYP/MYP class portfolio overview</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="rounded-xl gap-2">
          <Plus className="h-4 w-4" /> Add Entry
        </Button>
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger className="w-full sm:w-64 rounded-xl">
            <SelectValue placeholder="Select batch" />
          </SelectTrigger>
          <SelectContent>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className={`${INPUT_CLASS} pl-9`}
            placeholder="Search students..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Student grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No students found in this batch</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <Card
              key={s.id}
              className="rounded-xl border-border bg-card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/ib/portfolios/${s.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0">
                    {s.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{s.name}</p>
                    {s.admission_no && (
                      <p className="text-xs text-muted-foreground">{s.admission_no}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>{s.entryCount} {s.entryCount === 1 ? "entry" : "entries"}</span>
                  </div>
                  {s.lastEntryDate && (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <Calendar className="h-3 w-3" />
                      <span>{new Date(s.lastEntryDate).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Add Entry Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>Add Portfolio Entry</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Student selector */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Student</label>
              <Select value={entryStudentId} onValueChange={setEntryStudentId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Title</label>
              <input className={INPUT_CLASS} value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="Entry title" />
            </div>

            {/* Description */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Description</label>
              <textarea className={`${INPUT_CLASS} min-h-[80px] resize-y`} value={entryDescription} onChange={(e) => setEntryDescription(e.target.value)} placeholder="Describe this entry..." />
            </div>

            {/* Entry type */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Entry Type</label>
              <Select value={entryType} onValueChange={setEntryType}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* File URL */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">File URL</label>
              <input className={INPUT_CLASS} value={entryFileUrl} onChange={(e) => setEntryFileUrl(e.target.value)} placeholder="https://..." />
            </div>

            {/* ATL Skills */}
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

            {/* Learner Profile */}
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

            {/* Key Concepts */}
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

            {/* Visibility */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Visibility</label>
              <Select value={entryVisibility} onValueChange={setEntryVisibility}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
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

export default Portfolios;
