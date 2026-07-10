import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ListPlus, Loader2, Send, Mail, Trash2, Users, MessageSquare, AlertTriangle, Upload,
  Pause, PlayCircle, RefreshCw, XCircle, Phone, Check, ChevronDown,
  Megaphone,
} from "lucide-react";
import { WA_BULK_TEMPLATES, dynamicWaTemplateParams, type WaBulkTemplate } from "@/config/waBulkTemplates";
import {
  WhatsAppTemplatePreviewBubble,
  templateMediaUrlFromComponents,
  templateTextPreviewFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import {
  enrichApprovedWhatsAppTemplateMetadata,
  type ApprovedWhatsAppTemplateMetadata,
} from "@/lib/whatsappTemplateMeta";
import {
  WA_COMMON_VALUE,
  WA_PARAM_FIELD_OPTIONS,
  decodeWaParamFieldMapping,
  effectiveWaParamValue,
  encodeWaParamFieldMapping,
  isWaMappableTemplateParam,
  isWaMediaTemplateParam,
  sampleValueForWaMappedField,
  waBodyPreviewParams,
  waParamFieldLabel,
} from "@/lib/waCampaignParams";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import { decideBlockedRoleAccess, isAcademicPartnerPortalRole } from "@/lib/accessPolicy";

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

type CampaignChannel = "whatsapp" | "email";

interface CampaignQueueItem {
  id: string;
  channel: CampaignChannel;
  name: string;
  template: string | null;
  status: "pending" | "sending" | "paused" | "completed" | "failed" | "terminated";
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  business_phone_number_id: string | null;
  business_phone_number: string | null;
  created_at: string;
  completed_at: string | null;
}

type CounsellorOption = {
  id: string;
  name: string;
};

type LeadListAssignmentReportRow = {
  assignment_id: string;
  batch_id: string | null;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_stage: string | null;
  course_name: string | null;
  campus_name: string | null;
  assigned_to: string;
  assigned_to_name: string | null;
  assigned_by_name: string | null;
  previous_counsellor_name: string | null;
  latest_call_disposition: string | null;
  latest_call_response: string | null;
  latest_call_at: string | null;
  assigned_at: string;
};

type WaPhoneHealth = {
  phone_number_id: string;
  business_phone_number?: string | null;
  total: number;
  failed: number;
  read: number;
  failed_pct: number | null;
  read_pct: number | null;
};

type WaSenderOption = {
  value: string;
  label: string;
  provider: "meta" | "plivo";
  phoneNumberId: string | null;
  businessNumber: string | null;
  total: number | null;
  failed: number | null;
  failedPct: number | null;
  readPct: number | null;
  qualityRiskLevel: string | null;
};

const SOURCE_BADGE: Record<LeadList["source"], { label: string; cls: string }> = {
  manual:  { label: "Manual",   cls: "bg-pastel-blue text-foreground/70" },
  import:  { label: "Imported", cls: "bg-pastel-green text-foreground/70" },
  filter:  { label: "Filter",   cls: "bg-pastel-yellow text-foreground/70" },
};

const CAMPAIGN_STATUS_BADGE: Record<CampaignQueueItem["status"], string> = {
  pending: "bg-info/10 text-info-foreground",
  sending: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning-foreground",
  completed: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
  terminated: "bg-zinc-200 text-zinc-700",
};

const DEFAULT_WA_SENDER = "__default_bulk_sender__";
const WHATSAPP_BUSINESS_NAME = "NIMT Educational Institutions";
const KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER: Record<string, string> = {
  "1075269918995469": "917428499849",
  "970526789470416": "919599675267",
};

const defaultWaSenderOption = (): WaSenderOption => ({
  value: DEFAULT_WA_SENDER,
  label: "Bulk default sender",
  provider: "meta",
  phoneNumberId: null,
  businessNumber: null,
  total: null,
  failed: null,
  failedPct: null,
  readPct: null,
  qualityRiskLevel: null,
});

const knownBulkSenderOptions = (): WaSenderOption[] => [
  {
    value: "meta:919667691872",
    label: "Admissions Meta sender 9667691872",
    provider: "meta",
    phoneNumberId: null,
    businessNumber: "919667691872",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "normal",
  },
  {
    value: "meta:1075269918995469",
    label: "Bulk campaign Meta sender 7428499849",
    provider: "meta",
    phoneNumberId: "1075269918995469",
    businessNumber: "917428499849",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "watch",
  },
  {
    value: "plivo:919555192192",
    label: "Admissions Plivo sender 9555192192",
    provider: "plivo",
    phoneNumberId: null,
    businessNumber: "919555192192",
    total: null,
    failed: null,
    failedPct: null,
    readPct: null,
    qualityRiskLevel: "normal",
  },
];

const mergeKnownBulkSenders = (options: Map<string, WaSenderOption>) => {
  for (const sender of knownBulkSenderOptions()) {
    const byValue = options.get(sender.value);
    const byNumber = [...options.values()].find((option) =>
      option.provider === sender.provider &&
      digitsOnly(option.businessNumber) === digitsOnly(sender.businessNumber)
    );
    if (byValue || byNumber) continue;
    options.set(sender.value, sender);
  }
};

const digitsOnly = (value: string | null | undefined) => (value || "").replace(/[^0-9]/g, "");

const formatSenderNumber = (value: string | null | undefined) => {
  const digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value || "";
};

const formatPct = (value: number | null | undefined) =>
  typeof value === "number" ? `${value.toFixed(1)}%` : "n/a";

const senderHealthClass = (failedPct: number | null | undefined) => {
  if (typeof failedPct !== "number") return "bg-muted text-muted-foreground";
  if (failedPct >= 10) return "bg-destructive/10 text-destructive";
  if (failedPct >= 5) return "bg-warning/10 text-warning-foreground";
  return "bg-success/10 text-success";
};

const resolveBusinessNumber = (
  phoneNumberId: string | null | undefined,
  businessNumber: string | null | undefined,
) => {
  const numberDigits = digitsOnly(businessNumber);
  if (numberDigits) return numberDigits;
  return phoneNumberId ? KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER[phoneNumberId] || null : null;
};

const sampleValueForParam = (name: string) => {
  if (/^\d+$/.test(name)) return `sample ${name}`;
  if (name === "student_name") return "Rahul Sharma";
  if (name === "course_name") return "BPT";
  if (name === "campus_name") return "NIMT Greater Noida";
  if (name === "visit_date") return "14 Jun 2026, 11:00 AM";
  if (name === "amount") return "5,000";
  if (name === "due_date") return "14 Jun 2026";
  if (name === "application_id") return "NIMT-2026-001";
  return name.replace(/_/g, " ");
};

const renderTemplatePreview = (
  preview: string,
  staticParams: Record<string, string>,
  params: WaBulkTemplate["params"] = [],
) =>
  preview.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, name: string) => {
    const bodyParams = waBodyPreviewParams(params);
    const paramName = /^\d+$/.test(name) ? bodyParams[Number(name) - 1]?.name || name : name;
    const value = effectiveWaParamValue(staticParams, paramName);
    const mappedToken = decodeWaParamFieldMapping(value);
    if (mappedToken) return sampleValueForWaMappedField(mappedToken);
    const typed = value.trim();
    return typed || sampleValueForParam(paramName);
  });

