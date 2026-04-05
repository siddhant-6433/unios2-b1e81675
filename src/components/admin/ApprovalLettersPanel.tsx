import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Plus, FileText, ExternalLink, Trash2, Search } from "lucide-react";

interface Letter {
  id: string;
  name: string;
  slug: string;
  issue_date: string | null;
  academic_session: string;
  institution_name: string;
  file_url: string;
  approval_body_name?: string;
  course_names?: string[];
}

interface ApprovalBody {
  id: string;
  name: string;
  short_name: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
}

export default function ApprovalLettersPanel() {
  const { toast } = useToast();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [bodies, setBodies] = useState<ApprovalBody[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterBody, setFilterBody] = useState("all");
  const [filterCourse, setFilterCourse] = useState("all");
  const [filterInstitution, setFilterInstitution] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "", body_id: "", issue_date: "", session: "",
    institution: "", file_url: "", course_ids: [] as string[],
  });

  const fetchAll = async () => {
    setLoading(true);
    const [lettersRes, bodiesRes, coursesRes] = await Promise.all([
      supabase.from("approval_letters" as any).select("*, approval_bodies:approval_body_id(name, short_name)").order("issue_date", { ascending: false }).limit(500),
      supabase.from("approval_bodies" as any).select("id, name, short_name").order("name"),
      supabase.from("courses").select("id, name, code").order("name"),
    ]);

    if (lettersRes.data) {
      // Fetch course links
      const letterIds = (lettersRes.data as any[]).map(l => l.id);
      const { data: links } = await supabase
        .from("approval_letter_courses" as any)
        .select("letter_id, courses:course_id(name)")
        .in("letter_id", letterIds);

      const linkMap: Record<string, string[]> = {};
      (links || []).forEach((l: any) => {
        if (!linkMap[l.letter_id]) linkMap[l.letter_id] = [];
        linkMap[l.letter_id].push(l.courses?.name || "—");
      });

      setLetters((lettersRes.data as any[]).map(l => ({
        ...l,
        approval_body_name: (l.approval_bodies as any)?.short_name || (l.approval_bodies as any)?.name || "—",
        course_names: linkMap[l.id] || [],
      })));
    }
    if (bodiesRes.data) setBodies(bodiesRes.data as any);
    if (coursesRes.data) setCourses(coursesRes.data as any);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    if (!form.name.trim() || !form.file_url.trim()) return;
    setSaving(true);

    const { data: letter, error } = await supabase.from("approval_letters" as any).insert({
      name: form.name.trim(),
      slug: form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      approval_body_id: form.body_id || null,
      issue_date: form.issue_date || null,
      academic_session: form.session || null,
      institution_name: form.institution || null,
      file_url: form.file_url.trim(),
    } as any).select("id").single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Link courses
    if (letter && form.course_ids.length > 0) {
      await supabase.from("approval_letter_courses" as any).insert(
        form.course_ids.map(cid => ({ letter_id: (letter as any).id, course_id: cid })) as any
      );
    }

    toast({ title: "Letter added" });
    setForm({ name: "", body_id: "", issue_date: "", session: "", institution: "", file_url: "", course_ids: [] });
    setShowAdd(false);
    setSaving(false);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("approval_letters" as any).delete().eq("id", id);
    toast({ title: "Letter deleted" });
    fetchAll();
  };

  // Extract unique institutions for filter
  const institutions = [...new Set(letters.map(l => l.institution_name).filter(Boolean))].sort();

  // Extract unique course names across all letters
  const allCourseNames = [...new Set(letters.flatMap(l => l.course_names || []))].sort();

  const filtered = letters.filter(l => {
    const matchSearch = !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      (l.approval_body_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (l.academic_session || "").includes(search);
    const matchBody = filterBody === "all" || l.approval_body_name === filterBody;
    const matchCourse = filterCourse === "all" || (l.course_names || []).some(cn => cn === filterCourse);
    const matchInst = filterInstitution === "all" || l.institution_name === filterInstitution;
    return matchSearch && matchBody && matchCourse && matchInst;
  });

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search letters..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{filtered.length}/{letters.length} letters</Badge>
          <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" />Add Letter</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={filterBody} onChange={e => setFilterBody(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Bodies ({bodies.length})</option>
          {bodies.map(b => <option key={b.id} value={b.short_name}>{b.short_name} — {b.name}</option>)}
        </select>
        <select value={filterCourse} onChange={e => setFilterCourse(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Courses</option>
          {allCourseNames.map(cn => <option key={cn} value={cn}>{cn}</option>)}
        </select>
        <select value={filterInstitution} onChange={e => setFilterInstitution(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Institutions</option>
          {institutions.map(inst => <option key={inst} value={inst}>{(inst || "").replace(/-/g, " ")}</option>)}
        </select>
        {(filterBody !== "all" || filterCourse !== "all" || filterInstitution !== "all") && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setFilterBody("all"); setFilterCourse("all"); setFilterInstitution("all"); }}>
            Clear Filters
          </Button>
        )}
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Letter</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Body</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Session</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Courses</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(l => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground text-xs">{l.name}</div>
                    <div className="text-[10px] text-muted-foreground">{l.institution_name?.replace(/-/g, " ")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className="text-[10px] border-0 bg-blue-100 text-blue-700">{l.approval_body_name}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.academic_session || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(l.course_names || []).slice(0, 3).map((cn, i) => (
                        <Badge key={i} variant="outline" className="text-[9px]">{cn.length > 20 ? cn.slice(0, 20) + "..." : cn}</Badge>
                      ))}
                      {(l.course_names || []).length > 3 && <Badge variant="outline" className="text-[9px]">+{(l.course_names || []).length - 3}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {l.file_url && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => window.open(l.file_url, "_blank")}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => handleDelete(l.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No letters found</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Add Letter Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Approval Letter</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Letter Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. AICTE Approval 2024-25" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Issuing Body</label>
                <select value={form.body_id} onChange={e => setForm(p => ({ ...p, body_id: e.target.value }))} className={inputCls}>
                  <option value="">Select body</option>
                  {bodies.map(b => <option key={b.id} value={b.id}>{b.short_name} — {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Academic Session</label>
                <input value={form.session} onChange={e => setForm(p => ({ ...p, session: e.target.value }))} placeholder="2024-2025" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Issue Date</label>
                <input type="date" value={form.issue_date} onChange={e => setForm(p => ({ ...p, issue_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Institution</label>
                <input value={form.institution} onChange={e => setForm(p => ({ ...p, institution: e.target.value }))} placeholder="e.g. NIMT Greater Noida" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">File URL *</label>
              <input value={form.file_url} onChange={e => setForm(p => ({ ...p, file_url: e.target.value }))} placeholder="https://..." className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Tag Courses (hold Ctrl/Cmd to multi-select)</label>
              <select multiple value={form.course_ids} onChange={e => setForm(p => ({ ...p, course_ids: Array.from(e.target.selectedOptions, o => o.value) }))}
                className={`${inputCls} min-h-[120px]`}>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.file_url.trim() || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Add Letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
