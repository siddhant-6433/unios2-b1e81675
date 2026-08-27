import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DatePickerField, FieldShell, SelectField } from "@/components/ui/state-fields";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, ListPlus, Mail, Megaphone, MessageSquare, MousePointerClick, PauseCircle, PhoneCall, PlayCircle, RefreshCw, Reply, Send, StopCircle, Trash2, UserX, XCircle } from "lucide-react";
import {
  type WaSenderOption,
  DEFAULT_WA_SENDER,
  defaultWaSenderOption,
  loadWaSenders,
} from "@/lib/waSenders";
import { WhatsAppBusinessIdentity } from "@/components/whatsapp/WhatsAppBusinessIdentity";
import { getDatePresetRange, getEndExclusiveIso, type DatePreset } from "@/lib/datePresets";
import { decideBlockedRoleAccess, isAcademicPartnerPortalRole } from "@/lib/accessPolicy";
import { buildCampaignPacePlan, DEFAULT_DAILY_UNIQUE_CAP } from "@/lib/campaignPacing";
import {
  DEFAULT_QUIET_DAYS,
  filterCampaignRecipients,
} from "@/lib/campaignEligibility";
import { fetchLastWhatsAppMarketingAtByLeadIds } from "@/lib/campaignEligibilityFetch";
import { evaluateTemplateQualityForBulk } from "@/lib/campaignTemplateQuality";
import { AUTO_FILLED_PARAMS, WA_BULK_TEMPLATES, dynamicWaTemplateParams, type WaBulkTemplate } from "@/config/waBulkTemplates";
import {
  WhatsAppTemplatePreviewBubble,
  resolveSendableTemplateMediaUrl,
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

type Channel = "whatsapp" | "email";

interface CampaignRow {
  id: string;
  channel: Channel;
  name: string;
  template: string | null;
  listName: string | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  responded: number;
  called: number;
  clickedLink: number;
  clickedButton: number;
  delivered: number;
  read: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
  workerError: string | null;
}

interface LeadList {
  id: string;
  name: string;
  member_count: number;
}

interface EmailTemplate {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body_html: string;
}

interface RecipientRow {
  id: string;
  destination: string;
  leadName: string | null;
  status: string;
  error: string | null;
  sentAt: string | null;
  providerId: string | null;
  respondedAt: string | null;
  calledAt: string | null;
  callDisposition: string | null;
  clickedLinkAt: string | null;
  clickedUrl: string | null;
  clickedButtonAt: string | null;
  clickedButtonTitle: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
}

const statusTone = (status: string) => {
  if (status === "scheduled") return "bg-sky-100 text-sky-700";
  if (status === "completed") return "bg-success/10 text-success";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "sending") return "bg-info/10 text-info-foreground";
  if (status === "paused") return "bg-slate-100 text-slate-700";
  if (status === "terminated") return "bg-zinc-200 text-zinc-700";
  return "bg-warning/10 text-warning-foreground";
};

function scheduledDatePart(value: string) {
  return value.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || "";
}

