import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/state-fields";
import { Plus, FileText, ExternalLink, Trash2, Search, Upload, CloudUpload } from "lucide-react";

const R2_HOST = "r2.dev";
const isR2Url = (url: string | null | undefined) => !!url && url.includes(R2_HOST);

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
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [migratingId, setMigratingId] = useState<string | null>(null);
  const [bulkMigrating, setBulkMigrating] = useState(false);

  const [form, setForm] = useState({
    name: "", body_id: "", issue_date: "", sessions: [] as string[],
    institution: "", file_url: "", course_ids: [] as string[],
  });

  const sessionOptions = (() => {
    const years: string[] = [];
    const currentYear = new Date().getFullYear();
    for (let y = currentYear + 3; y >= 1990; y--) {
      years.push(`${y}-${y + 1}`);
    }
    return years;
  })();

  const invokeR2 = async (body: FormData | Record<string, unknown>): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("r2-upload", { body });
    if (error) {
      // Try to read the actual response body to surface the server error message
      let detail = error.message || "";
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const j = await ctx.json();
          if (j?.error) detail = j.error;
        } catch { /* ignore */ }
      } else if (ctx && typeof ctx.text === "function") {
        try {
          const t = await ctx.text();
          if (t) detail = t;
        } catch { /* ignore */ }
      }
      console.error("[r2-upload] invoke error:", error, "detail:", detail);
      throw new Error(detail || "Upload failed");
    }
    if (!data?.url) {
      console.error("[r2-upload] no url in response:", data);
      throw new Error(data?.error || "Upload returned no URL");
    }
    return data.url as string;
  };

  const uploadFileToR2 = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("prefix", "letters");
    return invokeR2(fd);
  };

  const migrateUrlToR2 = async (sourceUrl: string, filenameHint?: string): Promise<string> => {
    return invokeR2({ source_url: sourceUrl, filename: filenameHint, prefix: "letters" });
  };

  const handleMigrate = async (letter: Letter) => {
    if (!letter.file_url || isR2Url(letter.file_url)) return;
    setMigratingId(letter.id);
    try {
      const newUrl = await migrateUrlToR2(letter.file_url, letter.slug || letter.name);
      const { error } = await supabase.from("approval_letters" as any).update({ file_url: newUrl } as any).eq("id", letter.id);
      if (error) throw error;
      toast({ title: "Migrated to R2" });
      setLetters(prev => prev.map(l => l.id === letter.id ? { ...l, file_url: newUrl } : l));
    } catch (err: any) {
      toast({ title: "Migration failed", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setMigratingId(null);
    }
  };

  const handleBulkMigrate = async () => {
    const targets = letters.filter(l => l.file_url && !isR2Url(l.file_url));
    if (targets.length === 0) {
      toast({ title: "Nothing to migrate", description: "All letters already on R2." });
      return;
    }
    setBulkMigrating(true);
    let ok = 0, fail = 0;
    let firstErr = "";
    for (const l of targets) {
      try {
        const newUrl = await migrateUrlToR2(l.file_url, l.slug || l.name);
        const { error } = await supabase.from("approval_letters" as any).update({ file_url: newUrl } as any).eq("id", l.id);
        if (error) throw error;
        setLetters(prev => prev.map(x => x.id === l.id ? { ...x, file_url: newUrl } : x));
        ok++;
      } catch (err: any) {
        console.error("[bulk migrate] failed for", l.id, l.file_url, err);
        if (!firstErr) firstErr = err?.message || String(err);
        fail++;
      }
    }
    setBulkMigrating(false);
    toast({
      title: `Migrated ${ok}/${targets.length}`,
      description: fail ? `${fail} failed: ${firstErr}` : undefined,
      variant: fail ? "destructive" : "default",
    });
  };

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
    if (!form.name.trim()) return;
    if (!pendingFile && !form.file_url.trim()) {
      toast({ title: "Add a file or URL", variant: "destructive" });
      return;
    }
    setSaving(true);

    let fileUrl = form.file_url.trim();
    if (pendingFile) {
      setUploadingFile(true);
      try {
        fileUrl = await uploadFileToR2(pendingFile);
      } catch (err: any) {
        toast({ title: "Upload failed", description: err?.message || String(err), variant: "destructive" });
        setUploadingFile(false);
        setSaving(false);
        return;
      }
      setUploadingFile(false);
    }

    const { data: letter, error } = await supabase.from("approval_letters" as any).insert({
      name: form.name.trim(),
      slug: form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      approval_body_id: form.body_id || null,
      issue_date: form.issue_date || null,
      academic_session: form.sessions.length > 0 ? form.sessions.join(", ") : null,
      institution_name: form.institution || null,
      file_url: fileUrl,
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
    setForm({ name: "", body_id: "", issue_date: "", sessions: [], institution: "", file_url: "", course_ids: [] });
    setPendingFile(null);
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

  if (loading) return <PageLoader />;

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
          {letters.some(l => l.file_url && !isR2Url(l.file_url)) && (
            <Button variant="outline" onClick={handleBulkMigrate} disabled={bulkMigrating} className="gap-2">
              {bulkMigrating ? <ButtonOrb state="working" /> : <CloudUpload className="h-4 w-4" />}
              Migrate {letters.filter(l => l.file_url && !isR2Url(l.file_url)).length} to R2
            </Button>
          )}
          <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" />Add Letter</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <SelectField
          value={filterBody}
          onValueChange={setFilterBody}
          options={[
            { value: "all", label: `All Bodies (${bodies.length})` },
            ...bodies.map(b => ({ value: b.short_name, label: `${b.short_name} — ${b.name}` })),
          ]}
          hideLabel
          placeholder={`All Bodies (${bodies.length})`}
        />
        <SelectField
          value={filterCourse}
          onValueChange={setFilterCourse}
          options={[
            { value: "all", label: "All Courses" },
            ...allCourseNames.map(cn => ({ value: cn, label: cn })),
          ]}
          hideLabel
          placeholder="All Courses"
        />
        <SelectField
          value={filterInstitution}
          onValueChange={setFilterInstitution}
          options={[
            { value: "all", label: "All Institutions" },
            ...institutions.map(inst => ({ value: inst, label: (inst || "").replace(/-/g, " ") })),
          ]}
          hideLabel
          placeholder="All Institutions"
        />
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
                    <Badge className="text-[10px] border-0 bg-info/10 text-info-foreground">{l.approval_body_name}</Badge>
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
                      {l.file_url && !isR2Url(l.file_url) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-info-foreground"
                          title="Migrate to R2"
                          disabled={migratingId === l.id || bulkMigrating}
                          onClick={() => handleMigrate(l)}
                        >
                          {migratingId === l.id ? <ButtonOrb state="working" /> : <CloudUpload className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(l.id)}>
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
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Issue Date</label>
                <input type="date" value={form.issue_date} onChange={e => setForm(p => ({ ...p, issue_date: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Institution</label>
              <select value={form.institution} onChange={e => setForm(p => ({ ...p, institution: e.target.value }))} className={inputCls}>
                <option value="">Select institution</option>
                {institutions.map(inst => (
                  <option key={inst} value={inst}>{(inst || "").replace(/-/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Academic Sessions {form.sessions.length > 0 && <span className="text-foreground">({form.sessions.length} selected)</span>}
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                {form.sessions.length === 0 && <span className="text-[10px] text-muted-foreground italic">No sessions selected</span>}
                {form.sessions.map(s => (
                  <Badge key={s} variant="outline" className="text-[10px] gap-1 pr-1">
                    {s}
                    <button
                      type="button"
                      onClick={() => setForm(p => ({ ...p, sessions: p.sessions.filter(x => x !== s) }))}
                      className="hover:text-destructive"
                      aria-label={`Remove ${s}`}
                    >×</button>
                  </Badge>
                ))}
              </div>
              <select
                value=""
                onChange={e => {
                  const v = e.target.value;
                  if (v && !form.sessions.includes(v)) {
                    setForm(p => ({ ...p, sessions: [...p.sessions, v] }));
                  }
                }}
                className={inputCls}
              >
                <option value="">+ Add session...</option>
                {sessionOptions.filter(s => !form.sessions.includes(s)).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-muted-foreground">File *</label>
              <label className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-input bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors ${pendingFile ? "text-foreground" : "text-muted-foreground"}`}>
                <Upload className="h-4 w-4 flex-shrink-0" />
                <span className="text-xs truncate flex-1">
                  {pendingFile ? pendingFile.name : "Choose PDF or image to upload to R2"}
                </span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setPendingFile(f);
                    if (f) setForm(p => ({ ...p, file_url: "" }));
                  }}
                  className="hidden"
                />
              </label>
              {pendingFile && (
                <button type="button" onClick={() => setPendingFile(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline">
                  Remove file
                </button>
              )}
              <div className="text-[10px] text-muted-foreground">Or paste an existing URL:</div>
              <input
                value={form.file_url}
                onChange={e => setForm(p => ({ ...p, file_url: e.target.value }))}
                placeholder="https://..."
                disabled={!!pendingFile}
                className={`${inputCls} ${pendingFile ? "opacity-50" : ""}`}
              />
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
            <Button onClick={handleSave} disabled={!form.name.trim() || (!pendingFile && !form.file_url.trim()) || saving} className="gap-1.5">
              {saving ? <ButtonOrb state="working" onFilled /> : <FileText className="h-4 w-4" />}
              {uploadingFile ? "Uploading..." : "Add Letter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
