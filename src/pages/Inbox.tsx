import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Tag, FileText, AlertTriangle, MessageSquare, CheckCircle, XCircle, ExternalLink, ChevronRight, Clock, User, RefreshCw, Inbox as InboxIcon, Video, Mic, Play, Pause, CheckCheck, FilePen, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIDEO_BRAND_LABEL, type VideoBrand } from "@/lib/videoBrands";
import { feeTermLabel } from "@/lib/feeTermLabels";
import { exportRowsCsv } from "@/lib/xlsxExport";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboxCategory {
  id: CategoryId;
  label: string;
  icon: React.ElementType;
  count: number;
  roles: string[]; // roles that can see this category
  color: string;
}

type CategoryId = "offer_waivers" | "fee_concessions" | "abvmu_deposits" | "offer_approvals" | "offer_edits" | "certificate_approvals" | "hr_document_approvals" | "pending_an_generation" | "contact_changes" | "applications" | "followups" | "whatsapp" | "video_approvals" | "voice_messages";

// Manual fee concessions raised at the cashier desk. Approving one runs
// sync_fee_ledger_concessions server-side, so an offer waiver already mapped
// onto the same ledger row survives.
interface FeeConcessionItem {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string | null;
  fee_code: string | null;
  term: string | null;
  fee_total: number | null;
  type: string;
  value: number;
  reason: string | null;
  requested_by_name: string | null;
  created_at: string | null;
}

interface CertificateApprovalItem {
  id: string;
  request_number: string;
  alumni_name: string;
  campus: string | null;
  course: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  pdf_path: string | null;
}

interface HrDocumentApprovalItem {
  id: string;
  letter_name: string;
  letter_code: string | null;
  target_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  status: string;
  subject: string | null;
  body: string | null;
}

// Paid students whose admission number is held by the mandatory-document gate.
type PendingAnDocState = "verified" | "rejected" | "pending" | "missing";
interface PendingAnDocStatus {
  complete?: boolean;
  required_total?: number;
  verified?: number;
  rejected?: number;
  pending?: number;
  missing?: number;
  docs?: { key: string; label: string; state: PendingAnDocState }[];
}
interface PendingAnItem {
  id: string; // lead_id (row key)
  lead_id: string;
  student_id: string;
  name: string;
  course: string | null;
  pre_admission_no: string | null;
  application_id: string | null;
  doc_status: PendingAnDocStatus | null;
}

interface AbvmuDepositItem {
  id: string;
  lead_id: string;
  lead_name: string;
  amount: number;
  status: string;
  challan_number: string | null;
  challan_date: string | null;
  proof_path: string;
  proof_file_name: string | null;
  notes: string | null;
  submitted_at: string;
}

interface WaiverItem {
  id: string;
  offer_letter_id: string;
  term: string;
  term_label: string;
  amount: number;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  created_at: string;
  lead_name: string;
  lead_id: string;
  course_name: string | null;
  // Gross fee for this waiver's term, summed from the active fee structure on
  // the offer's (course, session). Null when the structure can't be resolved.
  year_amount: number | null;
}

interface WaiverGroup {
  id: string; // lead_id::offer_letter_id — synthetic key for list identity
  lead_id: string;
  lead_name: string;
  course_name: string | null;
  offer_letter_id: string;
  waivers: WaiverItem[];
  total_waiver: number;
  created_at: string;
}

interface OfferApprovalItem {
  id: string;
  lead_id: string;
  lead_name: string;
  course_name: string | null;
  approval_status: string;
  created_at: string;
  requested_by_name: string | null;
  application_id: string | null;
}

interface OfferEditItem {
  id: string;
  offer_letter_id: string;
  lead_id: string;
  lead_name: string;
  course_name: string | null;
  created_at: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  reason: string | null;
  proposed_changes: { acceptance_deadline?: string; token_fee_amount?: number; course_id?: string };
  current_deadline: string | null;
  current_token_fee: number | null;
}

interface ContactChangeItem {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string;
  reason: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  created_at: string;
}

interface ApplicationItem {
  id: string;
  application_id: string;
  lead_name: string;
  course_name: string | null;
  created_at: string;
  stage: string;
  phone: string | null;
  app_status: string | null;
}

interface FollowupItem {
  id: string;
  lead_id: string;
  lead_name: string;
  phone: string | null;
  scheduled_at: string;
  notes: string | null;
  counsellor_name: string | null;
}

interface WhatsAppItem {
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
}

interface VideoApprovalInboxItem {
  id: string;
  title: string;
  drive_url: string;
  brand: string;
  content_type: string;
  editor_name: string;
  created_at: string;
}

interface VoiceMessageItem {
  id: string;
  consultant_id: string | null;
  sender_user_id: string | null;
  audio_url: string;
  duration_seconds: number | null;
  subject: string | null;
  status: string;
  created_at: string;
  sender_name: string;
}

type InboxItem = WaiverItem | FeeConcessionItem | AbvmuDepositItem | OfferApprovalItem | OfferEditItem | CertificateApprovalItem | HrDocumentApprovalItem | PendingAnItem | ContactChangeItem | ApplicationItem | FollowupItem | WhatsAppItem | VideoApprovalInboxItem | VoiceMessageItem;

// Label a source link by host so the inbox doesn't say "Drive" for a YouTube URL.
const videoSourceLabel = (url: string) => /youtube\.com|youtu\.be/i.test(url) ? "YouTube" : "Drive";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtINR = (n: number | null | undefined) =>
  n != null && !isNaN(n) ? "₹" + n.toLocaleString("en-IN") : "—";

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

const fmtTime = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return fmtDate(s);
};

const formatBadgeCount = (n: number) => n > 99 ? "99+" : String(n);

const ADMISSIONS_ROLES = [
  "super_admin", "campus_admin", "principal", "admission_head", "counsellor", "data_entry",
];

const APPROVER_ROLES = ["super_admin", "principal", "campus_admin", "admission_head"];

// ── Main Component ────────────────────────────────────────────────────────────