const resolveCampaignNextAttemptAt = (mode: "now" | "scheduled", scheduledAt: string) => {
  if (mode === "now") return { nextAttemptAt: new Date().toISOString(), scheduled: false };
  const scheduledDate = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(scheduledDate.getTime())) {
    throw new Error("Choose a valid scheduled send time.");
  }
  if (scheduledDate.getTime() <= Date.now()) {
    throw new Error("Scheduled send time must be in the future.");
  }
  return { nextAttemptAt: scheduledDate.toISOString(), scheduled: true };
};

const WhatsAppBusinessIdentity = ({
  sender,
  selected,
  compact = false,
}: {
  sender: WaSenderOption;
  selected?: boolean;
  compact?: boolean;
}) => {
  const formattedNumber = formatSenderNumber(sender.businessNumber);
  const primaryLabel = formattedNumber || sender.label || "Default bulk route";
  const countryLabel = formattedNumber ? "🇮🇳 India" : "Default route";

  return (
    <div className={`flex w-full items-center gap-3 ${compact ? "py-1" : "rounded-md p-2"}`}>
      <Avatar className={compact ? "h-9 w-9 border bg-white" : "h-10 w-10 border bg-white"}>
        <AvatarImage src={nimtLogo} alt={WHATSAPP_BUSINESS_NAME} className="object-contain p-1" />
        <AvatarFallback className="bg-success/5 text-[10px] font-semibold text-success">NIMT</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{primaryLabel}</p>
          {sender.provider === "meta" && (
            <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px]">Meta</Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{countryLabel}</span>
          <span className="hidden sm:inline">•</span>
          <span className="truncate">{WHATSAPP_BUSINESS_NAME}</span>
          {!compact && <span>Name visible to customers</span>}
        </div>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge className={`border-0 text-[10px] ${senderHealthClass(sender.failedPct)}`}>
              7d failed {formatPct(sender.failedPct)}
            </Badge>
            <span className="text-[11px] text-muted-foreground">Read {formatPct(sender.readPct)}</span>
            {sender.total != null && (
              <span className="text-[11px] text-muted-foreground">{sender.total.toLocaleString("en-IN")} sends</span>
            )}
            {sender.qualityRiskLevel && (
              <span className="text-[11px] text-muted-foreground">Risk: {sender.qualityRiskLevel}</span>
            )}
          </div>
        )}
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-success" />}
    </div>
  );
};

