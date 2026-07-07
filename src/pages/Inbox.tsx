import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tag, FileText, AlertTriangle, MessageSquare, CheckCircle, XCircle,
  Loader2, ExternalLink, ChevronRight, Clock, User, RefreshCw, Inbox as InboxIcon,
  Video, Mic, Play, Pause, CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VIDEO_BRAND_LABEL, type VideoBrand } from "@/lib/videoBrands";
import { feeTermLabel } from "@/lib/feeTermLabels";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboxCategory {
  id: CategoryId;
  label: string;
  icon: React.ElementType;
  count: number;
  roles: string[]; // roles that can see this category
  color: string;
}

type CategoryId = "offer_waivers" | "offer_approvals" | "contact_changes" | "applications" | "followups" | "whatsapp" | "video_approvals" | "voice_messages";

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

type InboxItem = WaiverItem | OfferApprovalItem | ContactChangeItem | ApplicationItem | FollowupItem | WhatsAppItem | VideoApprovalInboxItem | VoiceMessageItem;

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

  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<CategoryId, number>>({
    offer_waivers: 0,
    offer_approvals: 0,
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
      color: "text-amber-600",
    },
    {
      id: "offer_approvals",
      label: "Offer Approvals",
      icon: FileText,
      count: counts.offer_approvals,
      roles: APPROVER_ROLES,
      color: "text-blue-600",
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
      color: "text-violet-600",
    },
    {
      id: "followups",
      label: "Pending Follow-ups",
      icon: AlertTriangle,
      count: counts.followups,
      roles: ADMISSIONS_ROLES,
      color: "text-orange-600",
    },
    {
      id: "whatsapp",
      label: "WhatsApp Unreplied",
      icon: MessageSquare,
      count: counts.whatsapp,
      roles: ADMISSIONS_ROLES,
      color: "text-green-600",
    },
    {
      id: "video_approvals",
      label: "Video Approvals",
      icon: Video,
      count: counts.video_approvals,
      roles: ["super_admin"],
      color: "text-rose-600",
    },
    {
      id: "voice_messages",
      label: "Voice Messages",
      icon: Mic,
      count: counts.voice_messages,
      roles: APPROVER_ROLES,
      color: "text-purple-600",
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
    ]);

    const get = (i: number) => {
      const r = results[i];
      if (r.status === "fulfilled") return (r.value as any).count ?? (r.value as any).data?.length ?? 0;
      return 0;
    };

    setCounts({
      offer_waivers: get(0),
      offer_approvals: get(1),
      contact_changes: get(2),
      applications: get(3),
      followups: get(4),
      whatsapp: get(5),
      video_approvals: get(6),
      voice_messages: get(7),
    });
  }, [role, isSuperAdmin, isPrincipal, isApprover, isAdmissions, profile?.id]);

  useEffect(() => {
    fetchCounts();
    // auto-select first visible category
  }, [fetchCounts]);

  useEffect(() => {
    if (visibleCategories.length > 0 && !selected) {
      setSelected(visibleCategories[0].id);
    }
  }, [visibleCategories.length]);

  // ── Item loading ──────────────────────────────────────────────────────────

  const loadItems = useCallback(async (cat: CategoryId) => {
    setLoading(true);
    setSelectedItem(null);
    setItems([]); // clear stale items immediately so renderMiddleItem never sees mismatched data

    try {
      if (cat === "offer_waivers") {
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

        const nextItems = waiverRows.map((w: any) => {
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
        commitItems(cat, nextItems);
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
      setSelectedItem(null);
      loadItems("offer_waivers");
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

    if (selected === "offer_waivers") {
      const w = item as WaiverItem;
      return (
        <button key={w.id} className={baseClass} onClick={() => setSelectedItem(w)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{w.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{w.course_name || "—"}</p>
            </div>
            <span className="text-sm font-semibold text-amber-700 shrink-0">{fmtINR(w.amount)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px] capitalize">
              {w.term_label}
            </Badge>
            <span className="text-[10px] text-muted-foreground/60">{fmtTime(w.created_at)}</span>
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
            <span className="text-[10px] text-amber-600 font-medium shrink-0">Pending</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(o.created_at)}</p>
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
            <span className="text-[10px] text-amber-600 font-medium shrink-0">Pending</span>
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
            <Badge className="bg-green-100 text-green-700 border-0 text-[10px] shrink-0">
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
        <button key={m.id} className={cn(baseClass, isUnread && "bg-purple-50/30 dark:bg-purple-950/10")} onClick={() => setSelectedItem(m)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              {isUnread && <span className="h-2 w-2 rounded-full bg-purple-500 shrink-0" />}
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

    if (selected === "offer_waivers") {
      const w = selectedItem as WaiverItem;
      const applicableAfterWaiver = w.year_amount != null
        ? Math.max(0, w.year_amount - w.amount)
        : null;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{w.lead_name}</h3>
            {w.course_name && <p className="text-sm text-muted-foreground">{w.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Fee Particular" value={w.term_label} />
            <Row label="Amount" value={fmtINR(w.year_amount)} />
            <Row label="Waiver Requested" value={fmtINR(w.amount)} highlight />
            <Row label="Applicable Amount After Waiver" value={fmtINR(applicableAfterWaiver)} />
            <Row label="Reason" value={w.reason || "—"} />
            <Row label="Requested By" value={
              w.requested_by_name
                ? `${w.requested_by_name}${w.requested_by_role ? ` (${w.requested_by_role.replace("_", " ")})` : ""}`
                : "—"
            } />
            <Row label="Requested On" value={fmtDate(w.created_at)} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === w.id}
              onClick={() => decideWaiver(w, "approved")}
            >
              {processing === w.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isSuperAdmin || processing === w.id}
              onClick={() => decideWaiver(w, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground text-center">Only super admins can approve waivers.</p>
          )}

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
                <Loader2 className="h-4 w-4 animate-spin" />
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
                <Loader2 className="h-4 w-4 animate-spin" />
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
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
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
                <Loader2 className="h-4 w-4 animate-spin" />
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
                  cat.id === "whatsapp" ? "bg-green-500"
                  : cat.id === "followups" ? "bg-orange-500"
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
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-background/60">
          {loading && items.length === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
