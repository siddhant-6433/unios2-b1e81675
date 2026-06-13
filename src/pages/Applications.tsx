import { useState, useEffect, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { MiniLifecycleStepper } from "@/components/admissions/MiniLifecycleStepper";
import { RecordPaymentDialog } from "@/components/admissions/RecordPaymentDialog";
import { OfflinePaymentDialog } from "@/components/finance/OfflinePaymentDialog";
import { NudgePaymentDialog } from "@/components/admissions/NudgePaymentDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Download, Eye, Loader2, Search, Filter, ExternalLink,
  CheckCircle, Clock, CreditCard, Upload, AlertCircle, ChevronDown, ChevronUp, ChevronRight, X,
  Sparkles, Send, Gift, Wallet, UserCheck, GraduationCap, Receipt, RefreshCw, ClipboardCheck, Trash2, MessageCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  applicationFunnelStageOf,
  type ApplicationFunnelStage,
} from "@/lib/applicationFunnel";
import { deleteApplication as deleteApplicationRequest } from "@/lib/deleteApplication";
import { useToast } from "@/hooks/use-toast";

interface AppRow {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  fee_amount: number | null;
  program_category: string | null;
  course_selections: any[];
  completed_sections: Record<string, boolean>;
  submitted_at: string | null;
  created_at: string;
  flags: string[] | null;
  dob: string | null;
  gender: string | null;
  category: string | null;
  father: any;
  mother: any;
  address: any;
  academic_details: any;
  form_pdf_url: string | null;
  fee_receipt_url: string | null;
  counsellor_name?: string;
  lead_stage?: string;
  lead_counsellor_id?: string;
  lead_pre_admission_no?: string | null;
  lead_admission_no?: string | null;
  has_offer?: boolean;
  app_fee_paid?: number;
  has_token_fee_paid?: boolean;
  doc_counts?: { total: number; verified: number; rejected: number; pending: number };
  /** Amount still due for PAN issuance (null when lead has no offer yet or already has PAN). */
  pan_due?: number | null;
  /** Amount still due for AN issuance (null when lead has no PAN yet or already has AN). */
  an_due?: number | null;
  /** Remaining balance for the full first-year fee — needed by the nudge dialog. */
  year1_due?: number | null;
}

// Mutually-exclusive funnel stages. Each app is bucketed by the FURTHEST
// stage it has reached, so counts never overlap. The funnel below renders
// cumulative "reached" counts (apps at this stage OR beyond) with conversion
// % on the arrows, while clicking a box filters the table to apps currently
// STUCK at that stage — the leakage cohort to act on.
type FunnelStage = ApplicationFunnelStage;

