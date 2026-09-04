import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { maskMatrix } from "@/lib/maskContact";
import { useToast } from "@/hooks/use-toast";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { DatePickerField, FieldShell, SelectField } from "@/components/ui/state-fields";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Download, ListPlus, Mail, Megaphone, MessageSquare, PauseCircle, PlayCircle, RefreshCw, Send, StopCircle, Trash2, Users, UserX, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  type WaSenderOption,
  DEFAULT_WA_SENDER,
  WHATSAPP_BUSINESS_NAME,
  defaultWaSenderOption,
  formatMessagingTier,
  formatSenderNumber,
  loadWaSenders,
  senderCanSendTemplate,
} from "@/lib/waSenders";
import { WhatsAppBusinessIdentity } from "@/components/whatsapp/WhatsAppBusinessIdentity";
import { getDatePresetRange, getEndExclusiveIso, type DatePreset } from "@/lib/datePresets";
import { decideBlockedRoleAccess, isAcademicPartnerPortalRole } from "@/lib/accessPolicy";
import { buildCampaignPacePlan, DEFAULT_DAILY_UNIQUE_CAP, messagingTierDailyCap } from "@/lib/campaignPacing";
import {
  campaignMemberToLead,
  DEFAULT_QUIET_DAYS,
  filterCampaignRecipients,
} from "@/lib/campaignEligibility";
import { fetchLastWhatsAppMarketingAtByLeadIds, fetchListMembers } from "@/lib/campaignEligibilityFetch";
import { campaignHealth, campaignProgressPct, countdownTo, isCampaignTerminal } from "@/lib/campaignHealth";
import {
  campaignEngagedInboxPath,
  campaignHasEngaged,
  campaignRecipientQuery,
  fetchCampaignRecipientsByEngagement,
  type RecipientEngagementFilter,
} from "@/lib/campaignEngaged";
import { describeWhatsAppError, whatsAppErrorTextForCode, whatsAppErrorHint } from "@/lib/whatsappErrorText";
import { evaluateTemplateQualityForBulk } from "@/lib/campaignTemplateQuality";
import { classifyHeaderMediaUrl, probePublicMediaUrl } from "@/lib/publicMediaUrl";
import { waitForWhatsAppDelivery } from "@/lib/whatsappTestDelivery";
import { invokeEdge } from "@/integrations/supabase/edge";
import { AUTO_FILLED_PARAMS, WA_BULK_TEMPLATES, dynamicWaTemplateParams, ensureMediaHeaderParam, type WaBulkTemplate } from "@/config/waBulkTemplates";
import {
  WhatsAppTemplatePreviewBubble,
  resolveSendableTemplateMediaUrl,
  sendableHeaderMediaUrl,
  templateHeaderFromComponents,
  templateTextPreviewFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import {
  headerMediaIsSendable,
  headerMediaSendFields,
  nextHeaderMediaParams,
  resolvedHeaderMediaUrl,
} from "@/lib/headerMediaPrefill";
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
  parseWaButtonUrlParam,
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
  /** Recipients still to send (any eligible_at). */
  pendingRecipients: number;
  /** Pending AND already eligible — a worker should be sending these now. */
  dueNow: number;
  /** When the next paced wave unlocks. */
  nextEligibleAt: string | null;
  /** Failure counts grouped by Meta error code, worst first. */
  failureBreakdown: Array<{ code: string; count: number; text: string }>;
}

/** Row shape of the campaign_failure_breakdown RPC. */
type FailureBreakdownRow = {
  campaign_id: string;
  error_code: string | null;
  failures: number;
  sample_message: string | null;
};

/** Row shape of the campaign_funnel_counts RPC. */
type FunnelRow = {
  campaign_id: string;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  due_now: number;
  next_eligible_at: string | null;
};

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
  errorCode: string | null;
  retryCount: number;
}

const RECIPIENT_CSV_HEADERS = [
  "Lead",
  "Destination",
  "Status",
  "Sent at",
  "Delivered at",
  "Read at",
  "Responded at",
  "Called at",
  "Call disposition",
  "Clicked link at",
  "Clicked URL",
  "Clicked button at",
  "Button",
  "Provider/message id",
  "Error",
];

const mapDbRecipient = (
  row: any,
  destinationColumn: string,
  providerColumn: string,
): RecipientRow => ({
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
  errorCode: row.last_error_code ?? null,
  retryCount: Number(row.retry_count || 0),
  deliveredAt: row.delivered_at ?? null,
  readAt: row.read_at ?? null,
  failedAt: row.failed_at ?? null,
});

const recipientCsvRows = (recipients: RecipientRow[]) =>
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
  ]);

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

/** Numeric rate, for threshold comparisons (pct() returns a display string). */
const rate = (num: number, den: number) => (den ? (num / den) * 100 : 0);

/**
 * Health tone from a rate. Kind-aware because the metrics point in different
 * directions — a high delivered rate is good, a high failed rate is not.
 * Mirrors pctClass() in PublisherAnalytics.tsx.
 */
type StatTone = "ok" | "warn" | "bad";
const rateTone = (value: number, kind: "delivered" | "read" | "failed"): StatTone => {
  if (kind === "failed") return value >= 25 ? "bad" : value >= 10 ? "warn" : "ok";
  const t = kind === "read" ? { good: 30, warn: 15 } : { good: 85, warn: 60 };
  return value >= t.good ? "ok" : value >= t.warn ? "warn" : "bad";
};

/** Count + percentage in one pill, coloured by health. */
const ratePillClass = (value: number, kind: "delivered" | "read" | "failed") => {
  const tone = rateTone(value, kind);
  if (tone === "bad") return "text-destructive bg-destructive/5";
  if (tone === "warn") return "text-warning-foreground bg-warning/5";
  return "text-success bg-success/5";
};

/**
 * Compact date for the table cell — "02 Sep, 10:52 am", with the year only when
 * it isn't the current one. The full fmtDate string ran 190px wide, a seventh of
 * the table, to say something the reader mostly already knows.
 */
