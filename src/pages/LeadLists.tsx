import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ListPlus, Loader2, Send, Mail, Trash2, Users, MessageSquare, AlertTriangle, Upload,
} from "lucide-react";
import { WA_BULK_TEMPLATES } from "@/config/waBulkTemplates";

const BulkLeadImportDialog = lazy(() =>
  import("@/components/admissions/BulkLeadImportDialog").then((m) => ({ default: m.BulkLeadImportDialog })));

interface LeadList {
  id: string;
  name: string;
  description: string | null;
  source: "manual" | "import" | "filter";
  member_count: number;
  filters_snapshot: Record<string, unknown> | null;
  created_at: string;
}

const SOURCE_BADGE: Record<LeadList["source"], { label: string; cls: string }> = {
  manual:  { label: "Manual",   cls: "bg-pastel-blue text-foreground/70" },
  import:  { label: "Imported", cls: "bg-pastel-green text-foreground/70" },
  filter:  { label: "Filter",   cls: "bg-pastel-yellow text-foreground/70" },
};

export default function LeadLists() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  // Send-WhatsApp dialog
  const [waOpen, setWaOpen] = useState(false);
  const [waList, setWaList] = useState<LeadList | null>(null);
  const [waTemplate, setWaTemplate] = useState<string>(WA_BULK_TEMPLATES[0].key);
  const [waCampaignName, setWaCampaignName] = useState("");
  const [waStaticParams, setWaStaticParams] = useState<Record<string, string>>({});
  const [waSending, setWaSending] = useState(false);

  // Selected template definition — drives which static inputs we render.
  const waTemplateDef = useMemo(
    () => WA_BULK_TEMPLATES.find(t => t.key === waTemplate) || WA_BULK_TEMPLATES[0],
    [waTemplate]
  );
  const waStaticFields = useMemo(
    () => waTemplateDef.params.filter(p => p.source === "static"),
    [waTemplateDef]
  );
  const waMissingStatic = waStaticFields.some(p => !waStaticParams[p.name]?.trim());

  // Send-Email dialog
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailList, setEmailList] = useState<LeadList | null>(null);
  const [emailMode, setEmailMode] = useState<"template" | "custom">("template");
  const [emailTemplates, setEmailTemplates] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [emailSlug, setEmailSlug] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailCampaignName, setEmailCampaignName] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  // Members preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewList, setPreviewList] = useState<LeadList | null>(null);
  const [previewMembers, setPreviewMembers] = useState<Array<{ id: string; name: string; phone: string; email: string | null; stage: string }>>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Delete confirm
  const [deleteList, setDeleteList] = useState<LeadList | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchLists = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_lists" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Fetch lists failed:", error);
    setLists((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { fetchLists(); }, []);

  useEffect(() => {
    if (!emailOpen) return;
    (async () => {
      const { data } = await supabase
        .from("email_templates")
        .select("id, slug, name")
        .eq("is_active", true)
        .order("name");
      setEmailTemplates((data || []) as any);
      if ((data || []).length && !emailSlug) setEmailSlug((data as any)[0].slug);
    })();
  }, [emailOpen]);

  const openWa = (list: LeadList) => {
    setWaList(list);
    setWaCampaignName(`${list.name} — WhatsApp`);
    setWaTemplate(WA_BULK_TEMPLATES[0].key);
    setWaStaticParams({});
    setWaOpen(true);
  };

  const openEmail = (list: LeadList) => {
    setEmailList(list);
    setEmailCampaignName(`${list.name} — Email`);
    setEmailMode("template");
    setEmailSubject("");
    setEmailBody("");
    setEmailOpen(true);
  };

  const openPreview = async (list: LeadList) => {
    setPreviewList(list);
    setPreviewOpen(true);
    setPreviewLoading(true);
    const { data, error } = await supabase
      .from("lead_list_members" as any)
      .select("lead_id, leads(id, name, phone, email, stage)")
      .eq("list_id", list.id)
      .limit(100);
    if (error) console.error("Preview fetch failed:", error);
    setPreviewMembers(
      ((data as any) || [])
        .map((m: any) => m.leads)
        .filter(Boolean)
    );
    setPreviewLoading(false);
  };

  const handleSendWhatsApp = async () => {
    if (!waList) return;
    setWaSending(true);

    // Fetch members + lead phone/stage so we can materialize recipients with
    // the same shape whatsapp-campaign-send expects, skipping DNC leads.
    const { data: members, error: memErr } = await supabase
      .from("lead_list_members" as any)
      .select("lead_id, leads(id, phone, stage)")
      .eq("list_id", waList.id);
    if (memErr || !members) {
      toast({ title: "Could not load list members", description: memErr?.message, variant: "destructive" });
      setWaSending(false);
      return;
    }

    const valid = (members as any)
      .map((m: any) => m.leads)
      .filter((l: any) => l && l.phone && l.stage !== "dnc");

    if (!valid.length) {
      toast({ title: "No reachable leads", description: "All members are DNC or missing a phone.", variant: "destructive" });
      setWaSending(false);
      return;
    }

    // Trim and keep only the static params for the chosen template — guards
    // against stray values the user may have typed under a previous selection.
    const staticParamsToSend: Record<string, string> = {};
    for (const f of waStaticFields) {
      const v = (waStaticParams[f.name] || "").trim();
      if (v) staticParamsToSend[f.name] = v;
    }

    const { data: campaign, error: campErr } = await supabase
      .from("whatsapp_campaigns" as any)
      .insert({
        name: waCampaignName.trim() || `${waList.name} — WhatsApp`,
        template_key: waTemplate,
        list_id: waList.id,
        total_recipients: valid.length,
        static_params: staticParamsToSend,
        created_by: profile?.id || null,
        next_attempt_at: new Date().toISOString(),
        worker_locked_at: null,
        status: "pending",
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      toast({ title: "Could not create campaign", description: campErr?.message, variant: "destructive" });
      setWaSending(false);
      return;
    }

    const campaignId = (campaign as any).id;
    const rows = valid.map((l: any) => ({
      campaign_id: campaignId,
      lead_id: l.id,
      phone: l.phone,
    }));

    // Chunked insert to stay under PostgREST's request size cap.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("whatsapp_campaign_recipients" as any).insert(chunk);
      if (error) console.error("Recipient insert failed:", error);
    }

    setWaSending(false);
    setWaOpen(false);
    toast({
      title: "WhatsApp campaign queued",
      description: `${valid.length} recipients queued. You can close this screen; progress is tracked in Marketing.`,
    });
    supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1 } }).catch(() => {});
    await fetchLists();
  };

  const handleSendEmail = async () => {
    if (!emailList) return;
    if (emailMode === "template" && !emailSlug) {
      toast({ title: "Pick a template", variant: "destructive" });
      return;
    }
    if (emailMode === "custom" && (!emailSubject.trim() || !emailBody.trim())) {
      toast({ title: "Subject and body are required", variant: "destructive" });
      return;
    }
    setEmailSending(true);

    const { data: members, error: memErr } = await supabase
      .from("lead_list_members" as any)
      .select("lead_id, leads(id, email, stage)")
      .eq("list_id", emailList.id);
    if (memErr || !members) {
      toast({ title: "Could not load list members", description: memErr?.message, variant: "destructive" });
      setEmailSending(false);
      return;
    }

    const valid = (members as any)
      .map((m: any) => m.leads)
      .filter((l: any) => l && l.email && l.stage !== "dnc");
    if (!valid.length) {
      toast({ title: "No reachable leads", description: "All members are DNC or missing an email.", variant: "destructive" });
      setEmailSending(false);
      return;
    }

    const { data: campaign, error: campErr } = await supabase
      .from("email_campaigns" as any)
      .insert({
        name: emailCampaignName.trim() || `${emailList.name} — Email`,
        list_id: emailList.id,
        template_slug: emailMode === "template" ? emailSlug : null,
        custom_subject: emailMode === "custom" ? emailSubject.trim() : null,
        custom_body: emailMode === "custom" ? emailBody : null,
        total_recipients: valid.length,
        created_by: profile?.id || null,
        next_attempt_at: new Date().toISOString(),
        worker_locked_at: null,
        status: "pending",
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      toast({ title: "Could not create campaign", description: campErr?.message, variant: "destructive" });
      setEmailSending(false);
      return;
    }

    const campaignId = (campaign as any).id;
    const rows = valid.map((l: any) => ({
      campaign_id: campaignId,
      lead_id: l.id,
      to_email: l.email,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("email_campaign_recipients" as any).insert(chunk);
      if (error) console.error("Email recipient insert failed:", error);
    }

    setEmailSending(false);
    setEmailOpen(false);
    toast({
      title: "Email campaign queued",
      description: `${valid.length} recipients queued. You can close this screen; progress is tracked in Marketing.`,
    });
    supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1 } }).catch(() => {});
    await fetchLists();
  };

  const handleDelete = async () => {
    if (!deleteList) return;
    setDeleting(true);
    const { error } = await supabase.from("lead_lists" as any).delete().eq("id", deleteList.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Could not delete list", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "List deleted" });
    }
    setDeleteList(null);
    await fetchLists();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lead Lists</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable lead lists for bulk WhatsApp and email campaigns. Build a list from CSV import or from a filtered view in Lead Buckets.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)} className="gap-2 shrink-0 self-start">
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <ListPlus className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">No lists yet</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Create your first list by importing a CSV here, or by saving a filter snapshot from Lead Buckets.
            </p>
            <Button onClick={() => setImportOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Members</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => {
                const badge = SOURCE_BADGE[list.source];
                return (
                  <tr key={list.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openPreview(list)}
                        className="text-left font-medium text-foreground hover:text-primary"
                      >
                        {list.name}
                      </button>
                      {list.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-md">{list.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border-0 ${badge.cls}`}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground font-semibold">{list.member_count}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(list.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openPreview(list)}>
                          <Users className="h-3.5 w-3.5" /> Members
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openWa(list)} disabled={list.member_count === 0}>
                          <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openEmail(list)} disabled={list.member_count === 0}>
                          <Mail className="h-3.5 w-3.5" /> Email
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-destructive hover:text-destructive" onClick={() => setDeleteList(list)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && (
        <Suspense fallback={null}>
          <BulkLeadImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onSuccess={fetchLists}
            defaultListMode="new"
          />
        </Suspense>
      )}

      {/* WhatsApp send dialog */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send WhatsApp to "{waList?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Only Meta-approved templates can be sent in bulk. DNC leads and members without a phone are skipped automatically.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Campaign name</label>
              <input
                type="text"
                value={waCampaignName}
                onChange={(e) => setWaCampaignName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <select
                value={waTemplate}
                onChange={(e) => { setWaTemplate(e.target.value); setWaStaticParams({}); }}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                {WA_BULK_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              {waTemplateDef.description && (
                <p className="text-[11px] text-muted-foreground mt-1">{waTemplateDef.description}</p>
              )}
            </div>

            {/* Per-template static params — one input per non-auto-filled slot */}
            {waStaticFields.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">Template values</p>
                {waStaticFields.map(p => (
                  <div key={p.name}>
                    <label className="text-xs font-medium text-muted-foreground capitalize">
                      {p.name.replace(/_/g, " ")} <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={waStaticParams[p.name] || ""}
                      onChange={(e) => setWaStaticParams(s => ({ ...s, [p.name]: e.target.value }))}
                      placeholder={p.placeholder || ""}
                      className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    {p.help && <p className="text-[11px] text-muted-foreground mt-1">{p.help}</p>}
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">
                  Per-lead values (name, course, campus) are filled automatically from each lead's record.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Sending to <strong className="text-foreground">{waList?.member_count}</strong> lead{waList?.member_count === 1 ? "" : "s"} on this list (DNC + no-phone excluded at send time).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)}>Cancel</Button>
            <Button onClick={handleSendWhatsApp} disabled={waSending || waMissingStatic} className="gap-2">
              {waSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email send dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Email to "{emailList?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Campaign name</label>
              <input
                type="text"
                value={emailCampaignName}
                onChange={(e) => setEmailCampaignName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEmailMode("template")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${emailMode === "template" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
              >
                Use template
              </button>
              <button
                type="button"
                onClick={() => setEmailMode("custom")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${emailMode === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
              >
                Custom subject + body
              </button>
            </div>

            {emailMode === "template" ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Template</label>
                <select
                  value={emailSlug}
                  onChange={(e) => setEmailSlug(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  {emailTemplates.length === 0 && <option value="">No active templates</option>}
                  {emailTemplates.map((t) => (
                    <option key={t.id} value={t.slug}>{t.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Per-lead variables resolved automatically: <code>{"{{student_name}}"}</code>, <code>{"{{course_name}}"}</code>, <code>{"{{campus_name}}"}</code>.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Use {{student_name}}, {{course_name}} for per-lead values"
                    className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Body (HTML)</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={8}
                    placeholder={"<p>Hi {{student_name}},</p><p>...</p>"}
                    className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground">
              Sending to <strong className="text-foreground">{emailList?.member_count}</strong> lead{emailList?.member_count === 1 ? "" : "s"} (DNC + no-email excluded at send time).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button onClick={handleSendEmail} disabled={emailSending} className="gap-2">
              {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewList?.name} — Members</DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {previewMembers.map((m) => (
                    <tr key={m.id} className="border-b border-border/50">
                      <td className="px-3 py-2 text-foreground">{m.name}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{m.phone}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{m.email || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={m.stage === "dnc" ? "destructive" : "outline"} className="text-[10px]">
                          {m.stage}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewList && previewList.member_count > previewMembers.length && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
                  Showing first {previewMembers.length} of {previewList.member_count} members.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteList} onOpenChange={(o) => !o && setDeleteList(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteList?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The list and its membership rows will be removed. Leads themselves and any campaigns already sent are not affected.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteList(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-2">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