function scheduledTimePart(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function defaultFutureTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function defaultFutureDateTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + `T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const pct = (num: number, den: number) => {
  if (!den) return "0.0%";
  return `${((num / den) * 100).toFixed(1)}%`;
};

const fmtDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const isFutureAttempt = (value: string | null) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
};

const campaignDisplayStatus = (campaign: Pick<CampaignRow, "status" | "nextAttemptAt">) => {
  if (campaign.status === "pending" && isFutureAttempt(campaign.nextAttemptAt)) return "scheduled";
  return campaign.status;
};

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (filename: string, headers: string[], rows: unknown[][]) => {
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const sampleValueForParam = (name: string) => {
  if (/^\d+$/.test(name)) return `sample ${name}`;
  if (name === "student_name") return "Rahul Sharma";
  if (name === "lead_name") return "Rahul Sharma";
  if (name === "phone") return "+91 98765 43210";
  if (name === "email") return "rahul@example.com";
  if (name === "lead_source") return "CUET list";
  if (name === "lead_stage") return "new";
  if (name === "guardian_name") return "Sunita Sharma";
  if (name === "guardian_phone") return "+91 98765 43211";
  if (name === "course_name") return "BPT";
  if (name === "campus_name") return "NIMT Greater Noida";
  if (name === "notes") return "CUET score: 418\nPreferred city: Greater Noida";
  if (name === "latest_note") return "CUET score: 418";
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

const renderEmailSample = (value: string) =>
  value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => sampleValueForParam(name));

const EMAIL_LIST_VALUE_TOKENS = [
  { token: "student_name", label: "Student name" },
  { token: "phone", label: "Phone" },
  { token: "email", label: "Email" },
  { token: "lead_source", label: "Source" },
  { token: "lead_stage", label: "Stage" },
  { token: "course_name", label: "Course" },
  { token: "campus_name", label: "Campus" },
  { token: "guardian_name", label: "Guardian name" },
  { token: "guardian_phone", label: "Guardian phone" },
  { token: "latest_note", label: "Latest note" },
  { token: "notes", label: "All notes / imported extras" },
];

export default function Marketing() {
  const { profile, role, realRole, permissions, isImpersonating, user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const initialCustomRange = useMemo(() => getDatePresetRange("last_30"), []);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState(initialCustomRange.from);
  const [dateTo, setDateTo] = useState(initialCustomRange.to);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [queueingId, setQueueingId] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState("");
  const [campaignChannel, setCampaignChannel] = useState<Channel>("whatsapp");
  const [campaignName, setCampaignName] = useState("");
  const [campaignScheduleMode, setCampaignScheduleMode] = useState<"now" | "scheduled">("now");
  const [campaignScheduledAt, setCampaignScheduledAt] = useState("");
  const [waSendMode, setWaSendMode] = useState<"immediate" | "paced">("immediate");
  const [waDailyCap, setWaDailyCap] = useState(String(DEFAULT_DAILY_UNIQUE_CAP));
  const [waExcludeCold, setWaExcludeCold] = useState(true);
  const [waQuietDaysEnabled, setWaQuietDaysEnabled] = useState(true);
  const [waQuietDays, setWaQuietDays] = useState(String(DEFAULT_QUIET_DAYS));
  const [waTemplateQualityByKey, setWaTemplateQualityByKey] = useState<Record<string, string | null>>({});
  const [waTemplate, setWaTemplate] = useState(WA_BULK_TEMPLATES[0]?.key || "");
  const [waStaticParams, setWaStaticParams] = useState<Record<string, string>>({});
  const [dynamicWaBulkTemplates, setDynamicWaBulkTemplates] = useState<WaBulkTemplate[]>([]);
  const [waMetaTemplateOverrides, setWaMetaTemplateOverrides] = useState<Record<string, Partial<Pick<WaBulkTemplate, "description" | "preview">>>>({});
  const [waTemplateComponentsByKey, setWaTemplateComponentsByKey] = useState<Record<string, WhatsAppTemplateComponent[]>>({});
  const [waSenderValue, setWaSenderValue] = useState(DEFAULT_WA_SENDER);
  const [waSenderOptions, setWaSenderOptions] = useState<WaSenderOption[]>(() => [defaultWaSenderOption()]);
  const [waTestPhone, setWaTestPhone] = useState("");
  const [waTestSending, setWaTestSending] = useState(false);
  const [emailMode, setEmailMode] = useState<"template" | "custom">("template");
  const [emailSlug, setEmailSlug] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailInsertTarget, setEmailInsertTarget] = useState<"subject" | "body">("body");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [deleteList, setDeleteList] = useState<LeadList | null>(null);
  const [deletingList, setDeletingList] = useState(false);
  const [resendCampaign, setResendCampaign] = useState<CampaignRow | null>(null);
  const [resendMode, setResendMode] = useState<"now" | "scheduled">("now");
  const [resendScheduledAt, setResendScheduledAt] = useState("");
  const [resending, setResending] = useState(false);
  const requestedListId = searchParams.get("listId") || "";
  const canDeleteLists = role === "super_admin";
  const scheduledDateValue = scheduledDatePart(campaignScheduledAt);
  const scheduledTimeValue = scheduledTimePart(campaignScheduledAt);
  const waSelectedSender = useMemo(
    () => waSenderOptions.find((s) => s.value === waSenderValue) || waSenderOptions[0] || null,
    [waSenderOptions, waSenderValue]
  );

  const setScheduledDate = (date: string) => {
    if (!date) {
      setCampaignScheduledAt(scheduledTimeValue ? `T${scheduledTimeValue}` : "");
      return;
    }
    setCampaignScheduledAt(`${date}T${scheduledTimeValue || defaultFutureTime()}`);
  };

  const setScheduledTime = (time: string) => {
    if (!time) {
      setCampaignScheduledAt(scheduledDateValue ? `${scheduledDateValue}T` : "");
      return;
    }
    setCampaignScheduledAt(`${scheduledDateValue ? `${scheduledDateValue}T` : "T"}${time}`);
  };

  const selectedList = useMemo(
    () => lists.find((list) => list.id === selectedListId) || null,
    [lists, selectedListId],
  );
  const availableWaBulkTemplates = useMemo(
    () => [
      ...WA_BULK_TEMPLATES.map((template) => ({ ...template, ...(waMetaTemplateOverrides[template.key] || {}) })),
      ...dynamicWaBulkTemplates,
    ],
    [dynamicWaBulkTemplates, waMetaTemplateOverrides],
  );
  const selectedWaTemplate = useMemo(
    () => availableWaBulkTemplates.find((template) => template.key === waTemplate) || availableWaBulkTemplates[0] || WA_BULK_TEMPLATES[0],
    [availableWaBulkTemplates, waTemplate],
  );
  const waTemplateQuality = useMemo(
    () => evaluateTemplateQualityForBulk(waTemplateQualityByKey[selectedWaTemplate?.key || waTemplate]),
    [waTemplateQualityByKey, selectedWaTemplate?.key, waTemplate],
  );
  const waStaticFields = useMemo(
    () => (selectedWaTemplate?.params || []).filter((param) => param.source === "static" && !AUTO_FILLED_PARAMS.includes(param.name as any)),
    [selectedWaTemplate],
  );
  const selectedWaTemplateDefaultMediaUrl = useMemo(
    () => resolveSendableTemplateMediaUrl(
      selectedWaTemplate?.key,
      waTemplateComponentsByKey[selectedWaTemplate?.key || ""],
    ),
    [selectedWaTemplate?.key, waTemplateComponentsByKey],
  );
  const handleSendTest = useCallback(async () => {
    if (!waTemplate || !waTestPhone.trim()) return;
    setWaTestSending(true);
    try {
      const params: string[] = [];
      for (const p of selectedWaTemplate?.params || []) {
        if (isWaMediaTemplateParam(p.name)) continue;
        const value = effectiveWaParamValue(waStaticParams, p.name);
        const mappedToken = decodeWaParamFieldMapping(value);
        if (mappedToken) {
          params.push(sampleValueForWaMappedField(mappedToken));
        } else if (value.trim()) {
          params.push(value.trim());
        } else {
          params.push(sampleValueForParam(p.name));
        }
      }

      const hasMediaHeader = (selectedWaTemplate?.params || []).some((p) => isWaMediaTemplateParam(p.name));
      const headerImageUrl = hasMediaHeader
        ? (effectiveWaParamValue(waStaticParams, "template_header_media_url").trim() || selectedWaTemplateDefaultMediaUrl || undefined)
        : undefined;

      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: waTemplate,
          phone: waTestPhone.trim(),
          params,
          provider: "meta",
          business_phone_number_id: waSelectedSender?.phoneNumberId || null,
          business_number: waSelectedSender?.businessNumber || null,
          ...(headerImageUrl ? { header_image_url: headerImageUrl } : {}),
        },
      });
      if (error || data?.error || data?.ok === false) {
        throw new Error(error?.message || data?.error || "Send failed.");
      }
      toast({ title: "Test sent", description: `Sent to ${waTestPhone}` });
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Could not send test message.",
        variant: "destructive",
      });
    } finally {
      setWaTestSending(false);
    }
  }, [waTemplate, waTestPhone, selectedWaTemplate, waStaticParams, waSelectedSender, selectedWaTemplateDefaultMediaUrl, toast]);

  const waMissingStatic = waStaticFields.some((param) => {
    const value = effectiveWaParamValue(waStaticParams, param.name);
    if (isWaMediaTemplateParam(param.name) && selectedWaTemplateDefaultMediaUrl) return false;
    return !decodeWaParamFieldMapping(value) && !value.trim();
  });
  const waRenderedPreview = useMemo(
    () => renderTemplatePreview(selectedWaTemplate?.preview || "", waStaticParams, selectedWaTemplate?.params || []),
    [selectedWaTemplate, waStaticParams],
  );
  const selectedEmailTemplate = useMemo(
    () => emailTemplates.find((template) => template.slug === emailSlug) || null,
    [emailSlug, emailTemplates],
  );
  const emailPreviewSubject = emailMode === "template"
    ? renderEmailSample(selectedEmailTemplate?.subject || selectedEmailTemplate?.name || "Email subject")
    : renderEmailSample(emailSubject || "Campaign subject");
  const emailPreviewBody = emailMode === "template"
    ? renderEmailSample(selectedEmailTemplate?.body_html || "<p>Select an email template to preview the message.</p>")
    : renderEmailSample(emailBody || "<p>Write a custom email body to preview it here.</p>");

  const insertEmailValueToken = (token: string) => {
    const value = `{{${token}}}`;
    if (emailInsertTarget === "subject") {
      setEmailSubject((current) => current ? `${current} ${value}` : value);
    } else {
      setEmailBody((current) => current ? `${current}\n${value}` : value);
    }
  };

  const dateBounds = useMemo(() => {
    if (datePreset === "all") return { from: null, to: null };
    const range = datePreset === "custom"
      ? { from: dateFrom, to: dateTo }
      : getDatePresetRange(datePreset);
    return {
      from: range.from ? new Date(`${range.from}T00:00:00`).toISOString() : null,
      to: range.to ? getEndExclusiveIso(range.to) : null,
    };
  }, [dateFrom, datePreset, dateTo]);

  const load = useCallback(async () => {
    if (isAcademicPartnerPortalRole(role)) {
      setCampaigns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let whatsappQuery = supabase
      .from("whatsapp_campaigns" as any)
      .select("id,name,template_key,total_recipients,sent_count,failed_count,response_count,called_count,link_click_count,button_click_count,status,created_at,completed_at,next_attempt_at,worker_error,lead_lists(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    let emailQuery = supabase
      .from("email_campaigns" as any)
      .select("id,name,template_slug,total_recipients,sent_count,failed_count,response_count,called_count,link_click_count,button_click_count,status,created_at,completed_at,next_attempt_at,worker_error,lead_lists(name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (dateBounds.from) {
      whatsappQuery = whatsappQuery.gte("created_at", dateBounds.from);
      emailQuery = emailQuery.gte("created_at", dateBounds.from);
    }
    if (dateBounds.to) {
      whatsappQuery = whatsappQuery.lt("created_at", dateBounds.to);
      emailQuery = emailQuery.lt("created_at", dateBounds.to);
    }

    const [waRes, emailRes] = await Promise.all([
      whatsappQuery,
      emailQuery,
    ]);

    const waIds = ((waRes.data as any[]) || []).map((row) => row.id);
    const funnelRes = waIds.length
      ? await supabase.rpc("campaign_funnel_counts" as any, { p_campaign_ids: waIds })
      : null;
    const funnelById = new Map<string, { delivered: number; read: number; failed: number }>(
      ((funnelRes?.data as any[]) || []).map((r) => [
        r.campaign_id,
        { delivered: Number(r.delivered || 0), read: Number(r.read || 0), failed: Number(r.failed || 0) },
      ]),
    );

    const waRows: CampaignRow[] = ((waRes.data as any[]) || []).map((row) => {
      const total = Number(row.total_recipients || 0);
      const sent = Number(row.sent_count || 0);
      const failed = Number(row.failed_count || 0);
      return {
        id: row.id,
        channel: "whatsapp",
        name: row.name,
        template: row.template_key,
        listName: row.lead_lists?.name || null,
        total,
        sent,
        failed,
        pending: row.status === "completed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        responded: Number(row.response_count || 0),
        called: Number(row.called_count || 0),
        clickedLink: Number(row.link_click_count || 0),
        clickedButton: Number(row.button_click_count || 0),
        delivered: funnelById.get(row.id)?.delivered ?? 0,
        read: funnelById.get(row.id)?.read ?? 0,
        status: row.status || "pending",
        createdAt: row.created_at,
        completedAt: row.completed_at,
        nextAttemptAt: row.next_attempt_at || null,
        workerError: row.worker_error || null,
      };
    });

    const emailRows: CampaignRow[] = ((emailRes.data as any[]) || []).map((row) => {
      const total = Number(row.total_recipients || 0);
      const sent = Number(row.sent_count || 0);
      const failed = Number(row.failed_count || 0);
      return {
        id: row.id,
        channel: "email",
        name: row.name,
        template: row.template_slug || "custom",
        listName: row.lead_lists?.name || null,
        total,
        sent,
        failed,
        pending: row.status === "completed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        responded: Number(row.response_count || 0),
        called: Number(row.called_count || 0),
        clickedLink: Number(row.link_click_count || 0),
        clickedButton: Number(row.button_click_count || 0),
        delivered: 0,
        read: 0,
        status: row.status || "pending",
        createdAt: row.created_at,
        completedAt: row.completed_at,
        nextAttemptAt: row.next_attempt_at || null,
        workerError: row.worker_error || null,
      };
    });

    setCampaigns([...waRows, ...emailRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  }, [dateBounds, role]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadWaSenders(supabase as any)
      .then(({ options }) => {
        setWaSenderOptions(options);
        setWaSenderValue((c) => options.some((o) => o.value === c) ? c : options[0]?.value || DEFAULT_WA_SENDER);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    (async () => {
      const [listsRes, templatesRes] = await Promise.all([
        supabase
          .from("lead_lists" as any)
          .select("id,name,member_count")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("email_templates" as any)
          .select("id,slug,name,subject,body_html")
          .eq("is_active", true)
          .order("name"),
      ]);
      const nextLists = ((listsRes.data as any[]) || []) as LeadList[];
      const nextTemplates = ((templatesRes.data as any[]) || []) as EmailTemplate[];
      setLists(nextLists);
      setEmailTemplates(nextTemplates);
      setSelectedListId((current) => {
        if (requestedListId && nextLists.some((list) => list.id === requestedListId)) return requestedListId;
        return current || nextLists[0]?.id || "";
      });
      setEmailSlug((current) => current || nextTemplates[0]?.slug || "");
    })();
  }, [requestedListId, role]);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    (async () => {
      const knownKeys = new Set(WA_BULK_TEMPLATES.map((template) => template.key));
      const { data: settings } = await (supabase as any)
        .from("whatsapp_template_settings")
        .select("template_key, display_name, description, category, visibility")
        .in("visibility", ["marketing_only", "all"]);
      const settingsRows = ((settings || []) as Array<{
        template_key: string;
        display_name?: string | null;
        description?: string | null;
      }>);
      const { data: approvedRows } = await (supabase as any)
        .from("whatsapp_templates")
        .select("name, components, placeholder_count, has_media, header_format, quality_score")
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
      const qualityByKey: Record<string, string | null> = {};
      (approvedRows || []).forEach((row: { name?: string; quality_score?: string | null }) => {
        if (row.name) qualityByKey[row.name] = row.quality_score ?? null;
      });
      approvedTemplateRows.forEach((row) => {
        if (row.name && row.components) componentsByKey[row.name] = row.components;
        if (!row.name || !knownKeys.has(row.name)) return;
        const preview = templateTextPreviewFromComponents(row.components);
        if (preview) overrides[row.name] = { preview };
      });

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

      setWaMetaTemplateOverrides(overrides);
      setWaTemplateComponentsByKey(componentsByKey);
      setWaTemplateQualityByKey(qualityByKey);
      setDynamicWaBulkTemplates(dynamic);
    })();
  }, [role]);

  const totals = useMemo(() => {
    return campaigns.reduce(
      (acc, item) => {
        acc.total += item.total;
        acc.sent += item.sent;
        acc.failed += item.failed;
        acc.pending += item.pending;
        acc.responded += item.responded;
        acc.called += item.called;
        acc.clickedLink += item.clickedLink;
        acc.clickedButton += item.clickedButton;
        acc.delivered += item.delivered;
        acc.read += item.read;
        if (item.channel === "whatsapp") acc.whatsapp += item.sent;
        if (item.channel === "email") acc.email += item.sent;
        return acc;
      },
      { total: 0, sent: 0, failed: 0, pending: 0, responded: 0, called: 0, clickedLink: 0, clickedButton: 0, delivered: 0, read: 0, whatsapp: 0, email: 0 },
    );
  }, [campaigns]);

  const launchCampaign = async () => {
    if (!selectedList) {
      setLaunchError("Pick a lead list first.");
      return;
    }
    setLaunching(true);
    setLaunchError(null);

    try {
      let nextAttemptAt = new Date().toISOString();
      const isScheduled = campaignScheduleMode === "scheduled";
      if (isScheduled) {
        const scheduledDate = new Date(campaignScheduledAt);
        if (!campaignScheduledAt || Number.isNaN(scheduledDate.getTime())) {
          throw new Error("Choose a valid scheduled send time.");
        }
        if (scheduledDate.getTime() <= Date.now()) {
          throw new Error("Scheduled send time must be in the future.");
        }
        nextAttemptAt = scheduledDate.toISOString();
      }

      if (campaignChannel === "whatsapp") {
        if (!waTemplate) throw new Error("Pick a WhatsApp template.");
        if (waMissingStatic) throw new Error("Fill the required template fields.");
        if (!waTemplateQuality.allowBulk) throw new Error(waTemplateQuality.detail);

        const { data: members, error: memErr } = await supabase
          .from("lead_list_members" as any)
          .select("lead_id, leads(id, phone, stage, shared_with_nimt)")
          .eq("list_id", selectedList.id);
        if (memErr) throw memErr;

        const rawLeads = ((members as any[]) || [])
          .map((member) => member.leads)
          .filter((lead) => lead && lead.id);

        const quietDays = waQuietDaysEnabled ? Math.max(0, Number(waQuietDays) || DEFAULT_QUIET_DAYS) : 0;
        let lastMarketingAtByLeadId = new Map<string, string>();
        if (quietDays > 0 && rawLeads.length > 0) {
          lastMarketingAtByLeadId = await fetchLastWhatsAppMarketingAtByLeadIds(
            supabase as any,
            rawLeads.map((lead: { id: string }) => lead.id),
            Math.max(quietDays, 30),
          );
        }

        const eligibility = filterCampaignRecipients(rawLeads, {
          channel: "whatsapp",
          excludeCold: waExcludeCold,
          quietDays,
          lastMarketingAtByLeadId,
        });
        const valid = eligibility.eligible;
        if (!valid.length) {
          throw new Error(eligibility.preview || "No reachable WhatsApp recipients after DNC/quality filters.");
        }

        const staticParamsToSend: Record<string, string> = {};
        for (const field of waStaticFields) {
          const value = effectiveWaParamValue(waStaticParams, field.name).trim();
          if (value) staticParamsToSend[field.name] = value;
        }

        const pacePlan = buildCampaignPacePlan({
          recipientCount: valid.length,
          sendMode: waSendMode,
          dailyUniqueCap: waSendMode === "paced" ? Number(waDailyCap) : null,
          startAt: nextAttemptAt,
        });

        const { data: campaign, error: campErr } = await supabase
          .from("whatsapp_campaigns" as any)
          .insert({
            name: campaignName.trim() || `${selectedList.name} - WhatsApp`,
            template_key: waTemplate,
            list_id: selectedList.id,
            total_recipients: valid.length,
            static_params: staticParamsToSend,
            business_phone_number_id: waSelectedSender?.phoneNumberId || null,
            business_phone_number: waSelectedSender?.businessNumber || null,
            created_by: profile?.id || null,
            next_attempt_at: nextAttemptAt,
            worker_locked_at: null,
            status: "pending",
            send_mode: pacePlan.sendMode,
            daily_unique_cap: pacePlan.dailyUniqueCap,
            paced_wave_count: pacePlan.waveCount,
          })
          .select("id")
          .single();
        if (campErr || !campaign) throw campErr || new Error("Could not create WhatsApp campaign.");

        const rows = valid.map((lead, index) => ({
          campaign_id: (campaign as any).id,
          lead_id: lead.id,
          phone: lead.phone,
          eligible_at: pacePlan.eligibleAtByIndex[index] || nextAttemptAt,
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from("whatsapp_campaign_recipients" as any).insert(rows.slice(i, i + 500));
          if (error) throw error;
        }
      } else {
        if (emailMode === "template" && !emailSlug) throw new Error("Pick an email template.");
        if (emailMode === "custom" && (!emailSubject.trim() || !emailBody.trim())) {
          throw new Error("Subject and body are required for custom email.");
        }

        const { data: members, error: memErr } = await supabase
          .from("lead_list_members" as any)
          .select("lead_id, leads(id, email, stage, shared_with_nimt)")
          .eq("list_id", selectedList.id);
        if (memErr) throw memErr;

        const rawEmailLeads = ((members as any[]) || [])
          .map((member) => member.leads)
          .filter((lead) => lead && lead.id);
        const emailEligibility = filterCampaignRecipients(rawEmailLeads, {
          channel: "email",
          excludeCold: false,
          quietDays: 0,
        });
        const valid = emailEligibility.eligible;
        if (!valid.length) {
          throw new Error(emailEligibility.preview || "No reachable email recipients on this list (DNC excluded).");
        }

        const { data: campaign, error: campErr } = await supabase
          .from("email_campaigns" as any)
          .insert({
            name: campaignName.trim() || `${selectedList.name} - Email`,
            list_id: selectedList.id,
            template_slug: emailMode === "template" ? emailSlug : null,
            custom_subject: emailMode === "custom" ? emailSubject.trim() : null,
            custom_body: emailMode === "custom" ? emailBody : null,
            total_recipients: valid.length,
            created_by: profile?.id || null,
            next_attempt_at: nextAttemptAt,
            worker_locked_at: null,
            status: "pending",
          })
          .select("id")
          .single();
        if (campErr || !campaign) throw campErr || new Error("Could not create email campaign.");

        const rows = valid.map((lead) => ({
          campaign_id: (campaign as any).id,
          lead_id: lead.id,
          to_email: lead.email,
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from("email_campaign_recipients" as any).insert(rows.slice(i, i + 500));
          if (error) throw error;
        }
      }

      if (!isScheduled) {
        await supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1, batch_size: 10 } }).catch(() => {});
      }
      toast({
        title: isScheduled ? "Campaign scheduled" : "Campaign queued",
        description: isScheduled
          ? `This campaign will start at ${new Date(nextAttemptAt).toLocaleString()}.`
          : "Progress is tracked below in Executed Campaigns.",
      });
      setCampaignName("");
      setCampaignScheduleMode("now");
      setCampaignScheduledAt("");
      setWaSendMode("immediate");
      setWaDailyCap(String(DEFAULT_DAILY_UNIQUE_CAP));
      await load();
    } catch (error: any) {
      setLaunchError(error?.message || "Could not queue campaign.");
      toast({ title: "Could not queue campaign", description: error?.message, variant: "destructive" });
    } finally {
      setLaunching(false);
    }
  };

  const handleDeleteList = async () => {
    if (!deleteList || !canDeleteLists) return;
    setDeletingList(true);
    const { error } = await supabase.from("lead_lists" as any).delete().eq("id", deleteList.id);
    setDeletingList(false);

    if (error) {
      toast({ title: "Could not delete list", description: error.message, variant: "destructive" });
      return;
    }

    const deletedId = deleteList.id;
    const nextLists = lists.filter((list) => list.id !== deletedId);
    setLists(nextLists);
    if (selectedListId === deletedId) {
      setSelectedListId(nextLists[0]?.id || "");
    }
    setDeleteList(null);
    toast({ title: "List deleted" });
  };

  const openRecipients = async (campaign: CampaignRow) => {
    setDetailCampaign(campaign);
    setRecipientsLoading(true);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaign_recipients" : "email_campaign_recipients";
    const destinationColumn = campaign.channel === "whatsapp" ? "phone" : "to_email";
    const providerColumn = campaign.channel === "whatsapp" ? "message_id" : "provider_id";
    const funnelColumns = campaign.channel === "whatsapp" ? ",delivered_at,read_at,failed_at" : "";
    const { data } = await supabase
      .from(table as any)
      .select(`id,status,error_message,${providerColumn},sent_at,${destinationColumn},responded_at,called_at,call_disposition,clicked_link_at,clicked_url,clicked_button_at,clicked_button_title${funnelColumns},leads(name)`)
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })
      .limit(500);

    setRecipients(((data as any[]) || []).map((row) => ({
      id: row.id,
      destination: row[destinationColumn] || "-",
      leadName: row.leads?.name || null,
      status: row.status,
      error: row.error_message || null,
      sentAt: row.sent_at || null,
      providerId: row[providerColumn] || null,
      respondedAt: row.responded_at || null,
      calledAt: row.called_at || null,
      callDisposition: row.call_disposition || null,
      clickedLinkAt: row.clicked_link_at || null,
      clickedUrl: row.clicked_url || null,
      clickedButtonAt: row.clicked_button_at || null,
      clickedButtonTitle: row.clicked_button_title || null,
      deliveredAt: row.delivered_at ?? null,
      readAt: row.read_at ?? null,
      failedAt: row.failed_at ?? null,
    })));
    setRecipientsLoading(false);
  };

  const resumeCampaign = async (campaign: CampaignRow) => {
    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "pending",
        next_attempt_at: new Date().toISOString(),
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) {
      setQueueError(error.message);
      setQueueingId(null);
      await load();
      return;
    }
    supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1, batch_size: 10 } }).catch(() => {});
    setQueueingId(null);
    await load();
  };

  const pauseCampaign = async (campaign: CampaignRow) => {
    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "paused",
        next_attempt_at: null,
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) setQueueError(error.message);
    setQueueingId(null);
    await load();
  };

  const terminateCampaign = async (campaign: CampaignRow) => {
    const ok = window.confirm(`Terminate "${campaign.name}"? Pending recipients will not be sent.`);
    if (!ok) return;

    setQueueingId(campaign.id);
    setQueueError(null);
    const table = campaign.channel === "whatsapp" ? "whatsapp_campaigns" : "email_campaigns";
    const { error } = await supabase
      .from(table as any)
      .update({
        status: "terminated",
        completed_at: new Date().toISOString(),
        next_attempt_at: null,
        worker_locked_at: null,
        worker_error: null,
      })
      .eq("id", campaign.id);
    if (error) setQueueError(error.message);
    setQueueingId(null);
    await load();
  };

  const openResendDialog = (campaign: CampaignRow) => {
    setResendCampaign(campaign);
    setResendMode("now");
    setResendScheduledAt("");
    setResending(false);
  };

  const resendScheduledDateValue = scheduledDatePart(resendScheduledAt);
  const resendScheduledTimeValue = scheduledTimePart(resendScheduledAt);
  const setResendDate = (date: string) => {
    if (!date) { setResendScheduledAt(resendScheduledTimeValue ? `T${resendScheduledTimeValue}` : ""); return; }
    setResendScheduledAt(`${date}T${resendScheduledTimeValue || defaultFutureTime()}`);
  };
  const setResendTime = (time: string) => {
    if (!time) { setResendScheduledAt(resendScheduledDateValue ? `${resendScheduledDateValue}T` : ""); return; }
    setResendScheduledAt(`${resendScheduledDateValue ? `${resendScheduledDateValue}T` : "T"}${time}`);
  };

  const handleResendFailed = async () => {
    if (!resendCampaign) return;
    setResending(true);

    try {
      let nextAttemptAt = new Date().toISOString();
      if (resendMode === "scheduled") {
        const scheduledDate = new Date(resendScheduledAt);
        if (!resendScheduledAt || Number.isNaN(scheduledDate.getTime())) throw new Error("Choose a valid scheduled send time.");
        if (scheduledDate.getTime() <= Date.now()) throw new Error("Scheduled time must be in the future.");
        nextAttemptAt = scheduledDate.toISOString();
      }

      const isWhatsApp = resendCampaign.channel === "whatsapp";
      const campaignTable = isWhatsApp ? "whatsapp_campaigns" : "email_campaigns";
      const recipientTable = isWhatsApp ? "whatsapp_campaign_recipients" : "email_campaign_recipients";
      const destinationCol = isWhatsApp ? "phone" : "to_email";

      const { data: originalCampaign, error: origErr } = await supabase
        .from(campaignTable as any)
        .select("*")
        .eq("id", resendCampaign.id)
        .single();
      if (origErr || !originalCampaign) throw origErr || new Error("Could not load original campaign.");

      const { data: failedRows, error: failErr } = await supabase
        .from(recipientTable as any)
        .select(`lead_id,${destinationCol}`)
        .eq("campaign_id", resendCampaign.id)
        .eq("status", "failed");
      if (failErr) throw failErr;
      if (!failedRows?.length) throw new Error("No failed recipients to resend.");

      const orig = originalCampaign as any;
      const campaignInsert: Record<string, any> = {
        name: `${resendCampaign.name} (resend failed)`,
        list_id: orig.list_id || null,
        total_recipients: failedRows.length,
        created_by: profile?.id || null,
        next_attempt_at: nextAttemptAt,
        worker_locked_at: null,
        status: "pending",
      };
      if (isWhatsApp) {
        campaignInsert.template_key = orig.template_key;
        campaignInsert.static_params = orig.static_params || {};
        if (orig.business_phone_number_id) campaignInsert.business_phone_number_id = orig.business_phone_number_id;
        if (orig.business_phone_number) campaignInsert.business_phone_number = orig.business_phone_number;
      } else {
        campaignInsert.template_slug = orig.template_slug || null;
        campaignInsert.custom_subject = orig.custom_subject || null;
        campaignInsert.custom_body = orig.custom_body || null;
      }

      const { data: newCampaign, error: campErr } = await supabase
        .from(campaignTable as any)
        .insert(campaignInsert)
        .select("id")
        .single();
      if (campErr || !newCampaign) throw campErr || new Error("Could not create resend campaign.");

      const recipientRows = (failedRows as any[]).map((row) => ({
        campaign_id: (newCampaign as any).id,
        lead_id: row.lead_id,
        [destinationCol]: row[destinationCol],
      }));
      for (let i = 0; i < recipientRows.length; i += 500) {
        const { error } = await supabase.from(recipientTable as any).insert(recipientRows.slice(i, i + 500));
        if (error) throw error;
      }

      if (resendMode === "now") {
        await supabase.functions.invoke("campaign-dispatcher", { body: { limit: 1, batch_size: 10 } }).catch(() => {});
      }

      toast({
        title: resendMode === "scheduled" ? "Resend scheduled" : "Resend queued",
        description: `${failedRows.length} failed recipient${failedRows.length === 1 ? "" : "s"} will be retried.`,
      });
      setResendCampaign(null);
      await load();
    } catch (error: any) {
      toast({ title: "Could not resend", description: error?.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  const downloadCampaignReport = () => {
    downloadCsv(
      `executed-campaigns-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Campaign",
        "Channel",
        "Status",
        "Scheduled at",
        "List",
        "Template",
        "Total recipients",
        "Sent",
        "Failed",
        "Pending",
        "Responded",
        "Called",
        "Clicked link",
        "Clicked button",
        "Response rate",
        "Call rate",
        "Success rate",
        "Created",
        "Completed",
        "Worker error",
      ],
      campaigns.map((campaign) => [
        campaign.name,
        campaign.channel,
        campaignDisplayStatus(campaign),
        campaign.nextAttemptAt || "",
        campaign.listName || "",
        campaign.template || "",
        campaign.total,
        campaign.sent,
        campaign.failed,
        campaign.pending,
        campaign.responded,
        campaign.called,
        campaign.clickedLink,
        campaign.clickedButton,
        pct(campaign.responded, campaign.total),
        pct(campaign.called, campaign.total),
        pct(campaign.sent, campaign.sent + campaign.failed),
        campaign.createdAt,
        campaign.completedAt || "",
        campaign.workerError || "",
      ]),
    );
  };

  const downloadRecipientReport = () => {
    if (!detailCampaign) return;
    downloadCsv(
      `${detailCampaign.channel}-campaign-recipients-${detailCampaign.id}.csv`,
      ["Lead", "Destination", "Status", "Sent at", "Delivered at", "Read at", "Responded at", "Called at", "Call disposition", "Clicked link at", "Clicked URL", "Clicked button at", "Button", "Provider/message id", "Error"],
      recipients.map((recipient) => [
        recipient.leadName || "",
        recipient.destination,
        recipient.status,
        recipient.sentAt || "",
        recipient.deliveredAt || "",
        recipient.readAt || "",
        recipient.respondedAt || "",
        recipient.calledAt || "",
        recipient.callDisposition || "",
        recipient.clickedLinkAt || "",
        recipient.clickedUrl || "",
        recipient.clickedButtonAt || "",
        recipient.clickedButtonTitle || "",
        recipient.providerId || "",
        recipient.error || "",
      ]),
    );
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
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Marketing Hub</h1>
          <p className="text-sm text-muted-foreground">
            Start campaigns from saved lists and track every running or completed send in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            preset={datePreset}
            fromDate={dateFrom}
            toDate={dateTo}
            onPresetChange={setDatePreset}
            onFromDateChange={setDateFrom}
            onToDateChange={setDateTo}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
            inputClassName="h-8 rounded-md border border-input bg-background px-2 text-sm"
            ariaPrefix="Campaign"
          />
          <Button asChild variant="outline" size="sm">
            <Link to="/lists"><ListPlus className="mr-2 h-4 w-4" /> Manage Lists</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/template-manager"><Megaphone className="mr-2 h-4 w-4" /> Templates</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/marketing/opt-outs"><UserX className="mr-2 h-4 w-4" /> Opt-outs</Link>
          </Button>
          <Button onClick={load} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <div className="flex items-center gap-2">
              <ListPlus className="h-4 w-4 text-primary" />
              <p className="font-semibold">Lists / Initiate New Campaign</p>
            </div>
            <p className="text-xs text-muted-foreground">Pick a saved lead list, choose the channel, and queue the campaign.</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_1fr]">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lead list</label>
              <div className="mt-1 flex gap-2">
                <SelectField
                  value={selectedListId}
                  onValueChange={setSelectedListId}
                  placeholder={lists.length === 0 ? "No lists available" : "Select lead list"}
                  options={lists.map((list) => ({ value: list.id, label: `${list.name} (${list.member_count})` }))}
                  disabled={lists.length === 0}
                  triggerClassName="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  className="min-w-0 flex-1"
                  ariaLabel="Select lead list"
                />
                {canDeleteLists && selectedList && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteList(selectedList)}
                    title="Delete selected list"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div>
              <SelectField
                label="Channel"
                value={campaignChannel}
                onValueChange={(value) => setCampaignChannel(value as Channel)}
                options={[
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "email", label: "Email" },
                ]}
                allowEmpty={false}
                triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Campaign name</label>
              <Input
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder={selectedList ? `${selectedList.name} - ${campaignChannel}` : "Campaign name"}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid max-w-2xl gap-3 md:grid-cols-[180px_260px]">
            <SelectField
              label="Send time"
              value={campaignScheduleMode}
              onValueChange={(value) => {
                const nextMode = value as "now" | "scheduled";
                setCampaignScheduleMode(nextMode);
                if (nextMode === "scheduled" && !campaignScheduledAt) {
                  setCampaignScheduledAt(defaultFutureDateTime());
                }
              }}
              options={[
                { value: "now", label: "Send now" },
                { value: "scheduled", label: "Schedule for later" },
              ]}
              allowEmpty={false}
              triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            {campaignScheduleMode === "scheduled" && (
              <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_120px]">
                <DatePickerField
                  label="Scheduled date"
                  value={scheduledDateValue}
                  onValueChange={setScheduledDate}
                  placeholder="Pick date"
                  minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                  triggerClassName="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  ariaLabel="Scheduled campaign date"
                />
                <FieldShell label="Time">
                  <Input
                    type="time"
                    value={scheduledTimeValue || defaultFutureTime()}
                    onChange={(event) => setScheduledTime(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    aria-label="Scheduled campaign time"
                  />
                </FieldShell>
              </div>
            )}
          </div>

          {campaignChannel === "whatsapp" && (
            <div className="max-w-2xl space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Quality guards (Meta)</p>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">DNC is always excluded</span> — stage Do Not Contact stops all further outreach.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input accent-primary"
                    checked={waExcludeCold}
                    onChange={(e) => setWaExcludeCold(e.target.checked)}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">Exclude cold leads</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Cold-stage leads usually hurt read rates and quality ratings.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input accent-primary"
                    checked={waQuietDaysEnabled}
                    onChange={(e) => setWaQuietDaysEnabled(e.target.checked)}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">Skip recent WhatsApp templates</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Avoid blasting the same person again within a few days.
                    </span>
                  </span>
                </label>
                {waQuietDaysEnabled && (
                  <div className="pl-6 flex items-center gap-2">
                    <label className="text-xs font-medium text-muted-foreground">Quiet days</label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={waQuietDays}
                      onChange={(e) => setWaQuietDays(e.target.value)}
                      className="h-9 w-20"
                    />
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input accent-primary"
                    checked={waSendMode === "paced"}
                    onChange={(e) => setWaSendMode(e.target.checked ? "paced" : "immediate")}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">Pace over days (Meta unique-user limit)</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Split recipients into waves ~24h apart so you stay under Meta&apos;s rolling 24h unique-user tier.
                    </span>
                  </span>
                </label>
                {waSendMode === "paced" && (
                  <div className="pl-6 space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Max recipients per day</label>
                    <Input
                      type="number"
                      min={50}
                      step={50}
                      value={waDailyCap}
                      onChange={(e) => setWaDailyCap(e.target.value)}
                      className="h-9 w-40"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {(() => {
                        try {
                          const start = campaignScheduleMode === "scheduled" && campaignScheduledAt
                            ? new Date(campaignScheduledAt)
                            : new Date();
                          return buildCampaignPacePlan({
                            recipientCount: selectedList?.member_count || 0,
                            sendMode: "paced",
                            dailyUniqueCap: Number(waDailyCap) || DEFAULT_DAILY_UNIQUE_CAP,
                            startAt: start,
                          }).preview;
                        } catch {
                          return "Enter a valid daily cap.";
                        }
                      })()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {campaignChannel === "whatsapp" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Send from number</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
                      >
                        <WhatsAppBusinessIdentity sender={waSelectedSender ?? defaultWaSenderOption()} compact />
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
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Send test message</label>
                    <Input
                      value={waTestPhone}
                      onChange={(e) => setWaTestPhone(e.target.value)}
                      placeholder="Phone number to test"
                      className="mt-1"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!waTemplate || !waTestPhone.trim() || waTestSending}
                    onClick={handleSendTest}
                  >
                    {waTestSending ? "Sending…" : "Send test"}
                  </Button>
                </div>
                <div>
                  <SelectField
                    label="WhatsApp template"
                    value={waTemplate}
                    onValueChange={(value) => {
                      setWaTemplate(value);
                      setWaStaticParams({});
                    }}
                    options={availableWaBulkTemplates.map((template) => ({ value: template.key, label: template.label }))}
                    allowEmpty={false}
                    triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${waTemplateQuality.badgeClass}`}>
                      Meta: {waTemplateQuality.label}
                    </span>
                    {!waTemplateQuality.allowBulk && (
                      <span className="text-[11px] text-destructive font-medium">Bulk send blocked</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{waTemplateQuality.detail}</p>
                  {selectedWaTemplate?.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{selectedWaTemplate.description}</p>
                  )}
                </div>
                <div className="space-y-2">
                  {waStaticFields.length === 0 ? (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      This template uses only per-lead values.
                    </div>
                  ) : (
                    waStaticFields.map((field) => {
                      const value = effectiveWaParamValue(waStaticParams, field.name);
                      const mappedToken = decodeWaParamFieldMapping(value);
                      const canMap = isWaMappableTemplateParam(field.name);
                      const isMediaParam = isWaMediaTemplateParam(field.name);
                      const hasDefaultMedia = isMediaParam && !!selectedWaTemplateDefaultMediaUrl;
                      const label = isMediaParam
                        ? hasDefaultMedia ? "Override header media URL" : "Header media URL"
                        : field.name.replace(/^template_value_(\d+)$/, "Body variable {{$1}}").replace(/_/g, " ");
                      return (
                        <div key={field.name}>
                          <label className="text-xs font-medium text-muted-foreground">{label}</label>
                          {canMap && (
                            <SelectField
                              value={mappedToken ? value : WA_COMMON_VALUE}
                              onValueChange={(nextValue) => {
                                setWaStaticParams((current) => ({
                                  ...current,
                                  [field.name]: nextValue === WA_COMMON_VALUE ? "" : nextValue,
                                }));
                              }}
                              options={[
                                ...WA_PARAM_FIELD_OPTIONS.map((option) => ({
                                  value: encodeWaParamFieldMapping(option.token),
                                  label: `Use list column: ${option.label}`,
                                })),
                                { value: WA_COMMON_VALUE, label: "Use one common value" },
                              ]}
                              allowEmpty={false}
                              triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            />
                          )}
                          {(!canMap || !mappedToken) && (
                            <Input
                              value={canMap ? (waStaticParams[field.name] || "") : value}
                              onChange={(event) => setWaStaticParams((current) => ({ ...current, [field.name]: event.target.value }))}
                              placeholder={hasDefaultMedia ? "Leave blank to use the approved template image" : field.placeholder || field.name}
                              className="mt-1"
                            />
                          )}
                          {mappedToken && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Filled per recipient from {waParamFieldLabel(mappedToken)}.
                            </p>
                          )}
                          {hasDefaultMedia && !value.trim() && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Uses the approved template image by default. Add a public URL here only to replace it for this campaign.
                            </p>
                          )}
                          {field.help && !hasDefaultMedia && !mappedToken && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp Preview</p>
                <WhatsAppTemplatePreviewBubble
                  templateKey={selectedWaTemplate?.key}
                  components={waTemplateComponentsByKey[selectedWaTemplate?.key || ""]}
                  bodyText={waRenderedPreview}
                  fallbackText={waRenderedPreview}
                  className="max-h-[420px] overflow-y-auto"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button type="button" variant={emailMode === "template" ? "default" : "outline"} size="sm" onClick={() => setEmailMode("template")}>
                    Template
                  </Button>
                  <Button type="button" variant={emailMode === "custom" ? "default" : "outline"} size="sm" onClick={() => setEmailMode("custom")}>
                    Custom
                  </Button>
                </div>
                {emailMode === "template" ? (
                  <SelectField
                    label="Email template"
                    value={emailSlug}
                    onValueChange={setEmailSlug}
                    placeholder={emailTemplates.length === 0 ? "No active templates" : "Select email template"}
                    options={emailTemplates.map((template) => ({ value: template.slug, label: template.name }))}
                    disabled={emailTemplates.length === 0}
                    triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Subject</label>
                      <Input
                        value={emailSubject}
                        onFocus={() => setEmailInsertTarget("subject")}
                        onChange={(event) => setEmailSubject(event.target.value)}
                        placeholder="Use values like {{student_name}}"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Body HTML</label>
                      <Textarea
                        value={emailBody}
                        onFocus={() => setEmailInsertTarget("body")}
                        onChange={(event) => setEmailBody(event.target.value)}
                        rows={8}
                        placeholder={"<p>Hi {{student_name}},</p><p>Your course is {{course_name}}.</p>"}
                        className="mt-1 font-mono"
                      />
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Insert list value</p>
                          <p className="text-[11px] text-muted-foreground">
                            Adds a per-lead variable to the {emailInsertTarget === "subject" ? "subject" : "body"}.
                          </p>
                        </div>
                        <div className="flex rounded-md border border-input bg-background p-0.5">
                          <button
                            type="button"
                            onClick={() => setEmailInsertTarget("subject")}
                            className={`rounded px-2 py-1 text-[11px] font-medium ${emailInsertTarget === "subject" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            Subject
                          </button>
                          <button
                            type="button"
                            onClick={() => setEmailInsertTarget("body")}
                            className={`rounded px-2 py-1 text-[11px] font-medium ${emailInsertTarget === "body" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            Body
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {EMAIL_LIST_VALUE_TOKENS.map((item) => (
                          <button
                            key={item.token}
                            type="button"
                            onClick={() => insertEmailValueToken(item.token)}
                            className="rounded-full border border-input bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                            title={`Insert {{${item.token}}}`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Imported unmapped CSV columns are available inside notes when they were saved during import.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Preview</p>
                <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border bg-white p-4 shadow-sm">
                  <div className="mb-3 border-b border-border pb-3">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">Subject</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{emailPreviewSubject}</p>
                  </div>
                  <div className="prose prose-sm max-w-none text-slate-900" dangerouslySetInnerHTML={{ __html: emailPreviewBody }} />
                </div>
              </div>
            </div>
          )}

          {launchError && <p className="text-sm text-destructive">{launchError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              DNC leads and members without the selected channel destination are skipped at queue time.
            </p>
            <Button
              onClick={launchCampaign}
              disabled={
                launching
                || !selectedList
                || (campaignChannel === "whatsapp" && (waMissingStatic || !waTemplateQuality.allowBulk))
              }
            >
              {launching ? <ButtonOrb state="connecting" onFilled /> : <Send className="mr-2 h-4 w-4" />}
              Queue Campaign
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Executed Campaigns</h2>
          <p className="text-sm text-muted-foreground">Running, completed, paused, failed, and terminated campaign results.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric title="Total recipients" value={totals.total.toLocaleString("en-IN")} icon={Megaphone} />
          <Metric title="Sent" value={totals.sent.toLocaleString("en-IN")} icon={CheckCircle2} tone="emerald" />
          <Metric title="Delivered" value={`${totals.delivered.toLocaleString("en-IN")} (${pct(totals.delivered, totals.sent)})`} icon={CheckCircle2} tone="blue" />
          <Metric title="Read" value={`${totals.read.toLocaleString("en-IN")} (${pct(totals.read, totals.sent)})`} icon={MessageSquare} tone="emerald" />
          <Metric title="Failed" value={totals.failed.toLocaleString("en-IN")} icon={XCircle} tone="red" />
          <Metric title="Success rate" value={pct(totals.sent, totals.sent + totals.failed)} icon={Send} tone="blue" />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric title="Responded" value={totals.responded.toLocaleString("en-IN")} icon={Reply} tone="blue" />
          <Metric title="Called" value={totals.called.toLocaleString("en-IN")} icon={PhoneCall} tone="emerald" />
          <Metric title="Clicked link" value={totals.clickedLink.toLocaleString("en-IN")} icon={MousePointerClick} tone="slate" />
          <Metric title="Clicked button" value={totals.clickedButton.toLocaleString("en-IN")} icon={MousePointerClick} tone="slate" />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">WhatsApp sent</p>
                <p className="mt-1 text-2xl font-bold">{totals.whatsapp.toLocaleString("en-IN")}</p>
              </div>
              <MessageSquare className="h-8 w-8 text-success" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email sent</p>
                <p className="mt-1 text-2xl font-bold">{totals.email.toLocaleString("en-IN")}</p>
              </div>
              <Mail className="h-8 w-8 text-info-foreground" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Executed Campaigns</p>
              {queueError && <p className="mt-1 text-xs text-destructive">{queueError}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={downloadCampaignReport} disabled={campaigns.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <OrbLoader state="connecting" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No campaigns yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Campaign</th>
                    <th className="px-4 py-3 text-left">Channel</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Recipients</th>
                    <th className="px-4 py-3 text-right">Sent</th>
                    <th className="px-4 py-3 text-right">Delivered</th>
                    <th className="px-4 py-3 text-right">Read</th>
                    <th className="px-4 py-3 text-right">Failed</th>
                    <th className="px-4 py-3 text-right">Responded</th>
                    <th className="px-4 py-3 text-right">Called</th>
                    <th className="px-4 py-3 text-right">Clicks</th>
                    <th className="px-4 py-3 text-right">Success</th>
                    <th className="px-4 py-3 text-left">Scheduled / Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={`${campaign.channel}-${campaign.id}`} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {campaign.template || "No template"}{campaign.listName ? ` - ${campaign.listName}` : ""}
                        </p>
                        {campaign.workerError && (
                          <p className="mt-1 text-xs text-destructive">{campaign.workerError}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="capitalize">{campaign.channel}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const displayStatus = campaignDisplayStatus(campaign);
                          return <Badge className={`border-0 ${statusTone(displayStatus)}`}>{displayStatus}</Badge>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{campaign.total.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-success">{campaign.sent.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium text-success">
                          {campaign.channel === "whatsapp" ? campaign.delivered.toLocaleString("en-IN") : "—"}
                        </div>
                        {campaign.channel === "whatsapp" && (
                          <div className="text-[11px] text-muted-foreground">{pct(campaign.delivered, campaign.sent)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium text-success">
                          {campaign.channel === "whatsapp" ? campaign.read.toLocaleString("en-IN") : "—"}
                        </div>
                        {campaign.channel === "whatsapp" && (
                          <div className="text-[11px] text-muted-foreground">{pct(campaign.read, campaign.sent)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-destructive">{campaign.failed.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{campaign.responded.toLocaleString("en-IN")}</div>
                        <div className="text-[11px] text-muted-foreground">{pct(campaign.responded, campaign.total)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{campaign.called.toLocaleString("en-IN")}</div>
                        <div className="text-[11px] text-muted-foreground">{pct(campaign.called, campaign.total)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{(campaign.clickedLink + campaign.clickedButton).toLocaleString("en-IN")}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {campaign.clickedLink.toLocaleString("en-IN")} link / {campaign.clickedButton.toLocaleString("en-IN")} button
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{pct(campaign.sent, campaign.sent + campaign.failed)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {campaignDisplayStatus(campaign) === "scheduled" ? (
                          <div>
                            <div className="font-medium text-foreground">{fmtDate(campaign.nextAttemptAt)}</div>
                            <div className="text-[11px]">Created {fmtDate(campaign.createdAt)}</div>
                          </div>
                        ) : (
                          fmtDate(campaign.createdAt)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                        {campaign.pending > 0 && campaign.status !== "paused" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resumeCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            {queueingId === campaign.id ? <ButtonOrb state="connecting" /> : null}
                            {campaignDisplayStatus(campaign) === "scheduled" ? "Queue now" : "Queue"}
                          </Button>
                        )}
                        {campaign.status === "paused" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resumeCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            {queueingId === campaign.id ? <ButtonOrb state="connecting" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
                            Resume
                          </Button>
                        )}
                        {campaign.pending > 0 && ["pending", "sending"].includes(campaign.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => pauseCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            <PauseCircle className="mr-1 h-3.5 w-3.5" />
                            Pause
                          </Button>
                        )}
                        {campaign.pending > 0 && ["pending", "sending", "paused"].includes(campaign.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => terminateCampaign(campaign)}
                            disabled={queueingId === campaign.id}
                          >
                            <StopCircle className="mr-1 h-3.5 w-3.5" />
                            Terminate
                          </Button>
                        )}
                        {campaign.failed > 0 && ["completed", "terminated", "failed"].includes(campaign.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openResendDialog(campaign)}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            Resend failed
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRecipients(campaign)}
                        >
                          Details
                        </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailCampaign} onOpenChange={(open) => { if (!open) setDetailCampaign(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                Campaign recipients
              </DialogTitle>
              <Button variant="outline" size="sm" onClick={downloadRecipientReport} disabled={recipients.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
            </div>
          </DialogHeader>
          {recipientsLoading ? (
            <div className="flex items-center justify-center py-10">
              <OrbLoader state="connecting" />
            </div>
          ) : recipients.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No recipients found.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Lead</th>
                    <th className="px-3 py-2 text-left">Destination</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Sent</th>
                    <th className="px-3 py-2 text-left">Delivered</th>
                    <th className="px-3 py-2 text-left">Read</th>
                    <th className="px-3 py-2 text-left">Responded</th>
                    <th className="px-3 py-2 text-left">Called</th>
                    <th className="px-3 py-2 text-left">Clicks</th>
                    <th className="px-3 py-2 text-left">Provider ID</th>
                    <th className="px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-medium">{row.leadName || "-"}</td>
                      <td className="px-3 py-2">{row.destination}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="capitalize">{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(row.sentAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(row.deliveredAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(row.readAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(row.respondedAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{fmtDate(row.calledAt)}</div>
                        {row.callDisposition && <div className="text-[11px]">{row.callDisposition}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{row.clickedLinkAt ? `Link ${fmtDate(row.clickedLinkAt)}` : "-"}</div>
                        {row.clickedButtonAt && (
                          <div className="text-[11px]">
                            Button {fmtDate(row.clickedButtonAt)}{row.clickedButtonTitle ? `: ${row.clickedButtonTitle}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{row.providerId || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.error || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resendCampaign} onOpenChange={(open) => { if (!open) setResendCampaign(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resend to failed recipients</DialogTitle>
          </DialogHeader>
          {resendCampaign && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create a new campaign targeting the <span className="font-semibold text-destructive">{resendCampaign.failed}</span> failed
                recipient{resendCampaign.failed === 1 ? "" : "s"} from "{resendCampaign.name}".
                The same template and parameters will be used.
              </p>
              <div className="grid gap-3 md:grid-cols-[160px_1fr]">
                <SelectField
                  label="Send time"
                  value={resendMode}
                  onValueChange={(value) => {
                    const next = value as "now" | "scheduled";
                    setResendMode(next);
                    if (next === "scheduled" && !resendScheduledAt) setResendScheduledAt(defaultFutureDateTime());
                  }}
                  options={[
                    { value: "now", label: "Send now" },
                    { value: "scheduled", label: "Schedule for later" },
                  ]}
                  allowEmpty={false}
                  triggerClassName="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                {resendMode === "scheduled" && (
                  <div className="grid gap-2 md:grid-cols-[minmax(140px,1fr)_100px]">
                    <DatePickerField
                      label="Date"
                      value={resendScheduledDateValue}
                      onValueChange={setResendDate}
                      placeholder="Pick date"
                      minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                      triggerClassName="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      ariaLabel="Resend scheduled date"
                    />
                    <FieldShell label="Time">
                      <Input
                        type="time"
                        value={resendScheduledTimeValue || defaultFutureTime()}
                        onChange={(event) => setResendTime(event.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        aria-label="Resend scheduled time"
                      />
                    </FieldShell>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResendCampaign(null)}>Cancel</Button>
            <Button onClick={handleResendFailed} disabled={resending} className="gap-2">
              {resending ? <ButtonOrb state="connecting" onFilled /> : <RefreshCw className="h-4 w-4" />}
              {resendMode === "scheduled" ? "Schedule resend" : "Resend now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteList} onOpenChange={(open) => { if (!open) setDeleteList(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteList?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The list and its membership rows will be removed. Leads themselves and any campaigns already sent are not affected.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteList(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteList} disabled={deletingList} className="gap-2">
              {deletingList ? <ButtonOrb state="connecting" onFilled /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: string;
  icon: any;
  tone?: "slate" | "emerald" | "red" | "blue";
}) {
  const toneClass = {
    slate: "text-slate-600 bg-slate-100",
    emerald: "text-success bg-success/10",
    red: "text-destructive bg-destructive/10",
    blue: "text-info-foreground bg-info/10",
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