const fmtDateCompact = (value: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [visibleCampaigns, setVisibleCampaigns] = useState(10);
  /** Row whose failure breakdown is expanded (Applications.tsx pattern). */
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState(initialCustomRange.from);
  const [dateTo, setDateTo] = useState(initialCustomRange.to);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientFilter, setRecipientFilter] = useState<RecipientEngagementFilter>("all");
  const [exportingEngagedId, setExportingEngagedId] = useState<string | null>(null);
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
  // DB-authored param specs (whatsapp_template_settings.param_specs) override the
  // hardcoded WA_BULK_TEMPLATES params for a template — the single source aligned
  // to Meta's placeholder_count, shared with the server.
  const [paramSpecsByKey, setParamSpecsByKey] = useState<Record<string, WaBulkTemplate["params"]>>({});
  const [waTemplateComponentsByKey, setWaTemplateComponentsByKey] = useState<Record<string, WhatsAppTemplateComponent[]>>({});
  // Sendable header files saved in Template Manager (whatsapp_template_settings.media_url).
  const [waTemplateMediaUrlByKey, setWaTemplateMediaUrlByKey] = useState<Record<string, string>>({});
  // Real Meta template arity + which keys actually exist as APPROVED Meta templates.
  // The hardcoded WA_BULK_TEMPLATES params/keys drift from Meta (e.g. lead_welcome
  // has 3 body placeholders in Meta but 2 in config; kb_placements isn't a Meta
  // template at all), which broke test-sends. These come from whatsapp_templates.
  const [placeholderCountByKey, setPlaceholderCountByKey] = useState<Record<string, number>>({});
  const [headerFormatByKey, setHeaderFormatByKey] = useState<Record<string, string>>({});
  const [approvedTemplateKeys, setApprovedTemplateKeys] = useState<Set<string>>(new Set());
  // Which WABA each template belongs to (whatsapp_templates.waba_id, null = main NIMT WABA).
  const [templateWabaByKey, setTemplateWabaByKey] = useState<Record<string, string | null>>({});
  // No sender is selected by default — the user picks a template first, then the
  // number list narrows to the ones whose WABA can send it.
  const [waSenderValue, setWaSenderValue] = useState("");
  // Extra numbers to round-robin across for throughput (besides the primary
  // sender). Only numbers that can send the same template appear as candidates.
  const [waRotationValues, setWaRotationValues] = useState<string[]>([]);
  const [waSenderOptions, setWaSenderOptions] = useState<WaSenderOption[]>(() => [defaultWaSenderOption()]);
  const [waTestPhone, setWaTestPhone] = useState("");
  const [waTestSending, setWaTestSending] = useState(false);
  const [waTestSent, setWaTestSent] = useState(false);
  const [waTestDelivered, setWaTestDelivered] = useState(false);
  const [waTestPhase, setWaTestPhase] = useState<"idle" | "sending" | "waiting" | "delivered" | "failed">("idle");
  const [waTestError, setWaTestError] = useState<string | null>(null);
  const [waTestCanConfirm, setWaTestCanConfirm] = useState(false);
  const [mediaProbe, setMediaProbe] = useState<{ status: "idle" | "checking" | "ok" | "bad"; reason: string | null }>({
    status: "idle",
    reason: null,
  });
  const [builderOpen, setBuilderOpen] = useState(false);
  // Bumped after an on-open Meta sync so the template + sender loaders re-run
  // against freshly-synced data (status, waba_id, header media, available_templates).
  const [metaRefreshKey, setMetaRefreshKey] = useState(0);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [senderPickerOpen, setSenderPickerOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
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
    () => waSenderOptions.find((s) => s.value === waSenderValue) || null,
    [waSenderOptions, waSenderValue]
  );
  const selectedTemplateWaba = useMemo(
    () => templateWabaByKey[waTemplate] ?? null,
    [templateWabaByKey, waTemplate],
  );
  // A sender must be explicitly chosen (no default) AND its WABA must match the
  // template — this gates the test-send and Queue Campaign buttons.
  const selectedSenderCanSend = useMemo(
    () => !!waSelectedSender && senderCanSendTemplate(waSelectedSender, waTemplate, selectedTemplateWaba),
    [waSelectedSender, waTemplate, selectedTemplateWaba]
  );
  // Never leave a number selected that can't send the chosen template. The
  // template picker's onSelect narrows the sender, but a sender persisted from a
  // previous template (or restored after the on-open Meta sync) bypasses that —
  // which showed an incompatible number under a template it can't send. Clear it
  // (or auto-pick when exactly one number matches) so the guard can't be dodged.
  useEffect(() => {
    if (!waTemplate || !waSenderValue) return;
    if (senderCanSendTemplate(waSelectedSender, waTemplate, selectedTemplateWaba)) return;
    const compatible = waSenderOptions.filter(
      (s) => s.value !== DEFAULT_WA_SENDER && senderCanSendTemplate(s, "", selectedTemplateWaba),
    );
    setWaSenderValue(compatible.length === 1 ? compatible[0].value : "");
  }, [waTemplate, selectedTemplateWaba, waSenderOptions, waSelectedSender, waSenderValue]);
  // Org label per waba, sourced from synced senders' verified_name (e.g. "Seralis Lab").
  const orgByWaba = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of waSenderOptions) {
      if (s.wabaId && s.verifiedName) m[s.wabaId] = s.verifiedName;
    }
    return m;
  }, [waSenderOptions]);
  const wabaOrgLabel = useCallback(
    (wabaId: string | null) => (wabaId ? (orgByWaba[wabaId] || "Other WABA") : WHATSAPP_BUSINESS_NAME),
    [orgByWaba],
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
      // Drop hardcoded templates that aren't APPROVED Meta templates (e.g.
      // kb_placements) — they 404 as "Unknown template" at send. Only filter once
      // the approved set has loaded, so nothing flashes empty on first render.
      ...WA_BULK_TEMPLATES
        .filter((template) => approvedTemplateKeys.size === 0
          || approvedTemplateKeys.has(template.key)
          || !!paramSpecsByKey[template.key]) // key may differ from the Meta name (course_details -> inquiry_course_update); a spec vouches for it
        .map((template) => ({
          ...template,
          ...(waMetaTemplateOverrides[template.key] || {}),
          // DB param_specs (Meta-aligned) win over the hardcoded params list.
          params: ensureMediaHeaderParam(
            paramSpecsByKey[template.key] || template.params,
            waTemplateComponentsByKey[template.key],
            headerFormatByKey[template.key],
          ),
          wabaId: templateWabaByKey[template.key] ?? null,
        })),
      ...dynamicWaBulkTemplates.map((template) => ({
        ...template,
        params: ensureMediaHeaderParam(
          paramSpecsByKey[template.key] || template.params,
          waTemplateComponentsByKey[template.key],
          headerFormatByKey[template.key],
        ),
        wabaId: templateWabaByKey[template.key] ?? null,
      })),
    ] as (WaBulkTemplate & { wabaId?: string | null })[],
    [dynamicWaBulkTemplates, waMetaTemplateOverrides, approvedTemplateKeys, paramSpecsByKey, templateWabaByKey, waTemplateComponentsByKey, headerFormatByKey],
  );
  const selectedWaTemplate = useMemo(
    () => availableWaBulkTemplates.find((template) => template.key === waTemplate) || availableWaBulkTemplates[0] || WA_BULK_TEMPLATES[0],
    [availableWaBulkTemplates, waTemplate],
  );
  // Template-first flow: show ALL templates grouped by org. Filtering by the
  // (pre-selected default) sender would hide every non-MAIN WABA's templates
  // (Seralis etc.) until a matching number was picked first. The sender picker
  // still narrows to numbers that can send the chosen template, and picking a
  // template auto-switches to a compatible sender (see onSelect below).
  const templateOptions = availableWaBulkTemplates;
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
      waTemplateMediaUrlByKey[selectedWaTemplate?.key || ""],
    ),
    [selectedWaTemplate?.key, waTemplateComponentsByKey, waTemplateMediaUrlByKey],
  );
  const headerMediaFieldValue = effectiveWaParamValue(waStaticParams, "template_header_media_url").trim();
  const hasMediaHeader = (selectedWaTemplate?.params || []).some((param) => isWaMediaTemplateParam(param.name));
  const selectedHeaderFormat = headerFormatByKey[selectedWaTemplate?.key || ""]
    || String(templateHeaderFromComponents(waTemplateComponentsByKey[selectedWaTemplate?.key || ""])?.format || "");
  const resolvedHeaderUrl = resolvedHeaderMediaUrl(headerMediaFieldValue, selectedWaTemplateDefaultMediaUrl);
  // Probe is advisory (CORS often blocks HEAD). Classify + a sendable default is enough to send.
  const headerMediaReady = !hasMediaHeader || headerMediaIsSendable(headerMediaFieldValue, selectedWaTemplateDefaultMediaUrl);

  // Existing approved templates: prefill the saved public URL so the counsellor
  // can see it and edit it. Switching templates replaces the field with that
  // template's default (or blank if none is saved yet). A typed override is kept
  // until the template itself changes.
  const autoFilledMediaKey = useRef("");
  const autoFilledMediaUrl = useRef("");
  useEffect(() => {
    const key = selectedWaTemplate?.key || "";
    const def = selectedWaTemplateDefaultMediaUrl || "";
    setWaStaticParams((current) => {
      const next = nextHeaderMediaParams(
        current,
        def,
        key,
        autoFilledMediaKey.current,
        autoFilledMediaUrl.current,
      );
      autoFilledMediaKey.current = next.lastAutoKey;
      autoFilledMediaUrl.current = next.lastAutoUrl;
      return next.params;
    });
  }, [selectedWaTemplate?.key, selectedWaTemplateDefaultMediaUrl]);

  useEffect(() => {
    if (!hasMediaHeader) {
      setMediaProbe({ status: "idle", reason: null });
      return;
    }
    const toProbe = headerMediaFieldValue || selectedWaTemplateDefaultMediaUrl || "";
    const classified = classifyHeaderMediaUrl(toProbe);
    if (!classified.ok) {
      setMediaProbe({ status: toProbe ? "bad" : "idle", reason: classified.reason });
      return;
    }
    let cancelled = false;
    setMediaProbe({ status: "checking", reason: null });
    const timer = window.setTimeout(() => {
      void probePublicMediaUrl(classified.url!).then((result) => {
        if (cancelled) return;
        setMediaProbe({ status: result.ok ? "ok" : "bad", reason: result.reason });
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasMediaHeader, headerMediaFieldValue, selectedWaTemplateDefaultMediaUrl]);
  const rememberTemplateHeaderMedia = useCallback(async (templateKey: string, url: string) => {
    const sendable = sendableHeaderMediaUrl(url);
    if (!sendable || sendableHeaderMediaUrl(waTemplateMediaUrlByKey[templateKey])) return;
    const { error } = await (supabase as any)
      .from("whatsapp_template_settings")
      .update({ media_url: sendable, updated_at: new Date().toISOString() })
      .eq("template_key", templateKey);
    if (!error) {
      setWaTemplateMediaUrlByKey((current) => ({ ...current, [templateKey]: sendable }));
    }
  }, [waTemplateMediaUrlByKey]);
  const handleSendTest = useCallback(async () => {
    if (!waTemplate || !waTestPhone.trim()) return;
    if (!senderCanSendTemplate(waSelectedSender, waTemplate, selectedTemplateWaba)) {
      toast({ title: "Can't send", description: `This sender doesn't have "${waTemplate}" approved.`, variant: "destructive" });
      return;
    }
    // waTestPhone comes from PhoneInput as a full +CC number, so just strip to digits.
    const phone = waTestPhone.replace(/[^0-9]/g, "");
    if (phone.length < 10) {
      toast({ title: "Invalid number", description: "Enter a valid phone number with its country code.", variant: "destructive" });
      return;
    }
    if (hasMediaHeader && !headerMediaReady) {
      toast({ title: "Header file required", description: "This template needs a public HTTPS header URL. Save one in Template Manager or paste it here.", variant: "destructive" });
      return;
    }
    setWaTestSending(true);
    setWaTestPhase("sending");
    setWaTestDelivered(false);
    setWaTestSent(false);
    setWaTestError(null);
    setWaTestCanConfirm(false);
    try {
      // Body params, resolved like the preview. Then reconcile the count against
      // Meta's real placeholder_count — the hardcoded config drifts (e.g.
      // lead_welcome is 2 params in config but 3 in Meta), and whatsapp-send hard-
      // rejects arity mismatches.
      const resolveTestValue = (name: string) => {
        const value = effectiveWaParamValue(waStaticParams, name);
        const mappedToken = decodeWaParamFieldMapping(value);
        if (mappedToken) return sampleValueForWaMappedField(mappedToken);
        if (value.trim()) return value.trim();
        return sampleValueForParam(name);
      };
      // Dynamic-URL-button suffixes go out as button_urls (by button index), NOT
      // mixed into body params — whatsapp-send applies them per URL button.
      const buttonParams: { button: number; position: number; value: string }[] = [];
      const params: string[] = [];
      for (const p of selectedWaTemplate?.params || []) {
        if (isWaMediaTemplateParam(p.name)) continue;
        const btn = parseWaButtonUrlParam(p.name);
        if (btn) {
          buttonParams.push({ ...btn, value: resolveTestValue(p.name) });
          continue;
        }
        params.push(resolveTestValue(p.name));
      }
      const button_urls = buttonParams
        .sort((a, b) => a.button - b.button || a.position - b.position)
        .map((b) => b.value);
      const realCount = placeholderCountByKey[waTemplate];
      if (typeof realCount === "number") {
        while (params.length < realCount) params.push(`sample ${params.length + 1}`);
        params.length = realCount; // truncate if config had extras
      }

      const hasMediaHeader = (selectedWaTemplate?.params || []).some((p) => isWaMediaTemplateParam(p.name));
      const headerImageUrl = hasMediaHeader
        ? (resolvedHeaderUrl || undefined)
        : undefined;
      const headerFields = headerMediaSendFields(selectedHeaderFormat, headerImageUrl);

      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: waTemplate,
          phone,
          params,
          provider: "meta",
          business_phone_number_id: waSelectedSender?.phoneNumberId || null,
          business_number: waSelectedSender?.businessNumber || null,
          ...headerFields,
          ...(button_urls.length ? { button_urls } : {}),
        },
      });
      if (error || data?.error || data?.ok === false) {
        let detail = (error as any)?.message || data?.error || data?.meta_error || "Send failed.";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            detail = body?.error || body?.meta_error || detail;
          } catch { /* keep generic detail */ }
        }
        throw new Error(detail);
      }

      const messageId = String(data?.message_id || "").trim();
      setWaTestSent(true);
      setWaTestPhase("waiting");
      setWaTestCanConfirm(true);
      toast({ title: "Test sent", description: "Check your phone. Confirm below once it arrives." });
      if (headerImageUrl) void rememberTemplateHeaderMedia(waTemplate, headerImageUrl);

      if (!messageId) {
        setWaTestError("Sent, but no message id came back. Confirm on the phone that it arrived.");
        return;
      }

      try {
        const outcome = await waitForWhatsAppDelivery(
          async (waMessageId) => {
            const { data: row } = await supabase
              .from("whatsapp_messages" as any)
              .select("status, status_error, read_at")
              .eq("wa_message_id", waMessageId)
              .maybeSingle();
            return (row as { status: string | null; status_error: unknown; read_at: string | null } | null) ?? null;
          },
          messageId,
          { timeoutMs: 90_000 },
        );
        if (outcome.status === "failed") {
          setWaTestPhase("failed");
          setWaTestDelivered(false);
          const hint = whatsAppErrorHint(outcome.code);
          const msg = hint ? `${outcome.errorText} ${hint}` : outcome.errorText;
          setWaTestError(msg);
          toast({ title: "Test not delivered", description: msg, variant: "destructive" });
        } else if (outcome.status === "timeout") {
          setWaTestError("No delivery receipt yet. If the message arrived on the phone, confirm it below.");
        } else {
          setWaTestPhase("delivered");
          setWaTestDelivered(true);
          setWaTestError(null);
          toast({ title: "Test received", description: `Delivered to ${phone}` });
        }
      } catch (waitErr) {
        setWaTestError(waitErr instanceof Error ? waitErr.message : "Could not check delivery. Confirm on the phone.");
      }
    } catch (err) {
      setWaTestPhase("failed");
      setWaTestDelivered(false);
      setWaTestSent(false);
      const rawMsg = err instanceof Error ? err.message : "Could not send test message.";
      const detail = describeWhatsAppError(rawMsg);
      const friendly = detail?.text || rawMsg;
      const hint = whatsAppErrorHint(detail?.code);
      const msg = hint ? `${friendly} ${hint}` : friendly;
      setWaTestError(msg);
      toast({ title: "Test failed", description: msg, variant: "destructive" });
    } finally {
      setWaTestSending(false);
    }
  }, [waTemplate, waTestPhone, selectedWaTemplate, waStaticParams, waSelectedSender, selectedTemplateWaba, selectedWaTemplateDefaultMediaUrl, placeholderCountByKey, rememberTemplateHeaderMedia, hasMediaHeader, headerMediaReady, resolvedHeaderUrl, selectedHeaderFormat, toast]);

  const testSendSignature = `${waTemplate}|${waSenderValue}|${waTestPhone}|${resolvedHeaderUrl || ""}`;
  useEffect(() => {
    setWaTestSent(false);
    setWaTestDelivered(false);
    setWaTestPhase("idle");
    setWaTestError(null);
    setWaTestCanConfirm(false);
  }, [testSendSignature]);

  const waMissingStatic = waStaticFields.some((param) => {
    const value = effectiveWaParamValue(waStaticParams, param.name);
    if (isWaMediaTemplateParam(param.name)) {
      return !headerMediaIsSendable(value, selectedWaTemplateDefaultMediaUrl);
    }
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
    const [funnelRes, failureRes] = waIds.length
      ? await Promise.all([
          supabase.rpc("campaign_funnel_counts" as any, { p_campaign_ids: waIds }),
          supabase.rpc("campaign_failure_breakdown" as any, { p_campaign_ids: waIds }),
        ])
      : [null, null];

    // Group failures by campaign, worst reason first, with the same plain-English
    // wording the inbox uses so "504 failed" becomes three actionable numbers.
    const failuresById = new Map<string, Array<{ code: string; count: number; text: string }>>();
    for (const row of ((failureRes?.data as FailureBreakdownRow[] | null) || [])) {
      const code = String(row.error_code || "unknown");
      const list = failuresById.get(row.campaign_id) || [];
      list.push({
        code,
        count: Number(row.failures || 0),
        // We already have the code — look it up directly. Re-serialising it into
        // Meta's array shape just to parse it back rendered the raw JSON instead.
        text: code === "unknown"
          ? (describeWhatsAppError(row.sample_message)?.text ?? "Unknown error")
          : whatsAppErrorTextForCode(code),
      });
      failuresById.set(row.campaign_id, list);
    }
    for (const list of failuresById.values()) list.sort((a, b) => b.count - a.count);
    const funnelById = new Map<string, { delivered: number; read: number; failed: number; pending: number; dueNow: number; nextEligibleAt: string | null }>(
      ((funnelRes?.data as any[]) || []).map((r) => [
        r.campaign_id,
        {
          delivered: Number(r.delivered || 0),
          read: Number(r.read || 0),
          failed: Number(r.failed || 0),
          pending: Number(r.pending || 0),
          dueNow: Number(r.due_now || 0),
          nextEligibleAt: r.next_eligible_at || null,
        },
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
        // Real queue depth from the recipients table. The stored counters can
        // lag (they are only rewritten at the end of a batch), so pacing state
        // is derived from the rows themselves.
        pendingRecipients: funnelById.get(row.id)?.pending
          ?? (row.status === "completed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed)),
        dueNow: funnelById.get(row.id)?.dueNow ?? 0,
        nextEligibleAt: funnelById.get(row.id)?.nextEligibleAt ?? null,
        failureBreakdown: failuresById.get(row.id) || [],
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
        // No funnel RPC for email; derive queue depth from the counters.
        pendingRecipients: row.status === "completed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        dueNow: row.status === "completed" || row.status === "terminated" ? 0 : Math.max(0, total - sent - failed),
        nextEligibleAt: null,
        failureBreakdown: [],
      };
    });

    setCampaigns([...waRows, ...emailRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  }, [dateBounds, role]);

  useEffect(() => { load(); }, [load]);

  // ---- Live progress -------------------------------------------------------
  // A campaign in flight should be watchable without refreshing. Two separate
  // clocks, deliberately: a cheap local tick for the countdown, and a much
  // rarer network refresh for the counts. Polled RPCs have caused site-wide
  // slowness here before, so the network side is gated hard.

  const liveCampaigns = useMemo(
    () => campaigns.filter((c) => !isCampaignTerminal(c.status) && c.pendingRecipients > 0),
    [campaigns],
  );
  const hasLive = liveCampaigns.length > 0;
  const anyDueNow = liveCampaigns.some((c) => c.dueNow > 0);

  // Countdown clock. Local only — no queries. Runs solely while something is live.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasLive]);

  // Refresh just the funnel + failure counts for live campaigns. Deliberately
  // not `load()` — that re-queries campaigns, senders and templates.
  const refreshFunnels = useCallback(async () => {
    const ids = liveCampaigns.filter((c) => c.channel === "whatsapp").map((c) => c.id);
    if (!ids.length) return;
    const [funnelRes, failureRes] = await Promise.all([
      supabase.rpc("campaign_funnel_counts" as any, { p_campaign_ids: ids }),
      supabase.rpc("campaign_failure_breakdown" as any, { p_campaign_ids: ids }),
    ]);
    if (funnelRes.error) return;

    const byId = new Map(((funnelRes.data as FunnelRow[] | null) || []).map((r) => [r.campaign_id, r]));
    const failuresById = new Map<string, Array<{ code: string; count: number; text: string }>>();
    for (const row of ((failureRes?.data as FailureBreakdownRow[] | null) || [])) {
      const code = String(row.error_code || "unknown");
      const list = failuresById.get(row.campaign_id) || [];
      list.push({
        code,
        count: Number(row.failures || 0),
        text: code === "unknown"
          ? (describeWhatsAppError(row.sample_message)?.text ?? "Unknown error")
          : whatsAppErrorTextForCode(code),
      });
      failuresById.set(row.campaign_id, list);
    }
    for (const list of failuresById.values()) list.sort((a, b) => b.count - a.count);

    setCampaigns((prev) => prev.map((c) => {
      const f = byId.get(c.id);
      if (!f) return c;
      const pending = Number(f.pending || 0);
      const failed = Number(f.failed || 0);
      return {
        ...c,
        delivered: Number(f.delivered || 0),
        read: Number(f.read || 0),
        failed,
        pendingRecipients: pending,
        dueNow: Number(f.due_now || 0),
        nextEligibleAt: f.next_eligible_at || null,
        // Derived, so the Sent column advances mid-batch instead of jumping at
        // the end when the worker finally rewrites sent_count.
        sent: Math.max(0, c.total - pending - failed),
        failureBreakdown: failuresById.get(c.id) || c.failureBreakdown,
      };
    }));
  }, [liveCampaigns]);

  useEffect(() => {
    if (!hasLive) return;                       // nothing live → no timer at all
    // 20s while a batch is actually sending; 2min while idle between paced waves.
    const intervalMs = anyDueNow ? 20_000 : 120_000;
    let id: number | undefined;
    const start = () => {
      if (id != null) return;
      id = window.setInterval(() => {
        if (document.visibilityState === "visible") void refreshFunnels();
      }, intervalMs);
    };
    const onVisibility = () => {
      // A backgrounded tab polls nothing, and catches up on return.
      if (document.visibilityState === "visible") { void refreshFunnels(); start(); }
      else if (id != null) { window.clearInterval(id); id = undefined; }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (id != null) window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasLive, anyDueNow, refreshFunnels]);

  useEffect(() => {
    loadWaSenders(supabase as any)
      .then(({ options }) => {
        setWaSenderOptions(options);
        // Keep an explicit choice if still valid; otherwise leave unselected
        // (don't auto-pick a number — the user picks after choosing a template).
        setWaSenderValue((c) => (c && options.some((o) => o.value === c)) ? c : "");
      })
      .catch(() => {});
  }, [metaRefreshKey]);

  // Sync the template mirror from Meta when the campaign builder opens, so a
  // just-approved template's status/header/waba mapping is fresh at campaign
  // start (the nightly/hourly cron may not have run since Meta approved it).
  // Best-effort: needs a template-manager role; a 403 for others is swallowed
  // and the refresh still re-reads current DB. See whatsapp-templates `sync`.
  const syncTemplatesFromMeta = useCallback(async () => {
    if (!["super_admin", "admission_head"].includes(String(role))) return;
    setSyncingTemplates(true);
    try {
      await invokeEdge("whatsapp-templates", { body: { action: "sync" } });
    } catch {
      /* best-effort — the picker still works off the last sync */
    } finally {
      setSyncingTemplates(false);
      setMetaRefreshKey((key) => key + 1);
    }
  }, [role]);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) return;
    (async () => {
      // Paged, not a bare select. This used to carry `.limit(200)`, which hid
      // most of the 652 saved lists from the campaign picker. Dropping the limit
      // alone is not enough — PostgREST still caps every response at
      // db-max-rows=1000, so the same silent truncation returns once the list
      // count crosses 1000. Page until a short page comes back.
      const fetchAllLists = async () => {
        const PAGE = 500;
        const all: LeadList[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("lead_lists" as any)
            .select("id,name,member_count")
            .order("created_at", { ascending: false })
            .range(from, from + PAGE - 1);
          if (error) { console.error("Fetch lead lists failed:", error); break; }
          const page = ((data as any[]) || []) as LeadList[];
          all.push(...page);
          if (page.length < PAGE) break;
        }
        return all;
      };
      const [nextLists, templatesRes] = await Promise.all([
        fetchAllLists(),
        supabase
          .from("email_templates" as any)
          .select("id,slug,name,subject,body_html")
          .eq("is_active", true)
          .order("name"),
      ]);
      const nextTemplates = ((templatesRes.data as any[]) || []) as EmailTemplate[];
      setLists(nextLists);
      setEmailTemplates(nextTemplates);
      setSelectedListId((current) => {
        if (requestedListId && nextLists.some((list) => list.id === requestedListId)) return requestedListId;
        // Do NOT auto-select the first list — an auto-selected list + default
        // channel/template left "Queue Campaign" enabled on load, so a stray
        // click blasted the whole first list. Require an explicit choice.
        return current;
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
        .select("template_key, display_name, description, category, visibility, param_specs, media_url");
      const settingsRows = ((settings || []) as Array<{
        template_key: string;
        display_name?: string | null;
        description?: string | null;
        visibility?: string | null;
        media_url?: string | null;
      }>);
      const visibleSettings = settingsRows.filter((setting) =>
        ["marketing_only", "all"].includes(String(setting.visibility || "all")),
      );
      const mediaUrlByKey: Record<string, string> = {};
      for (const setting of settingsRows) {
        const url = sendableHeaderMediaUrl(setting.media_url);
        if (setting.template_key && url) mediaUrlByKey[setting.template_key] = url;
      }
      setWaTemplateMediaUrlByKey(mediaUrlByKey);
      const specsByKey: Record<string, WaBulkTemplate["params"]> = {};
      for (const s of (settings || []) as any[]) {
        if (Array.isArray(s.param_specs)) {
          specsByKey[s.template_key] = s.param_specs.map((p: any) => ({
            name: String(p.name),
            source: p.source === "auto" ? "auto" as const : "static" as const,
            placeholder: p.placeholder || undefined,
            help: p.help || undefined,
          }));
        }
      }
      const { data: approvedRows } = await (supabase as any)
        .from("whatsapp_templates")
        .select("name, components, placeholder_count, has_media, header_format, quality_score, waba_id")
        .eq("status", "APPROVED");
      const wabaByKey: Record<string, string | null> = {};
      for (const row of (approvedRows || []) as Array<{ name?: string; waba_id?: string | null }>) {
        if (row.name) wabaByKey[row.name] = row.waba_id ?? null;
      }
      setTemplateWabaByKey(wabaByKey);
      const dynamicTemplateKeys = visibleSettings
        .map((setting) => setting.template_key)
        .filter((templateKey) => templateKey && !knownKeys.has(templateKey));
      const approvedTemplateRows = await enrichApprovedWhatsAppTemplateMetadata(
        ((approvedRows || []) as ApprovedWhatsAppTemplateMetadata[]),
        dynamicTemplateKeys,
      );

      const overrides: Record<string, Partial<Pick<WaBulkTemplate, "description" | "preview">>> = {};
      const componentsByKey: Record<string, WhatsAppTemplateComponent[]> = {};
      const qualityByKey: Record<string, string | null> = {};
      const countByKey: Record<string, number> = {};
      const approvedKeys = new Set<string>();
      const formatByKey: Record<string, string> = {};
      (approvedRows || []).forEach((row: { name?: string; quality_score?: string | null; placeholder_count?: number | null; header_format?: string | null; has_media?: boolean | null }) => {
        if (row.name) {
          qualityByKey[row.name] = row.quality_score ?? null;
          countByKey[row.name] = Number(row.placeholder_count || 0);
          approvedKeys.add(row.name);
          const format = String(row.header_format || "").toUpperCase();
          if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) formatByKey[row.name] = format;
          else if (row.has_media) formatByKey[row.name] = "IMAGE";
        }
      });
      approvedTemplateRows.forEach((row) => {
        if (row.name && row.components) componentsByKey[row.name] = row.components;
        if (!row.name || !knownKeys.has(row.name)) return;
        const preview = templateTextPreviewFromComponents(row.components);
        if (preview) overrides[row.name] = { preview };
      });

      const approvedTemplateByName = new Map(approvedTemplateRows.map((row) => [row.name, row] as const));
      const dynamic = visibleSettings
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

      setParamSpecsByKey(specsByKey);
      setWaMetaTemplateOverrides(overrides);
      setWaTemplateComponentsByKey(componentsByKey);
      setWaTemplateQualityByKey(qualityByKey);
      setPlaceholderCountByKey(countByKey);
      setHeaderFormatByKey(formatByKey);
      setApprovedTemplateKeys(approvedKeys);
      setDynamicWaBulkTemplates(dynamic);
    })();
  }, [role, metaRefreshKey]);

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

  /**
   * Resolve a WhatsApp list into the exact audience `launchCampaign` will use.
   *
   * Shared deliberately: a preview computed by separate code drifts from the
   * send, and this is precisely the path where a silent mismatch cost us a
   * 4,000-member campaign. Returns the eligibility `counts` the builder throws
   * away today, plus the suppression figure.
   */
  const resolveWhatsAppAudience = useCallback(async (listId: string) => {
    const members = await fetchListMembers(
      supabase as any,
      listId,
      "lead_id, contact_id, leads(id, phone, stage, shared_with_nimt), marketing_contacts(id, phone, opted_out, promoted_lead_id)",
    );

    // Members are polymorphic (lead or bulk-imported marketing contact);
    // campaignMemberToLead normalises both into the shape
    // filterCampaignRecipients and the pacing plan expect, and carries
    // `isContact` through so the recipient row targets the right column.
    let rawLeads = ((members as any[]) || [])
      .map((member) => campaignMemberToLead(member, "whatsapp"))
      .filter((lead) => lead && lead.id) as Array<{ id: string; phone?: string | null }>;

    // Numbers that keep hitting Meta's per-user marketing cap. Excluded here so
    // they never enter the campaign, not just skipped at send time.
    let suppressedCount = 0;
    const phones = rawLeads.map((l) => String(l.phone || "")).filter(Boolean);
    if (phones.length) {
      const { data: sup, error: supErr } = await supabase
        .rpc("wa_suppressed_phones" as any, { _phones: phones });
      if (!supErr) {
        const blocked = new Set(((sup as Array<{ phone: string }> | null) || []).map((r) => String(r.phone)));
        if (blocked.size) {
          const before = rawLeads.length;
          rawLeads = rawLeads.filter((l) => !blocked.has(String(l.phone || "").replace(/[^0-9]/g, "")));
          suppressedCount = before - rawLeads.length;
        }
      }
    }

    const quietDays = waQuietDaysEnabled ? Math.max(0, Number(waQuietDays) || DEFAULT_QUIET_DAYS) : 0;
    let lastMarketingAtByLeadId = new Map<string, string>();
    if (quietDays > 0 && rawLeads.length > 0) {
      lastMarketingAtByLeadId = await fetchLastWhatsAppMarketingAtByLeadIds(
        supabase as any,
        rawLeads.map((lead) => lead.id),
        Math.max(quietDays, 30),
      );
    }

    const eligibility = filterCampaignRecipients(rawLeads as never[], {
      channel: "whatsapp",
      excludeCold: waExcludeCold,
      quietDays,
      lastMarketingAtByLeadId,
    });
    return { eligibility, suppressedCount, memberCount: (members as any[])?.length || 0 };
  }, [waExcludeCold, waQuietDaysEnabled, waQuietDays]);

  const [audiencePreview, setAudiencePreview] = useState<
    { eligible: number; memberCount: number; suppressed: number; counts: Record<string, number> } | null
  >(null);
  const [previewing, setPreviewing] = useState(false);

  // Reset whenever anything that changes the audience changes.
  useEffect(() => { setAudiencePreview(null); }, [selectedListId, waExcludeCold, waQuietDaysEnabled, waQuietDays]);

  const previewAudience = useCallback(async () => {
    if (!selectedList) return;
    setPreviewing(true);
    try {
      const { eligibility, suppressedCount, memberCount } = await resolveWhatsAppAudience(selectedList.id);
      setAudiencePreview({
        eligible: eligibility.counts.eligible,
        memberCount,
        suppressed: suppressedCount,
        counts: eligibility.counts as unknown as Record<string, number>,
      });
    } catch (err) {
      toast({
        title: "Could not check audience",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPreviewing(false);
    }
  }, [selectedList, resolveWhatsAppAudience, toast]);

  // Tier-aware pacing: the selected number's Meta rolling-24h unique-recipient
  // cap. A campaign whose audience exceeds it must be split across days, or Meta
  // rejects the overflow (131056 / quality hit). Use the checked eligible count
  // when available, else the raw list size.
  // Round-robin: only numbers that have THIS template approved on their own
  // WhatsApp account, besides the primary sender. The authority is each number's
  // synced `available_templates` (Meta approves per WABA) — NOT the WABA-id
  // heuristic, which treats an unmapped null waba_id as "main" and wrongly
  // matched Mirai/Beacon numbers. A number with no synced list can't be
  // confirmed, so it's excluded (conservative — never offer a number that would
  // 132001 at send).
  const rotationCandidates = useMemo(
    () => waSenderOptions.filter((s) =>
      s.value !== DEFAULT_WA_SENDER
      && s.value !== waSenderValue
      && !!s.phoneNumberId
      && Array.isArray(s.availableTemplates)
      && s.availableTemplates.includes(waTemplate),
    ),
    [waSenderOptions, waSenderValue, waTemplate],
  );
  const rotationSenders = useMemo(
    () => rotationCandidates.filter((s) => waRotationValues.includes(s.value)),
    [rotationCandidates, waRotationValues],
  );
  // Primary + rotation numbers, deduped by phone_number_id.
  const effectiveSenders = useMemo(() => {
    const out: WaSenderOption[] = [];
    if (waSelectedSender?.phoneNumberId) out.push(waSelectedSender);
    for (const s of rotationSenders) {
      if (!out.some((x) => x.phoneNumberId === s.phoneNumberId)) out.push(s);
    }
    return out;
  }, [waSelectedSender, rotationSenders]);
  const isRotating = effectiveSenders.length > 1;
  // Combined daily cap when rotating = sum of each number's Meta tier (one
  // unlimited/unknown → no finite cap to enforce).
  const combinedTierCap = useMemo(() => {
    if (effectiveSenders.length <= 1) return messagingTierDailyCap(waSelectedSender?.messagingLimitTier);
    let sum = 0;
    for (const s of effectiveSenders) {
      const cap = messagingTierDailyCap(s.messagingLimitTier);
      if (cap == null) return null;
      sum += cap;
    }
    return sum;
  }, [effectiveSenders, waSelectedSender?.messagingLimitTier]);
  const senderTierCap = combinedTierCap;
  // Drop rotation picks that stop being valid when the template/sender changes.
  useEffect(() => {
    setWaRotationValues((cur) => cur.filter((v) => rotationCandidates.some((s) => s.value === v)));
  }, [rotationCandidates]);
  const plannedRecipients = audiencePreview?.eligible ?? selectedList?.member_count ?? 0;
  const exceedsTier = campaignChannel === "whatsapp" && !!senderTierCap && plannedRecipients > senderTierCap;
  // Over tier → force pacing and cap the daily wave at the tier (keep a stricter
  // cap the user already chose). This is the "don't allow a send above the tier,
  // split it across days" behaviour, shown in the pacing box below.
  useEffect(() => {
    if (!exceedsTier || !senderTierCap) return;
    setWaSendMode("paced");
    setWaDailyCap((current) => {
      const cur = Number(current) || 0;
      return cur > 0 && cur <= senderTierCap ? current : String(senderTierCap);
    });
  }, [exceedsTier, senderTierCap]);

  const launchCampaign = async () => {
    if (!selectedList) {
      setLaunchError("Pick a lead list first.");
      return;
    }
    // Confirm before firing — queuing a campaign blasts real messages to a whole
    // list and can't be recalled. Show the blast radius so it can't be triggered
    // by an accidental click.
    const channelLabel = campaignChannel === "whatsapp" ? "WhatsApp" : "Email";
    const templateLabel = campaignChannel === "whatsapp" ? waTemplate : emailSlug;
    const whenLabel = campaignScheduleMode === "scheduled" && campaignScheduledAt
      ? `scheduled for ${campaignScheduledAt}`
      : "now";
    const ok = window.confirm(
      `Queue ${channelLabel} campaign to "${selectedList.name}" (~${selectedList.member_count} leads) ` +
      `using template "${templateLabel}", sending ${whenLabel}?\n\n` +
      `Eligible leads (after DNC / quiet-day / scope filters) will receive this message. This cannot be undone.`,
    );
    if (!ok) return;
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
        if (hasMediaHeader && !headerMediaReady) {
          throw new Error("This template needs a public HTTPS header URL. Save one in Template Manager or paste it here.");
        }
        if (!waTestDelivered) throw new Error("Send a test and confirm it was received before queueing.");
        if (!waTemplateQuality.allowBulk) throw new Error(waTemplateQuality.detail);
        if (!senderCanSendTemplate(waSelectedSender, waTemplate, selectedTemplateWaba)) {
          throw new Error(`This sender doesn't have "${waTemplate}" approved. Pick another sender or template.`);
        }

        // Same resolver the audience preview uses, so what the builder promised
        // is exactly what gets enrolled.
        const { eligibility } = await resolveWhatsAppAudience(selectedList.id);
        const valid = eligibility.eligible as any[];
        if (!valid.length) {
          throw new Error(eligibility.preview || "No reachable WhatsApp recipients after DNC/quality filters.");
        }

        // No single day's wave may exceed the number's Meta tier. Paced → the
        // daily cap is the wave size; immediate → the whole audience is one wave.
        if (senderTierCap) {
          const perWave = waSendMode === "paced"
            ? (Number(waDailyCap) || DEFAULT_DAILY_UNIQUE_CAP)
            : valid.length;
          if (perWave > senderTierCap) {
            throw new Error(
              `This number's Meta limit is ${senderTierCap.toLocaleString("en-IN")} recipients/day, but ` +
              `${perWave.toLocaleString("en-IN")} would go out in one day. Enable "Pace over days" (or lower the ` +
              `daily cap to ${senderTierCap.toLocaleString("en-IN")}) so the ${valid.length.toLocaleString("en-IN")} recipients split across days.`,
            );
          }
        }

        const staticParamsToSend: Record<string, string> = {};
        for (const field of waStaticFields) {
          const value = effectiveWaParamValue(waStaticParams, field.name).trim();
          if (value) staticParamsToSend[field.name] = value;
          else if (isWaMediaTemplateParam(field.name) && selectedWaTemplateDefaultMediaUrl) {
            staticParamsToSend[field.name] = selectedWaTemplateDefaultMediaUrl;
          }
        }
        const headerMediaToRemember = sendableHeaderMediaUrl(staticParamsToSend.template_header_media_url);

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
            sender_phone_number_ids: isRotating
              ? effectiveSenders.map((s) => s.phoneNumberId).filter(Boolean)
              : null,
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
        if (headerMediaToRemember) void rememberTemplateHeaderMedia(waTemplate, headerMediaToRemember);

        const rows = valid.map((lead, index) => {
          // Round-robin: recipient i sends from sender i%N, assigned now so it's
          // stable across retries and evenly split across the numbers.
          const rotSender = isRotating ? effectiveSenders[index % effectiveSenders.length] : null;
          return {
            campaign_id: (campaign as any).id,
            // Exactly one of these is set — whatsapp_campaign_recipients_one_target
            // enforces it at the DB level.
            lead_id: (lead as any).isContact ? null : lead.id,
            contact_id: (lead as any).isContact ? lead.id : null,
            phone: lead.phone,
            eligible_at: pacePlan.eligibleAtByIndex[index] || nextAttemptAt,
            ...(rotSender ? {
              business_phone_number_id: rotSender.phoneNumberId,
              business_number: rotSender.businessNumber,
            } : {}),
          };
        });
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from("whatsapp_campaign_recipients" as any).insert(rows.slice(i, i + 500));
          if (error) throw error;
        }
      } else {
        if (emailMode === "template" && !emailSlug) throw new Error("Pick an email template.");
        if (emailMode === "custom" && (!emailSubject.trim() || !emailBody.trim())) {
          throw new Error("Subject and body are required for custom email.");
        }

        const members = await fetchListMembers(
          supabase as any,
          selectedList.id,
          "lead_id, contact_id, leads(id, email, stage, shared_with_nimt), marketing_contacts(id, email, opted_out, promoted_lead_id)",
        );

        // Same polymorphic normalisation as the WhatsApp path above. Most
        // imported contacts have no email and drop out at the eligibility
        // filter, but without this an email campaign over a marketing list
        // would silently resolve every member to null and reach nobody.
        const rawEmailLeads = ((members as any[]) || [])
          .map((member) => campaignMemberToLead(member, "email"))
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
          // Exactly one target — email_campaign_recipients_one_target enforces it.
          lead_id: (lead as any).isContact ? null : lead.id,
          contact_id: (lead as any).isContact ? lead.id : null,
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

  const openRecipients = async (
    campaign: CampaignRow,
    filter: RecipientEngagementFilter = "all",
  ) => {
    setDetailCampaign(campaign);
    setRecipientFilter(filter);
    setRecipientsLoading(true);
    const { table, destinationColumn, providerColumn, select } = campaignRecipientQuery(campaign.channel);
    try {
      let rows: any[] = [];
      if (filter === "all") {
        const { data, error } = await supabase
          .from(table as any)
          .select(select)
          .eq("campaign_id", campaign.id)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        rows = (data as any[]) || [];
      } else {
        rows = await fetchCampaignRecipientsByEngagement(supabase, campaign.channel, campaign.id, filter);
      }
      setRecipients(rows.map((row) => mapDbRecipient(row, destinationColumn, providerColumn)));
    } catch (error: any) {
      toast({
        title: "Could not load recipients",
        description: error?.message || "Try again.",
        variant: "destructive",
      });
      setRecipients([]);
    } finally {
      setRecipientsLoading(false);
    }
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
        campaignHealth(campaign).label,
        campaign.nextEligibleAt || campaign.nextAttemptAt || "",
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

  const downloadRecipientCsv = (
    campaign: CampaignRow,
    rows: RecipientRow[],
    suffix = "recipients",
  ) => {
    downloadCsv(
      `${campaign.channel}-campaign-${suffix}-${campaign.id}.csv`,
      RECIPIENT_CSV_HEADERS,
      maskMatrix(RECIPIENT_CSV_HEADERS, recipientCsvRows(rows), realRole === "super_admin"),
    );
  };

  const downloadRecipientReport = () => {
    if (!detailCampaign) return;
    const suffix = recipientFilter === "all" ? "recipients" : recipientFilter;
    downloadRecipientCsv(detailCampaign, recipients, suffix);
  };

  const downloadEngagedLeads = async (campaign: CampaignRow) => {
    setExportingEngagedId(campaign.id);
    try {
      const { destinationColumn, providerColumn } = campaignRecipientQuery(campaign.channel);
      const rows = await fetchCampaignRecipientsByEngagement(
        supabase,
        campaign.channel,
        campaign.id,
        "engaged",
      );
      const mapped = rows.map((row) => mapDbRecipient(row, destinationColumn, providerColumn));
      if (mapped.length === 0) {
        toast({ title: "No engaged leads to export" });
        return;
      }
      downloadRecipientCsv(campaign, mapped, "engaged");
    } catch (error: any) {
      toast({
        title: "Could not export engaged leads",
        description: error?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setExportingEngagedId(null);
    }
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
    <div className="space-y-5">
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

      {!builderOpen ? (
        <Button onClick={() => { setBuilderOpen(true); void syncTemplatesFromMeta(); }} size="lg" className="gap-2">
          <Megaphone className="h-4 w-4" /> New Campaign
        </Button>
      ) : (
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <ListPlus className="h-4 w-4 text-primary" />
                <p className="font-semibold">Lists / Initiate New Campaign</p>
              </div>
              <p className="text-xs text-muted-foreground">Pick a saved lead list, choose the channel, and queue the campaign.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_1fr]">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lead list</label>
              <div className="mt-1 flex gap-2">
                <Popover open={listPickerOpen} onOpenChange={setListPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={lists.length === 0}
                      className="h-10 min-w-0 flex-1 justify-between rounded-md border border-input bg-background px-3 text-sm font-normal"
                    >
                      <span className="truncate">
                        {lists.length === 0
                          ? "No lists available"
                          : selectedList
                            ? `${selectedList.name} (${selectedList.member_count})`
                            : "Select lead list"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search lists…" />
                      <CommandList className="max-h-[300px] overflow-y-auto">
                        <CommandEmpty>No lists found.</CommandEmpty>
                        {lists.map((list) => (
                          <CommandItem
                            key={list.id}
                            value={list.name}
                            onSelect={() => {
                              setSelectedListId(list.id);
                              setListPickerOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 ${list.id === selectedListId ? "opacity-100" : "opacity-0"}`} />
                            <span className="truncate">{list.name} ({list.member_count})</span>
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
                {senderTierCap && (
                  <p className="pl-6 text-[11px] text-muted-foreground">
                    This number&apos;s Meta tier: <span className="font-medium text-foreground">{senderTierCap.toLocaleString("en-IN")}/day</span>
                    {plannedRecipients > 0 && <> · audience {plannedRecipients.toLocaleString("en-IN")}</>}
                  </p>
                )}
                {exceedsTier && senderTierCap && (
                  <p className="pl-6 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] font-medium text-warning-foreground">
                    Audience ({plannedRecipients.toLocaleString("en-IN")}) exceeds this number&apos;s Meta tier
                    ({senderTierCap.toLocaleString("en-IN")}/day). Pacing was enabled automatically to split it over
                    {" "}{Math.ceil(plannedRecipients / senderTierCap)} days — sending more in one day would be rejected by Meta.
                  </p>
                )}
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
                  <label className="text-xs font-medium text-muted-foreground">
                    WhatsApp template
                    {syncingTemplates && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <RefreshCw className="h-3 w-3 animate-spin" /> Syncing from Meta…
                      </span>
                    )}
                  </label>
                  <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-1 h-10 w-full justify-between rounded-md border border-input bg-background px-3 text-sm font-normal"
                      >
                        <span className="truncate">
                          {selectedWaTemplate?.label || (templateOptions.length === 0 ? "No templates available" : "Select template")}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search templates…" />
                        <CommandList className="max-h-[300px] overflow-y-auto">
                          <CommandEmpty>No templates found.</CommandEmpty>
                          {(() => {
                            const groups = new Map<string, typeof templateOptions>();
                            for (const template of templateOptions) {
                              const org = wabaOrgLabel(template.wabaId ?? null);
                              const list = groups.get(org) || [];
                              list.push(template);
                              groups.set(org, list);
                            }
                            const orgs = [...groups.keys()].sort((a, b) => {
                              if (a === WHATSAPP_BUSINESS_NAME) return -1;
                              if (b === WHATSAPP_BUSINESS_NAME) return 1;
                              return a.localeCompare(b);
                            });
                            return orgs.map((org) => (
                              <CommandGroup key={org} heading={org}>
                                {groups.get(org)!.map((template) => (
                                  <CommandItem
                                    key={template.key}
                                    value={`${org} ${template.label}`}
                                    onSelect={() => {
                                      setWaTemplate(template.key);
                                      setWaStaticParams({});
                                      // Template-first: if the current sender can't send this
                                      // template's WABA, narrow the number. Auto-pick only when
                                      // exactly one number matches (e.g. a Seralis template);
                                      // otherwise clear so the user chooses from the filtered list.
                                      if (!senderCanSendTemplate(waSelectedSender, template.key, template.wabaId ?? null)) {
                                        const compatible = waSenderOptions.filter(
                                          (s) => s.value !== DEFAULT_WA_SENDER && senderCanSendTemplate(s, "", template.wabaId ?? null),
                                        );
                                        setWaSenderValue(compatible.length === 1 ? compatible[0].value : "");
                                      }
                                      setTemplatePickerOpen(false);
                                    }}
                                  >
                                    <Check className={`mr-2 h-4 w-4 ${template.key === waTemplate ? "opacity-100" : "opacity-0"}`} />
                                    <span className="truncate">{template.label}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            ));
                          })()}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {templateOptions.length === 0 && (
                    <p className="mt-1.5 text-xs font-medium text-destructive">
                      No approved templates found. Sync templates and try again.
                    </p>
                  )}
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
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Send from number</label>
                  <Popover open={senderPickerOpen} onOpenChange={setSenderPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
                      >
                        {waSelectedSender ? (
                          <WhatsAppBusinessIdentity sender={waSelectedSender} compact />
                        ) : (
                          <span className="flex-1 text-muted-foreground">
                            {waTemplate ? "Select a number that can send this template" : "Select a template first"}
                          </span>
                        )}
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search numbers…" />
                        <CommandList className="max-h-[300px] overflow-y-auto">
                          <CommandEmpty>No numbers found.</CommandEmpty>
                          {waSenderOptions.map((sender) => {
                            const canSend = senderCanSendTemplate(sender, waTemplate, selectedTemplateWaba);
                            return (
                              <CommandItem
                                key={sender.value}
                                value={`${sender.businessNumber} ${sender.verifiedName ?? ""} ${sender.label}`}
                                disabled={!canSend}
                                onSelect={() => {
                                  setWaSenderValue(sender.value);
                                  setSenderPickerOpen(false);
                                }}
                                className="p-0"
                              >
                                <div className="flex w-full flex-col">
                                  <WhatsAppBusinessIdentity sender={sender} selected={sender.value === waSenderValue} />
                                  {!canSend && (
                                    <span className="px-3 pb-1.5 text-[11px] font-medium text-destructive">
                                      Can't send "{waTemplate}"
                                    </span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {!selectedSenderCanSend && (
                    <p className="mt-1.5 text-xs font-medium text-destructive">
                      This number can't send "{waTemplate}" — its WhatsApp account doesn't have that template approved. Pick another sender or template.
                    </p>
                  )}
                  {selectedSenderCanSend && rotationCandidates.length > 0 && (
                    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
                      <p className="text-xs font-medium text-foreground">
                        Rotate across more numbers <span className="font-normal text-muted-foreground">— throughput, same template</span>
                      </p>
                      {rotationCandidates.map((s) => (
                        <label key={s.value} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-input accent-primary"
                            checked={waRotationValues.includes(s.value)}
                            onChange={(e) => setWaRotationValues((cur) =>
                              e.target.checked ? [...cur, s.value] : cur.filter((v) => v !== s.value))}
                          />
                          <span className="text-foreground">{formatSenderNumber(s.businessNumber) || s.label}</span>
                          {s.messagingLimitTier && (
                            <span className="text-muted-foreground">· {formatMessagingTier(s.messagingLimitTier)}</span>
                          )}
                        </label>
                      ))}
                      {isRotating && (
                        <p className="text-[11px] text-muted-foreground">
                          Sending round-robin across {effectiveSenders.length} numbers
                          {combinedTierCap ? ` · combined ${combinedTierCap.toLocaleString("en-IN")}/day` : ""}. Recipients are split evenly; each always sends from the same number.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Send test message</label>
                    <PhoneInput
                      value={waTestPhone}
                      onChange={setWaTestPhone}
                      placeholder="Phone to test"
                      aria-label="Test phone number"
                      className="mt-1"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!waTemplate || !waTestPhone.trim() || waTestSending || !selectedSenderCanSend || !headerMediaReady}
                    onClick={handleSendTest}
                  >
                    {waTestSending ? "Sending…" : "Send test"}
                  </Button>
                </div>
                {!!waTemplate && !!waTestPhone.trim() && !waTestSending && (!selectedSenderCanSend || !headerMediaReady) && (
                  <p className="text-xs font-medium text-destructive">
                    {!selectedSenderCanSend
                      ? "Pick a sender that can send this template before testing."
                      : "This template needs a public header image URL (saved in Template Manager or pasted below)."}
                  </p>
                )}
                {waTestPhase === "waiting" && (
                  <p className="text-xs font-medium text-info-foreground">
                    Test sent — check the phone. Delivery receipts can take a minute.
                  </p>
                )}
                {waTestPhase === "delivered" && (
                  <p className="text-xs font-medium text-emerald-600">
                    Test received successfully. Queue campaign is now enabled.
                  </p>
                )}
                {waTestPhase === "failed" && waTestError && (
                  <p className="text-xs font-medium text-destructive">{waTestError}</p>
                )}
                {(waTestPhase === "waiting" || (waTestPhase === "failed" && waTestCanConfirm)) && waTestCanConfirm && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {waTestError || "If you received the message, confirm it so you can queue the campaign."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setWaTestPhase("delivered");
                        setWaTestDelivered(true);
                        setWaTestError(null);
                      }}
                    >
                      I received it
                    </Button>
                  </div>
                )}
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
                      const label = isMediaParam
                        ? "Header media URL"
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
                              value={isMediaParam
                                ? (headerMediaFieldValue || selectedWaTemplateDefaultMediaUrl || "")
                                : (canMap ? (waStaticParams[field.name] || "") : value)}
                              onChange={(event) => setWaStaticParams((current) => ({ ...current, [field.name]: event.target.value }))}
                              placeholder={isMediaParam ? "Public https:// image URL from Template Manager" : field.placeholder || field.name}
                              className={`mt-1 ${isMediaParam && mediaProbe.status === "bad" ? "border-destructive/50" : ""}`}
                            />
                          )}
                          {mappedToken && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Filled per recipient from {waParamFieldLabel(mappedToken)}.
                            </p>
                          )}
                          {isMediaParam && mediaProbe.status === "checking" && (
                            <p className="mt-1 text-xs text-muted-foreground">Checking that this URL is public…</p>
                          )}
                          {isMediaParam && mediaProbe.status === "ok" && (
                            <p className="mt-1 text-xs font-medium text-emerald-600">Public URL verified — Meta can fetch this file.</p>
                          )}
                          {isMediaParam && mediaProbe.status === "bad" && mediaProbe.reason && (
                            <p className="mt-1 text-xs font-medium text-destructive">{mediaProbe.reason}</p>
                          )}
                          {isMediaParam && mediaProbe.status === "idle" && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Filled from Template Manager when a header file is saved. Edit it if you need a different image.{" "}
                              <Link to="/template-manager" className="underline underline-offset-2">Open Template Manager</Link>
                            </p>
                          )}
                          {field.help && !isMediaParam && !mappedToken && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
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
                  mediaUrl={sendableHeaderMediaUrl(effectiveWaParamValue(waStaticParams, "template_header_media_url")) || selectedWaTemplateDefaultMediaUrl}
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

          {campaignChannel === "whatsapp" && selectedList && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Audience</p>
                <Button type="button" variant="outline" size="sm" onClick={previewAudience} disabled={previewing}>
                  {previewing ? "Checking…" : audiencePreview ? "Re-check" : "Check audience"}
                </Button>
              </div>
              {!audiencePreview ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedList.member_count.toLocaleString("en-IN")} on this list. Check to see how many will
                  actually receive it after DNC, opt-outs, quiet days and Meta suppression.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  <p className="text-sm">
                    <span className="font-semibold text-success">{audiencePreview.eligible.toLocaleString("en-IN")}</span>
                    {" will receive"}
                    <span className="text-muted-foreground">
                      {" "}of {audiencePreview.memberCount.toLocaleString("en-IN")} on the list
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      audiencePreview.counts.dnc ? `${audiencePreview.counts.dnc} DNC` : null,
                      audiencePreview.suppressed ? `${audiencePreview.suppressed} suppressed (Meta cap)` : null,
                      audiencePreview.counts.recentContact ? `${audiencePreview.counts.recentContact} recently messaged` : null,
                      audiencePreview.counts.noContact ? `${audiencePreview.counts.noContact} no phone` : null,
                      audiencePreview.counts.cold ? `${audiencePreview.counts.cold} cold` : null,
                      audiencePreview.counts.notShared ? `${audiencePreview.counts.notShared} not shared` : null,
                    ].filter(Boolean).join(" · ") || "No exclusions."}
                  </p>
                  {waSelectedSender?.messagingLimitTier && (
                    <p className="text-xs text-muted-foreground">
                      Sender limit: {formatMessagingTier(waSelectedSender.messagingLimitTier)}
                      {waSelectedSender.qualityRating && waSelectedSender.qualityRating !== "UNKNOWN"
                        ? ` · Meta quality ${waSelectedSender.qualityRating.toLowerCase()}`
                        : ""}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {launchError && <p className="text-sm text-destructive">{launchError}</p>}
          <p className="text-xs text-muted-foreground">
            DNC leads and members without the selected channel destination are skipped at queue time.
          </p>
          {/* Send-time choice sits WITH the launch button: pick now/schedule,
              then the button reads "Queue"/"Schedule" to match. */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-3 md:grid-cols-[180px_260px]">
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
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={launchCampaign}
                disabled={
                  launching
                  || !selectedList
                  || (campaignChannel === "whatsapp" && (waMissingStatic || !waTemplateQuality.allowBulk))
                  || (campaignChannel === "whatsapp" && !selectedSenderCanSend)
                  || (campaignChannel === "whatsapp" && !waTestDelivered)
                }
              >
                {launching ? <ButtonOrb state="connecting" onFilled /> : <Send className="mr-2 h-4 w-4" />}
                {campaignScheduleMode === "scheduled" ? "Schedule Campaign" : "Queue Campaign"}
              </Button>
              {campaignChannel === "whatsapp" && !waTestDelivered && (
                <p className="text-xs text-muted-foreground">
                  Send a test, then confirm it arrived (or wait for the delivery receipt) before queueing.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Executed Campaigns</h2>
          <p className="text-sm text-muted-foreground">Running, completed, paused, failed, and terminated campaign results.</p>
        </div>

        {/* One row of five, matching the WhatsAppHealth tile shape. Was twelve
            tiles across three grids — including a six-tile row inside
            md:grid-cols-4, which wrapped 4+2 and left two dead cells. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <CampaignStat index={0} icon={Users} chip="bg-pastel-purple" wash="bg-pastel-purple/60" label="Audience" value={totals.total} hint={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`} />
          <CampaignStat index={1} icon={Send} chip="bg-pastel-blue" wash="bg-pastel-blue/60" label="Sent" value={totals.sent} hint={`${pct(totals.sent, totals.sent + totals.failed)} success rate`} />
          <CampaignStat index={2} icon={CheckCircle2} chip="bg-pastel-green" wash="bg-pastel-green/60" label="Delivered" value={totals.delivered} hint={`${pct(totals.delivered, totals.sent)} of sent`} tone={rateTone(rate(totals.delivered, totals.sent), "delivered")} />
          <CampaignStat index={3} icon={MessageSquare} chip="bg-pastel-mint" wash="bg-pastel-mint/60" label="Read" value={totals.read} hint={`${pct(totals.read, totals.sent)} of sent`} tone={rateTone(rate(totals.read, totals.sent), "read")} />
          <CampaignStat index={4} icon={XCircle} chip="bg-pastel-red" wash="bg-pastel-red/60" label="Failed" value={totals.failed} hint={`${pct(totals.failed, totals.sent + totals.failed)} of attempts`} tone={rateTone(rate(totals.failed, totals.sent + totals.failed), "failed")} />
        </div>

        {/* Engagement and channel split are secondary — a line, not six tiles. */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {totals.responded.toLocaleString("en-IN")} responded · {totals.called.toLocaleString("en-IN")} called ·{" "}
          {(totals.clickedLink + totals.clickedButton).toLocaleString("en-IN")} clicks ·{" "}
          {totals.whatsapp.toLocaleString("en-IN")} WhatsApp / {totals.email.toLocaleString("en-IN")} email sent
        </p>
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
                <thead className="sticky top-0 z-10 border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Campaign</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-3 py-3 text-right">Audience</th>
                    <th className="px-3 py-3 text-right">Sent</th>
                    <th className="px-3 py-3 text-right">Delivered</th>
                    <th className="px-3 py-3 text-right">Read</th>
                    <th className="px-3 py-3 text-right">Failed</th>
                    <th className="px-3 py-3 text-left">Scheduled / Created</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.slice(0, visibleCampaigns).map((campaign) => (
                    <Fragment key={`${campaign.channel}-${campaign.id}`}>
                    <tr className="border-b border-border transition-colors duration-160 ease-standard last:border-b-0 hover:bg-muted/20">
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="flex items-start gap-2">
                          {campaign.channel === "whatsapp"
                            ? <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="WhatsApp" />
                            : <Mail className="mt-0.5 h-4 w-4 shrink-0 text-info-foreground" aria-label="Email" />}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground" title={campaign.name}>{campaign.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {campaign.template || "No template"}{campaign.listName ? ` · ${campaign.listName}` : ""}
                            </p>
                            {/* Live progress belongs here, not stacked inside the Sent
                                column where it was one of two causes of 400px rows. */}
                            {!isCampaignTerminal(campaign.status) && campaign.pendingRecipients > 0 && (
                              <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-info transition-all"
                                  style={{ width: `${campaignProgressPct(campaign.total - campaign.pendingRecipients, campaign.total)}%` }}
                                />
                              </div>
                            )}
                            {/* Auto-pause writes a full sentence here; clamp it so an
                                error can never blow the row height open again. */}
                            {campaign.workerError && (
                              <p className="mt-1 line-clamp-2 max-w-[22rem] text-xs text-destructive" title={campaign.workerError}>
                                {campaign.workerError}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const health = campaignHealth(campaign);
                          return (
                            <div className="space-y-1">
                              <Badge className={`border-0 ${health.tone}`}>{health.label}</Badge>
                              {health.detail && (
                                <p className="text-[11px] leading-tight text-muted-foreground">{health.detail}</p>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{campaign.total.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-3 text-right font-medium text-success tabular-nums">{campaign.sent.toLocaleString("en-IN")}</td>
                      {/* Count and rate in one pill, coloured by health — the
                          PublisherAnalytics idiom. Two lines became one. */}
                      <td className="px-3 py-3 text-right">
                        {campaign.channel === "whatsapp" ? (
                          <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${ratePillClass(rate(campaign.delivered, campaign.sent), "delivered")}`}>
                            {campaign.delivered.toLocaleString("en-IN")} · {pct(campaign.delivered, campaign.sent)}
                          </span>
                        ) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {campaign.channel === "whatsapp" ? (
                          <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${ratePillClass(rate(campaign.read, campaign.sent), "read")}`}>
                            {campaign.read.toLocaleString("en-IN")} · {pct(campaign.read, campaign.sent)}
                          </span>
                        ) : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Disclosure sits with the number it discloses, and to its
                              left so the numeral stays flush with the column edge. */}
                          { (campaign.failureBreakdown.length > 0 || campaignHasEngaged(campaign)) && (
                            <button
                              type="button"
                              onClick={() => setExpandedCampaignId((c) => (c === campaign.id ? null : campaign.id))}
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label={expandedCampaignId === campaign.id ? "Hide campaign details" : "Show campaign details"}
                              aria-expanded={expandedCampaignId === campaign.id}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform duration-160 ease-standard ${expandedCampaignId === campaign.id ? "rotate-180" : ""}`} />
                            </button>
                          )}
                          <span className="font-medium text-destructive tabular-nums">
                            {campaign.failed.toLocaleString("en-IN")}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {campaignDisplayStatus(campaign) === "scheduled" ? (
                          <div>
                            <div className="font-medium text-foreground">{fmtDateCompact(campaign.nextAttemptAt)}</div>
                            <div className="text-[11px]">Created {fmtDateCompact(campaign.createdAt)}</div>
                          </div>
                        ) : (
                          fmtDateCompact(campaign.createdAt)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
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
                    {expandedCampaignId === campaign.id && (
                      <tr className="border-b border-border last:border-b-0">
                        <td colSpan={9} className="bg-primary/5 px-4 py-3">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Why {campaign.failed.toLocaleString("en-IN")} failed
                              </p>
                              {campaign.failureBreakdown.length > 0 ? (
                              <ul className="space-y-1">
                                {campaign.failureBreakdown.map((f) => (
                                  <li key={f.code} className="flex items-baseline gap-2 text-xs">
                                    <span className="min-w-[3.5rem] text-right font-semibold tabular-nums text-destructive">
                                      {f.count.toLocaleString("en-IN")}
                                    </span>
                                    <span className="text-foreground">{f.text}</span>
                                    {f.code !== "unknown" && (
                                      <span className="text-[11px] text-muted-foreground/70">Meta {f.code}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">No send failures recorded.</p>
                              )}
                            </div>
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Engagement
                              </p>
                              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <dt className="text-muted-foreground">Responded</dt>
                                <dd className="tabular-nums">{campaign.responded.toLocaleString("en-IN")} · {pct(campaign.responded, campaign.total)}</dd>
                                <dt className="text-muted-foreground">Called</dt>
                                <dd className="tabular-nums">{campaign.called.toLocaleString("en-IN")} · {pct(campaign.called, campaign.total)}</dd>
                                <dt className="text-muted-foreground">Clicks</dt>
                                <dd className="tabular-nums">
                                  {campaign.clickedLink.toLocaleString("en-IN")} link / {campaign.clickedButton.toLocaleString("en-IN")} button
                                </dd>
                                <dt className="text-muted-foreground">Success rate</dt>
                                <dd className="tabular-nums">{pct(campaign.sent, campaign.sent + campaign.failed)}</dd>
                              </dl>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void downloadEngagedLeads(campaign)}
                                  disabled={!campaignHasEngaged(campaign) || exportingEngagedId === campaign.id}
                                >
                                  <Download className="mr-1 h-3.5 w-3.5" />
                                  {exportingEngagedId === campaign.id ? "Exporting…" : "Export engaged"}
                                </Button>
                                {campaign.channel === "whatsapp" && campaignHasEngaged(campaign) ? (
                                  <Button variant="outline" size="sm" asChild>
                                    <Link to={campaignEngagedInboxPath(campaign.id)} target="_blank" rel="noopener noreferrer">
                                      <MessageSquare className="mr-1 h-3.5 w-3.5" />
                                      Open in inbox
                                    </Link>
                                  </Button>
                                ) : campaign.channel === "whatsapp" ? (
                                  <Button variant="outline" size="sm" disabled>
                                    <MessageSquare className="mr-1 h-3.5 w-3.5" />
                                    Open in inbox
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void openRecipients(campaign, "engaged")}
                                  disabled={!campaignHasEngaged(campaign)}
                                >
                                  View engaged
                                </Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {campaigns.length > visibleCampaigns && (
                <div className="flex justify-center py-3">
                  <Button variant="outline" size="sm" onClick={() => setVisibleCampaigns((n) => n + 10)}>
                    Show more ({campaigns.length - visibleCampaigns} more)
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailCampaign} onOpenChange={(open) => { if (!open) { setDetailCampaign(null); setRecipientFilter("all"); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                Campaign recipients
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2">
                {detailCampaign?.channel === "whatsapp" && campaignHasEngaged(detailCampaign) && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={campaignEngagedInboxPath(detailCampaign.id)} target="_blank" rel="noopener noreferrer">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Open in inbox
                    </Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={downloadRecipientReport} disabled={recipients.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Download CSV
                </Button>
              </div>
            </div>
          </DialogHeader>
          {detailCampaign && (
            <div className="flex flex-wrap gap-1">
              {([
                { key: "all" as const, label: "All" },
                { key: "engaged" as const, label: "Engaged" },
                { key: "responded" as const, label: "Responded" },
                { key: "called" as const, label: "Called" },
                { key: "clicked" as const, label: "Clicked" },
              ]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => void openRecipients(detailCampaign, f.key)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                    recipientFilter === f.key
                      ? "bg-primary/10 text-primary border-primary/30 ring-1 ring-current"
                      : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {recipientsLoading ? (
            <div className="flex items-center justify-center py-10">
              <OrbLoader state="connecting" />
            </div>
          ) : recipients.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {recipientFilter === "all" ? "No recipients found." : `No ${recipientFilter} leads in this campaign.`}
            </div>
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
                      <td className="px-3 py-2 text-muted-foreground">
                        {(() => {
                          // Was the raw Meta JSON. Route it through the same
                          // plain-English map the inbox uses.
                          if (!row.error && !row.errorCode) return "-";
                          const described = row.errorCode
                            ? { text: whatsAppErrorTextForCode(row.errorCode) }
                            : describeWhatsAppError(row.error);
                          return (
                            <div className="space-y-0.5">
                              <div>{described?.text ?? row.error ?? "-"}</div>
                              <div className="text-[11px] text-muted-foreground/70">
                                {row.errorCode ? `Meta ${row.errorCode}` : null}
                                {row.retryCount > 0 ? `${row.errorCode ? " · " : ""}${row.retryCount} retr${row.retryCount === 1 ? "y" : "ies"}` : null}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
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

/**
 * Summary tile. Same shape as WhatsAppHealth's SummaryCard: small label, big
 * tabular number, a hint line carrying the percentage, and a tone derived from
 * thresholds rather than hard-coded per call site (which is what the older
 * local `Metric` does).
 */
function CampaignStat({
  label,
  value,
  hint,
  tone = "ok",
  icon: Icon,
  chip,
  wash,
  index = 0,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: StatTone;
  icon: LucideIcon;
  /** Full literal class for the icon chip — must be literal so Tailwind emits it. */
  chip: string;
  /** Full literal class for the card wash — likewise literal, not composed. */
  wash: string;
  /** Position in the row — drives the staggered entrance. */
  index?: number;
}) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning-foreground" : "text-foreground";
  return (
    <Card
      className="overflow-hidden border-border/40 shadow-none transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1 animate-rs-slide-up"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
    >
      {/* The wash goes on the content, not the Card: Card carries .blade-surface,
          which sets background-color and would win over a bg-* utility. */}
      <CardContent className={`p-4 ${wash}`}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${chip}`}>
            <Icon className="h-4 w-4 text-foreground/70" />
          </span>
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value.toLocaleString("en-IN")}</p>
        {hint && <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

