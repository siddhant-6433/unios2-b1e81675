import { PageLoader } from "@/components/ui/page-loader";
import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Edit, Trash2, Mail, MessageSquare, Eye, RefreshCw, Send, CheckCircle, Clock, XCircle, AlertTriangle,
  GraduationCap, Save, Filter,
} from "lucide-react";
import { cahetDeadlineDescription } from "@/lib/deadlineRollover";
import { WhatsAppTemplateTab } from "@/components/templates/WhatsAppTemplateTab";

// ── WhatsApp Template (from Meta API) ──
interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: any[];
}

// ── Email Templates (DB-managed) ──
interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string;
  body_html: string;
  variables: string[];
  category: string;
  is_active: boolean;
  created_at: string;
}

const CATEGORIES = [
  { value: "offer_letter", label: "Offer Letter" },
  { value: "fee_receipt", label: "Fee Receipt" },
  { value: "admission_confirmation", label: "Admission Confirmation" },
  { value: "general", label: "General" },
  { value: "reminder", label: "Reminder" },
  { value: "notification", label: "Counsellor Notification" },
];

const displayNameForWaTemplate = (key: string) =>
  key
    .split("_")
    .filter(Boolean)
    .map((part) => part.length <= 4 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const TemplateManager = () => {
  const { toast } = useToast();
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [saving, setSaving] = useState(false);

  // Email form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formVariables, setFormVariables] = useState("");

  // ── Course Data tab state ────────────────────────────────────────────────
  // Fields that flow into the course_info_v1 WhatsApp template body via
  // fn_resolve_course_info_params. Admins edit them here so the resolver
  // pulls the right text without anyone having to touch SQL.
  type CourseRow = {
    id: string;
    code: string;
    name: string;
    duration_years: number | null;
    type: string | null;
    marketing_eligibility: string | null;
    video_url: string | null;
    slug: string | null;
    maps_cid: string | null;
  };
  const [courseRows, setCourseRows] = useState<CourseRow[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [courseEdits, setCourseEdits] = useState<Record<string, Partial<CourseRow>>>({});
  const [savingCourseId, setSavingCourseId] = useState<string | null>(null);
  const [coursePreview, setCoursePreview] = useState<{ courseName: string; rendered: string } | null>(null);

  const fetchCourses = async () => {
    setCoursesLoading(true);
    const { data, error } = await (supabase as any)
      .from("courses")
      .select("id, code, name, duration_years, type, marketing_eligibility, video_url, slug, maps_cid")
      .order("code");
    if (!error && data) setCourseRows(data as CourseRow[]);
    setCoursesLoading(false);
  };

  const saveCourse = async (id: string) => {
    const edits = courseEdits[id];
    if (!edits) return;
    setSavingCourseId(id);
    const { error } = await (supabase as any).from("courses").update(edits).eq("id", id);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setCourseRows(prev => prev.map(c => (c.id === id ? { ...c, ...edits } : c)));
      setCourseEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast({ title: "Course updated" });
    }
    setSavingCourseId(null);
  };

  // Preview what course_info_v1 will look like for a given course — calls the
  // resolver RPC with a fake lead (we attach the course_id to a transient
  // representative lead via a wrapper RPC). Simpler: just show the resolver
  // output by attaching a real lead temporarily isn't ideal. Instead we
  // render client-side from the edited fields so previews work without round-tripping.
  const previewCourseTemplate = (c: CourseRow) => {
    const e = courseEdits[c.id] || {};
    const merged = { ...c, ...e } as CourseRow;
    const duration = merged.duration_years
      ? `${merged.duration_years} year${merged.duration_years === 1 ? "" : "s"} (${merged.type || "—"})`
      : "—";
    const eligibility = merged.marketing_eligibility || "(falls back to eligibility_rules.notes)";
    const courseUrl = merged.slug
      ? `https://www.nimt.ac.in/courses/${merged.slug}#admissions`
      : "https://www.nimt.ac.in/courses";
    const videoUrl = merged.video_url || courseUrl;
    const rendered =
`Hi <student>, here are the details for ${merged.name} at NIMT:
• Duration: ${duration}
• Eligibility: ${eligibility}
• Accreditation: (resolved from approval_letters)

Buttons:
  ▶ Watch course video → ${videoUrl}
  ▶ View fees & apply → ${courseUrl}`;
    setCoursePreview({ courseName: merged.name, rendered });
  };

  useEffect(() => { fetchCourses(); }, []);

  // ── Template Visibility tab state ────────────────────────────────────────
  // whatsapp_template_settings.show_in_lead_picker is the curated list for every
  // counsellor-facing picker: lead page, cloud dialer and WhatsApp inbox replies
  // all read it through src/lib/whatsappTemplateCatalog.
  type WaSetting = {
    template_key: string;
    display_name: string;
    description: string | null;
    category: string | null;
    show_in_lead_picker: boolean;
    created_at: string | null;
    updated_at: string | null;
    last_used_at?: string | null;
    /** Sendable header media URL; required when header_format is IMAGE/VIDEO/DOCUMENT. */
    media_url?: string | null;
    header_format?: string | null;
  };
  type WaVisibilitySort = "date_added_desc" | "date_added_asc" | "date_used_desc" | "date_used_asc" | "name_asc" | "name_desc";
  const [waSettings, setWaSettings] = useState<WaSetting[]>([]);
  const [waSettingsLoading, setWaSettingsLoading] = useState(false);
  const [waToggling, setWaToggling] = useState<string | null>(null);
  const [waSearch, setWaSearch] = useState("");
  const [waSort, setWaSort] = useState<WaVisibilitySort>("date_added_desc");

  const fetchWaSettings = async () => {
    setWaSettingsLoading(true);
    const { data, error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .select("template_key, display_name, description, category, show_in_lead_picker, created_at, updated_at, media_url")
      .order("created_at", { ascending: false });
    if (!error && data) {
      const settingsRows = (data as WaSetting[]);
      const settingsByKey = new Map(settingsRows.map((setting) => [setting.template_key, setting]));
      const { data: approvedTemplates } = await (supabase as any)
        .from("whatsapp_templates")
        .select("name, category, created_at, status_updated_at, header_format")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });
      // header_format decides whether a row needs a media URL at all.
      const headerFormatByName = new Map<string, string>(
        ((approvedTemplates || []) as Array<{ name: string; header_format?: string | null }>)
          .filter((t) => t.name)
          .map((t) => [t.name, String(t.header_format || "NONE").toUpperCase()]),
      );
      const { data: usedRows } = await (supabase as any)
        .from("whatsapp_messages")
        .select("template_key, created_at")
        .not("template_key", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000);
      const lastUsedByTemplate = new Map<string, string>();
      ((usedRows || []) as Array<{ template_key: string | null; created_at: string | null }>).forEach((row) => {
        if (row.template_key && row.created_at && !lastUsedByTemplate.has(row.template_key)) {
          lastUsedByTemplate.set(row.template_key, row.created_at);
        }
      });
      const missingApprovedSettings = ((approvedTemplates || []) as Array<{
        name: string;
        category?: string | null;
        created_at?: string | null;
        status_updated_at?: string | null;
      }>)
        .filter((template) => template.name && !settingsByKey.has(template.name))
        .map((template) => ({
          template_key: template.name,
          display_name: displayNameForWaTemplate(template.name),
          description: "Approved Meta template. Configure parameters before enabling if it uses variables.",
          category: String(template.category || "general").toLowerCase(),
          show_in_lead_picker: false,
          created_at: template.created_at || template.status_updated_at || null,
          updated_at: template.status_updated_at || template.created_at || null,
        } satisfies WaSetting));
      const mergedSettings = [...settingsRows, ...missingApprovedSettings];
      setWaSettings(mergedSettings.map((setting) => ({
        ...setting,
        ...(setting.template_key === "bpt_bmrit_cahet_deadline" ? { description: cahetDeadlineDescription() } : {}),
        last_used_at: lastUsedByTemplate.get(setting.template_key) || null,
        header_format: headerFormatByName.get(setting.template_key) || "NONE",
      })));
    }
    setWaSettingsLoading(false);
  };

  /**
   * Attach the sendable header file for a media template. Meta's own
   * header_handle can't be reused as a send link (131053), so without this the
   * template is approved but unsendable — which is how the Clinical Training &
   * Placement Report ended up looking "unavailable".
   */
  const saveWaMediaUrl = async (templateKey: string, mediaUrl: string) => {
    const current = waSettings.find((setting) => setting.template_key === templateKey);
    if (mediaUrl && /scontent\.whatsapp\.net|lookaside\.fbsbx\.com/.test(mediaUrl)) {
      toast({
        title: "That URL won't work",
        description: "Meta's own header link is rejected at send time (131053). Upload the file somewhere public and paste that URL.",
        variant: "destructive",
      });
      return;
    }
    const { error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .upsert({
        template_key: templateKey,
        display_name: current?.display_name || displayNameForWaTemplate(templateKey),
        description: current?.description || null,
        category: current?.category || "general",
        show_in_lead_picker: current?.show_in_lead_picker ?? false,
        media_url: mediaUrl || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "template_key" });
    if (error) {
      toast({ title: "Could not save file URL", description: error.message, variant: "destructive" });
      return;
    }
    setWaSettings(prev => prev.map(s => s.template_key === templateKey ? { ...s, media_url: mediaUrl || null } : s));
    toast({ title: mediaUrl ? "Header file saved" : "Header file cleared" });
  };

  const toggleWaSetting = async (templateKey: string, next: boolean) => {
    setWaToggling(templateKey);
    const current = waSettings.find((setting) => setting.template_key === templateKey);
    const { error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .upsert({
        template_key: templateKey,
        display_name: current?.display_name || displayNameForWaTemplate(templateKey),
        description: current?.description || null,
        category: current?.category || "general",
        show_in_lead_picker: next,
        media_url: current?.media_url || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "template_key" });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      setWaSettings(prev => prev.map(s => s.template_key === templateKey ? { ...s, show_in_lead_picker: next } : s));
    }
    setWaToggling(null);
  };

  useEffect(() => { fetchWaSettings(); }, []);

  const visibleWaSettings = useMemo(() => {
    const query = waSearch.trim().toLowerCase();
    const filtered = query
      ? waSettings.filter((setting) =>
          [
            setting.template_key,
            setting.display_name,
            setting.description || "",
            setting.category || "",
          ].some((value) => value.toLowerCase().includes(query)))
      : waSettings;

    const dateValue = (value?: string | null) => value ? new Date(value).getTime() : 0;
    return [...filtered].sort((a, b) => {
      if (waSort === "date_added_asc") return dateValue(a.created_at) - dateValue(b.created_at);
      if (waSort === "date_used_desc") return dateValue(b.last_used_at) - dateValue(a.last_used_at);
      if (waSort === "date_used_asc") return dateValue(a.last_used_at) - dateValue(b.last_used_at);
      if (waSort === "name_asc") return a.display_name.localeCompare(b.display_name);
      if (waSort === "name_desc") return b.display_name.localeCompare(a.display_name);
      return dateValue(b.created_at) - dateValue(a.created_at);
    });
  }, [waSearch, waSettings, waSort]);

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from("email_templates" as any)
      .select("*")
      .order("category")
      .order("name");
    if (error) console.error("Failed to fetch email templates:", error);
    if (data) setEmailTemplates(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFormName(""); setFormSlug(""); setFormSubject(""); setFormBody(""); setFormCategory("general"); setFormVariables("");
    setShowEdit(true);
  };

  const openEdit = (t: EmailTemplate) => {
    setEditing(t);
    setFormName(t.name);
    setFormSlug(t.slug);
    setFormSubject(t.subject);
    setFormBody(t.body_html);
    setFormCategory(t.category);
    setFormVariables((t.variables || []).join(", "));
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formSlug.trim() || !formSubject.trim()) return;
    setSaving(true);

    const payload = {
      name: formName.trim(),
      slug: formSlug.trim(),
      subject: formSubject.trim(),
      body_html: formBody,
      category: formCategory,
      variables: formVariables.split(",").map(v => v.trim()).filter(Boolean),
      is_active: true,
    };

    if (editing) {
      const { error } = await supabase.from("email_templates" as any).update(payload as any).eq("id", editing.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Template updated" }); }
    } else {
      const { error } = await supabase.from("email_templates" as any).insert(payload as any);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Template created" }); }
    }

    setSaving(false);
    setShowEdit(false);
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("email_templates" as any).delete().eq("id", id);
    toast({ title: "Template deleted" });
    fetchTemplates();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("email_templates" as any).update({ is_active: active } as any).eq("id", id);
    setEmailTemplates(prev => prev.map(t => t.id === id ? { ...t, is_active: active } : t));
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  const formatShortDate = (value?: string | null) => value
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Never";

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Template Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage WhatsApp and email templates</p>
      </div>

      <Tabs defaultValue="whatsapp" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="whatsapp"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            WhatsApp Templates
          </TabsTrigger>
          <TabsTrigger value="email"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Email Templates
          </TabsTrigger>
          <TabsTrigger value="courses"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Course Data
          </TabsTrigger>
          <TabsTrigger value="picker"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Template Visibility
          </TabsTrigger>
        </TabsList>

        {/* EMAIL TEMPLATES */}
        <TabsContent value="email" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> New Template</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {emailTemplates.map((t) => (
              <Card key={t.id} className={`border-border/60 shadow-none ${!t.is_active ? "opacity-50" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-info-foreground" />
                        <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Slug: {t.slug}</p>
                    </div>
                    <Badge className={`text-[9px] border-0 ${t.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  <div className="mt-3 rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Subject</p>
                    <p className="text-xs text-foreground">{t.subject}</p>
                  </div>

                  {t.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.variables.map(v => (
                        <Badge key={v} variant="outline" className="text-[9px] font-mono">{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-border/40">
                    <Badge variant="outline" className="text-[9px]">{CATEGORIES.find(c => c.value === t.category)?.label || t.category}</Badge>
                    <div className="ml-auto flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setPreviewHtml(t.body_html); setShowPreview(true); }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {emailTemplates.length === 0 && (
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No email templates yet</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* WHATSAPP TEMPLATES — DB-mirrored from Meta, live status via webhook */}
        <TabsContent value="whatsapp" className="mt-4">
          <WhatsAppTemplateTab />
        </TabsContent>

        {/* COURSE DATA — fields that flow into the course_info_v1 template */}
        <TabsContent value="courses" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-primary" />
                  Course data sent in WhatsApp templates
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                  These five fields feed the <span className="font-mono">course_info_v1</span> template body (Duration,
                  Eligibility, Accreditation, the video button, and the fees-and-apply button). Edit them here so
                  outbound messages match reality. Preview shows the rendered template.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={fetchCourses} disabled={coursesLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${coursesLoading ? "animate-spin" : ""}`} /> Reload
              </Button>
            </div>
          </div>

          {coursesLoading ? (
            <PageLoader />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Code</th>
                    <th className="text-left px-3 py-2 font-medium">Course name</th>
                    <th className="text-left px-3 py-2 font-medium">Duration</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[220px]">Marketing eligibility</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[200px]">Video URL</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[180px]">Slug</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[180px]">Maps CID (optional)</th>
                    <th className="text-right px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {courseRows.map((c) => {
                    const e = courseEdits[c.id] || {};
                    const merged = { ...c, ...e } as CourseRow;
                    const dirty = Object.keys(e).length > 0;
                    const set = (k: keyof CourseRow, v: any) => setCourseEdits(prev => ({ ...prev, [c.id]: { ...prev[c.id], [k]: v } }));
                    return (
                      <tr key={c.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">{c.code}</td>
                        <td className="px-3 py-2 text-foreground">{c.name}</td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {c.duration_years ? `${c.duration_years}y` : "—"} {c.type ? `(${c.type})` : ""}
                        </td>
                        <td className="px-3 py-2">
                          <textarea
                            value={merged.marketing_eligibility || ""}
                            onChange={(ev) => set("marketing_eligibility", ev.target.value)}
                            rows={2}
                            placeholder="10+2 with PCB, min 50%…"
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs resize-y"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={merged.video_url || ""}
                            onChange={(ev) => set("video_url", ev.target.value)}
                            placeholder="https://youtu.be/…"
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={merged.slug || ""}
                            onChange={(ev) => set("slug", ev.target.value)}
                            placeholder="bachelor-of-science-in-nursing"
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-mono"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={merged.maps_cid || ""}
                            onChange={(ev) => set("maps_cid", ev.target.value.trim() || (null as any))}
                            placeholder="1820424915210710582"
                            title="Overrides the campus Maps CID for visit_confirmation when this course sits in its own building."
                            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-mono"
                          />
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => previewCourseTemplate(c)}>
                              <Eye className="h-3 w-3 mr-1" /> Preview
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-[11px]"
                              disabled={!dirty || savingCourseId === c.id}
                              onClick={() => saveCourse(c.id)}
                            >
                              {savingCourseId === c.id ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3 mr-1" />
                              )}
                              Save
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {courseRows.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No courses.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* TEMPLATE VISIBILITY — toggle which WhatsApp templates appear in manual send pickers */}
        <TabsContent value="picker" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  Template Visibility
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                  This is the curated list: every approved Meta template is listed here, and the ones you switch on are
                  exactly what counsellors can pick on the <span className="font-medium text-foreground">lead page</span>,
                  the <span className="font-medium text-foreground">cloud dialer</span> and
                  {" "}<span className="font-medium text-foreground">WhatsApp inbox replies</span>.
                  Auto-fired templates (missed_call, nimt_followup_v1, offer_letter_acceptance) are off by default — they're sent
                  by the system on disposition / offer issuance, not by hand.
                  Templates with an image, video or PDF header also need a file URL below, or the send is rejected.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="search"
                  value={waSearch}
                  onChange={(e) => setWaSearch(e.target.value)}
                  placeholder="Search template name"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <select
                  value={waSort}
                  onChange={(e) => setWaSort(e.target.value as WaVisibilitySort)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="date_added_desc">Date added: newest first</option>
                  <option value="date_added_asc">Date added: oldest first</option>
                  <option value="date_used_desc">Date used: newest first</option>
                  <option value="date_used_asc">Date used: oldest first</option>
                  <option value="name_asc">Name: A-Z</option>
                  <option value="name_desc">Name: Z-A</option>
                </select>
                <Button variant="outline" size="sm" className="h-9 gap-2" onClick={fetchWaSettings} disabled={waSettingsLoading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${waSettingsLoading ? "animate-spin" : ""}`} /> Reload
                </Button>
              </div>
            </div>
          </div>

          {waSettingsLoading ? (
            <PageLoader />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Template key</th>
                    <th className="text-left px-3 py-2 font-medium">Display name</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium">Date added</th>
                    <th className="text-left px-3 py-2 font-medium">Date used</th>
                    <th className="text-left px-3 py-2 font-medium">Header file</th>
                    <th className="text-center px-3 py-2 font-medium">Show in picker</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWaSettings.map((s) => (
                    <tr key={s.template_key} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-foreground">{s.template_key}</td>
                      <td className="px-3 py-2 text-foreground">{s.display_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">{s.category || "general"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-md">{s.description || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatShortDate(s.created_at)}</td>
                      <td className="px-3 py-2">
                        {s.header_format && s.header_format !== "NONE" && s.header_format !== "TEXT" ? (
                          <div className="min-w-[220px]">
                            <input
                              type="url"
                              defaultValue={s.media_url || ""}
                              onBlur={(e) => {
                                const next = e.target.value.trim();
                                if (next !== (s.media_url || "")) void saveWaMediaUrl(s.template_key, next);
                              }}
                              placeholder={`Public ${s.header_format.toLowerCase()} URL`}
                              className={`h-8 w-full rounded-md border px-2 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring/20 ${
                                s.media_url ? "border-input" : "border-destructive/40 bg-destructive/5"
                              }`}
                            />
                            {!s.media_url && (
                              <p className="mt-0.5 text-[10px] text-destructive">
                                Required — this template sends a {s.header_format.toLowerCase()}.
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          role="switch"
                          aria-checked={s.show_in_lead_picker}
                          disabled={waToggling === s.template_key}
                          onClick={() => toggleWaSetting(s.template_key, !s.show_in_lead_picker)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            s.show_in_lead_picker ? "bg-success/50" : "bg-slate-300 dark:bg-slate-700"
                          } ${waToggling === s.template_key ? "opacity-60" : ""}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              s.show_in_lead_picker ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleWaSettings.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">{waSettings.length === 0 ? "No settings yet. Apply migration 20260610100900_whatsapp_template_settings to seed." : "No templates match your search."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Course preview dialog */}
      <Dialog open={!!coursePreview} onOpenChange={(v) => !v && setCoursePreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Preview — {coursePreview?.courseName}
            </DialogTitle>
          </DialogHeader>
          <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/40 rounded-lg p-3 max-h-[60vh] overflow-y-auto">
            {coursePreview?.rendered}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCoursePreview(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/Create Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Email Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Offer Letter" className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Slug *</label>
                <input value={formSlug} onChange={e => setFormSlug(e.target.value)} placeholder="offer-letter" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Category</label>
                <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className={inputCls}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Variables (comma-separated)</label>
                <input value={formVariables} onChange={e => setFormVariables(e.target.value)} placeholder="student_name, course_name" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Subject *</label>
              <input value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder="Offer of Admission — {{course_name}}" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Body (HTML)</label>
              <textarea value={formBody} onChange={e => setFormBody(e.target.value)} rows={10} className={`${inputCls} font-mono text-xs`} placeholder="<h2>Dear {{student_name}},</h2>..." />
            </div>
            <Button variant="outline" size="sm" onClick={() => { setPreviewHtml(formBody); setShowPreview(true); }}>
              <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formName.trim() || !formSlug.trim() || !formSubject.trim() || saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Email Preview</DialogTitle></DialogHeader>
          <div className="rounded-lg border border-border p-4 bg-white">
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default TemplateManager;
