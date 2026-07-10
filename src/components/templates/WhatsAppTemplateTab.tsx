import { PageLoader } from "@/components/ui/page-loader";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Trash2, MessageSquare, RefreshCw, Send,
  CheckCircle, Clock, XCircle, AlertTriangle,
} from "lucide-react";
import {
  cahetDeadlineDescription,
  cahetDeadlineMessage,
} from "@/lib/deadlineRollover";
import { WhatsAppTemplateForm } from "./WhatsAppTemplateForm";
import {
  WhatsAppTemplatePreviewBubble,
  templateBodyFromComponents,
  templateButtonsFromComponents,
  templateHeaderFromComponents,
  type WhatsAppTemplateButtonComponent,
  type WhatsAppTemplateComponent,
} from "./WhatsAppTemplatePreviewBubble";

interface WaTemplateRow {
  id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  header_format: string | null;
  has_media: boolean;
  placeholder_count: number;
  components: TemplateComponent[] | null;
  reject_reason: string | null;
  quality_score: string | null;
  submitted_at: string | null;
  status_updated_at?: string | null;
}

type TemplateButtonComponent = WhatsAppTemplateButtonComponent;
type TemplateComponent = WhatsAppTemplateComponent;

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: TemplateComponent[];
}

// Pre-built templates ready to submit (match approved Meta templates).
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

function statusVisual(status: string) {
  const Icon = status === "APPROVED" ? CheckCircle
    : status === "PENDING" ? Clock
    : status === "REJECTED" ? XCircle
    : AlertTriangle;
  const color = status === "APPROVED" ? "bg-success/10 text-success dark:bg-success/80/30 dark:text-success"
    : status === "PENDING" ? "bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning"
    : status === "REJECTED" ? "bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80"
    : "bg-muted text-muted-foreground";
  return { Icon, color };
}

function templateBody(t: WaTemplateRow) {
  return templateBodyFromComponents(t.components);
}

function templateButtons(t: WaTemplateRow) {
  return templateButtonsFromComponents(t.components);
}

function templateHeader(t: WaTemplateRow) {
  return templateHeaderFromComponents(t.components);
}