export default function Inbox() {
  const { role, profile, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<CategoryId, number>>({
    offer_waivers: 0,
    fee_concessions: 0,
    abvmu_deposits: 0,
    offer_approvals: 0,
    offer_edits: 0,
    certificate_approvals: 0,
    hr_document_approvals: 0,
    pending_an_generation: 0,
    contact_changes: 0,
    applications: 0,
    followups: 0,
    whatsapp: 0,
    video_approvals: 0,
    voice_messages: 0,
  });

  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isSuperAdmin = role === "super_admin";
  const isPrincipal = role === "principal";
  const isAdmissions = ADMISSIONS_ROLES.includes(role || "");
  const isApprover = APPROVER_ROLES.includes(role || "");

  // ── Category definitions ──────────────────────────────────────────────────

  const allCategories: InboxCategory[] = [
    {
      id: "offer_waivers",
      label: "Offer Waivers",
      icon: Tag,
      count: counts.offer_waivers,
      roles: ["super_admin"],
      color: "text-warning-foreground",
    },
    {
      id: "fee_concessions",
      label: "Fee Concessions",
      icon: Tag,
      count: counts.fee_concessions,
      roles: ["super_admin"],
      color: "text-warning-foreground",
    },
    {
      id: "abvmu_deposits",
      label: "ABVMU Deposits",
      icon: FileText,
      count: counts.abvmu_deposits,
      roles: ["super_admin"],
      color: "text-info-foreground",
    },
    {
      id: "offer_approvals",
      label: "Offer Approvals",
      icon: FileText,
      count: counts.offer_approvals,
      roles: APPROVER_ROLES,
      color: "text-info-foreground",
    },
    {
      id: "offer_edits",
      label: "Offer Letter Edits",
      icon: FilePen,
      count: counts.offer_edits,
      roles: ["super_admin"],
      color: "text-info-foreground",
    },
    {
      id: "certificate_approvals",
      label: "Certificate Approvals",
      icon: FileText,
      count: counts.certificate_approvals,
      roles: ["super_admin"],
      color: "text-emerald-600",
    },
    {
      id: "hr_document_approvals",
      label: "HR Document Approvals",
      icon: FilePen,
      count: counts.hr_document_approvals,
      roles: ["super_admin"],
      color: "text-emerald-600",
    },
    {
      id: "pending_an_generation",
      label: "Pending AN Generation",
      icon: AlertTriangle,
      count: counts.pending_an_generation,
      roles: ["super_admin", "principal"],
      color: "text-amber-600",
    },
    {
      id: "contact_changes",
      label: "Contact Changes",
      icon: User,
      count: counts.contact_changes,
      roles: ["super_admin", "principal"],
      color: "text-cyan-600",
    },
    {
      id: "applications",
      label: "New Applications",
      icon: FileText,
      count: counts.applications,
      roles: ADMISSIONS_ROLES,
      color: "text-primary",
    },
    {
      id: "followups",
      label: "Pending Follow-ups",
      icon: AlertTriangle,
      count: counts.followups,
      roles: ADMISSIONS_ROLES,
      color: "text-warning-foreground",
    },
    {
      id: "whatsapp",
      label: "WhatsApp Unreplied",
      icon: MessageSquare,
      count: counts.whatsapp,
      roles: ADMISSIONS_ROLES,
      color: "text-success",
    },
    {
      id: "video_approvals",
      label: "Video Approvals",
      icon: Video,
      count: counts.video_approvals,
      roles: ["super_admin"],
      color: "text-destructive",
    },
    {
      id: "voice_messages",
      label: "Voice Messages",
      icon: Mic,
      count: counts.voice_messages,
      roles: APPROVER_ROLES,
      color: "text-primary",
    },
  ];

  const visibleCategories = allCategories.filter((c) =>
    c.roles.includes(role || "")
  );
  const selectedCategory = visibleCategories.find((c) => c.id === selected);
  const categoryDisplayCount = (cat: InboxCategory) =>
    cat.id === selected && !loading ? items.length : cat.count;
  const selectedDisplayCount = selectedCategory ? categoryDisplayCount(selectedCategory) : 0;
  const totalVisibleCount = visibleCategories.reduce((sum, c) => sum + categoryDisplayCount(c), 0);

  const commitItems = useCallback((cat: CategoryId, nextItems: InboxItem[]) => {
    setItems(nextItems);
    setCounts((prev) => prev[cat] === nextItems.length ? prev : { ...prev, [cat]: nextItems.length });
  }, []);

  // ── Counts ────────────────────────────────────────────────────────────────

  const fetchCounts = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.allSettled([
      // offer_waivers — super_admin only
      isSuperAdmin
        ? supabase
            .from("offer_waivers")
            .select("id")
            .eq("status", "pending")
        : Promise.resolve({ count: 0 }),

      // abvmu deposit claims — super_admin only
      isSuperAdmin
        ? supabase
            .from("abvmu_deposit_claims" as any)
            .select("id")
            .eq("status", "pending")
        : Promise.resolve({ count: 0 }),

      // offer_approvals — approvers
      isApprover
        ? supabase
            .from("offer_letters")
            .select("id")
            .eq("approval_status", "pending_principal")
        : Promise.resolve({ count: 0 }),

      // contact changes — principal/super_admin
      (isSuperAdmin || isPrincipal)
        ? supabase
            .from("student_contact_change_requests" as any)
            .select("id")
            .eq("status", "pending")
        : Promise.resolve({ count: 0 }),

      // applications — admissions (submitted apps awaiting review)
      isAdmissions
        ? supabase
            .from("applications" as any)
            .select("id")
            .eq("status", "submitted")
        : Promise.resolve({ count: 0 }),

      // followups — admissions
      isAdmissions
        ? (() => {
            const q = supabase
              .from("lead_followups")
              .select("id")
              .eq("status", "pending")
              .lte("scheduled_at", `${today}T23:59:59`);
            return q;
          })()
        : Promise.resolve({ count: 0 }),

      // whatsapp unreplied
      isAdmissions
        ? supabase
            .from("whatsapp_conversations" as any)
            .select("phone")
            .gt("unread_count", 0)
        : Promise.resolve({ count: 0 }),

      // video approvals — super_admin only (videos awaiting approval)
      isSuperAdmin
        ? supabase
            .from("videos" as any)
            .select("id")
            .eq("status", "pending_approval")
        : Promise.resolve({ count: 0 }),

      // voice messages — approvers (unresolved messages from consultants)
      isApprover
        ? supabase
            .from("consultant_voice_messages" as any)
            .select("id")
            .neq("status", "resolved")
        : Promise.resolve({ count: 0 }),

      // PGDM certificate approvals — super_admin only
      isSuperAdmin
        ? supabase
            .from("alumni_verification_requests" as any)
            .select("id")
            .eq("pgdm_certificate_status", "pending_approval")
        : Promise.resolve({ count: 0 }),

      // Manual fee concessions awaiting a super_admin decision
      isSuperAdmin
        ? supabase
            .from("concessions")
            .select("id")
            .in("status", ["pending_principal", "pending_super_admin"])
        : Promise.resolve({ count: 0 }),

      // Pending AN generation — super_admin + principal
      (isSuperAdmin || isPrincipal)
        ? supabase.rpc("list_pending_an_generation")
        : Promise.resolve({ count: 0 }),

      // Offer letter edit requests — super_admin only (they alone can decide)
      isSuperAdmin
        ? supabase
            .from("offer_letter_edit_requests" as any)
            .select("id")
            .eq("status", "pending")
        : Promise.resolve({ count: 0 }),

      // HR document approvals — super_admin only
      isSuperAdmin
        ? supabase
            .from("hr_letters" as any)
            .select("id")
            .eq("status", "pending_approval")
        : Promise.resolve({ count: 0 }),
    ]);

    const get = (i: number) => {
      const r = results[i];
      if (r.status === "fulfilled") return (r.value as any).count ?? (r.value as any).data?.length ?? 0;
      return 0;
    };

    setCounts({
      offer_waivers: get(0),
      abvmu_deposits: get(1),
      offer_approvals: get(2),
      contact_changes: get(3),
      applications: get(4),
      followups: get(5),
      whatsapp: get(6),
      video_approvals: get(7),
      voice_messages: get(8),
      certificate_approvals: get(9),
      fee_concessions: get(10),
      pending_an_generation: get(11),
      offer_edits: get(12),
      hr_document_approvals: get(13),
    });
  }, [role, isSuperAdmin, isPrincipal, isApprover, isAdmissions, profile?.id]);

  useEffect(() => {
    fetchCounts();
    // auto-select first visible category
  }, [fetchCounts]);

  useEffect(() => {
    if (visibleCategories.length === 0 || selected) return;
    // Deep-link: /inbox?category=<id> (e.g. from a notification) wins over first-visible.
    const wanted = searchParams.get("category") as CategoryId | null;
    const target = wanted && visibleCategories.some((c) => c.id === wanted)
      ? wanted
      : visibleCategories[0].id;
    setSelected(target);
  }, [visibleCategories.length, searchParams]);

  // ── Item loading ──────────────────────────────────────────────────────────

  const loadItems = useCallback(async (cat: CategoryId, keepSelection?: boolean) => {
    setLoading(true);
    if (!keepSelection) {
      setSelectedItem(null);
      setItems([]);
    }

    try {
      if (cat === "abvmu_deposits") {
        const { data, error } = await supabase
          .from("abvmu_deposit_claims" as any)
          .select("id, lead_id, amount, status, challan_number, challan_date, proof_path, proof_file_name, notes, submitted_at")
          .eq("status", "pending")
          .order("submitted_at", { ascending: false });
        if (error) throw error;
        const rows = (data || []) as any[];
        const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean)));
        const leadsById = new Map<string, any>();
        if (leadIds.length) {
          const { data: leads } = await supabase.from("leads").select("id, name").in("id", leadIds);
          for (const l of (leads || []) as any[]) leadsById.set(l.id, l);
        }
        commitItems(
          cat,
          rows.map((r) => ({
            id: r.id,
            lead_id: r.lead_id,
            lead_name: leadsById.get(r.lead_id)?.name || "Candidate",
            amount: Number(r.amount),
            status: r.status,
            challan_number: r.challan_number,
            challan_date: r.challan_date,
            proof_path: r.proof_path,
            proof_file_name: r.proof_file_name,
            notes: r.notes,
            submitted_at: r.submitted_at,
          })) as AbvmuDepositItem[],
        );
      } else if (cat === "offer_waivers") {
        // Keep the pending waiver row as the source of truth for this inbox.
        // Related offer/lead/course data is resolved separately so a relationship
        // shape change cannot make the badge count include a row that the list
        // then fails to show.
        const { data, error } = await supabase
          .from("offer_waivers")
          .select(`
            id, offer_letter_id, term, amount, reason, status,
            requested_by_name, requested_by_role, created_at
          `)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        if (error) throw error;
        const waiverRows = (data || []) as any[];
        const offerIds = Array.from(new Set(waiverRows.map((w) => w.offer_letter_id).filter(Boolean)));
        const offersById = new Map<string, any>();
        const leadsById = new Map<string, any>();
        const coursesById = new Map<string, any>();

        if (offerIds.length > 0) {
          const { data: offerRows, error: offerError } = await (supabase as any)
            .from("offer_letters")
            .select("id, lead_id, course_id, session_id")
            .in("id", offerIds);
          if (offerError) throw offerError;

          for (const offer of (offerRows || []) as any[]) {
            offersById.set(offer.id, offer);
          }

          const leadIds = Array.from(new Set((offerRows || []).map((o: any) => o.lead_id).filter(Boolean)));
          const courseIdsFromOffers = Array.from(new Set((offerRows || []).map((o: any) => o.course_id).filter(Boolean)));

          const [leadRes, courseRes] = await Promise.all([
            leadIds.length > 0
              ? supabase.from("leads").select("id, name").in("id", leadIds)
              : Promise.resolve({ data: [], error: null }),
            courseIdsFromOffers.length > 0
              ? supabase.from("courses").select("id, name").in("id", courseIdsFromOffers)
              : Promise.resolve({ data: [], error: null }),
          ]);
          if (leadRes.error) throw leadRes.error;
          if (courseRes.error) throw courseRes.error;

          for (const lead of (leadRes.data || []) as any[]) leadsById.set(lead.id, lead);
          for (const course of (courseRes.data || []) as any[]) coursesById.set(course.id, course);
        }

        // Resolve gross year fee per (course, session, term) from active fee
        // structures so the detail card can show Amount + Applicable-after-waiver.
        const offerKeys = new Set<string>();
        for (const w of waiverRows) {
          const offer = offersById.get(w.offer_letter_id);
          const c = offer?.course_id;
          const s = offer?.session_id;
          if (c && s) offerKeys.add(`${c}::${s}`);
        }
        const yearAmountByKey = new Map<string, number>();
        const yearLabelByKey = new Map<string, string>();
        if (offerKeys.size > 0) {
          const pairs = Array.from(offerKeys).map(k => k.split("::"));
          const courseIds = Array.from(new Set(pairs.map(p => p[0])));
          const sessionIds = Array.from(new Set(pairs.map(p => p[1])));
          const { data: fsRows } = await supabase
            .from("fee_structures")
            .select("course_id, session_id, is_active, metadata, fee_structure_items ( term, amount )")
            .in("course_id", courseIds)
            .in("session_id", sessionIds)
            .eq("is_active", true);
          for (const fs of (fsRows || []) as any[]) {
            const key = `${fs.course_id}::${fs.session_id}`;
            if (!offerKeys.has(key)) continue;
            const metadata = fs.metadata as Record<string, unknown> | null;
            const byTerm = new Map<string, number>();
            for (const it of (fs.fee_structure_items || []) as any[]) {
              const t = String(it.term || "");
              if (!/^year_\d+$/.test(t)) continue;
              byTerm.set(t, (byTerm.get(t) || 0) + Number(it.amount || 0));
            }
            for (const [t, total] of byTerm) {
              yearAmountByKey.set(`${key}::${t}`, total);
              yearLabelByKey.set(`${key}::${t}`, feeTermLabel(t, metadata));
            }
          }
        }

        const flatWaivers = waiverRows.map((w: any) => {
            const offer = offersById.get(w.offer_letter_id);
            const lead = offer?.lead_id ? leadsById.get(offer.lead_id) : null;
            const course = offer?.course_id ? coursesById.get(offer.course_id) : null;
            const courseId = offer?.course_id;
            const sessionId = offer?.session_id;
            const yearAmount = (courseId && sessionId)
              ? yearAmountByKey.get(`${courseId}::${sessionId}::${w.term}`) ?? null
              : null;
            const termLabel = (courseId && sessionId)
              ? yearLabelByKey.get(`${courseId}::${sessionId}::${w.term}`) ?? feeTermLabel(w.term)
              : feeTermLabel(w.term);
            return {
              id: w.id,
              offer_letter_id: w.offer_letter_id,
              term: w.term,
              term_label: termLabel,
              amount: Number(w.amount),
              reason: w.reason,
              status: w.status,
              requested_by_name: w.requested_by_name,
              requested_by_role: w.requested_by_role,
              created_at: w.created_at,
              lead_name: lead?.name || "—",
              lead_id: offer?.lead_id || "",
              course_name: course?.name || null,
              year_amount: yearAmount,
            } as WaiverItem;
          });

        // Group by lead+offer so one row = one student
        const groupMap = new Map<string, WaiverGroup>();
        for (const w of flatWaivers) {
          const key = `${w.lead_id}::${w.offer_letter_id}`;
          let g = groupMap.get(key);
          if (!g) {
            g = {
              id: key,
              lead_id: w.lead_id,
              lead_name: w.lead_name,
              course_name: w.course_name,
              offer_letter_id: w.offer_letter_id,
              waivers: [],
              total_waiver: 0,
              created_at: w.created_at,
            };
            groupMap.set(key, g);
          }
          g.waivers.push(w);
          g.total_waiver += w.amount;
          if (w.created_at > g.created_at) g.created_at = w.created_at;
        }
        const nextItems = Array.from(groupMap.values());
        // Store flat count for badge (total pending waivers, not groups)
        setCounts((prev) => prev[cat] === flatWaivers.length ? prev : { ...prev, [cat]: flatWaivers.length });
        setItems(nextItems);
      } else if (cat === "offer_approvals") {
        // offer_letters has course_id → courses FK; join directly
        const { data, error } = await supabase
          .from("offer_letters")
          .select(`
            id, lead_id, approval_status, created_at,
            leads!lead_id ( name ),
            courses!course_id ( name )
          `)
          .eq("approval_status", "pending_principal")
          .order("created_at", { ascending: false });

        if (error) throw error;
        const nextItems = (data || []).map((o: any) => ({
            id: o.id,
            lead_id: o.lead_id,
            lead_name: o.leads?.name || "—",
            course_name: o.courses?.name || null,
            approval_status: o.approval_status,
            created_at: o.created_at || null,
            requested_by_name: null,
            application_id: null,
          } as OfferApprovalItem));
        commitItems(cat, nextItems);
      } else if (cat === "offer_edits") {
        const { data, error } = await supabase
          .from("offer_letter_edit_requests" as any)
          .select(`
            id, offer_letter_id, reason, proposed_changes,
            requested_by_name, requested_by_role, created_at,
            offer_letters!offer_letter_id (
              lead_id, acceptance_deadline, token_fee_amount,
              leads!lead_id ( name ),
              courses!course_id ( name )
            )
          `)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        if (error) throw error;
        const nextItems = (data || []).map((r: any) => ({
            id: r.id,
            offer_letter_id: r.offer_letter_id,
            lead_id: r.offer_letters?.lead_id || "",
            lead_name: r.offer_letters?.leads?.name || "—",
            course_name: r.offer_letters?.courses?.name || null,
            created_at: r.created_at || null,
            requested_by_name: r.requested_by_name,
            requested_by_role: r.requested_by_role,
            reason: r.reason,
            proposed_changes: r.proposed_changes || {},
            current_deadline: r.offer_letters?.acceptance_deadline || null,
            current_token_fee: r.offer_letters?.token_fee_amount ?? null,
          } as OfferEditItem));
        commitItems(cat, nextItems);
      } else if (cat === "fee_concessions") {
        const { data, error } = await supabase
          .from("concessions")
          .select(`
            id, student_id, type, value, reason, created_at,
            students:student_id(name, admission_no, pre_admission_no),
            fee_ledger:fee_ledger_id(term, total_amount, fee_codes:fee_code_id(code, name)),
            requester:requested_by(display_name)
          `)
          .in("status", ["pending_principal", "pending_super_admin"])
          .order("created_at", { ascending: true });
        if (error) throw error;
        const nextItems = ((data || []) as any[]).map((c: any) => ({
            id: c.id,
            student_id: c.student_id,
            student_name: c.students?.name || "—",
            admission_no: c.students?.admission_no || c.students?.pre_admission_no || null,
            fee_code: c.fee_ledger?.fee_codes?.code || null,
            term: c.fee_ledger?.term || null,
            fee_total: c.fee_ledger?.total_amount ?? null,
            type: c.type,
            value: Number(c.value),
            reason: c.reason,
            requested_by_name: c.requester?.display_name || null,
            created_at: c.created_at,
          } as FeeConcessionItem));
        commitItems(cat, nextItems);
      } else if (cat === "certificate_approvals") {
        const { data, error } = await supabase
          .from("alumni_verification_requests" as any)
          .select("id, request_number, alumni_name, campus, course, pgdm_certificate_submitted_by, pgdm_certificate_submitted_at, pgdm_certificate_pdf_path")
          .eq("pgdm_certificate_status", "pending_approval")
          .order("pgdm_certificate_submitted_at", { ascending: true });
        if (error) throw error;
        const rows = (data || []) as any[];
        const submitterIds = [...new Set(rows.map(r => r.pgdm_certificate_submitted_by).filter(Boolean))];
        const nameById: Record<string, string> = {};
        if (submitterIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name, email")
            .in("user_id", submitterIds);
          for (const p of (profs || []) as any[]) nameById[p.user_id] = p.display_name || p.email || "";
        }
        const nextItems = rows.map((r: any) => ({
            id: r.id,
            request_number: r.request_number,
            alumni_name: r.alumni_name,
            campus: r.campus,
            course: r.course,
            submitted_by_name: nameById[r.pgdm_certificate_submitted_by] || null,
            submitted_at: r.pgdm_certificate_submitted_at,
            pdf_path: r.pgdm_certificate_pdf_path,
          } as CertificateApprovalItem));
        commitItems(cat, nextItems);
      } else if (cat === "hr_document_approvals") {
        const { data, error } = await supabase
          .from("hr_letters" as any)
          .select("id, letter_name, letter_code, subject, body, status, submitted_by, submitted_at, employee_profile_id, job_applicant_id")
          .eq("status", "pending_approval")
          .order("submitted_at", { ascending: true });
        if (error) throw error;
        const rows = (data || []) as any[];
        const submitterIds = [...new Set(rows.map(r => r.submitted_by).filter(Boolean))];
        const nameById: Record<string, string> = {};
        if (submitterIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name, email")
            .in("user_id", submitterIds);
          for (const p of (profs || []) as any[]) nameById[p.user_id] = p.display_name || p.email || "";
        }
        const empIds = [...new Set(rows.map(r => r.employee_profile_id).filter(Boolean))];
        const appIds = [...new Set(rows.map(r => r.job_applicant_id).filter(Boolean))];
        const empNameById: Record<string, string> = {};
        const appNameById: Record<string, string> = {};
        if (empIds.length) {
          const { data: emps } = await supabase
            .from("employee_profiles" as any)
            .select("id, display_name")
            .in("id", empIds);
          for (const e of (emps || []) as any[]) empNameById[e.id] = e.display_name || "";
        }
        if (appIds.length) {
          const { data: apps } = await supabase
            .from("job_applicants" as any)
            .select("id, name")
            .in("id", appIds);
          for (const a of (apps || []) as any[]) appNameById[a.id] = a.name || "";
        }
        const nextItems = rows.map((r: any) => ({
            id: r.id,
            letter_name: r.letter_name,
            letter_code: r.letter_code,
            target_name: (r.employee_profile_id && empNameById[r.employee_profile_id]) || (r.job_applicant_id && appNameById[r.job_applicant_id]) || null,
            submitted_by_name: nameById[r.submitted_by] || null,
            submitted_at: r.submitted_at,
            status: r.status,
            subject: r.subject,
            body: r.body,
          } as HrDocumentApprovalItem));
        commitItems(cat, nextItems);
      } else if (cat === "pending_an_generation") {
        const { data, error } = await supabase.rpc("list_pending_an_generation");
        if (error) throw error;
        const nextItems = ((data || []) as any[]).map((r: any) => ({
            id: r.lead_id,
            lead_id: r.lead_id,
            student_id: r.student_id,
            name: r.name || "—",
            course: r.course,
            pre_admission_no: r.pre_admission_no,
            application_id: r.application_id,
            doc_status: r.admission_doc_status || null,
          } as PendingAnItem));
        commitItems(cat, nextItems);
      } else if (cat === "contact_changes") {
        const { data, error } = await supabase
          .from("student_contact_change_requests" as any)
          .select(`
            id, student_id, field_name, old_value, new_value, reason,
            requested_by_name, requested_by_role, created_at,
            students!student_id ( name, admission_no, pre_admission_no )
          `)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) throw error;
        const nextItems = (data || []).map((r: any) => ({
            id: r.id,
            student_id: r.student_id,
            student_name: r.students?.name || "—",
            admission_no: r.students?.admission_no || r.students?.pre_admission_no || null,
            field_name: r.field_name,
            old_value: r.old_value,
            new_value: r.new_value,
            reason: r.reason,
            requested_by_name: r.requested_by_name,
            requested_by_role: r.requested_by_role,
            created_at: r.created_at,
          } as ContactChangeItem));
        commitItems(cat, nextItems);
      } else if (cat === "applications") {
        const { data, error } = await (supabase as any)
          .from("applications")
          .select("id, application_id, status, created_at, submitted_at, course_selections, full_name, phone, leads!lead_id ( name, phone )")
          .eq("status", "submitted")
          .order("submitted_at", { ascending: false })
          .limit(100);

        if (error) throw error;
        const nextItems = (data || []).map((a: any) => ({
            id: a.id,
            application_id: a.application_id,
            lead_name: a.leads?.name || a.full_name || "—",
            course_name: a.course_selections?.[0]?.course_name || null,
            created_at: a.submitted_at || a.created_at,
            stage: a.status,
            phone: a.leads?.phone || a.phone || null,
            app_status: a.status || null,
          } as ApplicationItem));
        commitItems(cat, nextItems);
      } else if (cat === "followups") {
        const today = new Date().toISOString().slice(0, 10);
        // user_id is FK to auth.users (not profiles); just fetch lead data
        const { data, error } = await supabase
          .from("lead_followups")
          .select("id, lead_id, scheduled_at, notes, leads!lead_id ( name, phone )")
          .eq("status", "pending")
          .lte("scheduled_at", `${today}T23:59:59`)
          .order("scheduled_at", { ascending: true })
          .limit(100);

        if (error) throw error;
        const nextItems = (data || []).map((f: any) => ({
            id: f.id,
            lead_id: f.lead_id,
            lead_name: f.leads?.name || "—",
            phone: f.leads?.phone || null,
            scheduled_at: f.scheduled_at,
            notes: f.notes,
            counsellor_name: null,
          } as FollowupItem));
        commitItems(cat, nextItems);
      } else if (cat === "whatsapp") {
        // Use whatsapp_conversations view if available, else aggregate
        const { data, error } = await supabase
          .from("whatsapp_conversations" as any)
          .select("phone, lead_id, lead_name, last_message, last_message_at, unread_count")
          .gt("unread_count", 0)
          .order("last_message_at", { ascending: false })
          .limit(100);

        if (error) throw error;
        const nextItems = (data || []).map((c: any) => ({
            phone: c.phone,
            lead_id: c.lead_id,
            lead_name: c.lead_name,
            last_message: c.last_message,
            last_message_at: c.last_message_at,
            unread_count: c.unread_count,
          } as WhatsAppItem));
        commitItems(cat, nextItems);
      } else if (cat === "video_approvals") {
        const { data, error } = await supabase
          .from("videos" as any)
          .select("id, title, drive_url, brand, content_type, editor_id, created_at")
          .eq("status", "pending_approval")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const rows = (data as any[]) || [];
        const editorIds = [...new Set(rows.map(r => r.editor_id).filter(Boolean))];
        const nameById: Record<string, string> = {};
        if (editorIds.length) {
          const { data: eds } = await supabase
            .from("video_editors" as any)
            .select("id, name")
            .in("id", editorIds);
          for (const e of (eds as any[]) || []) nameById[e.id] = e.name;
        }
        const nextItems = rows.map((v: any) => ({
            id: v.id,
            title: v.title,
            drive_url: v.drive_url,
            brand: v.brand,
            content_type: v.content_type,
            editor_name: nameById[v.editor_id] || "—",
            created_at: v.created_at,
          } as VideoApprovalInboxItem));
        commitItems(cat, nextItems);
      } else if (cat === "voice_messages") {
        const { data, error } = await supabase
          .from("consultant_voice_messages" as any)
          .select("*, consultants:consultant_id(name)")
          .neq("status", "resolved")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const rows = (data as any[]) || [];
        const senderIds = [...new Set(rows.map(r => r.sender_user_id).filter(Boolean))];
        const nameMap: Record<string, string> = {};
        if (senderIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", senderIds);
          for (const p of (profs || []) as any[]) nameMap[p.user_id] = p.display_name || "";
        }
        const nextItems = rows.map((r: any) => ({
            id: r.id,
            consultant_id: r.consultant_id,
            sender_user_id: r.sender_user_id,
            audio_url: r.audio_url,
            duration_seconds: r.duration_seconds,
            subject: r.subject,
            status: r.status,
            created_at: r.created_at,
            sender_name: r.consultants?.name || nameMap[r.sender_user_id] || "Unknown consultant",
          } as VoiceMessageItem));
        commitItems(cat, nextItems);
      }
    } catch (e: any) {
      toast({ title: "Failed to load items", description: e.message, variant: "destructive" });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toast, commitItems]);

  useEffect(() => {
    if (selected) loadItems(selected);
  }, [selected, loadItems]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const decideWaiver = async (waiver: WaiverItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(waiver.id);
    try {
      const { data, error } = await supabase.functions.invoke("decide-offer-waiver", {
        body: { waiver_id: waiver.id, decision, rejection_reason },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({ title: decision === "approved" ? "Waiver approved" : "Waiver rejected" });
      // Optimistically update the group in-place so the user stays on the same card.
      // If only one waiver was left, clear selection (group gone). Otherwise remove
      // the decided waiver from the group and update totals.
      setSelectedItem((prev) => {
        if (!prev || !("waivers" in prev)) return null;
        const g = prev as WaiverGroup;
        const remaining = g.waivers.filter(w => w.id !== waiver.id);
        if (remaining.length === 0) return null;
        return { ...g, waivers: remaining, total_waiver: remaining.reduce((s, w) => s + w.amount, 0) };
      });
      loadItems("offer_waivers", true);
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideAllWaivers = async (group: WaiverGroup) => {
    if (!isSuperAdmin) return;
    setProcessing(group.id);
    try {
      for (const w of group.waivers) {
        const { data, error } = await supabase.functions.invoke("decide-offer-waiver", {
          body: { waiver_id: w.id, decision: "approved" },
        });
        if (error || data?.error) throw new Error(error?.message || data?.error);
      }
      toast({ title: `All ${group.waivers.length} waivers approved` });
      setSelectedItem(null);
      loadItems("offer_waivers");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Batch approve failed", description: e.message, variant: "destructive" });
      loadItems("offer_waivers");
      fetchCounts();
    } finally {
      setProcessing(null);
    }
  };

  const decideAbvmuDeposit = async (claim: AbvmuDepositItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(claim.id);
    try {
      const { data, error } = await (supabase as any).rpc("decide_abvmu_deposit_claim", {
        _claim_id: claim.id,
        _decision: decision,
        _rejection_reason: rejection_reason || null,
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({
        title: decision === "approved" ? "ABVMU deposit approved" : "ABVMU deposit rejected",
        description: decision === "approved"
          ? "Year-1 due reduced provisionally. Settle later when university remits funds to issue a receipt."
          : undefined,
      });
      setSelectedItem(null);
      loadItems("abvmu_deposits");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideOfferApproval = async (offer: OfferApprovalItem, decision: "approved" | "rejected") => {
    if (!isApprover) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(offer.id);
    try {
      const { error } = await supabase
        .from("offer_letters")
        .update({
          approval_status: decision,
          ...(rejection_reason ? { rejection_reason } : {}),
        })
        .eq("id", offer.id);
      if (error) throw error;
      toast({ title: decision === "approved" ? "Offer letter approved" : "Offer letter rejected" });
      setSelectedItem(null);
      loadItems("offer_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideOfferEdit = async (req: OfferEditItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(req.id);
    try {
      const { error } = await supabase
        .from("offer_letter_edit_requests" as any)
        .update({
          status: decision,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          ...(rejection_reason ? { rejection_reason } : {}),
        })
        .eq("id", req.id);
      if (error) throw error;
      // Approved deadline is written back to offer_letters by the apply trigger;
      // regenerate the PDF so it reflects the new value (fire-and-forget).
      if (decision === "approved") {
        supabase.functions
          .invoke("generate-offer-letter", { body: { offer_letter_id: req.offer_letter_id } })
          .catch(() => {});
      }
      toast({ title: decision === "approved" ? "Edit approved" : "Edit rejected" });
      setSelectedItem(null);
      loadItems("offer_edits");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const approveCertificate = async (cert: CertificateApprovalItem) => {
    if (!isSuperAdmin) return;
    const notes = window.prompt("Approval notes (optional):") ?? undefined;
    setProcessing(cert.id);
    try {
      const { error } = await (supabase as any).rpc("approve_pgdm_certificate", {
        _request_id: cert.id,
        _approval_notes: notes || null,
      });
      if (error) throw error;
      toast({ title: "Certificate approved", description: "The assigned handler has been notified to download and print." });
      setSelectedItem(null);
      loadItems("certificate_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const approveHrDocument = async (doc: HrDocumentApprovalItem) => {
    if (!isSuperAdmin) return;
    const notes = window.prompt("Approval notes (optional):") ?? undefined;
    setProcessing(doc.id);
    try {
      const { error } = await (supabase as any).rpc("approve_hr_document", {
        _letter_id: doc.id,
        _notes: notes || null,
      });
      if (error) throw error;
      toast({ title: "Document approved" });
      setSelectedItem(null);
      loadItems("hr_document_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const rejectHrDocument = async (doc: HrDocumentApprovalItem) => {
    if (!isSuperAdmin) return;
    const reason = window.prompt("Reason for rejection:");
    if (reason === null) return;
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "A reason is needed to reject this document.", variant: "destructive" });
      return;
    }
    setProcessing(doc.id);
    try {
      const { error } = await (supabase as any).rpc("reject_hr_document", {
        _letter_id: doc.id,
        _reason: reason.trim(),
      });
      if (error) throw error;
      toast({ title: "Document rejected" });
      setSelectedItem(null);
      loadItems("hr_document_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Rejection failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  // Super-admin override: generate the admission number despite the document gate.
  const bypassAn = async (p: PendingAnItem) => {
    if (!isSuperAdmin) return;
    const reason = window.prompt("Reason for generating the admission number despite the document check:");
    if (reason === null) return;
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "A reason is needed to override the document check.", variant: "destructive" });
      return;
    }
    setProcessing(p.id);
    try {
      const { data, error } = await (supabase as any).rpc("admission_bypass_generate_an", {
        _lead_id: p.lead_id,
        _reason: reason.trim(),
      });
      if (error) throw error;
      toast({ title: "Admission number generated", description: data ? `AN: ${data}` : "Issued." });
      setSelectedItem(null);
      loadItems("pending_an_generation");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Couldn't generate AN", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideConcession = async (c: FeeConcessionItem, approve: boolean) => {
    if (!isSuperAdmin) return;
    let note: string | null = null;
    if (!approve) {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      note = r || null;
    }
    setProcessing(c.id);
    try {
      const { error } = await (supabase as any).rpc("decide_fee_concession", {
        _id: c.id, _approve: approve, _note: note,
      });
      if (error) throw error;
      toast({ title: approve ? "Concession approved" : "Concession rejected" });
      setSelectedItem(null);
      loadItems("fee_concessions");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const openCertificatePdf = async (path: string | null) => {
    if (!path) { toast({ title: "No certificate PDF found", variant: "destructive" }); return; }
    const { data } = await supabase.storage.from("alumni-verification-docs").createSignedUrl(path, 60 * 30);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else toast({ title: "Could not open certificate", variant: "destructive" });
  };

  const decideContactChange = async (request: ContactChangeItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin && !isPrincipal) return;
    let notes: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      notes = r || undefined;
    }
    setProcessing(request.id);
    try {
      const { error } = await (supabase as any).rpc("review_student_contact_change_request", {
        _request_id: request.id,
        _decision: decision,
        _notes: notes || null,
      });
      if (error) throw error;
      toast({ title: decision === "approved" ? "Contact change approved" : "Contact change rejected" });
      setSelectedItem(null);
      loadItems("contact_changes");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideVideo = async (video: VideoApprovalInboxItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | null = null;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection:");
      if (r === null) return;
      if (!r.trim()) { toast({ title: "A reason is required to reject", variant: "destructive" }); return; }
      rejection_reason = r.trim();
    }
    setProcessing(video.id);
    try {
      const { error } = await supabase.from("videos" as any).update({
        status: decision,
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString(),
        rejection_reason,
      }).eq("id", video.id);
      if (error) throw error;
      // On approval, ping the editor on WhatsApp to post & submit the links.
      if (decision === "approved") {
        supabase.functions.invoke("video-notify", {
          body: { event: "approved", video_id: video.id },
        }).catch(() => { /* non-fatal */ });
      }
      toast({ title: decision === "approved" ? "Video approved" : "Video rejected" });
      setSelectedItem(null);
      loadItems("video_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const toggleVoicePlay = async (msg: VoiceMessageItem) => {
    if (playingId === msg.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    audioRef.current = new Audio(msg.audio_url);
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.onerror = () => { toast({ title: "Audio failed to load", variant: "destructive" }); setPlayingId(null); };
    await audioRef.current.play();
    setPlayingId(msg.id);
    // Auto-mark as read on first play
    if (msg.status === "unread") {
      await supabase.from("consultant_voice_messages" as any).update({ status: "read" }).eq("id", msg.id);
      fetchCounts();
    }
  };

  const markWhatsAppRead = async (item: WhatsAppItem) => {
    if (!item.phone || item.unread_count <= 0) return;
    setProcessing(item.phone);
    try {
      const { error } = await (supabase.rpc as any)("mark_whatsapp_conversation_read", {
        p_phone: item.phone,
        p_provider: null,
        p_business_phone_number_id: null,
        p_business_phone_number: null,
      });
      if (error) throw error;
      setItems((prev) => prev.filter((row) => (row as WhatsAppItem).phone !== item.phone));
      setSelectedItem(null);
      setCounts((prev) => ({ ...prev, whatsapp: Math.max(0, prev.whatsapp - 1) }));
      toast({ title: "Marked read", description: "WhatsApp notification removed from the inbox." });
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Could not mark read", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const markVoiceResolved = async (id: string) => {
    const { error } = await supabase
      .from("consultant_voice_messages" as any)
      .update({ status: "resolved", read_by: user?.id, read_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) {
      toast({ title: "Marked resolved" });
      setSelectedItem(null);
      loadItems("voice_messages");
      fetchCounts();
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderMiddleItem = (item: InboxItem) => {
    const isSelected = selectedItem === item;
    const baseClass = cn(
      "group w-full text-left px-4 py-3.5 border-b border-border/50 transition-all cursor-pointer",
      isSelected
        ? "bg-card shadow-sm ring-1 ring-border border-l-2 border-l-primary"
        : "hover:bg-card/80"
    );

    if (selected === "abvmu_deposits") {
      const c = item as AbvmuDepositItem;
      return (
        <button key={c.id} className={baseClass} onClick={() => setSelectedItem(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{c.lead_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                ABVMU deposit · ₹{Number(c.amount).toLocaleString("en-IN")}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(c.submitted_at)}</p>
        </button>
      );
    }

    if (selected === "offer_waivers") {
      const g = item as WaiverGroup;
      return (
        <button key={g.id} className={baseClass} onClick={() => setSelectedItem(g)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{g.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{g.course_name || "—"}</p>
            </div>
            <span className="text-sm font-semibold text-warning-foreground shrink-0">{fmtINR(g.total_waiver)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">
              {g.waivers.length} waiver{g.waivers.length > 1 ? "s" : ""}
            </Badge>
            {g.waivers.map(w => (
              <Badge key={w.id} className="bg-muted text-muted-foreground border-0 text-[10px] capitalize">
                {w.term_label}
              </Badge>
            ))}
            <span className="text-[10px] text-muted-foreground/60">{fmtTime(g.created_at)}</span>
          </div>
        </button>
      );
    }

    if (selected === "offer_approvals") {
      const o = item as OfferApprovalItem;
      return (
        <button key={o.id} className={baseClass} onClick={() => setSelectedItem(o)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{o.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{o.course_name || "—"}</p>
            </div>
            <span className="text-[10px] text-warning-foreground font-medium shrink-0">Pending</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(o.created_at)}</p>
        </button>
      );
    }

    if (selected === "offer_edits") {
      const r = item as OfferEditItem;
      return (
        <button key={r.id} className={baseClass} onClick={() => setSelectedItem(r)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{r.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{r.requested_by_name || "Staff"}</p>
            </div>
            <span className="text-[10px] text-info-foreground font-medium shrink-0">Edit</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(r.created_at)}</p>
        </button>
      );
    }

    if (selected === "fee_concessions") {
      const c = item as FeeConcessionItem;
      return (
        <button key={c.id} className={baseClass} onClick={() => setSelectedItem(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{c.student_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {c.fee_code || "Fee"} · {c.type === "flat" ? fmtINR(c.value) : `${c.value}%`}
              </p>
            </div>
            <span className="text-[10px] text-warning-foreground font-medium shrink-0">Pending</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {c.requested_by_name ? `by ${c.requested_by_name} · ` : ""}{fmtTime(c.created_at)}
          </p>
        </button>
      );
    }

    if (selected === "certificate_approvals") {
      const c = item as CertificateApprovalItem;
      return (
        <button key={c.id} className={baseClass} onClick={() => setSelectedItem(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{c.alumni_name}</p>
              <p className="text-xs text-muted-foreground truncate">{c.request_number} · {c.campus || c.course || "PGDM"}</p>
            </div>
            <span className="text-[10px] text-emerald-600 font-medium shrink-0">Approve</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {c.submitted_by_name ? `by ${c.submitted_by_name} · ` : ""}{fmtTime(c.submitted_at)}
          </p>
        </button>
      );
    }

    if (selected === "hr_document_approvals") {
      const h = item as HrDocumentApprovalItem;
      return (
        <button key={h.id} className={baseClass} onClick={() => setSelectedItem(h)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{h.target_name || h.letter_name}</p>
              <p className="text-xs text-muted-foreground truncate">{h.letter_name}</p>
            </div>
            <span className="text-[10px] text-emerald-600 font-medium shrink-0">Approve</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {h.submitted_by_name ? `by ${h.submitted_by_name} · ` : ""}{fmtTime(h.submitted_at)}
          </p>
        </button>
      );
    }

    if (selected === "pending_an_generation") {
      const p = item as PendingAnItem;
      const ds = p.doc_status || {};
      const outstanding = (ds.missing || 0) + (ds.rejected || 0) + (ds.pending || 0);
      return (
        <button key={p.id} className={baseClass} onClick={() => setSelectedItem(p)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
              <p className="text-xs text-muted-foreground truncate">{p.pre_admission_no || "PAN pending"} · {p.course || "—"}</p>
            </div>
            <span className="text-[10px] text-amber-600 font-medium shrink-0">{ds.verified ?? 0}/{ds.required_total ?? 0} verified</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {outstanding > 0 ? `${outstanding} document${outstanding === 1 ? "" : "s"} pending` : "Documents complete"}
          </p>
        </button>
      );
    }

    if (selected === "contact_changes") {
      const c = item as ContactChangeItem;
      return (
        <button key={c.id} className={baseClass} onClick={() => setSelectedItem(c)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{c.student_name}</p>
              <p className="text-xs text-muted-foreground truncate">{c.field_name.replace(/_/g, " ")}</p>
            </div>
            <span className="text-[10px] text-warning-foreground font-medium shrink-0">Pending</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(c.created_at)}</p>
        </button>
      );
    }

    if (selected === "applications") {
      const a = item as ApplicationItem;
      return (
        <button key={a.id} className={baseClass} onClick={() => setSelectedItem(a)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{a.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{a.course_name || "—"}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(a.created_at)}</p>
        </button>
      );
    }

    if (selected === "followups") {
      const f = item as FollowupItem;
      const isOverdue = new Date(f.scheduled_at) < new Date();
      return (
        <button key={f.id} className={baseClass} onClick={() => setSelectedItem(f)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{f.lead_name}</p>
              {f.notes && <p className="text-xs text-muted-foreground truncate">{f.notes}</p>}
            </div>
            <span className={cn("text-[10px] font-medium shrink-0", isOverdue ? "text-destructive" : "text-muted-foreground")}>
              {isOverdue ? "Overdue" : "Today"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {new Date(f.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {f.counsellor_name && ` · ${f.counsellor_name}`}
          </p>
        </button>
      );
    }

    if (selected === "whatsapp") {
      const w = item as WhatsAppItem;
      return (
        <button
          key={w.phone}
          className={cn(baseClass, isSelected && "bg-primary/5 border-l-2 border-l-primary")}
          onClick={() => setSelectedItem(w)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{w.lead_name || w.phone}</p>
              {w.last_message && (
                <p className="text-xs text-muted-foreground truncate">{w.last_message}</p>
              )}
            </div>
            <Badge className="bg-success/10 text-success border-0 text-[10px] shrink-0">
              {formatBadgeCount(w.unread_count)}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(w.last_message_at)}</p>
        </button>
      );
    }

    if (selected === "video_approvals") {
      const v = item as VideoApprovalInboxItem;
      return (
        <button key={v.id} className={baseClass} onClick={() => setSelectedItem(v)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{v.title}</p>
              <p className="text-xs text-muted-foreground truncate">{v.editor_name}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {VIDEO_BRAND_LABEL[v.brand as VideoBrand] || v.brand} · {fmtTime(v.created_at)}
          </p>
        </button>
      );
    }

    if (selected === "voice_messages") {
      const m = item as VoiceMessageItem;
      const isUnread = m.status === "unread";
      return (
        <button key={m.id} className={cn(baseClass, isUnread && "bg-primary/5/30 dark:bg-primary/90/10")} onClick={() => setSelectedItem(m)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              {isUnread && <span className="h-2 w-2 rounded-full bg-primary/50 shrink-0" />}
              <p className="text-sm font-medium text-foreground truncate">{m.sender_name}</p>
            </div>
            <Mic className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
          </div>
          {m.subject && <p className="text-xs text-muted-foreground truncate mt-0.5">{m.subject}</p>}
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(m.created_at)}</p>
        </button>
      );
    }

    return null;
  };

  const renderDetail = () => {
    if (!selectedItem) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
          <InboxIcon className="h-10 w-10 opacity-20" />
          <p className="text-sm">Select an item to review</p>
        </div>
      );
    }

    if (selected === "abvmu_deposits") {
      const c = selectedItem as AbvmuDepositItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{c.lead_name}</h3>
            <p className="text-sm text-muted-foreground">ABVMU deposit challan claim</p>
          </div>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Amount" value={`₹${Number(c.amount).toLocaleString("en-IN")}`} highlight />
            <Row label="Challan no." value={c.challan_number || "—"} />
            <Row label="Challan date" value={c.challan_date || "—"} />
            <Row label="Submitted" value={fmtDate(c.submitted_at)} />
            <Row label="Notes" value={c.notes || "—"} />
            <Row label="Proof file" value={c.proof_file_name || c.proof_path} />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={async () => {
                const { data } = await supabase.storage
                  .from("application-documents")
                  .createSignedUrl(c.proof_path, 60 * 30);
                if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
                else toast({ title: "Could not open proof", variant: "destructive" });
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View proof
            </Button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1 bg-success/90 hover:bg-success text-white"
                disabled={!isSuperAdmin || processing === c.id}
                onClick={() => decideAbvmuDeposit(c, "approved")}
              >
                {processing === c.id ? <ButtonOrb state="working" onFilled /> : <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                disabled={!isSuperAdmin || processing === c.id}
                onClick={() => decideAbvmuDeposit(c, "rejected")}
              >
                <XCircle className="h-4 w-4 mr-1.5" />Reject
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Approval reduces year-1 due provisionally. Use settle later (when ABVMU remits) to issue a receipt.
            </p>
            {c.lead_id && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/admissions/${c.lead_id}`)}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View Lead
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selected === "offer_waivers") {
      const g = selectedItem as WaiverGroup;
      return (
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-foreground">{g.lead_name}</h3>
              {g.course_name && <p className="text-sm text-muted-foreground">{g.course_name}</p>}
            </div>
            <span className="text-sm font-semibold text-warning-foreground shrink-0">
              Total: {fmtINR(g.total_waiver)}
            </span>
          </div>

          <div className="space-y-2">
            {g.waivers.map(w => {
              const afterWaiver = w.year_amount != null ? Math.max(0, w.year_amount - w.amount) : null;
              return (
                <div key={w.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{w.term_label}</span>
                      <span className="text-sm text-warning-foreground font-medium">−{fmtINR(w.amount)}</span>
                    </div>
                    {isSuperAdmin && (
                      <div className="flex gap-1">
                        <button
                          disabled={processing === w.id}
                          onClick={() => decideWaiver(w, "approved")}
                          className="rounded bg-success hover:bg-success/90 text-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                        >
                          {processing === w.id ? "…" : "Approve"}
                        </button>
                        <button
                          disabled={processing === w.id}
                          onClick={() => decideWaiver(w, "rejected")}
                          className="rounded border border-destructive/30 text-destructive hover:bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {w.year_amount != null && (
                      <div>Gross: {fmtINR(w.year_amount)} → After waiver: {fmtINR(afterWaiver)}</div>
                    )}
                    {w.reason && <div>Reason: {w.reason}</div>}
                    {w.requested_by_name && (
                      <div>
                        By {w.requested_by_name}
                        {w.requested_by_role ? ` (${w.requested_by_role.replace("_", " ")})` : ""}
                        {" · "}{fmtDate(w.created_at)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isSuperAdmin && g.waivers.length > 1 && (
            <Button
              size="sm"
              className="w-full bg-success/90 hover:bg-success text-white"
              disabled={processing != null}
              onClick={() => decideAllWaivers(g)}
            >
              {processing != null ? (
                <ButtonOrb state="working" onFilled />
              ) : (
                <CheckCheck className="h-4 w-4 mr-1.5" />
              )}
              Approve All ({g.waivers.length})
            </Button>
          )}

          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground text-center">Only super admins can approve waivers.</p>
          )}

          {g.lead_id && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate(`/admissions/${g.lead_id}`)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View Lead Profile
            </Button>
          )}
        </div>
      );
    }

    if (selected === "offer_approvals") {
      const o = selectedItem as OfferApprovalItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{o.lead_name}</h3>
            {o.course_name && <p className="text-sm text-muted-foreground">{o.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Status" value="Pending Approval" />
            <Row label="Requested By" value={o.requested_by_name || "—"} />
            <Row label="Issued On" value={fmtDate(o.created_at)} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isApprover || processing === o.id}
              onClick={() => decideOfferApproval(o, "approved")}
            >
              {processing === o.id ? (
                <ButtonOrb state="working" onFilled />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isApprover || processing === o.id}
              onClick={() => decideOfferApproval(o, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {o.lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(`/admissions/${o.lead_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View Lead Profile
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selected === "offer_edits") {
      const r = selectedItem as OfferEditItem;
      const pc = r.proposed_changes || {};
      const fmtFee = (n: number | null | undefined) =>
        n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{r.lead_name}</h3>
            {r.course_name && <p className="text-sm text-muted-foreground">{r.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row
              label="Requested By"
              value={`${r.requested_by_name || "Staff"}${r.requested_by_role ? ` (${r.requested_by_role})` : ""}`}
            />
            <Row label="Requested On" value={fmtDate(r.created_at)} />
            {r.reason && <Row label="Reason" value={r.reason} />}
          </div>

          <div className="rounded-xl border border-info/30 bg-info/5 divide-y divide-border">
            <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-info-foreground">
              Proposed Changes
            </div>
            {pc.acceptance_deadline && (
              <Row
                label="Acceptance Deadline"
                value={`${fmtDate(r.current_deadline)} → ${fmtDate(pc.acceptance_deadline)}`}
              />
            )}
            {pc.token_fee_amount != null && (
              <Row
                label="Token Fee"
                value={`${fmtFee(r.current_token_fee)} → ${fmtFee(pc.token_fee_amount)}`}
              />
            )}
            {!pc.acceptance_deadline && pc.token_fee_amount == null && (
              <Row label="Changes" value="See reason" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === r.id}
              onClick={() => decideOfferEdit(r, "approved")}
            >
              {processing === r.id ? (
                <ButtonOrb state="working" onFilled />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isSuperAdmin || processing === r.id}
              onClick={() => decideOfferEdit(r, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {r.lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(`/admissions/${r.lead_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View Lead Profile
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selected === "fee_concessions") {
      const c = selectedItem as FeeConcessionItem;
      const effective = c.type === "flat"
        ? c.value
        : Math.round(((c.fee_total || 0) * c.value) / 100);
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{c.student_name}</h3>
            {c.admission_no && <p className="text-sm text-muted-foreground font-mono">{c.admission_no}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Fee Head" value={`${c.fee_code || "—"}${c.term ? ` · ${c.term}` : ""}`} />
            <Row label="Fee Amount" value={fmtINR(c.fee_total)} />
            <Row label="Concession" value={c.type === "flat" ? fmtINR(c.value) : `${c.value}%`} />
            <Row label="Reduces Balance By" value={fmtINR(effective)} highlight />
            <Row label="Requested By" value={c.requested_by_name || "—"} />
            <Row label="Requested On" value={fmtDate(c.created_at)} />
          </div>

          {c.reason && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</p>
              <p className="mt-1 text-sm text-foreground">{c.reason}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === c.id}
              onClick={() => decideConcession(c, true)}
            >
              {processing === c.id ? <ButtonOrb state="working" onFilled /> : <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={!isSuperAdmin || processing === c.id}
              onClick={() => decideConcession(c, false)}
            >
              Reject
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Approving recomputes the ledger from every approved source, so offer waivers on the same row are preserved.
          </p>
        </div>
      );
    }

    if (selected === "certificate_approvals") {
      const c = selectedItem as CertificateApprovalItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{c.alumni_name}</h3>
            <p className="text-sm text-muted-foreground">{c.request_number} · PGDM Diploma Certificate</p>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Campus" value={c.campus || "—"} />
            <Row label="Course" value={c.course || "—"} />
            <Row label="Submitted By" value={c.submitted_by_name || "—"} highlight />
            <Row label="Submitted On" value={fmtDate(c.submitted_at)} />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => openCertificatePdf(c.pdf_path)}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Review certificate PDF
          </Button>

          <Button
            size="sm"
            className="w-full bg-success/90 hover:bg-success text-white"
            disabled={!isSuperAdmin || processing === c.id}
            onClick={() => approveCertificate(c)}
          >
            {processing === c.id ? <ButtonOrb state="working" onFilled /> : <><CheckCircle className="h-4 w-4 mr-1.5" />Approve Certificate</>}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => navigate("/alumni-verifications")}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in Student Services
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            To correct details, open in Student Services and use Regenerate.
          </p>
        </div>
      );
    }

    if (selected === "hr_document_approvals") {
      const h = selectedItem as HrDocumentApprovalItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{h.target_name || h.letter_name}</h3>
            <p className="text-sm text-muted-foreground">{h.letter_name}{h.letter_code ? ` · ${h.letter_code}` : ""}</p>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Submitted By" value={h.submitted_by_name || "—"} highlight />
            <Row label="Submitted On" value={fmtDate(h.submitted_at)} />
          </div>

          {(h.subject || h.body) && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              {h.subject && (
                <p className="text-sm font-medium text-foreground">{h.subject}</p>
              )}
              {h.body && (
                <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{h.body}</pre>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === h.id}
              onClick={() => approveHrDocument(h)}
            >
              {processing === h.id ? <ButtonOrb state="working" onFilled /> : <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={!isSuperAdmin || processing === h.id}
              onClick={() => rejectHrDocument(h)}
            >
              Reject
            </Button>
          </div>
        </div>
      );
    }

    if (selected === "pending_an_generation") {
      const p = selectedItem as PendingAnItem;
      const ds = p.doc_status || {};
      const docs = ds.docs || [];
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{p.name}</h3>
            <p className="text-sm text-muted-foreground">{p.pre_admission_no || "PAN pending"} · {p.course || "—"}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Mandatory documents — {ds.verified ?? 0} of {ds.required_total ?? 0} verified
            </p>
            <div className="space-y-1.5">
              {docs.length === 0 && (
                <p className="text-xs text-muted-foreground">No mandatory-document breakdown available.</p>
              )}
              {docs.map((d) => (
                <div key={d.key} className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate">{d.label}</span>
                  <span className={cn(
                    "text-[11px] font-medium shrink-0 ml-2 capitalize",
                    d.state === "verified" ? "text-success"
                      : d.state === "rejected" ? "text-destructive"
                      : d.state === "missing" ? "text-muted-foreground"
                      : "text-amber-600",
                  )}>
                    {d.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {p.application_id && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => navigate(`/applications/${p.application_id}`)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open document review
            </Button>
          )}

          {isSuperAdmin ? (
            <>
              <Button
                size="sm"
                className="w-full bg-amber-600/90 hover:bg-amber-600 text-white"
                disabled={processing === p.id}
                onClick={() => bypassAn(p)}
              >
                {processing === p.id ? <ButtonOrb state="working" onFilled /> : <><CheckCircle className="h-4 w-4 mr-1.5" />Bypass & Generate AN</>}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Use only when a document flag is incorrect — the override is recorded.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center">
              Only a super admin can override the document check and generate the admission number.
            </p>
          )}
        </div>
      );
    }

    if (selected === "contact_changes") {
      const c = selectedItem as ContactChangeItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{c.student_name}</h3>
            {c.admission_no && <p className="text-sm text-muted-foreground font-mono">{c.admission_no}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Field" value={c.field_name.replace(/_/g, " ")} />
            <Row label="Current Number" value={c.old_value || "—"} />
            <Row label="Requested Number" value={c.new_value} highlight />
            <Row label="Reason" value={c.reason || "—"} />
            <Row label="Requested By" value={
              c.requested_by_name
                ? `${c.requested_by_name}${c.requested_by_role ? ` (${c.requested_by_role.replace("_", " ")})` : ""}`
                : "—"
            } />
            <Row label="Requested On" value={fmtDate(c.created_at)} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={(!isSuperAdmin && !isPrincipal) || processing === c.id}
              onClick={() => decideContactChange(c, "approved")}
            >
              {processing === c.id ? (
                <ButtonOrb state="working" onFilled />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={(!isSuperAdmin && !isPrincipal) || processing === c.id}
              onClick={() => decideContactChange(c, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          {c.admission_no && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate(`/students/${c.admission_no}`)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View Student Profile
            </Button>
          )}
        </div>
      );
    }

    if (selected === "applications") {
      const a = selectedItem as ApplicationItem;
      const stageLabel: Record<string, string> = {
        draft: "Draft",
        submitted: "Submitted",
        under_review: "Under Review",
        approved: "Approved",
        rejected: "Rejected",
      };
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{a.lead_name}</h3>
            {a.course_name && <p className="text-sm text-muted-foreground">{a.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Application ID" value={a.application_id} />
            <Row label="Stage" value={stageLabel[a.stage] || a.stage} />
            {a.phone && <Row label="Phone" value={a.phone} />}
            <Row label="Started On" value={fmtDate(a.created_at)} />
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={() => navigate(`/applications/${a.application_id}`)}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Application
          </Button>
        </div>
      );
    }

    if (selected === "followups") {
      const f = selectedItem as FollowupItem;
      const isOverdue = new Date(f.scheduled_at) < new Date();
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{f.lead_name}</h3>
            {f.phone && <p className="text-sm text-muted-foreground">{f.phone}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row
              label="Scheduled"
              value={new Date(f.scheduled_at).toLocaleString("en-IN", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            />
            <Row label="Status" value={isOverdue ? "Overdue" : "Due Today"} />
            {f.counsellor_name && <Row label="Counsellor" value={f.counsellor_name} />}
            {f.notes && <Row label="Notes" value={f.notes} />}
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={() => navigate(`/admissions/${f.lead_id}`)}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Lead
          </Button>
        </div>
      );
    }

    if (selected === "whatsapp") {
      const w = selectedItem as WhatsAppItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{w.lead_name || w.phone}</h3>
            <p className="text-sm text-muted-foreground">{w.phone}</p>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Unread Messages" value={String(w.unread_count)} highlight />
            <Row label="Last Message" value={w.last_message || "—"} />
            <Row label="Received" value={fmtTime(w.last_message_at)} />
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={processing === w.phone}
              onClick={() => markWhatsAppRead(w)}
            >
              {processing === w.phone ? (
                <ButtonOrb state="working" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              )}
              Mark read
            </Button>
            <Button
              size="sm"
              className="w-full"
              onClick={() => navigate(`/whatsapp-inbox?phone=${encodeURIComponent(w.phone)}`)}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Open Conversation
            </Button>
            {w.lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(`/admissions/${w.lead_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View Lead Profile
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selected === "voice_messages") {
      const m = selectedItem as VoiceMessageItem;
      const fmtDur = (s: number | null) => {
        if (!s) return "0:00";
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
      };
      const isPlaying = playingId === m.id;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{m.sender_name}</h3>
            {m.subject && <p className="text-sm text-muted-foreground">{m.subject}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Duration" value={fmtDur(m.duration_seconds)} />
            <Row label="Received" value={fmtDate(m.created_at)} />
            <Row label="Status" value={m.status.charAt(0).toUpperCase() + m.status.slice(1)} />
          </div>

          <button
            onClick={() => toggleVoicePlay(m)}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {isPlaying ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Play</>}
          </button>

          {m.status !== "resolved" && (
            <Button
              size="sm"
              className="w-full bg-success/90 hover:bg-success text-white"
              onClick={() => markVoiceResolved(m.id)}
            >
              <CheckCircle className="h-4 w-4 mr-1.5" /> Mark Resolved
            </Button>
          )}
        </div>
      );
    }

    if (selected === "video_approvals") {
      const v = selectedItem as VideoApprovalInboxItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{v.title}</h3>
            <p className="text-sm text-muted-foreground">{v.editor_name}</p>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Brand" value={VIDEO_BRAND_LABEL[v.brand as VideoBrand] || v.brand} />
            <Row label="Submitted" value={fmtDate(v.created_at)} />
          </div>

          <a href={v.drive_url} target="_blank" rel="noreferrer"
             className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">
            <ExternalLink className="h-4 w-4" /> Open {videoSourceLabel(v.drive_url)} Link
          </a>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === v.id}
              onClick={() => decideVideo(v, "approved")}
            >
              {processing === v.id ? (
                <ButtonOrb state="working" onFilled />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isSuperAdmin || processing === v.id}
              onClick={() => decideVideo(v, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => navigate("/video-approvals")}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Video Approvals
          </Button>
        </div>
      );
    }

    return null;
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[hsl(var(--muted)/0.35)]">
      {/* Left: Category list */}
      <div className="w-[300px] shrink-0 border-r border-border/70 bg-background/95 flex flex-col">
        <div className="px-5 py-5 border-b border-border/70">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Command center</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Inbox</h2>
            </div>
            <button
              onClick={() => { fetchCounts(); if (selected) loadItems(selected); }}
              className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Open</p>
              <p className="mt-0.5 text-lg font-semibold text-foreground">{totalVisibleCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected</p>
              <p className="mt-0.5 text-lg font-semibold text-foreground">{selectedDisplayCount}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {visibleCategories.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">No categories available</p>
          )}
          {visibleCategories.map((cat) => {
            const active = selected === cat.id;
            const displayCount = categoryDisplayCount(cat);
            return (
            <button
              key={cat.id}
              onClick={() => {
                if (selected === cat.id) {
                  loadItems(cat.id);
                  return;
                }
                setItems([]);
                setSelected(cat.id);
              }}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition-all text-left",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-card/80 hover:text-foreground"
              )}
            >
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                active ? "border-primary/15 bg-primary/10" : "border-border bg-muted/50"
              )}>
                <cat.icon className={cn("h-4 w-4", cat.color)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{cat.label}</span>
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {displayCount === 0 ? "All clear" : `${displayCount} open item${displayCount === 1 ? "" : "s"}`}
                </span>
              </span>
              {displayCount > 0 && (
                <span className={cn(
                  "flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-bold text-white px-1.5",
                  cat.id === "whatsapp" ? "bg-success/50"
                  : cat.id === "followups" ? "bg-warning"
                  : "bg-primary"
                )}>
                  {formatBadgeCount(displayCount)}
                </span>
              )}
            </button>
          );})}
        </nav>
      </div>

      {/* Middle: Item list */}
      <div className="w-[380px] shrink-0 border-r border-border/70 bg-background/80 flex flex-col">
        <div className="px-5 py-4 border-b border-border/70 bg-background/95">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {selectedCategory?.label || ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length} item{items.length !== 1 ? "s" : ""}
              </p>
            </div>
            {loading && <ButtonOrb state="working" />}
            {selected === "pending_an_generation" && items.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() =>
                  exportRowsCsv(
                    (items as PendingAnItem[]).map((p) => ({
                      Name: p.name,
                      "PAN No": p.pre_admission_no || "",
                      Course: p.course || "",
                      "Verified docs": p.doc_status?.verified ?? 0,
                      "Required docs": p.doc_status?.required_total ?? 0,
                      Missing: p.doc_status?.missing ?? 0,
                      Rejected: p.doc_status?.rejected ?? 0,
                      Pending: p.doc_status?.pending ?? 0,
                      // Per-document breakdown: one column per mandatory doc, value = its state.
                      ...Object.fromEntries((p.doc_status?.docs || []).map((d) => [d.label, d.state])),
                    })),
                    "pending-an-generation",
                  )
                }
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-background/60">
          {loading && items.length === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <OrbLoader state="searching" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <CheckCircle className="h-9 w-9 opacity-20" />
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs">No open items in this queue.</p>
            </div>
          ) : (
            items.map((item) => renderMiddleItem(item))
          )}
        </div>
      </div>

      {/* Right: Detail pane */}
      <div className="flex-1 overflow-y-auto bg-background">
        {renderDetail()}
      </div>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="text-xs text-muted-foreground w-32 shrink-0 pt-px">{label}</span>
      <span className={cn("text-sm flex-1", highlight ? "font-semibold text-foreground" : "text-foreground/80")}>
        {value}
      </span>
    </div>
  );
}