export default function LeadLists() {
  const { toast } = useToast();
  const { profile, role, realRole, permissions, isImpersonating, user } = useAuth();
  const [lists, setLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [campaignQueue, setCampaignQueue] = useState<CampaignQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);

  // Send-WhatsApp dialog
  const [waOpen, setWaOpen] = useState(false);
  const [waList, setWaList] = useState<LeadList | null>(null);
  const [waTemplate, setWaTemplate] = useState<string>(WA_BULK_TEMPLATES[0].key);
  const [waCampaignName, setWaCampaignName] = useState("");
  const [waStaticParams, setWaStaticParams] = useState<Record<string, string>>({});
  const [waScheduleMode, setWaScheduleMode] = useState<"now" | "scheduled">("now");
  const [waScheduledAt, setWaScheduledAt] = useState("");
  const [waSenderValue, setWaSenderValue] = useState(DEFAULT_WA_SENDER);
  const [waSenderOptions, setWaSenderOptions] = useState<WaSenderOption[]>(() => [defaultWaSenderOption()]);
  const [waSenderLoading, setWaSenderLoading] = useState(false);
  const [waSenderError, setWaSenderError] = useState<string | null>(null);
  const [waSending, setWaSending] = useState(false);
  const [dynamicWaBulkTemplates, setDynamicWaBulkTemplates] = useState<WaBulkTemplate[]>([]);
  const [waMetaTemplateOverrides, setWaMetaTemplateOverrides] = useState<Record<string, Partial<Pick<WaBulkTemplate, "description" | "preview">>>>({});
  const [waTemplateComponentsByKey, setWaTemplateComponentsByKey] = useState<Record<string, WhatsAppTemplateComponent[]>>({});

  // Selected template definition — drives which static inputs we render.
  const availableWaBulkTemplates = useMemo(
    () => [
      ...WA_BULK_TEMPLATES.map((template) => ({ ...template, ...(waMetaTemplateOverrides[template.key] || {}) })),
      ...dynamicWaBulkTemplates,
    ],
    [dynamicWaBulkTemplates, waMetaTemplateOverrides]
  );
  const waTemplateDef = useMemo(
    () => availableWaBulkTemplates.find(t => t.key === waTemplate) || availableWaBulkTemplates[0] || WA_BULK_TEMPLATES[0],
    [availableWaBulkTemplates, waTemplate]
  );
  const waStaticFields = useMemo(
    () => waTemplateDef.params.filter(p => p.source === "static"),
    [waTemplateDef]
  );
  const waTemplateDefaultMediaUrl = useMemo(
    () => templateMediaUrlFromComponents(
      waTemplateDef.key,
      waTemplateComponentsByKey[waTemplateDef.key],
    ),
    [waTemplateDef.key, waTemplateComponentsByKey]
  );
  const waMissingStatic = waStaticFields.some((p) => {
    const value = effectiveWaParamValue(waStaticParams, p.name);
    if (isWaMediaTemplateParam(p.name) && waTemplateDefaultMediaUrl) return false;
    return !decodeWaParamFieldMapping(value) && !value.trim();
  });
  const waSelectedSender = useMemo(
    () => waSenderOptions.find((s) => s.value === waSenderValue) || waSenderOptions[0] || null,
    [waSenderOptions, waSenderValue]
  );
  const waRenderedPreview = useMemo(
    () => renderTemplatePreview(waTemplateDef.preview, waStaticParams, waTemplateDef.params),
    [waTemplateDef.preview, waTemplateDef.params, waStaticParams]
  );

  // Send-Email dialog
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailList, setEmailList] = useState<LeadList | null>(null);
  const [emailMode, setEmailMode] = useState<"template" | "custom">("template");
  const [emailTemplates, setEmailTemplates] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [emailSlug, setEmailSlug] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailCampaignName, setEmailCampaignName] = useState("");
  const [emailScheduleMode, setEmailScheduleMode] = useState<"now" | "scheduled">("now");
  const [emailScheduledAt, setEmailScheduledAt] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  // Members preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewList, setPreviewList] = useState<LeadList | null>(null);
  const [previewMembers, setPreviewMembers] = useState<Array<{ id: string; name: string; phone: string; email: string | null; stage: string }>>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // List assignment + calling report
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignList, setAssignList] = useState<LeadList | null>(null);
  const [counsellors, setCounsellors] = useState<CounsellorOption[]>([]);
  const [selectedCounsellorIds, setSelectedCounsellorIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignmentSummary, setAssignmentSummary] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportList, setReportList] = useState<LeadList | null>(null);
  const [assignmentReport, setAssignmentReport] = useState<LeadListAssignmentReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // Delete confirm
  const [deleteList, setDeleteList] = useState<LeadList | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canDeleteLists = role === "super_admin";

  const fetchLists = async () => {
    if (isAcademicPartnerPortalRole(role)) {
      setLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_lists" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Fetch lists failed:", error);
    setLists((data || []) as any);
    setLoading(false);
  };

  const fetchCampaignQueue = async () => {
    if (isAcademicPartnerPortalRole(role)) {
      setCampaignQueue([]);
      setQueueLoading(false);
      return;
    }
    setQueueLoading(true);
    const [waRes, emailRes] = await Promise.all([
      supabase
        .from("whatsapp_campaigns" as any)
        .select("id,name,template_key,status,total_recipients,sent_count,failed_count,business_phone_number_id,business_phone_number,created_at,completed_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("email_campaigns" as any)
        .select("id,name,template_slug,status,total_recipients,sent_count,failed_count,created_at,completed_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (waRes.error) console.error("Fetch WhatsApp campaigns failed:", waRes.error);
    if (emailRes.error) console.error("Fetch email campaigns failed:", emailRes.error);

    const wa = ((waRes.data || []) as any[]).map((c) => ({
      id: c.id,
      channel: "whatsapp" as const,
      name: c.name,
      template: c.template_key || null,
      status: c.status,
      total_recipients: c.total_recipients || 0,
      sent_count: c.sent_count || 0,
      failed_count: c.failed_count || 0,
      business_phone_number_id: c.business_phone_number_id || null,
      business_phone_number: c.business_phone_number || null,
      created_at: c.created_at,
      completed_at: c.completed_at || null,
    }));
    const email = ((emailRes.data || []) as any[]).map((c) => ({
      id: c.id,
      channel: "email" as const,
      name: c.name,
      template: c.template_slug || "custom",
      status: c.status,
      total_recipients: c.total_recipients || 0,
      sent_count: c.sent_count || 0,
      failed_count: c.failed_count || 0,
      business_phone_number_id: null,
      business_phone_number: null,
      created_at: c.created_at,
      completed_at: c.completed_at || null,
    }));

    setCampaignQueue([...wa, ...email]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20));
    setQueueLoading(false);
  };

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    fetchLists();
  }, [role]);

  const loadWaSenders = async () => {
    setWaSenderLoading(true);
    setWaSenderError(null);

    const [channelsRes, healthRes] = await Promise.all([
      supabase
        .from("whatsapp_channels" as any)
        .select("id,label,provider,route,business_number,meta_phone_number_id,allow_bulk,quality_risk_level")
        .eq("is_active", true)
        .eq("allow_bulk", true)
        .order("label", { ascending: true }),
      supabase.rpc("fn_whatsapp_health_dashboard" as any, { p_days: 7 }),
    ]);

    const healthRows = ((healthRes.data as any)?.phones || []) as WaPhoneHealth[];
    const healthByPhone = new Map(
      healthRows
        .filter((p) => p.phone_number_id && p.phone_number_id !== "(unset)")
        .map((p) => [p.phone_number_id, p])
    );

    const options = new Map<string, WaSenderOption>();
    options.set(DEFAULT_WA_SENDER, defaultWaSenderOption());
    mergeKnownBulkSenders(options);

    if (!channelsRes.error) {
      for (const channel of ((channelsRes.data || []) as any[])) {
        const phoneNumberId = channel.meta_phone_number_id || null;
        const businessNumber = channel.business_number || null;
        if (!phoneNumberId && !businessNumber) continue;
        const value = `${channel.provider}:${phoneNumberId || businessNumber}`;
        const health = phoneNumberId ? healthByPhone.get(phoneNumberId) : undefined;
        const resolvedBusinessNumber = resolveBusinessNumber(phoneNumberId, businessNumber || health?.business_phone_number);
        options.set(value, {
          value,
          label: formatSenderNumber(resolvedBusinessNumber) || channel.label || phoneNumberId || "WhatsApp sender",
          provider: channel.provider === "plivo" ? "plivo" : "meta",
          phoneNumberId,
          businessNumber: resolvedBusinessNumber,
          total: health?.total ?? null,
          failed: health?.failed ?? null,
          failedPct: health?.failed_pct ?? null,
          readPct: health?.read_pct ?? null,
          qualityRiskLevel: channel.quality_risk_level || null,
        });
      }
    }

    for (const health of healthRows) {
      if (!health.phone_number_id || health.phone_number_id === "(unset)") continue;
      const value = `meta:${health.phone_number_id}`;
      const existing = options.get(value);
      const businessNumber = resolveBusinessNumber(health.phone_number_id, existing?.businessNumber || health.business_phone_number);
      const existingByNumber = businessNumber
        ? [...options.values()].find((option) =>
            option.provider === "meta" && digitsOnly(option.businessNumber) === digitsOnly(businessNumber))
        : null;
      const targetValue = existingByNumber?.value || value;
      options.set(targetValue, {
        value: targetValue,
        label: formatSenderNumber(businessNumber) || existingByNumber?.label || existing?.label || `Meta sender ${health.phone_number_id}`,
        provider: "meta",
        phoneNumberId: existingByNumber?.phoneNumberId || health.phone_number_id,
        businessNumber,
        total: health.total,
        failed: health.failed,
        failedPct: health.failed_pct,
        readPct: health.read_pct,
        qualityRiskLevel: existingByNumber?.qualityRiskLevel || existing?.qualityRiskLevel || null,
      });
      if (targetValue !== value) options.delete(value);
    }

    if (channelsRes.error || healthRes.error) {
      setWaSenderError(channelsRes.error?.message || healthRes.error?.message || "Could not load WhatsApp sender health.");
    }

    mergeKnownBulkSenders(options);
    const concreteOptions = [...options.values()].filter((option) => option.value !== DEFAULT_WA_SENDER);
    const nextOptions = concreteOptions.length > 0 ? concreteOptions : [defaultWaSenderOption()];
    setWaSenderOptions(nextOptions);
    setWaSenderValue((current) => nextOptions.some((o) => o.value === current) ? current : nextOptions[0]?.value || DEFAULT_WA_SENDER);
    setWaSenderLoading(false);
  };

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    if (waOpen) loadWaSenders();
  }, [role, waOpen]);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    if (!waOpen) {
      setDynamicWaBulkTemplates([]);
      setWaMetaTemplateOverrides({});
      setWaTemplateComponentsByKey({});
      return;
    }
    (async () => {
      const knownKeys = new Set(WA_BULK_TEMPLATES.map((template) => template.key));
      const { data: settings } = await (supabase as any)
        .from("whatsapp_template_settings")
        .select("template_key, display_name, description, category, show_in_lead_picker")
        .eq("show_in_lead_picker", true);
      const settingsRows = ((settings || []) as Array<{
        template_key: string;
        display_name?: string | null;
        description?: string | null;
        category?: string | null;
      }>);
      const { data: approvedRows } = await (supabase as any)
        .from("whatsapp_templates")
        .select("name, components, placeholder_count, has_media, header_format")
        .eq("status", "APPROVED");
      const dynamicTemplateKeys = settingsRows
        .map((setting) => setting.template_key)
        .filter((templateKey) => templateKey && !knownKeys.has(templateKey));
      const approvedTemplateRows = await enrichApprovedWhatsAppTemplateMetadata(
        ((approvedRows || []) as ApprovedWhatsAppTemplateMetadata[]),
        dynamicTemplateKeys,
      );
      const overrides: Record<string, Partial<Pick<WaBulkTemplate, "description" | "preview">>> = {};
      const componentsByKey: Record<string, WhatsAppTemplateComponent[]> = {};
      approvedTemplateRows.forEach((row) => {
        if (row.name && row.components) componentsByKey[row.name] = row.components;
        if (!row.name || !knownKeys.has(row.name)) return;
        const preview = templateTextPreviewFromComponents(row.components);
        if (preview) overrides[row.name] = { preview };
      });
      setWaMetaTemplateOverrides(overrides);
      setWaTemplateComponentsByKey(componentsByKey);
      const approvedTemplateByName = new Map(approvedTemplateRows.map((row) => [row.name, row] as const));
      const dynamic = settingsRows
        .filter((setting) => setting.template_key && !knownKeys.has(setting.template_key))
        .map((setting) => {
          const row = approvedTemplateByName.get(setting.template_key);
          const metaMissingDescription = "Enabled in Template Visibility. Meta details are not available locally; dispatch will validate approval before sending.";
          return {
            key: setting.template_key,
            label: setting.display_name || setting.template_key.replace(/_/g, " "),
            description: row ? setting.description || "Approved Meta template" : setting.description || metaMissingDescription,
            preview: templateTextPreviewFromComponents(row?.components) || setting.description || setting.template_key,
            params: row ? dynamicWaTemplateParams(row.components, row.placeholder_count) : [],
          };
        });
      setDynamicWaBulkTemplates(dynamic);
    })();
  }, [role, waOpen]);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
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
  }, [emailOpen, role]);

  const openWa = (list: LeadList) => {
    setWaList(list);
    setWaCampaignName(`${list.name} — WhatsApp`);
    setWaTemplate(WA_BULK_TEMPLATES[0].key);
    setWaStaticParams({});
    setWaScheduleMode("now");
    setWaScheduledAt("");
    setWaSenderValue(DEFAULT_WA_SENDER);
    setWaOpen(true);
  };

  const openEmail = (list: LeadList) => {
    setEmailList(list);
    setEmailCampaignName(`${list.name} — Email`);
    setEmailMode("template");
    setEmailSubject("");
    setEmailBody("");
    setEmailScheduleMode("now");
    setEmailScheduledAt("");
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

  const loadAssignableCounsellors = async () => {
    if (role === "counsellor" && profile?.id) {
      const { data: ledTeams } = await supabase
        .from("teams")
        .select("id")
        .eq("leader_id", profile.id);

      if (!ledTeams || ledTeams.length === 0) {
        setCounsellors([{ id: profile.id, name: profile.display_name || "Me" }]);
        return;
      }

      const { data: teamMembers } = await supabase
        .from("team_members")
        .select("user_id")
        .in("team_id", ledTeams.map((team: any) => team.id));

      const memberUserIds = [...new Set((teamMembers || []).map((member: any) => member.user_id).filter(Boolean))];
      const { data: memberProfiles } = memberUserIds.length > 0
        ? await supabase
          .from("profiles")
          .select("id, display_name")
          .in("user_id", memberUserIds)
          .eq("login_disabled", false)
        : { data: [] };

      const scoped = new Map<string, string>([[profile.id, profile.display_name || "Me"]]);
      (memberProfiles || []).forEach((memberProfile: any) => {
        scoped.set(memberProfile.id, memberProfile.display_name || "Unknown");
      });
      setCounsellors(Array.from(scoped, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      return;
    }

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "counsellor");
    const userIds = [...new Set((roleRows || []).map((row: any) => row.user_id).filter(Boolean))];
    if (userIds.length === 0) {
      setCounsellors([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("user_id", userIds)
      .eq("login_disabled", false);
    setCounsellors(((profiles || []) as any[])
      .map((item) => ({ id: item.id, name: item.display_name || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  };

  const openAssign = async (list: LeadList) => {
    setAssignList(list);
    setSelectedCounsellorIds([]);
    setAssignmentSummary(null);
    setAssignOpen(true);
    await loadAssignableCounsellors();
  };

  const toggleCounsellor = (id: string) => {
    setSelectedCounsellorIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const assignListRoundRobin = async () => {
    if (!assignList || selectedCounsellorIds.length === 0) return;
    setAssigning(true);
    setAssignmentSummary(null);
    const { data, error } = await supabase.rpc("assign_lead_list_round_robin" as any, {
      _list_id: assignList.id,
      _counsellor_ids: selectedCounsellorIds,
    });
    setAssigning(false);
    if (error) {
      toast({ title: "Could not assign list", description: error.message, variant: "destructive" });
      return;
    }
    const rows = ((data as any[]) || []);
    const total = rows.reduce((sum, row) => sum + Number(row.assigned_count || 0), 0);
    setAssignmentSummary(`${total} lead${total === 1 ? "" : "s"} assigned across ${rows.length} counsellor${rows.length === 1 ? "" : "s"}.`);
    toast({ title: "List assigned", description: `${total} leads reassigned in round-robin order.` });
    await fetchLists();
  };

  const openAssignmentReport = async (list: LeadList) => {
    setReportList(list);
    setReportOpen(true);
    setReportLoading(true);
    const { data, error } = await supabase.rpc("get_lead_list_assignment_report" as any, {
      _list_id: list.id,
      _batch_id: null,
      _limit: 500,
    });
    if (error) {
      toast({ title: "Could not load calling report", description: error.message, variant: "destructive" });
      setAssignmentReport([]);
    } else {
      setAssignmentReport(((data as any[]) || []) as LeadListAssignmentReportRow[]);
    }
    setReportLoading(false);
  };

  const handleSendWhatsApp = async () => {
    if (!waList) return;
    setWaSending(true);
    let schedule: { nextAttemptAt: string; scheduled: boolean };
    try {
      schedule = resolveCampaignNextAttemptAt(waScheduleMode, waScheduledAt);
    } catch (error: any) {
      toast({ title: "Invalid schedule", description: error?.message, variant: "destructive" });
      setWaSending(false);
      return;
    }

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
      const v = effectiveWaParamValue(waStaticParams, f.name).trim();
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
        business_phone_number_id: waSelectedSender?.phoneNumberId || null,
        business_phone_number: waSelectedSender?.businessNumber || null,
        created_by: profile?.id || null,
        next_attempt_at: schedule.nextAttemptAt,
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
      title: schedule.scheduled ? "WhatsApp campaign scheduled" : "WhatsApp campaign queued",
      description: schedule.scheduled
        ? `${valid.length} recipients scheduled for ${new Date(schedule.nextAttemptAt).toLocaleString()}.`
        : `${valid.length} recipients queued. You can close this screen; progress is tracked in Marketing.`,
    });
    if (!schedule.scheduled) {
      supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1 } }).catch(() => {});
    }
    await fetchLists();
    await fetchCampaignQueue();
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
    let schedule: { nextAttemptAt: string; scheduled: boolean };
    try {
      schedule = resolveCampaignNextAttemptAt(emailScheduleMode, emailScheduledAt);
    } catch (error: any) {
      toast({ title: "Invalid schedule", description: error?.message, variant: "destructive" });
      setEmailSending(false);
      return;
    }

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
        next_attempt_at: schedule.nextAttemptAt,
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
      title: schedule.scheduled ? "Email campaign scheduled" : "Email campaign queued",
      description: schedule.scheduled
        ? `${valid.length} recipients scheduled for ${new Date(schedule.nextAttemptAt).toLocaleString()}.`
        : `${valid.length} recipients queued. You can close this screen; progress is tracked in Marketing.`,
    });
    if (!schedule.scheduled) {
      supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1 } }).catch(() => {});
    }
    await fetchLists();
    await fetchCampaignQueue();
  };

  const campaignTables = (channel: CampaignChannel) => ({
    campaign: channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns",
    recipients: channel === "whatsapp" ? "whatsapp_campaign_recipients" : "email_campaign_recipients",
    sender: channel === "whatsapp" ? "whatsapp-campaign-send" : "email-campaign-send",
  });

  const pauseCampaign = async (item: CampaignQueueItem) => {
    const tables = campaignTables(item.channel);
    setQueueBusyId(item.id);
    const { error } = await supabase
      .from(tables.campaign as any)
      .update({ status: "paused" })
      .eq("id", item.id)
      .in("status", ["pending", "sending"]);
    setQueueBusyId(null);
    if (error) {
      toast({ title: "Could not pause campaign", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Campaign paused", description: "The sender will stop before the next pending recipient." });
    }
    await fetchCampaignQueue();
  };

  const resumeCampaign = async (item: CampaignQueueItem) => {
    const tables = campaignTables(item.channel);
    setQueueBusyId(item.id);
    const { error } = await supabase
      .from(tables.campaign as any)
      .update({
        status: "pending",
        completed_at: null,
        next_attempt_at: new Date().toISOString(),
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", item.id)
      .in("status", ["paused", "failed"]);
    if (error) {
      setQueueBusyId(null);
      toast({ title: "Could not resume campaign", description: error.message, variant: "destructive" });
      await fetchCampaignQueue();
      return;
    }

    const { error: invokeErr } = await supabase.functions.invoke(tables.sender, {
      body: { campaign_id: item.id },
    });
    setQueueBusyId(null);
    if (invokeErr) {
      toast({ title: "Resume requested but sender errored", description: invokeErr.message, variant: "destructive" });
    } else {
      toast({ title: "Campaign resumed", description: "Remaining pending recipients are being processed." });
    }
    await fetchCampaignQueue();
  };

  const terminateCampaign = async (item: CampaignQueueItem) => {
    const ok = window.confirm(`Terminate "${item.name}"? Pending recipients will be canceled and cannot be resumed.`);
    if (!ok) return;

    const tables = campaignTables(item.channel);
    setQueueBusyId(item.id);
    const { error: campaignErr } = await supabase
      .from(tables.campaign as any)
      .update({ status: "terminated", completed_at: new Date().toISOString() })
      .eq("id", item.id)
      .in("status", ["pending", "sending", "paused", "failed"]);

    const { error: recipientErr } = await supabase
      .from(tables.recipients as any)
      .update({ status: "canceled", error_message: "Campaign terminated by operator" })
      .eq("campaign_id", item.id)
      .eq("status", "pending");

    setQueueBusyId(null);
    const error = campaignErr || recipientErr;
    if (error) {
      toast({ title: "Could not terminate campaign", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Campaign terminated", description: "Pending recipients were canceled." });
    }
    await fetchCampaignQueue();
  };

  const handleDelete = async () => {
    if (!deleteList || !canDeleteLists) return;
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

  const accessDecision = decideBlockedRoleAccess({
    isAuthenticated: !!user,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, ["academic_partner"]);
  if (accessDecision.allowed === false) return <Navigate to={accessDecision.redirectTo} replace />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lead Lists</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage reusable lead lists, counsellor assignment, and list-level calling reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 self-start">
          <Button asChild variant="outline" className="gap-2">
            <Link to="/marketing">
              <Megaphone className="h-4 w-4" />
              Marketing Hub
            </Link>
          </Button>
          <Button onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
          <div className="flex flex-col gap-1 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Lists</p>
              <p className="text-xs text-muted-foreground">Use Marketing Hub to initiate campaigns; use this page to maintain and assign lists.</p>
            </div>
          </div>
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
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openAssign(list)} disabled={list.member_count === 0}>
                          <Users className="h-3.5 w-3.5" /> Assign
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openAssignmentReport(list)}>
                          <Phone className="h-3.5 w-3.5" /> Calling Report
                        </Button>
                        <Button asChild size="sm" variant="outline" className="gap-1.5 h-8">
                          <Link to={`/marketing?listId=${list.id}`}>
                            <Megaphone className="h-3.5 w-3.5" /> New Campaign
                          </Link>
                        </Button>
                        {canDeleteLists && (
                          <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-destructive hover:text-destructive" onClick={() => setDeleteList(list)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Send WhatsApp to "{waList?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto px-6 py-4">
            <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-warning-foreground">
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
            <div className="grid max-w-xl gap-3 sm:grid-cols-[170px_240px]">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Send time</label>
                <select
                  value={waScheduleMode}
                  onChange={(e) => setWaScheduleMode(e.target.value as "now" | "scheduled")}
                  className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="now">Send now</option>
                  <option value="scheduled">Schedule for later</option>
                </select>
              </div>
              {waScheduleMode === "scheduled" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Scheduled date and time</label>
                  <input
                    type="datetime-local"
                    value={waScheduledAt}
                    onChange={(e) => setWaScheduledAt(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">Outgoing WhatsApp number</label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={loadWaSenders}
                  disabled={waSenderLoading}
                  className="h-6 gap-1 px-1.5 text-[11px]"
                >
                  {waSenderLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </Button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={waSenderLoading}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {waSelectedSender ? (
                      <WhatsAppBusinessIdentity sender={waSelectedSender} compact />
                    ) : (
                      <span className="flex-1 text-muted-foreground">Select outgoing WhatsApp number</span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] p-1.5">
                  {waSenderOptions.map((sender) => (
                    <DropdownMenuItem
                      key={sender.value}
                      onSelect={() => setWaSenderValue(sender.value)}
                      className="cursor-pointer p-0 focus:bg-muted"
                    >
                      <WhatsAppBusinessIdentity sender={sender} selected={sender.value === waSenderValue} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {waSelectedSender && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Phone className="h-3 w-3" />
                    {waSelectedSender.businessNumber
                      ? formatSenderNumber(waSelectedSender.businessNumber)
                      : waSelectedSender.phoneNumberId || "Default bulk route"}
                  </Badge>
                  <Badge className={`border-0 text-[10px] ${senderHealthClass(waSelectedSender.failedPct)}`}>
                    7d failed {formatPct(waSelectedSender.failedPct)}
                  </Badge>
                  <span>Read {formatPct(waSelectedSender.readPct)}</span>
                  {waSelectedSender.total != null && <span>{waSelectedSender.total.toLocaleString("en-IN")} sends</span>}
                  {waSelectedSender.qualityRiskLevel && <span>Risk: {waSelectedSender.qualityRiskLevel}</span>}
                </div>
              )}
              {waSenderError && (
                <p className="mt-1 text-[11px] text-warning-foreground">
                  Could not refresh sender health: {waSenderError}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <select
                value={waTemplate}
                onChange={(e) => { setWaTemplate(e.target.value); setWaStaticParams({}); }}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                {availableWaBulkTemplates.map((t) => (
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
                {waStaticFields.map((p) => {
                  const value = effectiveWaParamValue(waStaticParams, p.name);
                  const mappedToken = decodeWaParamFieldMapping(value);
                  const canMap = isWaMappableTemplateParam(p.name);
                  const isMediaParam = isWaMediaTemplateParam(p.name);
                  const hasDefaultMedia = isMediaParam && !!waTemplateDefaultMediaUrl;
                  const label = isMediaParam
                    ? hasDefaultMedia ? "Override header media URL" : "Header media URL"
                    : p.name.replace(/^template_value_(\d+)$/, "Body variable {{$1}}").replace(/_/g, " ");
                  return (
                    <div key={p.name}>
                      <label className="text-xs font-medium text-muted-foreground capitalize">
                        {label} {!hasDefaultMedia && <span className="text-destructive">*</span>}
                      </label>
                      {canMap && (
                        <select
                          value={mappedToken ? value : WA_COMMON_VALUE}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            setWaStaticParams((current) => ({
                              ...current,
                              [p.name]: nextValue === WA_COMMON_VALUE ? "" : nextValue,
                            }));
                          }}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        >
                          {WA_PARAM_FIELD_OPTIONS.map((option) => (
                            <option key={option.token} value={encodeWaParamFieldMapping(option.token)}>
                              Use list column: {option.label}
                            </option>
                          ))}
                          <option value={WA_COMMON_VALUE}>Use one common value</option>
                        </select>
                      )}
                      {(!canMap || !mappedToken) && (
                        <input
                          type="text"
                          value={canMap ? (waStaticParams[p.name] || "") : value}
                          onChange={(e) => setWaStaticParams(s => ({ ...s, [p.name]: e.target.value }))}
                          placeholder={hasDefaultMedia ? "Leave blank to use the approved template image" : p.placeholder || ""}
                          className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      )}
                      {mappedToken && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Filled per recipient from {waParamFieldLabel(mappedToken)}.
                        </p>
                      )}
                      {hasDefaultMedia && !value.trim() && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Uses the approved template image by default. Add a public URL here only to replace it for this campaign.
                        </p>
                      )}
                      {p.help && !hasDefaultMedia && !mappedToken && <p className="text-[11px] text-muted-foreground mt-1">{p.help}</p>}
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">
                  Per-lead values (name, course, campus) are filled automatically from each lead's record.
                </p>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Template preview</p>
                <span className="text-[11px] text-muted-foreground">Sample values shown</span>
              </div>
              <WhatsAppTemplatePreviewBubble
                templateKey={waTemplateDef.key}
                components={waTemplateComponentsByKey[waTemplateDef.key]}
                bodyText={waRenderedPreview}
                fallbackText={waRenderedPreview}
                className="max-h-[360px] overflow-y-auto"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Sending to <strong className="text-foreground">{waList?.member_count}</strong> lead{waList?.member_count === 1 ? "" : "s"} on this list (DNC + no-phone excluded at send time).
            </p>
          </div>
          <DialogFooter className="border-t border-border bg-background px-6 py-4">
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
            <div className="grid max-w-xl gap-3 sm:grid-cols-[170px_240px]">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Send time</label>
                <select
                  value={emailScheduleMode}
                  onChange={(e) => setEmailScheduleMode(e.target.value as "now" | "scheduled")}
                  className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="now">Send now</option>
                  <option value="scheduled">Schedule for later</option>
                </select>
              </div>
              {emailScheduleMode === "scheduled" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Scheduled date and time</label>
                  <input
                    type="datetime-local"
                    value={emailScheduledAt}
                    onChange={(e) => setEmailScheduledAt(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              )}
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
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
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

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign "{assignList?.name}" to counsellors</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              All list members will be reassigned in round-robin order across the selected counsellors.
            </p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {counsellors.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No counsellors available.</div>
              ) : (
                counsellors.map((counsellor) => {
                  const checked = selectedCounsellorIds.includes(counsellor.id);
                  return (
                    <label key={counsellor.id} className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCounsellor(counsellor.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium text-foreground">{counsellor.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            {assignmentSummary && <p className="rounded-md bg-success/5 px-3 py-2 text-sm text-success">{assignmentSummary}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Close</Button>
            <Button onClick={assignListRoundRobin} disabled={assigning || selectedCounsellorIds.length === 0} className="gap-2">
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Assign Round Robin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{reportList?.name} — Calling Report</DialogTitle>
          </DialogHeader>
          {reportLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : assignmentReport.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No list assignment activity found.</div>
          ) : (
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Lead</th>
                    <th className="px-3 py-2 text-left">Counsellor</th>
                    <th className="px-3 py-2 text-left">Assigned</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Latest Call</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentReport.map((row) => (
                    <tr key={row.assignment_id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{row.lead_name || "Unknown lead"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.lead_phone || "-"} {" | "} {row.course_name || "No course"}{row.campus_name ? ` | ${row.campus_name}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{row.assigned_to_name || "Unknown"}</p>
                        {row.previous_counsellor_name && <p className="text-[11px] text-muted-foreground">from {row.previous_counsellor_name}</p>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(row.assigned_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="capitalize">{(row.lead_stage || "-").replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {row.latest_call_disposition ? (
                          <>
                            <Badge className="border-0 bg-info/10 text-info-foreground">{row.latest_call_disposition.replace(/_/g, " ")}</Badge>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {row.latest_call_at ? new Date(row.latest_call_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No call response yet</span>
                        )}
                      </td>
                      <td className="max-w-md px-3 py-2 text-muted-foreground">
                        <p className="line-clamp-2 text-xs">{row.latest_call_response || "-"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