function formatMetaDate(value?: string | null) {
  if (!value) return "Not synced";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function edgeErrorMessage(error: any, data?: any) {
  if (data?.error) return data.error;
  if (data?.warning) return data.warning;
  if (error?.context?.error) return error.context.error;
  if (error?.context?.message) return error.context.message;
  if (error?.message) return error.message;
  return "Unknown error";
}

function TemplateCard({
  template,
  deleting,
  onDelete,
}: {
  template: WaTemplateRow;
  deleting: string | null;
  onDelete: (template: WaTemplateRow) => void;
}) {
  const { Icon, color } = statusVisual(template.status);
  const body = templateBody(template);
  const buttons = templateButtons(template);
  const metaCategory = (template.category || "UNKNOWN").toUpperCase();

  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-success shrink-0" />
              <h3 className="text-sm font-semibold text-foreground font-mono truncate">{template.name}</h3>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">
              Meta ID: {template.meta_template_id || "Not returned yet"}
            </p>
          </div>
          <Badge className={`text-[9px] border-0 gap-1 shrink-0 ${color}`}>
            <Icon className="h-3 w-3" />
            {template.status}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          <Badge variant="outline" className="text-[9px]">Category: {metaCategory}</Badge>
          <Badge variant="outline" className="text-[9px]">Language: {template.language}</Badge>
          <Badge variant="outline" className="text-[9px]">Header: {template.header_format || "NONE"}</Badge>
          <Badge variant="outline" className="text-[9px]">Vars: {template.placeholder_count}</Badge>
          {template.quality_score && (
            <Badge variant="outline" className="text-[9px]">Quality: {template.quality_score}</Badge>
          )}
        </div>

        {body && (
          <div className="mt-3 rounded-lg bg-muted/30 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Body</p>
            <p className="text-xs text-foreground whitespace-pre-wrap">{body}</p>
          </div>
        )}

        {template.status === "REJECTED" && template.reject_reason && (
          <div className="mt-3 rounded-lg bg-destructive/5 dark:bg-destructive/90/20 px-3 py-2">
            <p className="text-[10px] font-semibold text-destructive dark:text-destructive/80 uppercase mb-0.5">Rejection reason</p>
            <p className="text-xs text-destructive/90 dark:text-destructive/60">{template.reject_reason}</p>
          </div>
        )}

        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {buttons.map((b, i) => (
              <Badge key={i} variant="outline" className="text-[9px]">
                {b.type === "URL" ? `URL: ${b.text}` : b.text}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground">Synced {formatMetaDate(template.status_updated_at || template.submitted_at)}</p>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={deleting === template.name}
              onClick={() => onDelete(template)}
              title="Delete template from Meta"
            >
              {deleting === template.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatePreviewPanel({
  template,
  deleting,
  onDelete,
}: {
  template: WaTemplateRow | null;
  deleting: string | null;
  onDelete: (template: WaTemplateRow) => void;
}) {
  if (!template) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">
        Select a template to preview it.
      </div>
    );
  }

  const { Icon, color } = statusVisual(template.status);
  const body = templateBody(template);
  const header = templateHeader(template);
  const headerFormat = (header?.format || template.header_format || "NONE").toUpperCase();
  const metaCategory = (template.category || "UNKNOWN").toUpperCase();

  return (
    <div className="flex min-h-[520px] flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-base font-semibold text-foreground">{template.name}</h3>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Meta ID: {template.meta_template_id || "Not returned yet"}
            </p>
          </div>
          <Badge className={`shrink-0 gap-1 border-0 text-[10px] ${color}`}>
            <Icon className="h-3 w-3" />
            {template.status}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[9px]">Category: {metaCategory}</Badge>
          <Badge variant="outline" className="text-[9px]">Language: {template.language}</Badge>
          <Badge variant="outline" className="text-[9px]">Header: {headerFormat}</Badge>
          <Badge variant="outline" className="text-[9px]">Vars: {template.placeholder_count}</Badge>
          {template.quality_score && (
            <Badge variant="outline" className="text-[9px]">Quality: {template.quality_score}</Badge>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <WhatsAppTemplatePreviewBubble
          templateKey={template.name}
          components={template.components}
          fallbackText={body}
          className="mx-auto max-w-2xl"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <p className="text-[11px] text-muted-foreground">
          Synced {formatMetaDate(template.status_updated_at || template.submitted_at)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 text-muted-foreground hover:text-destructive"
          disabled={deleting === template.name}
          onClick={() => onDelete(template)}
          title="Delete template from Meta"
        >
          {deleting === template.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  description,
}: {
  title: string;
  count: number;
  description: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Badge variant="outline" className="text-[10px] shrink-0">{count}</Badge>
    </div>
  );
}

export function WhatsAppTemplateTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<WaTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [initialForm, setInitialForm] = useState<{ name?: string; category?: string; body?: string } | undefined>();
  const [selectedApprovedId, setSelectedApprovedId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data: dbRows, error: dbError } = await supabase
      .from("whatsapp_templates" as never)
      .select("*")
      .order("submitted_at", { ascending: false });

    if (dbError) console.error("Failed to fetch whatsapp_templates:", dbError);
    const localRows = (dbRows || []) as unknown as WaTemplateRow[];

    const { data: metaData, error: metaError } = await invokeEdge<{ templates?: MetaTemplate[]; error?: string }>("whatsapp-templates", {
      body: { action: "list" },
    });
    if (metaError || metaData?.error) {
      console.error("Failed to list Meta templates:", metaData?.error || metaError?.message);
      setRows(localRows);
      setLoading(false);
      return;
    }

    const localByName = new Map(localRows.map((row) => [`${row.name}:${row.language}`, row]));
    const metaRows: WaTemplateRow[] = (metaData?.templates || []).map((template) => {
      const local = localByName.get(`${template.name}:${template.language}`);
      const header = template.components?.find((component) => component.type === "HEADER");
      const bodyComp = template.components?.find((component) => component.type === "BODY");
      return {
        id: local?.id || template.id,
        meta_template_id: template.id,
        name: template.name,
        language: template.language || "en",
        category: template.category || local?.category || null,
        status: (template.status || local?.status || "PENDING").toUpperCase(),
        header_format: header?.format || local?.header_format || "NONE",
        has_media: ["IMAGE", "VIDEO", "DOCUMENT"].includes((header?.format || "").toUpperCase()),
        placeholder_count: (String(bodyComp?.text || "").match(/\{\{\d+\}\}/g) || []).length,
        components: template.components || local?.components || null,
        reject_reason: local?.reject_reason || null,
        quality_score: local?.quality_score || null,
        submitted_at: local?.submitted_at || null,
        status_updated_at: local?.status_updated_at || new Date().toISOString(),
      };
    });

    const metaKeys = new Set(metaRows.map((row) => `${row.name}:${row.language}`));
    const localOnlyRows = localRows.filter((row) => !metaKeys.has(`${row.name}:${row.language}`));
    setRows([...metaRows, ...localOnlyRows]);
    setLoading(false);
  }, []);

  // Initial load + realtime: status flips arrive live from the webhook.
  useEffect(() => {
    fetchRows();
    const channel = supabase
      .channel("whatsapp-templates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_templates" },
        () => { fetchRows(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRows]);

  const syncFromMeta = async () => {
    setSyncing(true);
    const { data, error } = await invokeEdge<{ synced?: number; error?: string }>("whatsapp-templates", { body: { action: "sync" } });
    if (error || data?.error) {
      toast({ title: "Sync failed", description: edgeErrorMessage(error, data), variant: "destructive" });
    } else {
      toast({
        title: data?.warning ? "Meta fetched" : "Synced from Meta",
        description: data?.warning || `${data?.synced ?? 0} template(s) reconciled.`,
      });
      await fetchRows();
    }
    setSyncing(false);
  };

  const deleteTemplate = async (template: WaTemplateRow) => {
    setDeleting(template.name);
    const { data, error } = await invokeEdge<{ error?: string }>("whatsapp-templates", {
      body: {
        action: "delete",
        name: template.name,
        meta_template_id: template.meta_template_id,
        language: template.language,
      },
    });
    if (error || data?.error) {
      toast({ title: "Delete failed", description: data?.error || error?.message, variant: "destructive" });
    } else {
      toast({ title: "Template deleted" });
      await fetchRows();
    }
    setDeleting(null);
  };

  const openSuggested = (s: typeof SUGGESTED_TEMPLATES[number]) => {
    setInitialForm({ name: s.name, category: s.category, body: s.body });
    setShowCreate(true);
  };

  const openBlank = () => {
    setInitialForm(undefined);
    setShowCreate(true);
  };

  const existingNames = new Set(rows.map((r) => r.name));
  const pendingSuggested = SUGGESTED_TEMPLATES.filter((s) => !existingNames.has(s.name));
  const approvedRows = rows.filter((r) => r.status === "APPROVED");
  const submittedRows = rows.filter((r) => r.status !== "APPROVED" && r.status !== "REJECTED");
  const attentionRows = rows.filter((r) => r.status === "REJECTED");
  const metaBackedCount = rows.filter((r) => r.meta_template_id).length;
  const selectedApproved = approvedRows.find((row) => row.id === selectedApprovedId) || approvedRows[0] || null;

  useEffect(() => {
    if (approvedRows.length === 0) {
      if (selectedApprovedId !== null) setSelectedApprovedId(null);
      return;
    }
    if (!selectedApprovedId || !approvedRows.some((row) => row.id === selectedApprovedId)) {
      setSelectedApprovedId(approvedRows[0].id);
    }
  }, [approvedRows, selectedApprovedId]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">WhatsApp Templates</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {metaBackedCount} Meta template{metaBackedCount === 1 ? "" : "s"} synced. Approval status, template ID, and category come from Meta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={syncFromMeta} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
          </Button>
          <Button size="sm" className="gap-2" onClick={openBlank}>
            <Plus className="h-4 w-4" /> Submit New Template
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <SectionHeader
          title="Approved Templates"
          count={approvedRows.length}
          description="Ready for one-to-one sends, automations, and bulk campaigns."
        />
        {loading ? (
          <PageLoader />
        ) : approvedRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No approved templates synced from Meta yet.
          </div>
        ) : (
          <div className="grid min-h-[520px] overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="border-b border-border lg:border-b-0 lg:border-r">
              <div className="max-h-[70vh] overflow-y-auto p-2">
                {approvedRows.map((template) => {
                  const { Icon, color } = statusVisual(template.status);
                  const body = templateBody(template);
                  const active = selectedApproved?.id === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedApprovedId(template.id)}
                      className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                        active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-semibold text-foreground">{template.name}</p>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                            {template.meta_template_id || "No Meta ID"}
                          </p>
                        </div>
                        <Badge className={`shrink-0 gap-1 border-0 text-[9px] ${color}`}>
                          <Icon className="h-3 w-3" />
                          {template.status}
                        </Badge>
                      </div>
                      {body && (
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {body}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <TemplatePreviewPanel template={selectedApproved} deleting={deleting} onDelete={deleteTemplate} />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Drafts"
          count={pendingSuggested.length}
          description="Suggested templates that are not yet submitted locally. Review them, edit copy/samples, then submit to Meta."
        />
        {pendingSuggested.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No draft suggestions left. Use Submit New Template for a custom template.
          </div>
        ) : (
          <div className="space-y-2">
            {pendingSuggested.map((s) => (
              <div key={s.name} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground font-mono">{s.name}</p>
                    <Badge variant="outline" className="text-[9px]">Draft</Badge>
                    <Badge variant="outline" className="text-[9px]">Category: {s.category}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                  <p className="text-xs text-foreground/70 mt-1.5 whitespace-pre-wrap bg-muted/30 rounded-lg px-2 py-1.5 line-clamp-3">{s.body}</p>
                </div>
                <Button size="sm" className="gap-1.5 shrink-0" onClick={() => openSuggested(s)}>
                  <Send className="h-3 w-3" /> Review &amp; Submit
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="Submitted To Meta"
          count={submittedRows.length + attentionRows.length}
          description="Pending, paused, disabled, or rejected templates that need monitoring or action."
        />
        {!loading && submittedRows.length === 0 && attentionRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing pending with Meta.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...attentionRows, ...submittedRows].map((template) => (
              <TemplateCard key={template.id} template={template} deleting={deleting} onDelete={deleteTemplate} />
            ))}
          </div>
        )}
      </section>

      <WhatsAppTemplateForm
        key={showCreate ? (initialForm?.name ?? "blank") : "closed"}
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmitted={fetchRows}
        initial={initialForm}
      />
    </div>
  );
}
