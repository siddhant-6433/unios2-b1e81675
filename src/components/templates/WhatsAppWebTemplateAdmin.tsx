import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ExternalLink, Eye, EyeOff, FileText, Pencil, Plus, Trash2 } from "lucide-react";

interface WebTemplate {
  id: string;
  template_key: string;
  display_name: string;
  category: string;
  body: string;
  attachment_label: string | null;
  attachment_url: string | null;
  is_active: boolean;
  sort_order: number;
}

const inputClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const keyFromName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function WhatsAppWebTemplateAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [templates, setTemplates] = useState<WebTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<WebTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [body, setBody] = useState("");
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  const load = async () => {
    setLoading(true);
    const [configResult, templateResult] = await Promise.all([
      supabase.from("whatsapp_web_config").select("enabled").eq("id", true).maybeSingle(),
      supabase.from("whatsapp_web_templates")
        .select("id, template_key, display_name, category, body, attachment_label, attachment_url, is_active, sort_order")
        .order("sort_order").order("display_name"),
    ]);
    if (configResult.error || templateResult.error) {
      toast({ title: "Could not load WhatsApp Web settings", description: configResult.error?.message || templateResult.error?.message, variant: "destructive" });
    } else {
      setEnabled(Boolean(configResult.data?.enabled));
      setTemplates((templateResult.data || []) as WebTemplate[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const toggleEnabled = async () => {
    const next = !enabled;
    const { error } = await supabase.from("whatsapp_web_config")
      .update({ enabled: next, updated_at: new Date().toISOString(), updated_by: user?.id || null })
      .eq("id", true);
    if (error) {
      toast({ title: "Setting update failed", description: error.message, variant: "destructive" });
      return;
    }
    setEnabled(next);
    toast({ title: next ? "WhatsApp Web enabled for counsellors" : "WhatsApp Web hidden from counsellors" });
  };

  const startCreate = () => {
    setEditing(null);
    setName(""); setCategory("general"); setBody(""); setAttachmentLabel(""); setAttachmentUrl("");
    setFormOpen(true);
  };

  const startEdit = (template: WebTemplate) => {
    setEditing(template);
    setName(template.display_name); setCategory(template.category); setBody(template.body);
    setAttachmentLabel(template.attachment_label || ""); setAttachmentUrl(template.attachment_url || "");
    setFormOpen(true);
  };

  const saveTemplate = async () => {
    const cleanName = name.trim();
    const cleanBody = body.trim();
    const cleanUrl = attachmentUrl.trim();
    if (!cleanName || !cleanBody) {
      toast({ title: "Name and message are required", variant: "destructive" });
      return;
    }
    if (cleanUrl && !/^https:\/\//i.test(cleanUrl)) {
      toast({ title: "Use a public HTTPS link", description: "WhatsApp Web can include a clickable link, but cannot attach the file itself.", variant: "destructive" });
      return;
    }
    const key = editing?.template_key || keyFromName(cleanName);
    if (!key) {
      toast({ title: "Template name must include a letter or number", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      template_key: key,
      display_name: cleanName,
      category: category.trim() || "general",
      body: cleanBody,
      attachment_label: attachmentLabel.trim() || null,
      attachment_url: cleanUrl || null,
      updated_by: user?.id || null,
      updated_at: new Date().toISOString(),
      ...(editing ? {} : { is_active: false }),
    };
    const { error } = await supabase.from("whatsapp_web_templates")
      .upsert(payload, { onConflict: "template_key" });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save template", description: error.message, variant: "destructive" });
      return;
    }
    setFormOpen(false);
    toast({ title: editing ? "WhatsApp Web template updated" : "WhatsApp Web template created" });
    await load();
  };

  const toggleTemplate = async (template: WebTemplate) => {
    const { error } = await supabase.from("whatsapp_web_templates")
      .update({ is_active: !template.is_active, updated_at: new Date().toISOString(), updated_by: user?.id || null })
      .eq("id", template.id);
    if (error) {
      toast({ title: "Template update failed", description: error.message, variant: "destructive" });
      return;
    }
    setTemplates((previous) => previous.map((row) => row.id === template.id ? { ...row, is_active: !row.is_active } : row));
  };

  const deleteTemplate = async (template: WebTemplate) => {
    if (!window.confirm(`Delete “${template.display_name}”?`)) return;
    const { error } = await supabase.from("whatsapp_web_templates").delete().eq("id", template.id);
    if (error) {
      toast({ title: "Template delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setTemplates((previous) => previous.filter((row) => row.id !== template.id));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><ExternalLink className="h-4 w-4" /> Counsellor WhatsApp Web button</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs text-muted-foreground">Controls whether counsellors see the Send WhatsApp Web option on Lead pages and in Cloud Dialer. Browser messages are manually sent and are not confirmed by Meta.</p>
          <Button variant={enabled ? "default" : "outline"} onClick={toggleEnabled} disabled={loading} aria-pressed={enabled} className="gap-2">
            {enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {enabled ? "Visible to counsellors" : "Hidden from counsellors"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">WhatsApp Web templates</h3>
          <p className="text-xs text-muted-foreground">These are UniOs message drafts, not Meta templates. A public HTTPS attachment URL is added as a clickable link.</p>
        </div>
        <Button onClick={startCreate} className="gap-2"><Plus className="h-4 w-4" /> New Web template</Button>
      </div>

      {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading Web templates…</div> : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className={!template.is_active ? "opacity-70" : ""}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold">{template.display_name}</h4>
                    <p className="font-mono text-[10px] text-muted-foreground">{template.template_key}</p>
                  </div>
                  <Badge variant={template.is_active ? "default" : "outline"}>{template.is_active ? "Active" : "Hidden"}</Badge>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{template.body}</p>
                {template.attachment_url ? <a href={template.attachment_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-primary underline">{template.attachment_label || "Attachment link"}: {template.attachment_url}</a> : <p className="text-[11px] text-warning-foreground">No attachment URL saved</p>}
                <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
                  <Button size="sm" variant="outline" onClick={() => toggleTemplate(template)} className="gap-1.5">
                    {template.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {template.is_active ? "Hide" : "Activate"}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(template)} aria-label={`Edit ${template.display_name}`}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteTemplate(template)} aria-label={`Delete ${template.display_name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {templates.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-2 h-5 w-5 opacity-40" />No WhatsApp Web templates yet.</div>}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit WhatsApp Web template" : "New WhatsApp Web template"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">Template name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Course Brochure" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Category<Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="course" /></label>
            </div>
            <label className="block space-y-1 text-xs text-muted-foreground">Message body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} className={inputClass} placeholder="Hi {{student_name}}, here is the information you requested about {{course_name}}." /></label>
            <p className="text-[11px] text-muted-foreground">Available fields: <code>{"{{student_name}}"}</code>, <code>{"{{course_name}}"}</code>, <code>{"{{campus_name}}"}</code>, <code>{"{{application_id}}"}</code>.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">Link label<Input value={attachmentLabel} onChange={(event) => setAttachmentLabel(event.target.value)} placeholder="Course brochure" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Public HTTPS file link<Input type="url" value={attachmentUrl} onChange={(event) => setAttachmentUrl(event.target.value)} placeholder="https://..." /></label>
            </div>
            <p className="text-[11px] text-muted-foreground">WhatsApp Web will include this URL in the message. It will not upload or attach the file itself.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
