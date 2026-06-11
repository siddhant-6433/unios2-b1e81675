import { useState, useEffect } from "react";
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
import {
  cahetDeadlineDescription,
  cahetDeadlineMessage,
} from "@/lib/deadlineRollover";

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

  // ── Lead Picker tab state ────────────────────────────────────────────────
  // whatsapp_template_settings.show_in_lead_picker drives the visible list
  // in the lead-page SendWhatsAppDialog. Admin toggles each here.
  type WaSetting = {
    template_key: string;
    display_name: string;
    description: string | null;
    category: string | null;
    show_in_lead_picker: boolean;
  };
  const [waSettings, setWaSettings] = useState<WaSetting[]>([]);
  const [waSettingsLoading, setWaSettingsLoading] = useState(false);
  const [waToggling, setWaToggling] = useState<string | null>(null);

  const fetchWaSettings = async () => {
    setWaSettingsLoading(true);
    const { data, error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .select("template_key, display_name, description, category, show_in_lead_picker")
      .order("category", { ascending: true })
      .order("display_name", { ascending: true });
    if (!error && data) {
      setWaSettings((data as WaSetting[]).map((setting) => (
        setting.template_key === "bpt_bmrit_cahet_deadline"
          ? { ...setting, description: cahetDeadlineDescription() }
          : setting
      )));
    }
    setWaSettingsLoading(false);
  };

  const toggleWaSetting = async (templateKey: string, next: boolean) => {
    setWaToggling(templateKey);
    const { error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .update({ show_in_lead_picker: next })
      .eq("template_key", templateKey);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      setWaSettings(prev => prev.map(s => s.template_key === templateKey ? { ...s, show_in_lead_picker: next } : s));
    }
    setWaToggling(null);
  };

  useEffect(() => { fetchWaSettings(); }, []);

  // WhatsApp state
  const [waTemplates, setWaTemplates] = useState<MetaTemplate[]>([]);
  const [waLoading, setWaLoading] = useState(true);
  const [showWaCreate, setShowWaCreate] = useState(false);
  const [waSubmitting, setWaSubmitting] = useState(false);
  const [waFormName, setWaFormName] = useState("");
  const [waFormCategory, setWaFormCategory] = useState("UTILITY");
  const [waFormBody, setWaFormBody] = useState("");
  const [waDeleting, setWaDeleting] = useState<string | null>(null);

  // Pre-built templates ready to submit
  // These match the approved Meta templates exactly
  const SUGGESTED_TEMPLATES = [
    {
      name: "nimt_new_staff",
      category: "UTILITY",
      body: "Welcome to NIMT Educational Institutions, {{1}}!\n\nYou have been added as {{2}} at {{3}}.\n\nPlease check your email for login details.\n\nFor any assistance, contact the admin office.",
      description: "Sent when a new staff/admin/teacher account is created (3 params: name, role, campus)",
    },
    {
      name: "nimt_student_admitted",
      category: "UTILITY",
      body: "Congratulations {{1}}!\n\nWelcome to NIMT Educational Institutions.\n\nAdmission No: {{2}}\nCourse: {{3}}\nCampus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in\n\nWe wish you a great academic journey ahead!",
      description: "Sent when a lead is converted to student (4 params: name, admission_no, course, campus)",
    },
    {
      name: "nimt_application_started",
      category: "UTILITY",
      body: "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions!\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt/\n\nOur admissions team is here to help. Feel free to reach out anytime!",
      description: "Sent when a new applicant starts the application process (3 params: name, app_id, course)",
    },
    {
      name: "bpt_bmrit_cahet_deadline",
      category: "UTILITY",
      body: cahetDeadlineMessage(),
      description: `Sent to BPT/BMRIT applicants for the ${cahetDeadlineDescription()}`,
    },
  ];

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

  const fetchWaTemplates = async () => {
    setWaLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
        body: { action: "list" },
      });
      // If error, try reading the response context for details
      if (error && (error as any).context) {
        const errBody = await (error as any).context.json().catch(() => null);
        console.error("WA templates error body:", errBody);
      }
      console.log("WA invoke result:", { data, error });
      if (data?.templates) setWaTemplates(data.templates);
    } catch (e) {
      console.error("WA templates exception:", e);
    }
    setWaLoading(false);
  };

  const submitWaTemplate = async () => {
    if (!waFormName.trim() || !waFormBody.trim()) return;
    setWaSubmitting(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: {
        action: "create",
        name: waFormName.trim(),
        category: waFormCategory,
        body_text: waFormBody,
      },
    });
    if (error || data?.error) {
      toast({ title: "Submission failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Template submitted", description: "Sent to Meta for approval." });
      setShowWaCreate(false);
      setWaFormName(""); setWaFormBody(""); setWaFormCategory("UTILITY");
      await fetchWaTemplates();
    }
    setWaSubmitting(false);
  };

  const deleteWaTemplate = async (name: string) => {
    setWaDeleting(name);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: { action: "delete", name },
    });
    if (error || data?.error) {
      toast({ title: "Delete failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Template deleted" });
      await fetchWaTemplates();
    }
    setWaDeleting(null);
  };

  useEffect(() => { fetchTemplates(); fetchWaTemplates(); }, []);

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

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Template Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage WhatsApp and email templates</p>
      </div>

      <Tabs defaultValue="email" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="email"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Email Templates
          </TabsTrigger>
          <TabsTrigger value="whatsapp"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            WhatsApp Templates
          </TabsTrigger>
          <TabsTrigger value="courses"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Course Data
          </TabsTrigger>
          <TabsTrigger value="picker"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Lead Picker
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
                        <Mail className="h-4 w-4 text-blue-600" />
                        <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Slug: {t.slug}</p>
                    </div>
                    <Badge className={`text-[9px] border-0 ${t.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => handleDelete(t.id)}>
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

        {/* WHATSAPP TEMPLATES — Live from Meta */}
        <TabsContent value="whatsapp" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" className="gap-2" onClick={fetchWaTemplates} disabled={waLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${waLoading ? "animate-spin" : ""}`} /> Refresh from Meta
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowWaCreate(true)}>
              <Plus className="h-4 w-4" /> New Template
            </Button>
          </div>

          {/* Suggested templates to submit */}
          {(() => {
            const existingNames = new Set(waTemplates.map(t => t.name));
            const pending = SUGGESTED_TEMPLATES.filter(s => !existingNames.has(s.name));
            if (pending.length === 0 || waLoading) return null;
            return (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Ready to Submit</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pending.length} template(s) not yet submitted to Meta</p>
                </div>
                <div className="space-y-2">
                  {pending.map((s) => (
                    <div key={s.name} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground font-mono">{s.name}</p>
                          <Badge variant="outline" className="text-[9px]">{s.category}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                        <p className="text-xs text-foreground/70 mt-1.5 whitespace-pre-wrap bg-muted/30 rounded-lg px-2 py-1.5 line-clamp-3">{s.body}</p>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => {
                          setWaFormName(s.name);
                          setWaFormCategory(s.category);
                          setWaFormBody(s.body);
                          setShowWaCreate(true);
                        }}
                      >
                        <Send className="h-3 w-3" /> Review & Submit
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {waLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : waTemplates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No WhatsApp templates found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {waTemplates.map((t) => {
                const bodyComp = t.components?.find((c: any) => c.type === "BODY");
                const headerComp = t.components?.find((c: any) => c.type === "HEADER");
                const buttonComp = t.components?.find((c: any) => c.type === "BUTTONS");
                const StatusIcon = t.status === "APPROVED" ? CheckCircle
                  : t.status === "PENDING" ? Clock
                  : t.status === "REJECTED" ? XCircle
                  : AlertTriangle;
                const statusColor = t.status === "APPROVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : t.status === "PENDING" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : t.status === "REJECTED" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-muted text-muted-foreground";

                return (
                  <Card key={t.id} className="border-border/60 shadow-none">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-green-600" />
                          <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                        </div>
                        <Badge className={`text-[9px] border-0 gap-1 ${statusColor}`}>
                          <StatusIcon className="h-3 w-3" />
                          {t.status}
                        </Badge>
                      </div>

                      {headerComp && (
                        <div className="mt-2">
                          <Badge variant="outline" className="text-[9px]">Header: {headerComp.format || "TEXT"}</Badge>
                        </div>
                      )}

                      {bodyComp?.text && (
                        <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Body</p>
                          <p className="text-xs text-foreground whitespace-pre-wrap">{bodyComp.text}</p>
                        </div>
                      )}

                      {buttonComp?.buttons && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {buttonComp.buttons.map((b: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[9px]">
                              {b.type === "URL" ? `🔗 ${b.text}` : b.text}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
                        <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
                        <Badge variant="outline" className="text-[9px]">{t.language}</Badge>
                        <div className="ml-auto">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-600"
                            disabled={waDeleting === t.name}
                            onClick={() => deleteWaTemplate(t.name)}
                          >
                            {waDeleting === t.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
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
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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

        {/* LEAD PICKER — toggle which WhatsApp templates appear in the lead-page picker */}
        <TabsContent value="picker" className="mt-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  Lead-page Send WhatsApp picker
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                  Toggle which templates the counsellor sees when they tap <span className="font-mono">Send WhatsApp</span> on a lead.
                  Auto-fired templates (missed_call, nimt_followup_v1, offer_letter_acceptance) are off by default — they're sent
                  by the system on disposition / offer issuance, not by hand.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={fetchWaSettings} disabled={waSettingsLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${waSettingsLoading ? "animate-spin" : ""}`} /> Reload
              </Button>
            </div>
          </div>

          {waSettingsLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Template key</th>
                    <th className="text-left px-3 py-2 font-medium">Display name</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-center px-3 py-2 font-medium">Show in picker</th>
                  </tr>
                </thead>
                <tbody>
                  {waSettings.map((s) => (
                    <tr key={s.template_key} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-foreground">{s.template_key}</td>
                      <td className="px-3 py-2 text-foreground">{s.display_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">{s.category || "general"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-md">{s.description || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          role="switch"
                          aria-checked={s.show_in_lead_picker}
                          disabled={waToggling === s.template_key}
                          onClick={() => toggleWaSetting(s.template_key, !s.show_in_lead_picker)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            s.show_in_lead_picker ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
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
                  {waSettings.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No settings yet. Apply migration 20260610100900_whatsapp_template_settings to seed.</td></tr>
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

      {/* WhatsApp Create Dialog */}
      <Dialog open={showWaCreate} onOpenChange={setShowWaCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit WhatsApp Template to Meta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Templates are submitted to Meta for approval. Use <code className="bg-amber-200/50 px-1 rounded">{"{{1}}"}</code>, <code className="bg-amber-200/50 px-1 rounded">{"{{2}}"}</code> etc. for variables. Name must be lowercase with underscores only.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Template Name *</label>
                <input
                  value={waFormName}
                  onChange={e => setWaFormName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  placeholder="my_template_name"
                  className={inputCls + " font-mono"}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Category</label>
                <select value={waFormCategory} onChange={e => setWaFormCategory(e.target.value)} className={inputCls}>
                  <option value="UTILITY">Utility</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Body Text *</label>
              <textarea
                value={waFormBody}
                onChange={e => setWaFormBody(e.target.value)}
                rows={6}
                className={inputCls + " text-xs"}
                placeholder={"Hi {{1}}, thank you for your interest in {{2}} at NIMT. Our team will contact you shortly."}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {(waFormBody.match(/\{\{\d+\}\}/g) || []).length} variable(s) detected
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWaCreate(false)}>Cancel</Button>
            <Button
              onClick={submitWaTemplate}
              disabled={!waFormName.trim() || !waFormBody.trim() || waSubmitting}
              className="gap-2"
            >
              {waSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit to Meta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TemplateManager;
