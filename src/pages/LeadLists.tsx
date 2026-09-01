import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { maskMatrix } from "@/lib/maskContact";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useCallListOverview, type CallListOverviewRow } from "@/components/dashboard/CallListProgressPanel";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { describeFilterDefinition, type DynamicListFilterDefinition } from "@/lib/dynamicListFilters";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ListPlus, Loader2, Send, Mail, Trash2, Users, MessageSquare, AlertTriangle, Upload,
  Pause, PlayCircle, RefreshCw, XCircle, Phone, Check, ChevronDown, Lock,
  Megaphone, MoreHorizontal, Download, Archive, PhoneForwarded,
} from "lucide-react";
import { WA_BULK_TEMPLATES, dynamicWaTemplateParams, type WaBulkTemplate } from "@/config/waBulkTemplates";
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
import { decideBlockedRoleAccess, isAcademicPartnerPortalRole } from "@/lib/accessPolicy";
import {
  type WaSenderOption,
  DEFAULT_WA_SENDER,
  defaultWaSenderOption,
  formatSenderNumber,
  formatPct,
  senderHealthClass,
  loadWaSenders as sharedLoadWaSenders,
} from "@/lib/waSenders";
import { WhatsAppBusinessIdentity } from "@/components/whatsapp/WhatsAppBusinessIdentity";
import {
  buildCampaignPacePlan,
  DEFAULT_DAILY_UNIQUE_CAP,
  type CampaignSendMode,
} from "@/lib/campaignPacing";
import {
  campaignMemberToLead,
  DEFAULT_QUIET_DAYS,
  filterCampaignRecipients,
} from "@/lib/campaignEligibility";
import { fetchLastWhatsAppMarketingAtByLeadIds, fetchListMembers } from "@/lib/campaignEligibilityFetch";
import { evaluateTemplateQualityForBulk } from "@/lib/campaignTemplateQuality";

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
  created_by?: string | null;
  /** Set to 'calling' once the list is assigned out as a priority call list. */
  purpose?: "marketing" | "calling";
  is_active?: boolean;
  due_date?: string | null;
  /** static = frozen set. dynamic = re-derived from filter_definition on a cron. */
  list_type?: "static" | "dynamic";
  filter_definition?: DynamicListFilterDefinition | null;
  last_refreshed_at?: string | null;
  include_terminal?: boolean;
  /** Free-form tags (e.g. city + type) — searchable on the dashboard. */
  tags?: string[] | null;
  /** Non-null = archived. is_active is derived from this by a DB trigger. */
  archived_at?: string | null;
  /** Set when this list was spun out of another as the next calling attempt. */
  parent_list_id?: string | null;
  /** Attempt number in a follow-up chain. 1 = original list. */
  generation?: number;
  /** Retry cap for the chain before a lead is dropped as exhausted. */
  max_attempts?: number;
}

/** Server-computed follow-up buckets + throughput for one list. */
type FollowupCounts = {
  pending: number;
  no_answer: number;
  unrecorded: number;
  at_cap: number;
  max_attempts: number;
  dialable: number;
  attempted: number;
  connected: number;
  contact_rate: number | null;
};

// The three buckets the rollover can carry forward. Labels match what the
// admission head asked for; values match call_list_followup_candidates.
const FOLLOWUP_BUCKETS = [
  { value: "pending", label: "Never called", hint: "Still pending — nobody dialled them" },
  { value: "no_answer", label: "Not answered", hint: "Dialled, but no answer / busy / voicemail" },
  { value: "unrecorded", label: "No disposition", hint: "A call happened but no outcome was logged" },
] as const;

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
  /** Null = has never placed a call. */
  last_call_at?: string | null;
  open_leads?: number;
  /** Still-pending members across their other active call lists. */
  pending_call_list?: number;
};

// login_disabled=false is a poor proxy for "active" — several counsellors
// holding hundreds of leads have not dialled in weeks, and a test account is
// selectable. Rather than guess who is on leave, show the evidence and let the
// assigner decide.
const daysSince = (iso: string | null | undefined) =>
  iso == null ? null : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const lastCallLabel = (iso: string | null | undefined) => {
  const d = daysSince(iso);
  if (d === null) return "never called";
  if (d === 0) return "called today";
  if (d === 1) return "called yesterday";
  return `last called ${d}d ago`;
};

const DORMANT_DAYS = 14;

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

type CallListPreview = {
  total: number;
  dialable: number;
  no_phone: number;
  terminal: number;
};

