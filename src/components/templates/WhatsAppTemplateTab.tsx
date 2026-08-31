import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/integrations/supabase/edge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, MessageSquare, RefreshCw, Send, Search, CheckCircle, Clock, XCircle, AlertTriangle, Eye, EyeOff, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  waba_id?: string | null;
}

/** A WhatsApp Business Account we hold a usable token for. */
type WabaOption = { waba_id: string; label: string; is_default: boolean };

/** Per-account outcome of one sync run. `error` = that account was unreadable. */
type SyncWabaResult = { waba_id: string; label: string; fetched: number; error?: string };

type SyncResponse = {
  synced?: number;
  per_waba?: SyncWabaResult[];
  duplicate_names_skipped?: string[];
  warning?: string;
  error?: string;
};

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
              {deleting === template.name ? <ButtonOrb state="connecting" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ponytail: 3-state visibility selector for whatsapp_template_settings.visibility
const VISIBILITY_OPTIONS = [
  { value: "hidden", label: "Hidden", color: "border-input bg-muted/40 text-muted-foreground hover:bg-muted" },
  { value: "marketing_only", label: "Marketing", color: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20" },
  { value: "all", label: "All", color: "border-success/30 bg-success/10 text-success hover:bg-success/20" },
] as const;

function VisibilityToggle({
  value,
  onChange,
  size = "sm",
}: {
  value: string;
  onChange: (next: string) => void;
  size?: "sm" | "md";
}) {
  // Cycle: hidden → marketing_only → all → hidden
  const cycle = () => {
    const order = ["hidden", "marketing_only", "all"] as const;
    const idx = order.indexOf(value as any);
    onChange(order[(idx + 1) % 3]);
  };
  const opt = VISIBILITY_OPTIONS.find(o => o.value === value) || VISIBILITY_OPTIONS[0];
  const Icon = value === "all" ? Eye : value === "marketing_only" ? Eye : EyeOff;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); cycle(); }}
      title={value === "all" ? "Marketing + Counsellors — click to cycle" : value === "marketing_only" ? "Marketing only — click to cycle" : "Hidden — click to cycle"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-medium transition-colors ${
        size === "md" ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]"
      } ${opt.color}`}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
      {opt.label}
    </button>
  );
}

function TemplatePreviewPanel({
  template,
  deleting,
  onDelete,
  visible,
  onToggleVisible,
}: {
  template: WaTemplateRow | null;
  deleting: string | null;
  onDelete: (template: WaTemplateRow) => void;
  visible?: string;
  onToggleVisible?: (next: string) => void;
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
          <div className="flex shrink-0 items-center gap-2">
            {onToggleVisible && (
              <VisibilityToggle value={visible || "hidden"} onChange={onToggleVisible} size="md" />
            )}
            <Badge className={`gap-1 border-0 text-[10px] ${color}`}>
              <Icon className="h-3 w-3" />
              {template.status}
            </Badge>
          </div>
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
          {deleting === template.name ? <ButtonOrb state="connecting" /> : <Trash2 className="h-3.5 w-3.5" />}
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

export function WhatsAppTemplateTab({
  visibilityByKey,
  onToggleVisibility,
}: {
  visibilityByKey?: Record<string, string>;
  onToggleVisibility?: (templateKey: string, next: string) => void;
} = {}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WaTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [wabaOptions, setWabaOptions] = useState<WabaOption[]>([]);
  // Per-account outcome of the last sync. Kept on screen because a partial
  // failure (one bad token) is invisible in a single-line toast.
  const [syncReport, setSyncReport] = useState<SyncWabaResult[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [initialForm, setInitialForm] = useState<{ name?: string; category?: string; body?: string } | undefined>();
  const [selectedApprovedId, setSelectedApprovedId] = useState<string | null>(null);
  const [approvedSearch, setApprovedSearch] = useState("");

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

  // Sync covers every connected WhatsApp account by default. `wabaId` narrows it
  // to one — handy for retrying a single account whose token was just fixed.
  const syncFromMeta = async (wabaId?: string) => {
    setSyncing(true);
    setSyncReport(null);
    const { data, error } = await invokeEdge<SyncResponse>("whatsapp-templates", {
      body: { action: "sync", ...(wabaId ? { waba_id: wabaId } : {}) },
    });
    if (error || data?.error) {
      toast({ title: "Sync failed", description: edgeErrorMessage(error, data), variant: "destructive" });
    } else {
      const perWaba = data?.per_waba ?? [];
      setSyncReport(perWaba);
      const failed = perWaba.filter((w) => w.error);
      toast({
        title: data?.warning ? "Meta fetched" : "Synced from Meta",
        description: data?.warning
          || `${data?.synced ?? 0} template(s) reconciled across ${perWaba.length || 1} account(s).`
            + (failed.length ? ` ${failed.length} account(s) could not be read — see below.` : ""),
        variant: failed.length ? "destructive" : undefined,
      });
      await fetchRows();
    }
    setSyncing(false);
  };

  // Accounts we hold a usable token for, for the "sync just this one" menu.
  useEffect(() => {
    invokeEdge<{ wabas?: WabaOption[] }>("whatsapp-templates", { body: { action: "wabas" } })
      .then(({ data }) => setWabaOptions(data?.wabas ?? []))
      .catch(() => {});
  }, []);

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
  const filteredApprovedRows = useMemo(() => {
    const q = approvedSearch.trim().toLowerCase();
    if (!q) return approvedRows;
    return approvedRows.filter((row) => {
      const body = templateBody(row).toLowerCase();
      const header = (templateHeader(row)?.text || "").toLowerCase();
      return (
        row.name.toLowerCase().includes(q)
        || (row.meta_template_id || "").toLowerCase().includes(q)
        || (row.category || "").toLowerCase().includes(q)
        || (row.language || "").toLowerCase().includes(q)
        || body.includes(q)
        || header.includes(q)
      );
    });
  }, [approvedRows, approvedSearch]);
  const submittedRows = rows.filter((r) => r.status !== "APPROVED" && r.status !== "REJECTED");
  const attentionRows = rows.filter((r) => r.status === "REJECTED");
  const metaBackedCount = rows.filter((r) => r.meta_template_id).length;
  const selectedApproved =
    filteredApprovedRows.find((row) => row.id === selectedApprovedId)
    || filteredApprovedRows[0]
    || null;

  useEffect(() => {
    if (filteredApprovedRows.length === 0) {
      if (!approvedSearch.trim() && selectedApprovedId !== null) setSelectedApprovedId(null);
      return;
    }
    if (!selectedApprovedId || !filteredApprovedRows.some((row) => row.id === selectedApprovedId)) {
      setSelectedApprovedId(filteredApprovedRows[0].id);
    }
  }, [filteredApprovedRows, selectedApprovedId, approvedSearch]);

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
          {/* Split button: the main action syncs every account, the caret targets one. */}
          <div className="flex">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-r-none"
              onClick={() => syncFromMeta()}
              disabled={syncing}
              title="Sync templates from every connected WhatsApp Business Account"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sync all WABAs
              {wabaOptions.length > 1 && (
                <span className="text-[10px] text-muted-foreground">({wabaOptions.length})</span>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-l-none border-l-0 px-2"
                  disabled={syncing || wabaOptions.length === 0}
                  title="Sync a single account"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs">Sync one account only</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {wabaOptions.map((w) => (
                  <DropdownMenuItem
                    key={w.waba_id}
                    onSelect={(e) => { e.preventDefault(); void syncFromMeta(w.waba_id); }}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="text-xs">{w.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{w.waba_id}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button size="sm" className="gap-2" onClick={openBlank}>
            <Plus className="h-4 w-4" /> Submit New Template
          </Button>
        </div>
      </div>

      {/* A single-line toast hides a partial failure, and a WABA whose token has
          lapsed fails quietly forever. Show the per-account outcome instead. */}
      {syncReport && syncReport.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Last sync by account</p>
            <button
              onClick={() => setSyncReport(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-1">
            {syncReport.map((w) => (
              <li key={w.waba_id} className="flex flex-wrap items-center gap-2 text-xs">
                {w.error
                  ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  : <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success" />}
                <span className="text-foreground">{w.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{w.waba_id}</span>
                {w.error ? (
                  <span className="text-destructive">{w.error}</span>
                ) : (
                  <span className="text-muted-foreground">{w.fetched} template{w.fetched === 1 ? "" : "s"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader
            title="Approved Templates"
            count={approvedSearch.trim() ? filteredApprovedRows.length : approvedRows.length}
            description={
              approvedSearch.trim()
                ? `Showing ${filteredApprovedRows.length} of ${approvedRows.length} approved templates.`
                : "Ready for one-to-one sends, automations, and bulk campaigns."
            }
          />
          {approvedRows.length > 0 && (
            <div className="relative w-full sm:max-w-xs shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={approvedSearch}
                onChange={(e) => setApprovedSearch(e.target.value)}
                placeholder="Search name, body, category, Meta ID…"
                className="h-9 pl-9 text-sm"
                aria-label="Search approved templates"
              />
            </div>
          )}
        </div>
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
                {filteredApprovedRows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No approved templates match “{approvedSearch.trim()}”.
                  </div>
                ) : (
                  filteredApprovedRows.map((template) => {
                  const { Icon, color } = statusVisual(template.status);
                  const body = templateBody(template);
                  const active = selectedApproved?.id === template.id;
                  return (
                    <div
                      key={template.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedApprovedId(template.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedApprovedId(template.id); } }}
                      className={`w-full cursor-pointer rounded-lg px-3 py-3 text-left transition-colors ${
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
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge className={`gap-1 border-0 text-[9px] ${color}`}>
                            <Icon className="h-3 w-3" />
                            {template.status}
                          </Badge>
                          {onToggleVisibility && (
                            <VisibilityToggle
                              value={visibilityByKey?.[template.name] || "hidden"}
                              onChange={(next) => onToggleVisibility(template.name, next)}
                            />
                          )}
                        </div>
                      </div>
                      {body && (
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {body}
                        </p>
                      )}
                    </div>
                  );
                })
                )}
              </div>
            </div>
            {selectedApproved ? (
              <TemplatePreviewPanel
                template={selectedApproved}
                deleting={deleting}
                onDelete={deleteTemplate}
                visible={visibilityByKey?.[selectedApproved.name] || "hidden"}
                onToggleVisible={onToggleVisibility ? (next) => onToggleVisibility(selectedApproved.name, next) : undefined}
              />
            ) : (
              <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                Select a template from the list.
              </div>
            )}
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