// In NIMT's workflow the candidate ALWAYS pays the application fee before
// submitting — docs + declaration come after the payment screen. So the
// funnel order is In Progress → Paid → Submitted (= paid + declaration
// submitted) → Approved → … rather than Submitted → Paid.
const FUNNEL_ORDER: FunnelStage[] = [
  "in_progress", "paid", "submitted", "approved",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

const funnelStageOf = applicationFunnelStageOf;

const FUNNEL_META: Record<FunnelStage, {
  label: string; icon: any;
  iconBg: string; iconColor: string;
  tint: string; ring: string; bar: string;
}> = {
  in_progress:  { label: "In Progress",  icon: Clock,         iconBg: "bg-amber-100",   iconColor: "text-amber-600",   tint: "bg-amber-50/60",   ring: "ring-amber-400",   bar: "bg-amber-400" },
  submitted:    { label: "Submitted",    icon: CheckCircle,   iconBg: "bg-violet-100",  iconColor: "text-violet-600",  tint: "bg-violet-50/60",  ring: "ring-violet-400",  bar: "bg-violet-400" },
  paid:         { label: "Paid",         icon: CreditCard,    iconBg: "bg-emerald-100", iconColor: "text-emerald-600", tint: "bg-emerald-50/60", ring: "ring-emerald-400", bar: "bg-emerald-400" },
  approved:     { label: "Pending Offer", icon: ClipboardCheck,iconBg: "bg-orange-100",  iconColor: "text-orange-600",  tint: "bg-orange-50/60",  ring: "ring-orange-400",  bar: "bg-orange-400" },
  offer_sent:   { label: "Offer Sent",   icon: Gift,          iconBg: "bg-teal-100",    iconColor: "text-teal-600",    tint: "bg-teal-50/60",    ring: "ring-teal-400",    bar: "bg-teal-400" },
  token_paid:   { label: "Token Paid",   icon: Wallet,        iconBg: "bg-cyan-100",    iconColor: "text-cyan-600",    tint: "bg-cyan-50/60",    ring: "ring-cyan-400",    bar: "bg-cyan-400" },
  pre_admitted: { label: "Pre-Admitted", icon: UserCheck,     iconBg: "bg-indigo-100",  iconColor: "text-indigo-600",  tint: "bg-indigo-50/60",  ring: "ring-indigo-400",  bar: "bg-indigo-400" },
  admitted:     { label: "Admitted",     icon: GraduationCap, iconBg: "bg-green-100",   iconColor: "text-green-600",   tint: "bg-green-50/60",   ring: "ring-green-400",   bar: "bg-green-400" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (pct >= 70)   return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  submitted: "bg-emerald-100 text-emerald-700",
  under_review: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const PAYMENT_BADGE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

const LEAD_STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress", application_submitted: "Submitted",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
  not_interested: "Not Interested", rejected: "Rejected",
};

const LEAD_STAGE_BADGE: Record<string, string> = {
  application_in_progress: "bg-blue-100 text-blue-700",
  application_submitted: "bg-violet-100 text-violet-700",
  visit_scheduled: "bg-purple-100 text-purple-700",
  interview: "bg-indigo-100 text-indigo-700",
  offer_sent: "bg-teal-100 text-teal-700",
  token_paid: "bg-cyan-100 text-cyan-700",
  pre_admitted: "bg-emerald-100 text-emerald-700",
  admitted: "bg-green-100 text-green-700",
};

export default function Applications() {
  const { role, profile } = useAuth();
  const { toast } = useToast();
  const isCounsellor = role === "counsellor";
  const isSuperAdmin = role === "super_admin";
  const [apps, setApps] = useState<AppRow[]>([]);
  const [offlinePaymentApp, setOfflinePaymentApp] = useState<AppRow | null>(null);
  const [offlineReceiptApp, setOfflineReceiptApp] = useState<AppRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "pending">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted">("all");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"date" | "nudge">("date");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docsDialog, setDocsDialog] = useState<{ appId: string; applicationId: string } | null>(null);
  const [docs, setDocs] = useState<{ name: string; url: string }[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [generatingPdfFor, setGeneratingPdfFor] = useState<string | null>(null);
  const [bulkRegen, setBulkRegen] = useState<{ done: number; total: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AppRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [nudgeTarget, setNudgeTarget] = useState<AppRow | null>(null);

  const handleOfflinePaymentSuccess = async () => {
    if (!offlinePaymentApp) return;
    await supabase.from("applications" as any)
      .update({ payment_status: "paid" })
      .eq("id", offlinePaymentApp.id);
    setApps(prev => prev.map(a =>
      a.id === offlinePaymentApp.id ? { ...a, payment_status: "paid" } : a
    ));
    setOfflinePaymentApp(null);
  };

  const generateFormPdf = async (app: AppRow) => {
    setGeneratingPdfFor(app.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-form", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.form_pdf_url;
      if (url) {
        setApps(prev => prev.map(a => a.id === app.id ? { ...a, form_pdf_url: url } : a));
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("generate-application-form failed:", e);
    } finally {
      setGeneratingPdfFor(null);
    }
  };

  const regenerateAll = async () => {
    const eligible = (a: AppRow) => a.status === "submitted" || a.status === "under_review" || a.status === "approved";
    const targets = selectedIds.size > 0
      ? apps.filter(a => selectedIds.has(a.id) && eligible(a))
      : apps.filter(eligible);
    if (!targets.length) return;
    const scope = selectedIds.size > 0 ? "selected" : "all";
    if (!window.confirm(`Regenerate ${targets.length} ${scope} application form PDFs? This may take a few minutes.`)) return;
    setBulkRegen({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const app = targets[i];
      try {
        const { data, error } = await supabase.functions.invoke("generate-application-form", {
          body: { application_id: app.application_id },
        });
        if (error) throw error;
        const url = (data as any)?.form_pdf_url;
        if (url) {
          setApps(prev => prev.map(a => a.id === app.id ? { ...a, form_pdf_url: url } : a));
        }
      } catch (e) {
        console.error(`bulk regen failed for ${app.application_id}:`, e);
      }
      setBulkRegen({ done: i + 1, total: targets.length });
    }
    setBulkRegen(null);
  };

  const generateFeeReceipt = async (app: AppRow) => {
    setGeneratingPdfFor(app.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-fee-receipt", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.fee_receipt_url;
      if (url) {
        setApps(prev => prev.map(a => a.id === app.id ? { ...a, fee_receipt_url: url } : a));
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("generate-application-fee-receipt failed:", e);
    } finally {
      setGeneratingPdfFor(null);
    }
  };

  useEffect(() => {
    // Counsellor scoping has to happen at the SQL layer — otherwise we pull
    // every application system-wide, then fan out lead_fee_status RPCs for
    // every other counsellor's offer-letter leads, then filter to ours.
    // Wait until profile.id is available before firing.
    if (isCounsellor && !profile?.id) return;

    const fetchApps = async () => {
      setLoading(true);

      // Counsellors get a server-scoped list via the counsellor_applications
      // RPC. The old approach — fetch every assigned lead_id, then filter with
      // .in("lead_id", […]) — built a multi-KB request URL for high-volume
      // counsellors (900+ leads) that the gateway rejected, silently blanking
      // the page. Admins still read the table directly (RLS lets them see all).
      let rows: any[] = [];
      if (isCounsellor) {
        const { data, error } = await (supabase as any).rpc("counsellor_applications");
        if (error) {
          console.error("counsellor_applications failed:", error);
          setApps([]);
          setLoading(false);
          return;
        }
        rows = data || [];
      } else {
        const { data } = await (supabase as any).from("applications")
          .select("id, application_id, lead_id, full_name, phone, email, status, payment_status, payment_ref, fee_amount, program_category, course_selections, completed_sections, submitted_at, created_at, flags, dob, gender, category, father, mother, address, academic_details, form_pdf_url, fee_receipt_url")
          .order("created_at", { ascending: false });
        rows = data || [];
      }

      // Batch-fetch counsellor names + lead stage + lifecycle data via
      // leads → profiles → offer_letters → application_doc_reviews.
      const leadIds = [...new Set(rows.map((a: any) => a.lead_id).filter(Boolean))];
      const appIdsForReview = rows.map((a: any) => a.application_id).filter(Boolean);
      const counsellorMap: Record<string, string> = {};
      const leadStageMap: Record<string, string> = {};
      const leadCounsellorIdMap: Record<string, string> = {};
      const leadPanMap: Record<string, string | null> = {};
      const leadAnMap: Record<string, string | null> = {};
      const leadOfferMap: Record<string, boolean> = {};
      const appFeePaidMap: Record<string, number> = {};
      const leadTokenFeePaidSet: Set<string> = new Set();
      const appDocCountsMap: Record<string, { total: number; verified: number; rejected: number; pending: number }> = {};
      if (leadIds.length > 0) {
        // Offer-letter existence — one row per lead is enough to flag.
        const { data: offers } = await supabase.from("offer_letters")
          .select("lead_id")
          .in("lead_id", leadIds);
        (offers || []).forEach((o: any) => { leadOfferMap[o.lead_id] = true; });

        // Confirmed application_fee + token_fee payments — track per lead.
        // We need TOKEN-fee separately so the "Token Paid" stat reflects
        // anyone who actually paid the token fee, not just leads whose
        // current `stage` happens to equal 'token_paid' (which gets
        // overwritten as soon as they progress to offer_sent / pre_admitted
        // / admitted, leaving most real payers uncounted).
        const { data: pmts } = await supabase.from("lead_payments")
          .select("lead_id, amount, type")
          .in("lead_id", leadIds)
          .in("type", ["application_fee", "token_fee"])
          .eq("status", "confirmed");
        (pmts || []).forEach((p: any) => {
          if (p.type === "application_fee") {
            appFeePaidMap[p.lead_id] = (appFeePaidMap[p.lead_id] || 0) + Number(p.amount || 0);
          } else if (p.type === "token_fee") {
            leadTokenFeePaidSet.add(p.lead_id);
          }
        });

        for (let i = 0; i < leadIds.length; i += 50) {
          const batch = leadIds.slice(i, i + 50);
          const { data: leads } = await supabase.from("leads")
            .select("id, counsellor_id, stage, pre_admission_no, admission_no")
            .in("id", batch);
          (leads || []).forEach((l: any) => {
            leadStageMap[l.id] = l.stage;
            leadCounsellorIdMap[l.id] = l.counsellor_id;
            leadPanMap[l.id] = l.pre_admission_no;
            leadAnMap[l.id] = l.admission_no;
          });
          const counsellorIds = [...new Set((leads || []).map((l: any) => l.counsellor_id).filter(Boolean))];
          if (counsellorIds.length > 0) {
            const { data: profiles } = await supabase.from("profiles")
              .select("id, display_name")
              .in("id", counsellorIds);
            const profileMap: Record<string, string> = {};
            (profiles || []).forEach((p: any) => { profileMap[p.id] = p.display_name || ""; });
            (leads || []).forEach((l: any) => {
              if (l.counsellor_id && profileMap[l.counsellor_id]) {
                counsellorMap[l.id] = profileMap[l.counsellor_id];
              }
            });
          }
        }
      }

      // Document review counts per application — used by the mini lifecycle
      // stepper. One round-trip; harmless if zero rows.
      if (appIdsForReview.length > 0) {
        const { data: reviews } = await supabase.from("application_doc_reviews" as any)
          .select("application_id, status")
          .in("application_id", appIdsForReview);
        (reviews || []).forEach((r: any) => {
          if (!appDocCountsMap[r.application_id]) {
            appDocCountsMap[r.application_id] = { total: 0, verified: 0, rejected: 0, pending: 0 };
          }
          const c = appDocCountsMap[r.application_id];
          c.total++;
          if (r.status === "verified") c.verified++;
          else if (r.status === "rejected") c.rejected++;
          else c.pending++;
        });
      }

      // Pull PAN/AN amounts due from the server-side `lead_fee_status` RPC
      // — same source of truth the candidate's portal uses (TokenFeePanel).
      // Only fetch for leads who can still progress toward PAN or AN:
      // they have an offer letter AND don't already have admission_no. This
      // narrows ~200 leads → ~40 RPC calls in parallel.
      const panDueMap: Record<string, number | null> = {};
      const anDueMap: Record<string, number | null> = {};
      const year1DueMap: Record<string, number | null> = {};
      const feeStatusLeadIds = leadIds.filter((lid: string) =>
        leadOfferMap[lid] && !leadAnMap[lid]
      );
      if (feeStatusLeadIds.length > 0) {
        await Promise.all(feeStatusLeadIds.map(async (lid: string) => {
          const { data: fs } = await (supabase as any).rpc("lead_fee_status", { _lead_id: lid });
          if (!fs) return;
          const tokenReq = Number(fs.token_required || 0);
          const tokenPaid = Number(fs.token_paid || 0);
          const anThr = Number(fs.an_threshold || 0);
          const postSchY1 = Number(fs.post_scholarship_year_1 || fs.first_year_fee || 0);
          // `paid_toward_course` excludes application_fee + registration_fee
          // (the one-time admin gate at NIMT — same concept, two names) and
          // is the right field for both the AN-gate balance and the year-1
          // remaining. `total_paid` would double-count the app/reg fee and
          // wrongly shrink the displayed dues.
          const paidTowardCourse = Number(fs.paid_toward_course || 0);
          const hasPan = !!leadPanMap[lid];
          panDueMap[lid] = hasPan ? null : Math.max(0, tokenReq - tokenPaid);
          anDueMap[lid] = Math.max(0, anThr - paidTowardCourse);
          year1DueMap[lid] = Math.max(0, postSchY1 - paidTowardCourse);
        }));
      }

      const mapped = rows.map((a: any) => ({
        ...a,
        counsellor_name: counsellorMap[a.lead_id] || "",
        lead_stage: leadStageMap[a.lead_id] || "",
        lead_counsellor_id: leadCounsellorIdMap[a.lead_id] || "",
        // Lifecycle inputs the MiniLifecycleStepper consumes
        lead_pre_admission_no: leadPanMap[a.lead_id] || null,
        lead_admission_no: leadAnMap[a.lead_id] || null,
        has_offer: !!leadOfferMap[a.lead_id],
        app_fee_paid: appFeePaidMap[a.lead_id] || 0,
        has_token_fee_paid: leadTokenFeePaidSet.has(a.lead_id),
        doc_counts: appDocCountsMap[a.application_id] || { total: 0, verified: 0, rejected: 0, pending: 0 },
        pan_due: panDueMap[a.lead_id] ?? null,
        an_due: anDueMap[a.lead_id] ?? null,
        year1_due: year1DueMap[a.lead_id] ?? null,
      }));

      setApps(mapped);
      setLoading(false);
    };
    fetchApps();
  }, [profile?.id, isCounsellor]);

  const completedCount = (cs: Record<string, boolean>) => Object.values(cs || {}).filter(Boolean).length;
  const totalCount = (cs: Record<string, boolean>) => Object.keys(cs || {}).length;
  const completionPct = (cs: Record<string, boolean>) => { const t = totalCount(cs); return t > 0 ? completedCount(cs) / t : 0; };

  const filtered = apps.filter(a => {
    if (paymentFilter !== "all" && a.payment_status !== paymentFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    // The "token_paid" tile filters on the lead_payments-derived flag so it
    // includes everyone who paid token fee, not just those currently AT the
    // token_paid stage. Other stage tiles still match on the lead's stage.
    if (stageFilter === "paid_no_offer") {
      if (a.payment_status !== "paid" || a.has_offer) return false;
    } else if (stageFilter && (FUNNEL_ORDER as string[]).includes(stageFilter)) {
      // Funnel filter → show only apps currently STUCK at that stage
      // (the leakage cohort — didn't progress beyond).
      if (funnelStageOf(a) !== stageFilter) return false;
    } else if (stageFilter && a.lead_stage !== stageFilter) {
      // Legacy stage-key passthrough (kept for any external callers).
      return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.full_name?.toLowerCase().includes(q) ||
      a.phone?.includes(q) ||
      a.application_id?.toLowerCase().includes(q) ||
      a.course_selections?.some((c: any) => c.course_name?.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    if (sortMode === "nudge") {
      const aPaid = a.payment_status === "paid" ? 1 : 0;
      const bPaid = b.payment_status === "paid" ? 1 : 0;
      if (bPaid !== aPaid) return bPaid - aPaid;
      return completionPct(b.completed_sections) - completionPct(a.completed_sections);
    }

    // "In Progress" filter: paid first → then most sections completed first
    if (statusFilter === "draft") {
      const aPaid = a.payment_status === "paid" ? 1 : 0;
      const bPaid = b.payment_status === "paid" ? 1 : 0;
      if (bPaid !== aPaid) return bPaid - aPaid;
      return completionPct(b.completed_sections) - completionPct(a.completed_sections);
    }

    // "Paid" filter: most sections completed first (closest to submission)
    if (paymentFilter === "paid") {
      return completionPct(b.completed_sections) - completionPct(a.completed_sections);
    }

    // "Submitted" filter: most recent submission first
    if (statusFilter === "submitted") {
      const aDate = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const bDate = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return bDate - aDate;
    }

    // Default: date descending
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const fetchDocs = async (appId: string, applicationId: string) => {
    setDocsDialog({ appId, applicationId });
    setDocsLoading(true);
    setDocs([]);

    try {
      const { data, error } = await supabase.functions.invoke("list-app-docs", {
        body: { application_id: applicationId },
      });
      if (error) throw error;
      const list = ((data as any)?.docs || []) as { name: string; url: string }[];
      setDocs(list);
    } catch (e) {
      console.error("list-app-docs failed:", e);
      setDocs([]);
    }
    setDocsLoading(false);
  };

  // ── Funnel bucketing ─────────────────────────────────────────────────────
  // Bucket every app into exactly one stage (the furthest reached) so counts
  // never overlap. Then derive cumulative "reached" counts for the funnel
  // display: reached[s] = apps that landed at s OR any later stage.
  const stageBucket: Record<FunnelStage, number> = {
    in_progress: 0, submitted: 0, paid: 0, approved: 0,
    offer_sent: 0, token_paid: 0, pre_admitted: 0, admitted: 0,
  };
  for (const a of apps) stageBucket[funnelStageOf(a)]++;

  const stageReached: Record<FunnelStage, number> = {} as any;
  {
    let cum = apps.length;
    for (const s of FUNNEL_ORDER) {
      stageReached[s] = cum;
      cum -= stageBucket[s];
    }
  }
  const totalApps = apps.length;
  const paidNoOffer = apps.filter(a => a.payment_status === "paid" && !a.has_offer).length;

  const handleDelete = async () => {
    if (!deleteTarget || deleteTarget.payment_status === "paid") return;
    setDeleting(true);
    const { data, error } = await deleteApplicationRequest({
      id: deleteTarget.id,
      applicationId: deleteTarget.application_id,
      paymentStatus: deleteTarget.payment_status,
    });
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setApps(prev => prev.filter(a => a.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast({
      title: "Application deleted",
      description: data
        ? `${data.application_id} deleted with ${data.deleted_storage_files} storage files cleaned up.`
        : undefined,
    });
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Applications" : "Applications"}</h1>
          <p className="text-sm text-muted-foreground mt-1">{isCounsellor ? "Applications for your assigned leads" : "All online applications with payment and document status"}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isCounsellor && (
            <button onClick={regenerateAll} disabled={!!bulkRegen}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50">
              {bulkRegen ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {bulkRegen
                ? `Regenerating ${bulkRegen.done}/${bulkRegen.total}`
                : selectedIds.size > 0
                  ? `Regenerate Selected (${selectedIds.size})`
                  : "Regenerate All PDFs"}
            </button>
          )}
          <button onClick={() => setSortMode(sortMode === "nudge" ? "date" : "nudge")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              sortMode === "nudge" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-input bg-background text-muted-foreground hover:bg-muted/50"
            }`}>
            <Sparkles className="h-3 w-3" />{sortMode === "nudge" ? "Nudge View" : "Sort: Date"}
          </button>
        </div>
      </div>

      {/* Application Pipeline Funnel ────────────────────────────────────────
          Mutually-exclusive stages — each app is bucketed by the furthest
          stage it has reached. The big number in each box is the STUCK-here
          count (apps currently at that stage and not progressed beyond) so
          the click filter and the displayed number always match. Funnel
          NARROWING comes from box width = proportional to cumulative reach,
          and "X reached" caption shows that cumulative count for context.
          Conversion % between stages uses cumulative reach (proper funnel
          math), colored ≥90 green, ≥70 amber, <70 rose. */}
      <Card className="rounded-2xl border-border/40 shadow-none">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">Application Pipeline</h2>
              <span className="text-xs text-muted-foreground">{totalApps} total · big number = currently at stage · click to see who's stuck</span>
            </div>
            {paidNoOffer > 0 && (
              <button
                onClick={() => { setStageFilter(stageFilter === "paid_no_offer" ? null : "paid_no_offer"); setPaymentFilter("all"); setStatusFilter("all"); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                  stageFilter === "paid_no_offer"
                    ? "border-rose-400 bg-rose-100 text-rose-800 ring-2 ring-rose-300"
                    : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 animate-pulse"
                }`}
                title="Paid candidates with no offer letter yet — counsellor action needed"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                {paidNoOffer} paid · offer not issued
              </button>
            )}
          </div>

          {/* `overflow-x-auto` also clips Y in CSS, so the ring-2 on the active
              box would get cropped at the top/bottom without vertical padding.
              `py-1.5 -my-1.5` keeps layout space identical while giving the
              ring room to render. */}
          <div className="flex items-stretch gap-1.5 overflow-x-auto py-1.5 -my-1.5 px-1 -mx-1">
            {FUNNEL_ORDER.map((stage, i) => {
              const meta = FUNNEL_META[stage];
              const Icon = meta.icon;
              const reached = stageReached[stage];
              const stuck = stageBucket[stage];
              const prevReached = i > 0 ? stageReached[FUNNEL_ORDER[i - 1]] : null;
              const conversion = prevReached != null && prevReached > 0
                ? Math.round((reached / prevReached) * 100)
                : null;
              const isActive = stageFilter === stage;
              // Proportional width gives the true funnel-narrowing shape;
              // floor at min-width so single-digit stages stay legible.
              const widthBasis = totalApps > 0
                ? Math.max(96, (reached / totalApps) * 220)
                : 96;
              const reachPct = totalApps > 0 ? (reached / totalApps) * 100 : 0;

              return (
                <Fragment key={stage}>
                  {i > 0 && (
                    <div className="flex flex-col items-center justify-center shrink-0 self-center">
                      <div className={`text-[10px] font-semibold rounded-md border px-1.5 py-0.5 leading-tight ${conversionTone(conversion)}`}>
                        {conversion != null ? `${conversion}%` : "—"}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5" />
                    </div>
                  )}
                  <button
                    onClick={() => { setStageFilter(isActive ? null : stage); setPaymentFilter("all"); setStatusFilter("all"); }}
                    className={`group relative rounded-xl border transition-all text-left p-3 shrink-0 ${
                      isActive
                        ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                        : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                    }`}
                    style={{ flex: `1 1 ${widthBasis}px`, minWidth: 96 }}
                    title={`${stuck} currently at ${meta.label} · ${reached} reached this stage or beyond`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`w-7 h-7 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-3.5 w-3.5 ${meta.iconColor}`} />
                      </div>
                      <p className="text-2xl font-bold text-foreground leading-none tracking-tight">{stuck}</p>
                    </div>
                    <p className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</p>
                    <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                      <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground/70">{reached}</span> reached
                    </p>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, app ID, course..."
            className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
          <option value="all">All Payments</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
        </select>
        {(paymentFilter !== "all" || statusFilter !== "all" || stageFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setPaymentFilter("all"); setStatusFilter("all"); setStageFilter(null); }}>
            <X className="h-3.5 w-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-8"></th>
                {!isCounsellor && (
                  <th className="px-2 py-2.5 text-left font-medium text-muted-foreground w-8">
                    <input
                      type="checkbox"
                      className="cursor-pointer accent-primary"
                      title="Select all eligible"
                      checked={(() => {
                        const eligible = filtered.filter(a => a.status === "submitted" || a.status === "under_review" || a.status === "approved");
                        return eligible.length > 0 && eligible.every(a => selectedIds.has(a.id));
                      })()}
                      onChange={(e) => {
                        const eligible = filtered.filter(a => a.status === "submitted" || a.status === "under_review" || a.status === "approved");
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) eligible.forEach(a => next.add(a.id));
                          else eligible.forEach(a => next.delete(a.id));
                          return next;
                        });
                      }}
                    />
                  </th>
                )}
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[140px]">App ID</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground max-w-[160px]">Name</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Course</th>
                {/* Form-fill progress is meaningless on the Submitted tab — every
                    row is 7/7 by definition — so we drop the column there. */}
                {statusFilter !== "submitted" && (
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Form</th>
                )}
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground min-w-[420px]" title="Submission → Fee → Docs → Approved → Offer → Token → Admitted">Lifecycle</th>
                {!isCounsellor && <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>}
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(app => {
                const isExpanded = expandedId === app.id;
                const courses = (app.course_selections || []).map((c: any) => c.course_name).join(", ");
                const cc = completedCount(app.completed_sections);
                const tc = totalCount(app.completed_sections);
                const progressPct = tc > 0 ? Math.round((cc / tc) * 100) : 0;

                const courseList = app.course_selections || [];
                const cs = app.completed_sections || {};
                // Columns: chevron + (checkbox if !counsellor) + appId + name + phone + course
                // + (form if !submitted-tab) + lifecycle + (counsellor if !counsellor) + date + actions.
                // Adjust expandColSpan when the Form column is hidden on the Submitted tab.
                const formColShown = statusFilter !== "submitted";
                const expandColSpan = (isCounsellor ? 9 : 11) - (formColShown ? 0 : 1);

                return (
                  <Fragment key={app.id}>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpandedId(isExpanded ? null : app.id)} className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                    {!isCounsellor && (
                      <td className="px-2 py-2.5">
                        {(app.status === "submitted" || app.status === "under_review" || app.status === "approved") ? (
                          <input
                            type="checkbox"
                            className="cursor-pointer accent-primary"
                            checked={selectedIds.has(app.id)}
                            onChange={(e) => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(app.id);
                                else next.delete(app.id);
                                return next;
                              });
                            }}
                          />
                        ) : null}
                      </td>
                    )}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-mono text-xs text-primary">{app.application_id}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[160px]">
                      <span className={`font-medium block truncate ${app.full_name === "Applicant" ? "text-muted-foreground italic" : "text-foreground"}`} title={app.full_name || ""}>
                        {app.full_name || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{app.phone}</td>
                    <td className="px-3 py-2.5 text-xs text-foreground max-w-[200px] truncate">{courses || "—"}</td>
                    {/* Form-fill progress (sections completed in apply portal) — hidden on Submitted tab. */}
                    {statusFilter !== "submitted" && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${progressPct === 100 ? "bg-emerald-500" : progressPct > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                              style={{ width: `${progressPct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{cc}/{tc}</span>
                        </div>
                      </td>
                    )}
                    {/* Lifecycle stepper — labeled variant so each stage is readable at a glance. */}
                    <td className="px-3 py-2.5">
                      <MiniLifecycleStepper
                        showLabels
                        app={{ status: app.status, payment_status: app.payment_status }}
                        lead={app.lead_id ? {
                          id: app.lead_id,
                          pre_admission_no: app.lead_pre_admission_no,
                          admission_no: app.lead_admission_no,
                        } : null}
                        hasLead={!!app.lead_id}
                        appFeePaid={app.app_fee_paid}
                        hasOffer={app.has_offer}
                        docs={app.doc_counts}
                        panDue={app.pan_due}
                        anDue={app.an_due}
                      />
                    </td>
                    {!isCounsellor && <td className="px-3 py-2.5 text-xs text-muted-foreground">{app.counsellor_name || "—"}</td>}
                    <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                      {new Date(app.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="inline-flex items-center gap-2">
                        {/* Single "View" CTA — opens AdminApplicationView, which is the
                            unified surface for the application PDF, fee receipt,
                            uploaded documents, lifecycle, and admin actions
                            (approve / reject, issue offer letter, etc.).
                            Replaces the previous icon-cluster of separate
                            doc / receipt / open-lead links. */}
                        <a
                          href={`/applications/${app.application_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 whitespace-nowrap"
                          title="View application — PDF, receipt, uploaded documents, and admin actions"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </a>

                        {/* Send a one-click login link to the apply portal so the
                            student can resume / complete their application or pay
                            the token fee. */}
                        {app.lead_id && (
                          <ApplyMagicLinkButton
                            leadId={app.lead_id}
                            leadName={app.full_name}
                            leadPhone={app.phone}
                          />
                        )}

                        {/* Nudge button — surfaces only when the candidate has
                            an offer letter and still owes money before getting
                            AN. Opens a dialog that pre-fills a WhatsApp message
                            with the AN balance + full Sem 1 balance + due date. */}
                        {app.lead_id && app.has_offer && !app.lead_admission_no
                          && (((app.an_due ?? 0) > 0) || ((app.year1_due ?? 0) > 0)) && (
                          <button
                            onClick={() => setNudgeTarget(app)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                            title="Nudge candidate over WhatsApp to confirm admission"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Nudge
                          </button>
                        )}
                        {role === "super_admin" && app.payment_status !== "paid" && (
                          <button
                            onClick={() => setDeleteTarget(app)}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                            title="Delete application"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded details — rendered inline below the clicked row */}
                  {isExpanded && (
                    <tr className="border-b border-border/40">
                      <td colSpan={expandColSpan} className="p-0 bg-primary/5">
                        <div className="border-l-4 border-primary/30 p-5 animate-fade-in">
                          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-foreground">{app.application_id} — {app.full_name}</h3>
                            <div className="flex items-center gap-2">
                              {app.form_pdf_url ? (
                                <>
                                  <a href={app.form_pdf_url} target="_blank" rel="noopener"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
                                    <FileText className="h-3.5 w-3.5" /> Open Form PDF
                                  </a>
                                  <button onClick={() => generateFormPdf(app)} disabled={generatingPdfFor === app.id}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                                    title="Regenerate Application Form PDF">
                                    {generatingPdfFor === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                    Regenerate
                                  </button>
                                </>
                              ) : (app.status === "submitted" || app.status === "under_review" || app.status === "approved") && (
                                <button onClick={() => generateFormPdf(app)} disabled={generatingPdfFor === app.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                  {generatingPdfFor === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                  Generate Form PDF
                                </button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                            {/* Personal Details */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personal Details</p>
                              <div className="space-y-1">
                                <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{app.full_name}</span></p>
                                <p><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{app.phone}</span></p>
                                <p><span className="text-muted-foreground">Email:</span> <span className="font-medium">{app.email || "—"}</span></p>
                                <p><span className="text-muted-foreground">DOB:</span> <span className="font-medium">{app.dob || "—"}</span></p>
                                <p><span className="text-muted-foreground">Gender:</span> <span className="font-medium capitalize">{app.gender || "—"}</span></p>
                                <p><span className="text-muted-foreground">Category:</span> <span className="font-medium">{app.category || "—"}</span></p>
                                {app.address?.city && <p><span className="text-muted-foreground">City:</span> <span className="font-medium">{app.address.city}, {app.address.state}</span></p>}
                              </div>
                            </div>

                            {/* Course & Payment */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Course Selections</p>
                              <div className="space-y-1.5">
                                {courseList.map((c: any, i: number) => (
                                  <div key={i} className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{i + 1}</span>
                                    <span className="font-medium">{c.course_name}</span>
                                    {c.campus_name && <span className="text-muted-foreground">· {c.campus_name}</span>}
                                  </div>
                                ))}
                                {courseList.length === 0 && <p className="text-muted-foreground">No courses selected</p>}
                              </div>

                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Payment</p>
                              <div className="space-y-1">
                                <p><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] border-0 ml-1 ${PAYMENT_BADGE[app.payment_status || "pending"]}`}>{app.payment_status || "pending"}</Badge></p>
                                {app.fee_amount && <p><span className="text-muted-foreground">Amount:</span> <span className="font-medium">₹{app.fee_amount.toLocaleString("en-IN")}</span></p>}
                                {app.payment_ref && <p><span className="text-muted-foreground">Ref:</span> <span className="font-mono text-[10px]">{app.payment_ref}</span></p>}
                                {isSuperAdmin && app.payment_status !== "paid" && app.lead_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => setOfflinePaymentApp(app)}
                                  >
                                    <CreditCard className="h-3 w-3 mr-1" />Mark Offline Payment
                                  </Button>
                                )}
                                {isSuperAdmin && app.lead_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 ml-2 h-7 text-xs"
                                    onClick={() => setOfflineReceiptApp(app)}
                                  >
                                    <Receipt className="h-3 w-3 mr-1" />Record Offline Receipt
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Section Progress */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Section Progress</p>
                              <div className="space-y-1.5">
                                {Object.entries(cs).map(([key, done]) => (
                                  <div key={key} className="flex items-center gap-2">
                                    {done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                                    <span className={`capitalize ${done ? "text-foreground" : "text-muted-foreground"}`}>{key.replace(/_/g, " ")}</span>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-4 flex gap-2">
                                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => fetchDocs(app.id, app.application_id)}>
                                  <Upload className="h-3 w-3 mr-1" />Documents
                                </Button>
                                {app.lead_id && (
                                  <a href={`/admissions/${app.lead_id}`} target="_blank" rel="noreferrer">
                                    <Button size="sm" variant="outline" className="text-xs h-7">
                                      <ExternalLink className="h-3 w-3 mr-1" />Lead Page
                                    </Button>
                                  </a>
                                )}
                              </div>

                              {app.flags?.length ? (
                                <div className="mt-3 flex flex-wrap gap-1">
                                  {app.flags.filter(f => !(f === "payment_pending" && app.payment_status === "paid")).map((f, i) => (
                                    <Badge key={i} className="text-[9px] border-0 bg-gray-100 text-gray-600">{f}</Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={isCounsellor ? 11 : 13} className="px-4 py-12 text-center text-muted-foreground">No applications found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Documents Dialog */}
      <Dialog open={!!docsDialog} onOpenChange={() => setDocsDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Documents — {docsDialog?.applicationId}
            </DialogTitle>
          </DialogHeader>
          {docsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No documents uploaded</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {docs.map((doc, i) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(doc.name);
                const isPdf = /\.pdf$/i.test(doc.name);
                const label = doc.name.split("-").slice(0, -1).join("-").replace(/_/g, " ") || doc.name;

                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {isImage ? (
                        <img src={doc.url} alt={doc.name} className="w-10 h-10 rounded object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize truncate">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{isPdf ? "PDF" : isImage ? "Image" : "File"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={doc.url} target="_blank" rel="noreferrer"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="View">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={doc.url} download
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {offlinePaymentApp?.lead_id && (
        <RecordPaymentDialog
          open={!!offlinePaymentApp}
          onOpenChange={(o) => { if (!o) setOfflinePaymentApp(null); }}
          leadId={offlinePaymentApp.lead_id}
          leadName={offlinePaymentApp.full_name}
          defaultType="application_fee"
          title="Record Offline Payment"
          onSuccess={handleOfflinePaymentSuccess}
        />
      )}

      {offlineReceiptApp?.lead_id && (
        <OfflinePaymentDialog
          open={!!offlineReceiptApp}
          onOpenChange={(o) => { if (!o) setOfflineReceiptApp(null); }}
          leadId={offlineReceiptApp.lead_id}
          onRecorded={() => setOfflineReceiptApp(null)}
        />
      )}

      <NudgePaymentDialog
        open={!!nudgeTarget}
        onClose={() => setNudgeTarget(null)}
        candidate={nudgeTarget ? {
          lead_id: nudgeTarget.lead_id || "",
          full_name: nudgeTarget.full_name,
          phone: nudgeTarget.phone,
          course_name: (nudgeTarget.course_selections || [])
            .map((c: any) => c.course_name).filter(Boolean).join(", ") || null,
          an_due: nudgeTarget.an_due ?? null,
          year1_due: nudgeTarget.year1_due ?? null,
        } : null}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{deleteTarget?.application_id}</span> ({deleteTarget?.full_name}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