type CallListProgress = {
  list_id: string;
  total: number;
  dialable: number;
  pending: number;
  worked: number;
  skipped: number;
  not_dialable: number;
  last_call_at: string | null;
  dispositions: Record<string, number>;
  by_counsellor: {
    counsellor_id: string;
    counsellor_name: string;
    total: number;
    worked: number;
    pending: number;
  }[];
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

export default function LeadLists() {
  const { toast } = useToast();
  const { profile, role, realRole, permissions, isImpersonating, user } = useAuth();
  const [searchParams] = useSearchParams();
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
  const [waSendMode, setWaSendMode] = useState<CampaignSendMode>("immediate");
  const [waDailyCap, setWaDailyCap] = useState(String(DEFAULT_DAILY_UNIQUE_CAP));
  /** Quality: skip stage=cold (default on). DNC is always excluded. */
  const [waExcludeCold, setWaExcludeCold] = useState(true);
  /** Skip leads who got a WhatsApp template in the last N days. */
  const [waQuietDaysEnabled, setWaQuietDaysEnabled] = useState(true);
  const [waQuietDays, setWaQuietDays] = useState(String(DEFAULT_QUIET_DAYS));
  const [waTemplateQualityByKey, setWaTemplateQualityByKey] = useState<Record<string, string | null>>({});
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
    () => resolveSendableTemplateMediaUrl(
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
  const waTemplateQuality = useMemo(
    () => evaluateTemplateQualityForBulk(waTemplateQualityByKey[waTemplateDef.key]),
    [waTemplateQualityByKey, waTemplateDef.key],
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
  // A list member is now polymorphic: either a real lead or a bulk-imported
  // marketing contact that hasn't engaged yet. lead_list_members_page returns
  // both shapes in one paged result.
  const [previewMembers, setPreviewMembers] = useState<Array<{ member_id: string; kind: "lead" | "contact"; target_id: string; name: string | null; phone: string | null; email: string | null; stage: string | null; promoted: boolean | null }>>([]);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // List assignment + calling report
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignList, setAssignList] = useState<LeadList | null>(null);
  const [counsellors, setCounsellors] = useState<CounsellorOption[]>([]);
  const [selectedCounsellorIds, setSelectedCounsellorIds] = useState<string[]>([]);
  // ponytail: counsellors already assigned to this list — shown disabled in the assign dialog
  const [alreadyAssignedIds, setAlreadyAssignedIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignmentSummary, setAssignmentSummary] = useState<string | null>(null);
  // Working instructions the counsellor sees on the dialer's list banner.
  const [assignNote, setAssignNote] = useState("");
  const [assignDueDate, setAssignDueDate] = useState("");
  // Re-running an assignment used to silently steal every already-owned lead.
  const [assignOnlyUnassigned, setAssignOnlyUnassigned] = useState(false);
  // Some pushes (win-backs) deliberately want cold / not-interested leads.
  const [assignIncludeTerminal, setAssignIncludeTerminal] = useState(false);
  const [assignPreview, setAssignPreview] = useState<CallListPreview | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportList, setReportList] = useState<LeadList | null>(null);
  const [assignmentReport, setAssignmentReport] = useState<LeadListAssignmentReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportProgress, setReportProgress] = useState<CallListProgress | null>(null);
  // Click an outcome chip to see only those leads.
  const [reportDispositionFilter, setReportDispositionFilter] = useState<string | null>(null);
  // Roll a list forward: archive it and spawn the next calling attempt out of the
  // leads that were never actually reached.
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupList, setFollowupList] = useState<LeadList | null>(null);
  const [followupBuckets, setFollowupBuckets] = useState<string[]>([]);
  const [followupDueDate, setFollowupDueDate] = useState("");
  const [followupIdentifier, setFollowupIdentifier] = useState("");
  const [followupArchiveSource, setFollowupArchiveSource] = useState(true);
  const [followupCounts, setFollowupCounts] = useState<FollowupCounts | null>(null);
  const [followupCreating, setFollowupCreating] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // One aggregated RPC for every active call list — cheaper and RLS-safe
  // compared with counting lead_list_members client-side per row.
  const { data: callListOverview = [] } = useCallListOverview({ enabled: role !== "counsellor" });
  const callProgressByList = useMemo(
    () => Object.fromEntries(callListOverview.map((l) => [l.id, l])),
    [callListOverview],
  );

  // ── Filter / sort controls ──────────────────────────────────────────────
  const [listFilter, setListFilter] = useState<"all" | "calling" | "mine" | "archived">("all");
  // Archived lists live behind a different query, not a client-side filter.
  const showArchived = listFilter === "archived";
  const [counsellorFilter, setCounsellorFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<"created" | "due" | "assigned" | "members" | "name">("created");
  const [search, setSearch] = useState("");

  // Counsellors that appear on any active calling list — drives the filter.
  const counsellorOptions = useMemo(() => {
    const m = new Map<string, string>();
    callListOverview.forEach((o) => o.by_counsellor.forEach((c) => m.set(c.counsellor_id, c.counsellor_name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [callListOverview]);

  const displayLists = useMemo(() => {
    let rows = lists.map((list) => ({ list, ov: callProgressByList[list.id] as CallListOverviewRow | undefined }));
    if (listFilter === "calling") rows = rows.filter((r) => r.list.purpose === "calling" && r.list.is_active);
    if (listFilter === "mine") rows = rows.filter((r) => r.list.created_by && r.list.created_by === profile?.id);
    if (counsellorFilter) rows = rows.filter((r) => r.ov?.by_counsellor.some((c) => c.counsellor_id === counsellorFilter));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      r.list.name.toLowerCase().includes(q) ||
      (r.list.tags ?? []).some((t) => t.toLowerCase().includes(q)));
    const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
    rows.sort((a, b) => {
      switch (sortKey) {
        case "name": return a.list.name.localeCompare(b.list.name);
        case "members": return b.list.member_count - a.list.member_count;
        case "due": { // soonest due first, lists without a due date last
          const da = time(a.ov?.due_date ?? a.list.due_date), db = time(b.ov?.due_date ?? b.list.due_date);
          if (da === null) return db === null ? 0 : 1;
          if (db === null) return -1;
          return da - db;
        }
        case "assigned": { // most recently assigned first
          const da = time(a.ov?.assigned_at), db = time(b.ov?.assigned_at);
          if (da === null) return db === null ? 0 : 1;
          if (db === null) return -1;
          return db - da;
        }
        default: return time(b.list.created_at)! - time(a.list.created_at)!;
      }
    });
    return rows;
  }, [lists, callProgressByList, listFilter, counsellorFilter, sortKey, search, profile?.id]);

  // Delete confirm
  const [deleteList, setDeleteList] = useState<LeadList | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canDeleteLists = role === "super_admin";
  // Mirrors the check inside assign_lead_list_round_robin — the button used to
  // render for everyone and only fail on submit.
  const isTeamLeader = useIsTeamLeader();
  const canAssignLists = role === "super_admin" || role === "admission_head"
    || role === "principal" || isTeamLeader;
  // A counsellor can put a list on their OWN dialer. loadAssignableCounsellors
  // returns only themselves, and assign_lead_list_round_robin restricts a plain
  // counsellor to self — so this button just needs to be reachable for them.
  const canSelfAssign = canAssignLists || role === "counsellor";

  const fetchLists = async () => {
    if (isAcademicPartnerPortalRole(role)) {
      setLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Archived lists are hidden unless the Archived segment is selected — before
    // archiving existed every list ever made stayed on this page forever.
    // Paged because PostgREST caps every response at db-max-rows=1000 and this
    // project is already at 652 lists and bulk-importing more.
    const PAGE = 500;
    const all: LeadList[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from("lead_lists" as any).select("*");
      q = showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) { console.error("Fetch lists failed:", error); break; }
      const page = ((data as any[]) || []) as LeadList[];
      all.push(...page);
      if (page.length < PAGE) break;
    }
    setLists(all);
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
  }, [role, showArchived]);

  // Deep link from the dashboard's "Assigned call lists" panel:
  // /lists?report=<id> opens that list's Calling Report directly.
  useEffect(() => {
    const reportId = searchParams.get("report");
    if (!reportId || lists.length === 0 || reportOpen) return;
    const target = lists.find((l) => l.id === reportId);
    if (target) openAssignmentReport(target);
  }, [searchParams, lists]);

  const loadWaSenders = async () => {
    setWaSenderLoading(true);
    setWaSenderError(null);
    const { options, error } = await sharedLoadWaSenders(supabase as any);
    if (error) setWaSenderError(error);
    setWaSenderOptions(options);
    setWaSenderValue((current) => options.some((o) => o.value === current) ? current : options[0]?.value || DEFAULT_WA_SENDER);
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
        .select("template_key, display_name, description, category, visibility")
        .in("visibility", ["marketing_only", "all"]);
      const settingsRows = ((settings || []) as Array<{
        template_key: string;
        display_name?: string | null;
        description?: string | null;
        category?: string | null;
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
      setWaMetaTemplateOverrides(overrides);
      setWaTemplateComponentsByKey(componentsByKey);
      setWaTemplateQualityByKey(qualityByKey);
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
    setWaSendMode("immediate");
    setWaDailyCap(String(DEFAULT_DAILY_UNIQUE_CAP));
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

  // Manual promotion: staff can pull a marketing contact into the CRM without
  // waiting for it to reply. Same RPC the engagement channels call, so the
  // result is identical (lead created under the contact's id, intake
  // round-robin applied, activity logged) and it stays idempotent.
  const promoteContact = async (contactId: string) => {
    setPromotingId(contactId);
    const { data, error } = await supabase.rpc("promote_marketing_contact" as any, {
      _contact_id: contactId,
      _source: "other",
      _reason: "manual_promote",
    });
    setPromotingId(null);
    if (error || !data) {
      toast({ title: "Promote failed", description: error?.message || "No lead returned.", variant: "destructive" });
      return;
    }
    setPreviewMembers(prev => prev.map(m =>
      m.target_id === contactId ? { ...m, kind: "lead" as const, promoted: true, stage: "new_lead" } : m
    ));
    toast({ title: "Promoted to lead", description: "This contact is now in the CRM and assigned." });
  };

  const openPreview = async (list: LeadList) => {
    setPreviewList(list);
    setPreviewOpen(true);
    setPreviewLoading(true);
    const { data, error } = await supabase.rpc("lead_list_members_page" as any, {
      _list_id: list.id,
      _limit: 100,
      _offset: 0,
    });
    if (error) console.error("Preview fetch failed:", error);
    setPreviewMembers(((data as any) || []) as typeof previewMembers);
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

    // One RPC instead of user_roles + profiles: it also carries the activity
    // signals the assigner needs (last call, open leads, outstanding list work).
    const { data, error } = await supabase.rpc("assignable_counsellors" as any);
    if (error) {
      toast({ title: "Could not load counsellors", description: error.message, variant: "destructive" });
      setCounsellors([]);
      return;
    }
    setCounsellors(((data || []) as any[])
      .map((item) => ({
        id: item.id,
        name: item.name || "Unknown",
        last_call_at: item.last_call_at ?? null,
        open_leads: item.open_leads ?? 0,
        pending_call_list: item.pending_call_list ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  };

  // Same RPC the cron runs, so an assigner never waits 15 minutes to see a
  // dynamic list catch up.
  const [refreshingListId, setRefreshingListId] = useState<string | null>(null);
  const refreshDynamicList = async (list: LeadList) => {
    setRefreshingListId(list.id);
    const { data, error } = await supabase.rpc("resolve_dynamic_list_members" as any, { _list_id: list.id });
    setRefreshingListId(null);
    if (error) {
      toast({ title: "Could not refresh list", description: error.message, variant: "destructive" });
      return;
    }
    const res = (data as { added?: number; removed?: number }) || {};
    toast({
      title: "List refreshed",
      description: `${res.added ?? 0} added · ${res.removed ?? 0} removed`,
    });
    await fetchLists();
  };

  const openAssign = async (list: LeadList) => {
    setAssignList(list);
    setSelectedCounsellorIds([]);
    setAlreadyAssignedIds([]);
    setAssignmentSummary(null);
    setAssignIncludeTerminal(list.include_terminal ?? false);
    setAssignPreview(null);
    setAssignOpen(true);
    await loadAssignableCounsellors();

    // Fetch counsellors already assigned to this list so they show disabled.
    const { data: assigned } = await supabase
      .from("lead_list_members" as any)
      .select("assigned_to")
      .eq("list_id", list.id)
      .not("assigned_to", "is", null);
    const ids = [...new Set((assigned || []).map((r: any) => r.assigned_to).filter(Boolean))] as string[];
    setAlreadyAssignedIds(ids);

    // A pure counsellor can only assign themselves — preselect so it's one click.
    if (!canAssignLists && role === "counsellor" && profile?.id) {
      setSelectedCounsellorIds([profile.id]);
    }
  };

  // Effective length, recomputed whenever the include-terminal choice flips, so
  // the assigner sees what they're actually handing over before committing.
  useEffect(() => {
    if (!assignOpen || !assignList) return;
    let cancelled = false;
    supabase
      .rpc("preview_call_list_assignment" as any, {
        _list_id: assignList.id,
        _include_terminal: assignIncludeTerminal,
      })
      .then(({ data }) => { if (!cancelled) setAssignPreview((data as CallListPreview) || null); });
    return () => { cancelled = true; };
  }, [assignOpen, assignList, assignIncludeTerminal]);

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
      _only_unassigned: assignOnlyUnassigned,
      _priority_note: assignNote.trim() || null,
      _due_date: assignDueDate || null,
      _include_terminal: assignIncludeTerminal,
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

  // Called-first ordering: the assigner opens this to read outcomes, and rows
  // with no call yet have nothing to say.
  const visibleAssignmentReport = useMemo(() => {
    const rows = reportDispositionFilter
      ? assignmentReport.filter((r) =>
          (r.latest_call_disposition || "unrecorded") === reportDispositionFilter)
      : assignmentReport;
    return [...rows].sort((a, b) => {
      const at = a.latest_call_at ? new Date(a.latest_call_at).getTime() : -1;
      const bt = b.latest_call_at ? new Date(b.latest_call_at).getTime() : -1;
      return bt - at;
    });
  }, [assignmentReport, reportDispositionFilter]);

  const openAssignmentReport = async (list: LeadList) => {
    setReportList(list);
    setReportOpen(true);
    setReportLoading(true);
    setReportDispositionFilter(null);
    // Aggregated server-side — a per-row client fetch would hit the 1000-row cap
    // on any list worth assigning.
    supabase.rpc("call_list_progress" as any, { p_list_id: list.id })
      .then(({ data: p }) => setReportProgress((p as CallListProgress) || null));
    supabase.rpc("call_list_followup_counts" as any, { _list_id: list.id })
      .then(({ data: c }) => setFollowupCounts((c as FollowupCounts) || null));
    // Page it. This used to be a single `_limit: 500` call, so every count and
    // chip in the dialog silently described only the first 500 leads.
    const PAGE = 1000;
    const all: LeadListAssignmentReportRow[] = [];
    let failed = false;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.rpc("get_lead_list_assignment_report" as any, {
        _list_id: list.id, _batch_id: null, _limit: PAGE, _offset: offset,
      });
      if (error) {
        toast({ title: "Could not load calling report", description: error.message, variant: "destructive" });
        failed = true;
        break;
      }
      const page = ((data as any[]) || []) as LeadListAssignmentReportRow[];
      all.push(...page);
      if (page.length < PAGE) break;
    }
    setAssignmentReport(failed ? [] : all);
    setReportLoading(false);
  };

  const [reportExporting, setReportExporting] = useState(false);

  // Full-list CSV — pages the report RPC 1000 rows at a time (the RPC hard-caps
  // per call; see project-supabase-1000-row-cap) so large lists aren't silently
  // truncated. Respects the active disposition chip.
  const downloadCallingReportCsv = async () => {
    if (!reportList) return;
    setReportExporting(true);
    try {
      const PAGE = 1000;
      const all: LeadListAssignmentReportRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase.rpc("get_lead_list_assignment_report" as any, {
          _list_id: reportList.id, _batch_id: null, _limit: PAGE, _offset: offset,
        });
        if (error) throw error;
        const page = ((data as any[]) || []) as LeadListAssignmentReportRow[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      // Must use the same bucketer the chips are built from — comparing against
      // `latest_call_disposition || "unrecorded"` meant the "not_called" chip
      // matched nothing and exported an empty file.
      const rows = reportDispositionFilter
        ? all.filter((r) => reportBucket(r) === reportDispositionFilter)
        : all;
      const dt = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN") : "");
      const header = ["Lead", "Phone", "Course", "Campus", "Counsellor", "Assigned At", "Stage", "Latest Disposition", "Latest Call At", "Notes"];
      const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rawBody = rows.map((r) => [
        r.lead_name || "", r.lead_phone || "", r.course_name || "", r.campus_name || "",
        r.assigned_to_name || "", dt(r.assigned_at), (r.lead_stage || "").replace(/_/g, " "),
        (r.latest_call_disposition || "").replace(/_/g, " "), dt(r.latest_call_at), r.latest_call_response || "",
      ]);
      const body = maskMatrix(header, rawBody, realRole === "super_admin");
      const csv = [header, ...body].map((cols) => cols.map(cell).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportList.name.replace(/[^\w -]+/g, "_")} - calling report.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "CSV export failed", description: e?.message, variant: "destructive" });
    } finally {
      setReportExporting(false);
    }
  };

  // Bucket a report row for the outcome chips. A lead that was never called (no
  // call since assignment) gets its own "not_called" segment instead of hiding
  // under "unrecorded" — the latter means called but no outcome logged.
  const reportBucket = (r: LeadListAssignmentReportRow) =>
    !r.latest_call_at ? "not_called" : (r.latest_call_disposition || "unrecorded");

  // How many leads the chosen buckets cover, and how many of those would be
  // dropped at the attempt cap. Server-computed, so it holds for lists of any size.
  const followupSelected = useMemo(() => {
    if (!followupCounts) return 0;
    return followupBuckets.reduce((sum, b) => sum + (followupCounts[b as keyof FollowupCounts] as number ?? 0), 0);
  }, [followupCounts, followupBuckets]);

  const openFollowup = async (list: LeadList) => {
    setFollowupList(list);
    // Default to all three "never actually reached" buckets — that is the whole
    // point of a rollover.
    setFollowupBuckets(FOLLOWUP_BUCKETS.map((b) => b.value));
    setFollowupDueDate("");
    setFollowupIdentifier("");
    setFollowupArchiveSource(true);
    setFollowupCounts(null);
    setFollowupOpen(true);
    const { data } = await supabase.rpc("call_list_followup_counts" as any, { _list_id: list.id });
    setFollowupCounts((data as FollowupCounts) || null);
  };

  const toggleFollowupBucket = (b: string) =>
    setFollowupBuckets((cur) => cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]);

  // One RPC does the whole rollover in a single transaction: pick the leads,
  // split at the attempt cap, spawn the next list keeping each lead with the same
  // counsellor, park + cool the exhausted ones, archive the source. Selection is
  // server-side precisely because the old client version derived its ids from a
  // 500-row report page and silently dropped everyone past it.
  const createFollowupList = async () => {
    if (!followupList || followupBuckets.length === 0) return;
    setFollowupCreating(true);
    try {
      const { data, error } = await supabase.rpc("build_followup_list" as any, {
        _source_list_id: followupList.id,
        _buckets: followupBuckets,
        _due_date: followupDueDate || null,
        _list_name: followupIdentifier.trim() || null,
        _archive_source: followupArchiveSource,
      });
      if (error) throw error;
      const r = (data || {}) as {
        carried?: number; exhausted?: number; cooled?: number; list_name?: string; message?: string;
      };
      if (!r.carried && !r.exhausted) {
        toast({ title: "Nothing to roll forward", description: r.message || "No leads matched those buckets." });
      } else {
        const bits = [`${r.carried ?? 0} carried forward`];
        if (r.exhausted) bits.push(`${r.exhausted} exhausted at the ${followupCounts?.max_attempts ?? 4}-attempt cap`);
        if (r.cooled) bits.push(`${r.cooled} marked cold`);
        toast({ title: r.list_name ? `Created “${r.list_name}”` : "Rolled forward", description: bits.join(" · ") });
      }
      setFollowupOpen(false);
      if (reportOpen) setReportOpen(false);
      await fetchLists();
    } catch (e: any) {
      toast({ title: "Could not roll the list forward", description: e?.message, variant: "destructive" });
    } finally {
      setFollowupCreating(false);
    }
  };

  const setListArchived = async (list: LeadList, archived: boolean) => {
    setArchivingId(list.id);
    const { error } = await supabase.rpc("set_lead_list_archived" as any, {
      _list_id: list.id, _archived: archived,
    });
    setArchivingId(null);
    if (error) {
      toast({ title: archived ? "Could not archive" : "Could not restore", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: archived ? "List archived" : "List restored",
      description: archived
        ? `“${list.name}” is off the dialer. Its members and call history are kept.`
        : `“${list.name}” is active again.`,
    });
    await fetchLists();
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

    if (!waTemplateQuality.allowBulk) {
      toast({
        title: "Template blocked for bulk",
        description: waTemplateQuality.detail,
        variant: "destructive",
      });
      setWaSending(false);
      return;
    }

    // Fetch members + lead phone/stage so we can materialize recipients with
    // the same shape whatsapp-campaign-send expects. DNC is always hard-excluded.
    // Paginated (a raw select is capped at PostgREST's 1000 rows) and polymorphic
    // — a marketing list is mostly marketing_contacts, not leads.
    let members: any[];
    try {
      members = await fetchListMembers(
        supabase as any,
        waList.id,
        "lead_id, contact_id, leads(id, phone, stage, shared_with_nimt), marketing_contacts(id, phone, opted_out, promoted_lead_id)",
      );
    } catch (memErr) {
      const message = memErr instanceof Error ? memErr.message : String(memErr);
      toast({ title: "Could not load list members", description: message, variant: "destructive" });
      setWaSending(false);
      return;
    }

    const rawLeads = members
      .map((m: any) => campaignMemberToLead(m, "whatsapp"))
      .filter((l: any) => l && l.id);

    const quietDays = waQuietDaysEnabled ? Math.max(0, Number(waQuietDays) || DEFAULT_QUIET_DAYS) : 0;
    let lastMarketingAtByLeadId = new Map<string, string>();
    if (quietDays > 0 && rawLeads.length > 0) {
      lastMarketingAtByLeadId = await fetchLastWhatsAppMarketingAtByLeadIds(
        supabase as any,
        rawLeads.map((l: any) => l.id),
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
      toast({
        title: "No reachable leads",
        description: eligibility.preview || "All members were excluded (DNC, cold, recent contact, or missing phone).",
        variant: "destructive",
      });
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

    let pacePlan;
    try {
      const dailyCap = Number(waDailyCap);
      pacePlan = buildCampaignPacePlan({
        recipientCount: valid.length,
        sendMode: waSendMode,
        dailyUniqueCap: waSendMode === "paced" ? dailyCap : null,
        startAt: schedule.nextAttemptAt,
      });
    } catch (error: any) {
      toast({ title: "Invalid pacing", description: error?.message, variant: "destructive" });
      setWaSending(false);
      return;
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
        send_mode: pacePlan.sendMode,
        daily_unique_cap: pacePlan.dailyUniqueCap,
        paced_wave_count: pacePlan.waveCount,
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      toast({ title: "Could not create campaign", description: campErr?.message, variant: "destructive" });
      setWaSending(false);
      return;
    }

    const campaignId = (campaign as any).id;
    const rows = valid.map((l: any, index: number) => ({
      campaign_id: campaignId,
      // Exactly one target — whatsapp_campaign_recipients_one_target enforces it.
      lead_id: l.isContact ? null : l.id,
      contact_id: l.isContact ? l.id : null,
      phone: l.phone,
      eligible_at: pacePlan.eligibleAtByIndex[index] || schedule.nextAttemptAt,
    }));

    // Chunked insert to stay under PostgREST's request size cap. A swallowed
    // error here leaves the campaign claiming total_recipients with no rows to
    // send, so surface it instead of only logging.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("whatsapp_campaign_recipients" as any).insert(chunk);
      if (error) {
        console.error("Recipient insert failed:", error);
        toast({
          title: "Campaign only partially queued",
          description: `${i} of ${rows.length} recipients were added before this failed: ${error.message}`,
          variant: "destructive",
        });
        setWaSending(false);
        return;
      }
    }

    setWaSending(false);
    setWaOpen(false);
    const pacedNote = pacePlan.sendMode === "paced"
      ? ` Paced: ${pacePlan.waveCount} wave(s), max ${pacePlan.dailyUniqueCap}/day.`
      : "";
    const skipNote = eligibility.counts.total > valid.length
      ? ` Excluded ${eligibility.counts.total - valid.length} (DNC ${eligibility.counts.dnc}, cold ${eligibility.counts.cold}, recent ${eligibility.counts.recentContact}, no phone ${eligibility.counts.noContact}).`
      : "";
    toast({
      title: schedule.scheduled
        ? "WhatsApp campaign scheduled"
        : pacePlan.sendMode === "paced"
          ? "WhatsApp campaign paced"
          : "WhatsApp campaign queued",
      description: (schedule.scheduled
        ? `${valid.length} recipients scheduled for ${new Date(schedule.nextAttemptAt).toLocaleString()}.`
        : `${valid.length} recipients queued. You can close this screen; progress is tracked in Marketing.`) + pacedNote + skipNote,
    });
    // Kick dispatcher only if first wave is due now
    if (new Date(schedule.nextAttemptAt).getTime() <= Date.now() + 2000) {
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

    // Paginated + polymorphic, same as the WhatsApp path above.
    let members: any[];
    try {
      members = await fetchListMembers(
        supabase as any,
        emailList.id,
        "lead_id, contact_id, leads(id, email, stage, shared_with_nimt), marketing_contacts(id, email, opted_out, promoted_lead_id)",
      );
    } catch (memErr) {
      const message = memErr instanceof Error ? memErr.message : String(memErr);
      toast({ title: "Could not load list members", description: message, variant: "destructive" });
      setEmailSending(false);
      return;
    }

    const valid = members
      .map((m: any) => campaignMemberToLead(m, "email"))
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
      // Exactly one target — email_campaign_recipients_one_target enforces it.
      lead_id: l.isContact ? null : l.id,
      contact_id: l.isContact ? l.id : null,
      to_email: l.email,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("email_campaign_recipients" as any).insert(chunk);
      if (error) {
        console.error("Email recipient insert failed:", error);
        toast({
          title: "Campaign only partially queued",
          description: `${i} of ${rows.length} recipients were added before this failed: ${error.message}`,
          variant: "destructive",
        });
        setEmailSending(false);
        return;
      }
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
          <OrbLoader state="searching" />
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
        <div className="rounded-xl border border-border overflow-x-auto">
          <div className="flex flex-col gap-2 border-b border-border bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Lists</p>
              <p className="text-xs text-muted-foreground">Use Marketing Hub to initiate campaigns; use this page to maintain and assign lists.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or tag (e.g. Gurgaon)…"
                className="rounded-md border border-input bg-background px-2 py-1 text-xs w-56"
              />
              <div className="inline-flex rounded-lg border border-border p-0.5">
                {([
                  ["all", "All"],
                  ["calling", "Calling"],
                  ["mine", "My lists"],
                  ["archived", "Archived"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setListFilter(key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      listFilter === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {counsellorOptions.length > 0 && (
                <select
                  value={counsellorFilter}
                  onChange={(e) => setCounsellorFilter(e.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                >
                  <option value="">All counsellors</option>
                  {counsellorOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                <option value="created">Sort: Created</option>
                <option value="due">Sort: Due date</option>
                <option value="assigned">Sort: Date assigned</option>
                <option value="members">Sort: Members</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Members</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Due</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayLists.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No lists match this filter.
                  </td>
                </tr>
              )}
              {displayLists.map(({ list, ov }) => {
                const badge = SOURCE_BADGE[list.source];
                const dueDate = ov?.due_date ?? list.due_date ?? null;
                const overdue = ov?.overdue ?? false;
                return (
                  <tr key={list.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openPreview(list)}
                        className="text-left font-medium text-foreground hover:text-primary"
                      >
                        {list.name}
                      </button>
                      {/* Static vs dynamic at a glance — a dynamic list keeps
                          absorbing new matches, so the distinction changes what
                          the assigner can expect from it. */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium align-middle ${
                              list.list_type === "dynamic"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}>
                              {list.list_type === "dynamic"
                                ? <><RefreshCw className="h-2.5 w-2.5" />Dynamic</>
                                : <><Lock className="h-2.5 w-2.5" />Static</>}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {list.list_type === "dynamic" ? (
                              <>
                                <p className="font-medium">Auto-updating list</p>
                                <p className="text-xs">{describeFilterDefinition(list.filter_definition)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  New matching leads are added every 15 min
                                  {list.last_refreshed_at && ` · last refreshed ${new Date(list.last_refreshed_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs">Fixed set of leads — membership never changes on its own.</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {/* Where this list sits in a follow-up chain. Only meaningful
                          once it has been rolled forward at least once. */}
                      {(list.generation ?? 1) > 1 && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium align-middle text-warning-foreground"
                          title={`Attempt ${list.generation} of ${list.max_attempts ?? 4} in this follow-up chain`}
                        >
                          <PhoneForwarded className="h-2.5 w-2.5" />
                          Attempt {list.generation}/{list.max_attempts ?? 4}
                        </span>
                      )}
                      {list.archived_at && (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium align-middle text-muted-foreground">
                          <Archive className="h-2.5 w-2.5" />Archived
                        </span>
                      )}
                      {list.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-md">{list.description}</p>
                      )}
                      {(list.tags ?? []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(list.tags ?? []).map((t) => (
                            <button
                              key={t}
                              onClick={() => setSearch(t)}
                              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border-0 ${badge.cls}`}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground font-semibold">
                      {list.member_count}
                      {/* Calling progress inline, so an assigner sees which lists
                          are moving without opening each Calling Report. */}
                      {callProgressByList[list.id] && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-primary" style={{
                              width: `${callProgressByList[list.id].total
                                ? Math.round((callProgressByList[list.id].worked / callProgressByList[list.id].total) * 100)
                                : 0}%`,
                            }} />
                          </div>
                          <span className="text-[10px] font-normal tabular-nums text-muted-foreground">
                            {callProgressByList[list.id].worked}/{callProgressByList[list.id].total} called
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {dueDate ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                          overdue ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                        }`}>
                          {new Date(dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          {overdue && " · overdue"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(list.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openPreview(list)}>
                          <Users className="h-3.5 w-3.5" /> Members
                        </Button>
                        {canSelfAssign && (
                          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openAssign(list)} disabled={list.member_count === 0}>
                            <Users className="h-3.5 w-3.5" /> {canAssignLists ? "Assign" : "Call this"}
                          </Button>
                        )}
                        {/* ponytail: all secondary actions in overflow — keeps row from clipping */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openAssignmentReport(list)}>
                              <Phone className="mr-2 h-4 w-4" /> Calling Report
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to={`/marketing?listId=${list.id}`}>
                                <Megaphone className="mr-2 h-4 w-4" /> New Campaign
                              </Link>
                            </DropdownMenuItem>
                            {list.list_type === "dynamic" && canAssignLists && (
                              <DropdownMenuItem
                                onSelect={(e) => { e.preventDefault(); refreshDynamicList(list); }}
                                disabled={refreshingListId === list.id}
                              >
                                {refreshingListId === list.id
                                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  : <RefreshCw className="mr-2 h-4 w-4" />} Refresh members
                              </DropdownMenuItem>
                            )}
                            {canAssignLists && list.purpose === "calling" && !list.archived_at && (
                              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openFollowup(list); }}>
                                <PhoneForwarded className="mr-2 h-4 w-4" /> Roll forward…
                              </DropdownMenuItem>
                            )}
                            {canAssignLists && (
                              <DropdownMenuItem
                                onSelect={(e) => { e.preventDefault(); setListArchived(list, !list.archived_at); }}
                                disabled={archivingId === list.id}
                              >
                                {archivingId === list.id
                                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  : <Archive className="mr-2 h-4 w-4" />}
                                {list.archived_at ? "Restore list" : "Archive list"}
                              </DropdownMenuItem>
                            )}
                            {canDeleteLists && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={(e) => { e.preventDefault(); setDeleteList(list); }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete list
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={waQuietDays}
                    onChange={(e) => setWaQuietDays(e.target.value)}
                    className="h-9 w-20 rounded-lg border border-input bg-card px-3 text-sm"
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
                    Split this list into waves ~24h apart so you stay under Meta&apos;s rolling 24h unique-user tier.
                    Does not fix quality or template blocks.
                  </span>
                </span>
              </label>
              {waSendMode === "paced" && (
                <div className="pl-6 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Max recipients per day</label>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={waDailyCap}
                    onChange={(e) => setWaDailyCap(e.target.value)}
                    className="h-9 w-40 rounded-lg border border-input bg-card px-3 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {(() => {
                      try {
                        const start = waScheduleMode === "scheduled" && waScheduledAt
                          ? new Date(waScheduledAt)
                          : new Date();
                        return buildCampaignPacePlan({
                          recipientCount: waList?.member_count || 0,
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
                  {waSenderLoading ? <ButtonOrb state="working" /> : <RefreshCw className="h-3 w-3" />}
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
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${waTemplateQuality.badgeClass}`}>
                  Meta: {waTemplateQuality.label}
                </span>
                {!waTemplateQuality.allowBulk && (
                  <span className="text-[11px] text-destructive font-medium">Bulk send blocked</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {waTemplateQuality.detail}
              </p>
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
            <Button onClick={handleSendWhatsApp} disabled={waSending || waMissingStatic || !waTemplateQuality.allowBulk} className="gap-2">
              {waSending ? <ButtonOrb state="working" onFilled /> : <Send className="h-4 w-4" />}
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
              {emailSending ? <ButtonOrb state="working" onFilled /> : <Send className="h-4 w-4" />}
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
              <OrbLoader state="searching" />
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
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {previewMembers.map((m) => (
                    <tr key={m.member_id} className="border-b border-border/50">
                      <td className="px-3 py-2 text-foreground">{m.name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{m.phone || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{m.email || "—"}</td>
                      <td className="px-3 py-2">
                        {m.kind === "lead" ? (
                          <Badge variant={m.stage === "dnc" ? "destructive" : "outline"} className="text-[10px]">
                            {m.stage}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Marketing contact</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {m.kind === "contact" && !m.promoted && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={promotingId === m.target_id}
                            onClick={() => promoteContact(m.target_id)}
                          >
                            {promotingId === m.target_id ? "Promoting…" : "Promote to lead"}
                          </Button>
                        )}
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
              Members are split round-robin across the selected counsellors and appear in their
              Cloud Dialer under <span className="font-medium text-foreground">My Call Lists</span> —
              they can work the list start to finish without searching or filtering.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Priority note (optional)</label>
                <input
                  type="text"
                  value={assignNote}
                  onChange={(e) => setAssignNote(e.target.value)}
                  placeholder="e.g. Call before the counselling deadline"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Due date (optional)</label>
                <input
                  type="date"
                  value={assignDueDate}
                  onChange={(e) => setAssignDueDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={assignOnlyUnassigned}
                onChange={(e) => setAssignOnlyUnassigned(e.target.checked)}
                className="h-4 w-4"
              />
              Only assign leads that currently have no counsellor
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={assignIncludeTerminal}
                onChange={(e) => setAssignIncludeTerminal(e.target.checked)}
                className="h-4 w-4"
              />
              Include cold / not-interested leads
              <span className="text-xs text-muted-foreground/70">(for win-back pushes)</span>
            </label>

            {/* Effective length: what the counsellor will actually be able to dial. */}
            {assignPreview && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{assignPreview.total} in list → </span>
                <span className="font-semibold text-foreground">{assignPreview.dialable} will be dialable</span>
                {assignPreview.dialable !== assignPreview.total && (
                  <span className="text-muted-foreground">
                    {" "}({assignPreview.total - assignPreview.dialable} excluded
                    {assignPreview.terminal > 0 && !assignIncludeTerminal && `: ${assignPreview.terminal} cold/closed`}
                    {assignPreview.no_phone > 0 && `${assignPreview.terminal > 0 && !assignIncludeTerminal ? ", " : ": "}${assignPreview.no_phone} without phone`})
                  </span>
                )}
                {assignPreview.dialable === 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Nothing dialable — tick “Include cold / not-interested” or pick a different list.
                  </p>
                )}
              </div>
            )}
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {counsellors.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No counsellors available.</div>
              ) : (
                counsellors.map((counsellor) => {
                  const alreadyAssigned = alreadyAssignedIds.includes(counsellor.id);
                  const checked = alreadyAssigned || selectedCounsellorIds.includes(counsellor.id);
                  const days = daysSince(counsellor.last_call_at);
                  const dormant = days === null || days >= DORMANT_DAYS;
                  return (
                    <label key={counsellor.id} className={`flex items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 ${alreadyAssigned ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/30"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => !alreadyAssigned && toggleCounsellor(counsellor.id)}
                        disabled={alreadyAssigned}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium text-foreground">{counsellor.name}</span>
                      {alreadyAssigned && (
                        <Badge variant="secondary" className="text-[10px] font-normal">Already assigned</Badge>
                      )}
                      <span className={`ml-auto flex items-center gap-2 text-[11px] ${dormant ? "text-destructive" : "text-muted-foreground"}`}>
                        {dormant && <AlertTriangle className="h-3 w-3" />}
                        {lastCallLabel(counsellor.last_call_at)}
                        {!!counsellor.pending_call_list && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {counsellor.pending_call_list} on other lists
                          </Badge>
                        )}
                      </span>
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
              {assigning ? <ButtonOrb state="working" onFilled /> : <Check className="h-4 w-4" />}
              Assign Round Robin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle>{reportList?.name} — Calling Report</DialogTitle>
              <div className="flex items-center gap-2">
                {canAssignLists && reportList && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => openFollowup(reportList)}>
                    <PhoneForwarded className="h-3.5 w-3.5" /> Roll forward
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5 h-8"
                  onClick={downloadCallingReportCsv} disabled={reportExporting || assignmentReport.length === 0}>
                  {reportExporting ? <ButtonOrb state="working" /> : <Download className="h-3.5 w-3.5" />}
                  Download CSV
                </Button>
              </div>
            </div>
          </DialogHeader>
          {reportProgress && reportProgress.total > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((reportProgress.worked / Math.max(reportProgress.dialable || reportProgress.total, 1)) * 100)}%` }} />
                </div>
                <span className="text-sm tabular-nums text-foreground">
                  {reportProgress.worked}/{reportProgress.dialable ?? reportProgress.total} called
                </span>
                <span className="text-xs text-muted-foreground">
                  {reportProgress.pending} pending
                  {reportProgress.skipped > 0 && ` · ${reportProgress.skipped} skipped`}
                  {reportProgress.not_dialable > 0 && ` · ${reportProgress.not_dialable} not dialable (no phone or closed)`}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {reportProgress.last_call_at
                    ? `last call ${new Date(reportProgress.last_call_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "no calls yet"}
                </span>
              </div>
              {/* Throughput: of the calls actually placed, how many reached someone.
                  "Called" above counts attempts; this counts outcomes. */}
              {followupCounts && followupCounts.attempted > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{followupCounts.connected}</span> connected</span>
                  <span><span className="font-semibold text-foreground">{followupCounts.no_answer}</span> no answer</span>
                  <span><span className="font-semibold text-foreground">{followupCounts.unrecorded}</span> no disposition</span>
                  {followupCounts.contact_rate !== null && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                      {followupCounts.contact_rate}% contact rate
                    </span>
                  )}
                  <span className="ml-auto">
                    {followupCounts.pending + followupCounts.no_answer + followupCounts.unrecorded} can be rolled forward
                  </span>
                </div>
              )}
              {/* What actually came back on the calls — the number the assigner
                  is looking for, not just how many were dialled. */}
              {Object.keys(reportProgress.dispositions || {}).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(reportProgress.dispositions)
                    .sort((a, b) => b[1] - a[1])
                    .map(([disposition, n]) => (
                      <button
                        key={disposition}
                        onClick={() => setReportDispositionFilter((cur) => cur === disposition ? null : disposition)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                          reportDispositionFilter === disposition
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {disposition.replace(/_/g, " ")} {n}
                      </button>
                    ))}
                  {reportDispositionFilter && (
                    <button
                      onClick={() => setReportDispositionFilter(null)}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {reportProgress.by_counsellor.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reportProgress.by_counsellor.map((c) => (
                    <Badge key={c.counsellor_id} variant="outline" className="text-[11px] font-normal">
                      {c.counsellor_name}: {c.worked}/{c.total}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
          {reportLoading ? (
            <div className="flex h-40 items-center justify-center">
              <OrbLoader state="searching" />
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
                  {visibleAssignmentReport.map((row) => (
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

      {/* Create follow-up list from selected dispositions */}
      <Dialog open={followupOpen} onOpenChange={setFollowupOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Roll forward — {followupList?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Creates the next calling attempt from the leads that were never actually
              reached. Each lead stays with the counsellor who already tried them.
            </p>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carry forward</p>
              {followupCounts === null ? (
                <div className="rounded-md border border-border p-3 text-center text-xs text-muted-foreground">
                  Counting leads…
                </div>
              ) : (
                <div className="rounded-md border border-border">
                  {FOLLOWUP_BUCKETS.map((b) => (
                    <button
                      key={b.value}
                      onClick={() => toggleFollowupBucket(b.value)}
                      className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        followupBuckets.includes(b.value) ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      }`}>
                        {followupBuckets.includes(b.value) && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">{b.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{b.hint}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-foreground">
                        {followupCounts[b.value as keyof FollowupCounts] as number}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {followupCounts && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {followupSelected} lead{followupSelected === 1 ? "" : "s"} selected.
                  {" "}Leads with a real outcome (interested, not interested, …) are never carried forward.
                </p>
              )}
              {!!followupCounts?.at_cap && (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {followupCounts.at_cap} lead{followupCounts.at_cap === 1 ? " has" : "s have"} reached the
                    {" "}{followupCounts.max_attempts}-attempt cap. They will be parked in an
                    “exhausted” list and marked cold instead of being called again.
                  </span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Due date</label>
                <input
                  type="date"
                  value={followupDueDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFollowupDueDate(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">List name (optional)</label>
                <input
                  type="text"
                  value={followupIdentifier}
                  placeholder="Auto-named if blank"
                  onChange={(e) => setFollowupIdentifier(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={followupArchiveSource}
                onChange={(e) => setFollowupArchiveSource(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Archive “{followupList?.name}” afterwards
                <span className="block text-[11px] text-muted-foreground">
                  Takes it off the dialer and off this page. Members and call history are kept.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowupOpen(false)}>Cancel</Button>
            <Button
              onClick={createFollowupList}
              disabled={followupCreating || !followupCounts || followupSelected === 0}
            >
              {followupCreating && <ButtonOrb state="working" onFilled />}
              Roll forward
            </Button>
          </DialogFooter>
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
              {deleting ? <ButtonOrb state="working" onFilled /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
