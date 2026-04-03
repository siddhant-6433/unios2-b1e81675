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
  Loader2, Plus, Edit, Trash2, Mail, MessageSquare, Eye,
} from "lucide-react";

// ── WhatsApp Templates (stored in code, managed via Meta Business Manager) ──
interface WhatsAppTemplate {
  key: string;
  name: string;
  description: string;
  params: string[];
}

const WA_TEMPLATES: WhatsAppTemplate[] = [
  { key: "lead_welcome", name: "Lead Welcome", description: "Welcome message with course info", params: ["student_name", "course_name"] },
  { key: "visit_confirmation", name: "Visit Confirmation", description: "Confirm scheduled campus visit", params: ["student_name", "visit_date", "campus_name"] },
  { key: "visit_reminder_24hr", name: "Visit Reminder (24hr)", description: "Remind about upcoming visit", params: ["student_name", "visit_date"] },
  { key: "application_received", name: "Application Received", description: "Acknowledge application submission", params: ["student_name", "application_id"] },
  { key: "fee_reminder", name: "Fee Reminder", description: "Remind about pending fee payment", params: ["student_name", "amount", "due_date"] },
  { key: "course_details", name: "Course Details + Brochure", description: "Send course information and brochure", params: ["student_name", "course_name"] },
];

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

  // Form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formVariables, setFormVariables] = useState("");

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from("email_templates" as any)
      .select("*")
      .order("name");
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

        {/* WHATSAPP TEMPLATES */}
        <TabsContent value="whatsapp" className="mt-4 space-y-4">
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              WhatsApp templates are managed in <strong>Meta Business Manager</strong>. The list below shows templates registered in the CRM. To add new templates, create them in Meta first, then update the codebase.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WA_TEMPLATES.map((t) => (
              <Card key={t.key} className="border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-green-600" />
                    <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Template Key</p>
                    <p className="text-xs font-mono text-foreground">{t.key}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.params.map(p => (
                      <Badge key={p} variant="outline" className="text-[9px] font-mono">{p}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

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
