import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Gift, CheckCircle, XCircle, ShieldCheck, RefreshCw, ExternalLink, Pencil, Coins, Trash2, AlertCircle } from "lucide-react";
import { CahetRegistrationDetails } from "@/components/leads/CahetRegistrationDetails";
import { UpdeledRegistrationDetails } from "@/components/leads/UpdeledRegistrationDetails";
import {
  cahetRegistrationFromApplication,
  fetchCahetRegistration,
  isBptOrBmritCourseName,
  type ApplicationCahetSource,
  type CahetRegistrationDetails as CahetRegistrationDetailsType,
} from "@/lib/cahet";
import {
  fetchUpdeledRegistration,
  isDeledCourseName,
  isUpdeledExamName,
  updeledRegistrationFromApplication,
  type ApplicationUpdeledSource,
  type SupabaseUpdeledClient,
  type UpdeledRegistrationDetails as UpdeledRegistrationDetailsType,
} from "@/lib/updeled";
import { chooseOfferSessionId, feeBackedSessionIds, pickOfferFeeStructure, type OfferSessionOption } from "@/lib/offerSessions";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";
import { feeTermLabel } from "@/lib/feeTermLabels";
import {
  buildOfferWaiversFromFeeProposalChild,
  feeProposalChildKey,
  feeProposalChildLabel,
  proposalFeeSnapshotDiff,
  type FeeProposalChildLike,
} from "@/lib/feeProposalOfferMapping";
import { collectOfferFeeTermTotals, firstOfferFeeTerm, hasSchoolFeeOptions, SECURITY_DEPOSIT_TERM, type OfferFeeItemLike, type SchoolFeeSelection, type SchoolStudentType, type SchoolHostelType, type SchoolTransportZone } from "@/lib/offerFeeTerms";
import { AbvmuDepositPanel } from "@/components/finance/AbvmuDepositPanel";

interface OfferLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  applicationId?: string | null;
  academicPartnerId?: string | null;
  courseId: string | null;
  courseName?: string | null;
  campusId: string | null;
  cahetRegistration?: CahetRegistrationDetailsType | null;
  updeledRegistration?: UpdeledRegistrationDetailsType | null;
  onSuccess: () => void;
}

interface OfferLetter {
  id: string;
  course_id?: string | null;
  campus_id?: string | null;
  total_fee: number;
  scholarship_amount: number | null;
  net_fee: number;
  status: string;
  approval_status?: string;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  acceptance_deadline: string | null;
  accepted_at: string | null;
  created_at: string;
  session_id?: string | null;
  letter_url?: string | null;
  loan_letter_url?: string | null;
  token_fee_amount?: number | null;
  token_fee_user_edited?: boolean | null;
  admission_mode?: "direct" | "entrance" | null;
  entrance_exam_name?: string | null;
  source_fee_proposal_id?: string | null;
  source_fee_proposal_child_key?: string | null;
}

type SessionOption = OfferSessionOption;

interface CourseOption {
  id: string;
  name: string;
  code: string | null;
}

type FeeStructurePolicy = {
  token_required_amount?: number | string | null;
};

type OfferFeeStructureRow = {
  version?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  policy?: FeeStructurePolicy | null;
  fee_structure_items?: { term: string; amount: number | string | null; fee_codes?: { code?: string | null; category?: string | null } | null }[] | null;
};

interface OfferWaiver {
  id: string;
  offer_letter_id: string;
  term: string;
  amount: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by_name: string | null;
  requested_by_role: string | null;
  approved_by_name: string | null;
  rejection_reason: string | null;
  created_at: string;
  source_type?: "manual" | "fee_proposal" | null;
  source_fee_proposal_id?: string | null;
  source_fee_proposal_child_key?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ApprovedFeeProposal {
  id: string;
  lead_id: string | null;
  linked_lead_ids?: string[] | null;
  status: string;
  proposal: {
    children?: FeeProposalChildLike[];
    full_year_payment?: {
      extra_waiver_amount?: number | string | null;
    } | null;
  } | null;
  annual_total?: number | string | null;
  payable_at_admission?: number | string | null;
  revision_number?: number | null;
  is_current?: boolean | null;
  created_at?: string | null;
}

interface OfferLetterEditRequest {
  id: string;
  offer_letter_id: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  proposed_changes: { acceptance_deadline?: string; course_id?: string; token_fee_amount?: number };
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

const ENTRANCE_OPTIONS = [
  "CAHET",
  "CAT",
  "MAT",
  "XAT",
  "CMAT",
  "CUET",
  "CLAT",
  "LSAT",
  "NEET",
  "JEECUP",
  "UP B.Ed Joint Entrance Exam (JEEB.Ed)",
  "UP D.El.Ed Counselling",
  "PTET Entrance Exam",
  "NIMT Admission Test (NAT)",
  "Other",
];

function parseTokenFeeFromEditReason(reason: string | null | undefined): number | null {
  if (!reason || !/\btoken\b/i.test(reason)) return null;
  const match = reason.match(/(?:rs\.?|₹|inr)?\s*([0-9][0-9,\s]{2,})/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function OfferLetterDialog({ open, onOpenChange, leadId, leadName, applicationId, academicPartnerId, courseId, courseName, campusId, cahetRegistration: cahetRegistrationProp, updeledRegistration: updeledRegistrationProp, onSuccess }: OfferLetterDialogProps) {
  const { user, role, realRole, isImpersonating } = useAuth();
  const { toast } = useToast();
  const [offers, setOffers] = useState<OfferLetter[]>([]);
  const isApprover = role === "super_admin" || role === "principal";
  const isPrincipalOrAbove = isApprover;
  const isSuperAdmin = role === "super_admin";
  const isAcademicPartnerOfferIssuer = role === "academic_partner_offer_letter";
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Note: scholarship is no longer collected here — discounts are applied as
  // waivers after the offer is issued. Total fee is also no longer typed by
  // the user — it comes directly from the published fee_structure for the
  // selected course + session.
  const [form, setForm] = useState({
    acceptance_deadline: "",
    session_id: "",
    token_fee_amount: "",
    admission_mode: "direct" as "direct" | "entrance",
    entrance_exam_name: "",
    entrance_exam_other: "",
  });
  const [tokenFeeEdited, setTokenFeeEdited] = useState(false);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  // Raw fee-structure items + metadata for the picked course+session. yearTotals,
  // firstYearFee and availableTerms (below) are DERIVED from these plus the chosen
  // school mode, so changing the mode recomputes the programme fee without a re-query.
  const [rawFeeItems, setRawFeeItems] = useState<OfferFeeItemLike[]>([]);
  const [feeMetadata, setFeeMetadata] = useState<Record<string, unknown> | null>(null);
  const [feePolicy, setFeePolicy] = useState<Record<string, unknown> | null>(null);
  // School fee mode (day scholar / day boarder / boarder + tier + transport zone).
  // Only meaningful for school structures that expose boarding/transport options;
  // day_scholar with no transport = base fee. Prefilled from the applicant's
  // declared choice; staff can override before issuing.
  const [schoolSelection, setSchoolSelection] = useState<SchoolFeeSelection>({ studentType: "day_scholar", hostelType: null, transportZone: null });
  const [schoolModePrefilled, setSchoolModePrefilled] = useState(false);
  // offer_id → waivers list, fetched alongside offers.
  const [waiversByOffer, setWaiversByOffer] = useState<Record<string, OfferWaiver[]>>({});
  // Which offer's add-waiver inline form is currently visible.
  const [addingWaiverFor, setAddingWaiverFor] = useState<string | null>(null);
  const [waiverForm, setWaiverForm] = useState<{ term: string; amount: string; reason: string }>({
    term: "year_1", amount: "", reason: "",
  });
  const [waiverSaving, setWaiverSaving] = useState(false);
  const [waiverDecidingId, setWaiverDecidingId] = useState<string | null>(null);
  // Pre-issuance waivers — collected in the new-offer form and bulk-inserted
  // right after the offer row is created, so staff don't have to add them post-hoc.
  const [preWaivers, setPreWaivers] = useState<{ term: string; amount: number; reason: string }[]>([]);
  const [showPreWaiverForm, setShowPreWaiverForm] = useState(false);
  const [preWaiverForm, setPreWaiverForm] = useState<{ term: string; amount: string; reason: string }>({ term: "year_1", amount: "", reason: "" });
  const [approvedFeeProposals, setApprovedFeeProposals] = useState<ApprovedFeeProposal[]>([]);
  const [selectedFeeProposalId, setSelectedFeeProposalId] = useState("");
  const [selectedProposalChildKey, setSelectedProposalChildKey] = useState("");
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  // Edit requests
  const [editRequestsByOffer, setEditRequestsByOffer] = useState<Record<string, OfferLetterEditRequest[]>>({});
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ acceptance_deadline: "", course_id: "", token_fee_amount: "", reason: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editDecidingId, setEditDecidingId] = useState<string | null>(null);
  // Which offer's PDF is showing in the right-hand preview pane.
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  // Tracks an in-flight generate-offer-letter call so the preview pane can
  // show a spinner instead of an empty placeholder while waiting.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Bumped after every regenerate so the iframe url changes (?v=<n>) and the
  // browser actually fetches the new bytes — the storage path is reused on
  // upsert, so without this the cached PDF stays on screen.
  const [pdfBust, setPdfBust] = useState<number>(() => Date.now());
  const [fetchedCahetRegistration, setFetchedCahetRegistration] = useState<CahetRegistrationDetailsType | null>(null);
  const cahetRegistration = cahetRegistrationProp ?? fetchedCahetRegistration;
  const [fetchedUpdeledRegistration, setFetchedUpdeledRegistration] = useState<UpdeledRegistrationDetailsType | null>(null);
  const updeledRegistration = updeledRegistrationProp ?? fetchedUpdeledRegistration;
  const requiresCahetRegistration = isBptOrBmritCourseName(courseName);
  const requiresUpdeledRegistration = isDeledCourseName(courseName);
  const cahetOfferBlocked = requiresCahetRegistration && !cahetRegistration;
  const updeledOfferBlocked = requiresUpdeledRegistration && !updeledRegistration;
  const registrationOfferBlocked = cahetOfferBlocked || updeledOfferBlocked;
  const cahetOfferBlockMessage = "CAHET registration details are required before issuing an offer letter for BPT and BMRIT.";
  const updeledOfferBlockMessage = "UPDELED registration details are required before issuing an offer letter for D.El.Ed.";
  const registrationOfferBlockMessage = cahetOfferBlocked ? cahetOfferBlockMessage : updeledOfferBlockMessage;

  const fetchOffers = async () => {
    setLoading(true);
    const { data } = await supabase.from("offer_letters").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
    if (data) {
      setOffers(data);
      // Auto-select most recent offer with a letter, falling back to most
      // recent overall, so the preview pane is never empty when offers exist.
      setSelectedOfferId(prev => {
        if (prev && data.some(o => o.id === prev)) return prev;
        const withPdf = data.find(o => !!o.letter_url);
        return withPdf?.id || data[0]?.id || null;
      });

      // Pull all waivers for these offers in one round-trip, then group by offer.
      const offerIds = data.map(o => o.id);
      if (offerIds.length > 0) {
        const { data: waiverRows } = await supabase
          .from("offer_waivers")
          .select("id, offer_letter_id, term, amount, reason, status, requested_by_name, requested_by_role, approved_by_name, rejection_reason, created_at, source_type, source_fee_proposal_id, source_fee_proposal_child_key, metadata")
          .in("offer_letter_id", offerIds)
          .order("created_at", { ascending: true });
        const grouped: Record<string, OfferWaiver[]> = {};
        for (const w of (waiverRows || []) as OfferWaiver[]) {
          (grouped[w.offer_letter_id] ||= []).push(w);
        }
        setWaiversByOffer(grouped);
      } else {
        setWaiversByOffer({});
      }

      // Fetch pending edit requests for all offers
      if (offerIds.length > 0) {
        const { data: editRows } = await supabase
          .from("offer_letter_edit_requests" as any)
          .select("id, offer_letter_id, requested_by_name, requested_by_role, proposed_changes, reason, status, reviewed_at, rejection_reason, created_at")
          .in("offer_letter_id", offerIds)
          .eq("status", "pending")
          .order("created_at", { ascending: false });
        const grouped: Record<string, OfferLetterEditRequest[]> = {};
        for (const r of (editRows || []) as OfferLetterEditRequest[]) {
          (grouped[r.offer_letter_id] ||= []).push(r);
        }
        setEditRequestsByOffer(grouped);
      } else {
        setEditRequestsByOffer({});
      }
    }
    setLoading(false);
  };

  // Trigger PDF regeneration. The edge function is fully synchronous — it
  // generates, uploads, and updates letter_url before returning — so we just
  // await the invoke, refresh state, and bump the cache-bust token.
  const regeneratePdf = async (offerId: string) => {
    setRegeneratingId(offerId);
    try {
      const { error } = await supabase.functions.invoke("generate-offer-letter", {
        body: { offer_letter_id: offerId, application_id: applicationId || undefined },
      });
      if (error) {
        toast({ title: "Couldn't generate PDF", description: error.message, variant: "destructive" });
        return;
      }
      await fetchOffers();
      // Bump so the ?cb= param on the iframe src changes, forcing the browser
      // to fetch the newly uploaded bytes rather than returning a 304.
      setPdfBust(Date.now());
      toast({ title: "PDF ready" });
    } catch (e: any) {
      // A transport-level failure (e.g. "TypeError: Failed to fetch") throws
      // instead of returning { error }. Degrade gracefully — the offer is
      // already persisted and the PDF can be regenerated — never propagate,
      // so an awaiting caller (handleCreate) still completes its success path.
      toast({ title: "Couldn't generate PDF", description: e?.message || "Network error — try Regenerate.", variant: "destructive" });
    } finally {
      setRegeneratingId(null);
    }
  };

  useEffect(() => { if (open) fetchOffers(); }, [open]);

  useEffect(() => {
    if (!open || !leadId) return;
    let cancelled = false;
    (async () => {
      const selectCols = "id, lead_id, linked_lead_ids, status, proposal, annual_total, payable_at_admission, revision_number, is_current, created_at";
      const [primary, linked] = await Promise.all([
        supabase
          .from("fee_proposals" as any)
          .select(selectCols)
          .eq("lead_id", leadId)
          .eq("status", "approved")
          .eq("is_current", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("fee_proposals" as any)
          .select(selectCols)
          .contains("linked_lead_ids", [leadId])
          .eq("status", "approved")
          .eq("is_current", true)
          .order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;
      const byId = new Map<string, ApprovedFeeProposal>();
      for (const row of ([...(primary.data || []), ...(linked.data || [])] as ApprovedFeeProposal[])) {
        if (!row?.id) continue;
        byId.set(row.id, row);
      }
      setApprovedFeeProposals(Array.from(byId.values()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))));
    })().catch(() => {
      if (!cancelled) setApprovedFeeProposals([]);
    });
    return () => { cancelled = true; };
  }, [open, leadId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, name, code")
        .order("name", { ascending: true });
      if (cancelled) return;
      setCourseOptions(((data || []) as any[]).map((course) => ({
        id: course.id,
        name: course.name,
        code: course.code ?? null,
      })));
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || cahetRegistrationProp !== undefined) return;
    let cancelled = false;
    (async () => {
      const row = await fetchCahetRegistration(supabase, leadId);
      if (row) {
        if (!cancelled) setFetchedCahetRegistration(row);
        return;
      }

      const { data: appRow } = await supabase
        .from("applications")
        .select("id, application_id, lead_id, academic_details")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setFetchedCahetRegistration(cahetRegistrationFromApplication(appRow as ApplicationCahetSource | null, leadId));
    })();
    return () => { cancelled = true; };
  }, [open, leadId, cahetRegistrationProp]);

  useEffect(() => {
    if (!open || updeledRegistrationProp !== undefined) return;
    let cancelled = false;
    (async () => {
      const row = await fetchUpdeledRegistration(supabase as unknown as SupabaseUpdeledClient, leadId);
      if (row) {
        if (!cancelled) setFetchedUpdeledRegistration(row);
        return;
      }

      const { data: appRow } = await supabase
        .from("applications")
        .select("id, application_id, lead_id, academic_details")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setFetchedUpdeledRegistration(updeledRegistrationFromApplication(appRow as ApplicationUpdeledSource | null, leadId));
    })();
    return () => { cancelled = true; };
  }, [open, leadId, updeledRegistrationProp]);

  // Re-arm the prefill when the dialog closes so reopening for another lead
  // picks up that applicant's declared mode.
  useEffect(() => {
    if (!open) {
      setSchoolModePrefilled(false);
      setSchoolSelection({ studentType: "day_scholar", hostelType: null, transportZone: null });
    }
  }, [open]);

  // Prefill the school mode from what the applicant declared on the application
  // (school_details.{student_type,hostel_type,transport_zone}). Staff can override.
  useEffect(() => {
    if (!open || !leadId || schoolModePrefilled) return;
    let cancelled = false;
    (async () => {
      const { data: appRow } = await supabase
        .from("applications")
        .select("school_details")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const sd = ((appRow as { school_details?: Record<string, unknown> } | null)?.school_details ?? {}) as Record<string, unknown>;
      const studentType = (["day_scholar", "day_boarder", "boarder"] as const).find(v => v === sd.student_type) || null;
      const hostelType = (["non_ac", "ac_central", "ac_individual"] as const).find(v => v === sd.hostel_type) || null;
      const transportZone = (["zone_1", "zone_2", "zone_3"] as const).find(v => v === sd.transport_zone) || null;
      if (studentType || hostelType || transportZone) {
        setSchoolSelection({
          studentType: studentType || "day_scholar",
          hostelType: studentType === "boarder" ? hostelType : null,
          transportZone,
        });
      }
      setSchoolModePrefilled(true);
    })().catch(() => { if (!cancelled) setSchoolModePrefilled(true); });
    return () => { cancelled = true; };
  }, [open, leadId, schoolModePrefilled]);

  // Pull sessions whenever the form opens so the select has data. Prefer a
  // session that actually has active year-wise fees for this course; multiple
  // sessions can be active, and principals cannot change this dropdown.
  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    (async () => {
      const [{ data: sessionRows }, { data: feeRows }] = await Promise.all([
        supabase.from("admission_sessions").select("id, name, is_active").order("name", { ascending: false }),
        courseId
          ? supabase
              .from("fee_structures")
              .select("session_id, fee_structure_items ( term, amount )")
              .eq("course_id", courseId)
              .eq("is_active", true)
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;

      const feeSessionIds = new Set(feeBackedSessionIds((feeRows || []) as any[]));
      const list = ((sessionRows ?? []) as SessionOption[]).map((session) => ({
        ...session,
        has_fee_structure: !courseId || feeSessionIds.has(session.id),
      }));

      setSessions(list);
      setForm((previous) => ({
        ...previous,
        session_id: chooseOfferSessionId(list, previous.session_id),
      }));
    })();
    return () => { cancelled = true; };
  }, [showForm, courseId]);

  // Resolve the first offer-fee period + the list of available waiver terms for the
  // picked course+session pair. firstYearFee drives token-fee defaults;
  // availableTerms drives the year picker in the Add-Waiver form.
  useEffect(() => {
    if (!courseId) { setRawFeeItems([]); setFeeMetadata(null); setFeePolicy(null); return; }
    // For waiver picker, use the offer's session if any are loaded; otherwise
    // fall back to form.session_id (when the new-offer form is open).
    const sessionId = form.session_id || (offers.find(o => !!o.session_id)?.session_id || "");
    if (!sessionId) { setRawFeeItems([]); setFeeMetadata(null); setFeePolicy(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("fee_structures")
        .select("id, version, created_at, metadata, policy, fee_structure_items ( term, amount, fee_codes:fee_code_id ( code, category ) )")
        .eq("course_id", courseId)
        .eq("session_id", sessionId)
        .eq("is_active", true);
      if (cancelled) return;
      const feeStructure = pickOfferFeeStructure((data || []) as OfferFeeStructureRow[]);
      setRawFeeItems((feeStructure?.fee_structure_items ?? []) as OfferFeeItemLike[]);
      setFeeMetadata(feeStructure?.metadata ?? null);
      setFeePolicy(feeStructure?.policy ?? null);
    })().catch(() => { setRawFeeItems([]); setFeeMetadata(null); setFeePolicy(null); });
    return () => { cancelled = true; };
  }, [courseId, form.session_id, offers]);

  // Whether the picked structure exposes school boarding/transport add-on options.
  const hasSchoolOptions = useMemo(() => hasSchoolFeeOptions(rawFeeItems), [rawFeeItems]);

  // Per-period totals, derived from the raw items + the chosen school mode. For
  // non-school structures the selection is ignored (no hostel/transport items).
  const yearTotals = useMemo(() => {
    const totals = collectOfferFeeTermTotals(rawFeeItems, hasSchoolOptions ? schoolSelection : undefined);
    return totals.map(({ term, total }) => ({ term, total, label: feeTermLabel(term, feeMetadata) }));
  }, [rawFeeItems, hasSchoolOptions, schoolSelection, feeMetadata]);

  // Term keys present (drives the Add-Waiver year picker). Includes the synthetic
  // security-deposit line so the refundable boarding deposit can be waived too;
  // waivers keyed on 'security_deposit' render on the deposit line and are netted
  // by the offer's net_fee. The fee engine excludes the deposit from the 25% base,
  // so a deposit waiver does not change the AN threshold.
  const availableTerms = useMemo(() => {
    const terms = yearTotals.map(s => s.term);
    return terms.length ? terms : ["year_1"];
  }, [yearTotals]);

  // First payable programme-fee period, used to default the token fee. Skip the
  // refundable deposit so the token defaults off the admission fee.
  const firstYearFee = useMemo(() => {
    const payable = yearTotals.filter((item) => item.term !== SECURITY_DEPOSIT_TERM);
    const firstTerm = firstOfferFeeTerm(payable);
    return payable.find((item) => item.term === firstTerm)?.total || 0;
  }, [yearTotals]);

  // Programme total = sum of the mode-adjusted period totals from the published
  // fee structure. Canonical source of truth for the offer's "total fee".
  const programmeTotal = yearTotals.reduce((sum, y) => sum + y.total, 0);
  const preWaiverTotal = preWaivers.reduce((sum, waiver) => sum + Number(waiver.amount || 0), 0);
  const selectedSessionName = sessions.find(s => s.id === form.session_id)?.name || null;
  const selectedFeeProposal = approvedFeeProposals.find(p => p.id === selectedFeeProposalId) || null;
  const proposalChildOptions = useMemo(() => {
    if (!selectedFeeProposal) return [];
    return (selectedFeeProposal.proposal?.children || [])
      .map((child, index) => ({
        child,
        index,
        key: feeProposalChildKey(child, index),
        label: feeProposalChildLabel(child, `Student ${index + 1}`),
      }))
      .filter(({ child }) => {
        const leadMatches = !child.lead_id || child.lead_id === leadId;
        const courseMatches = !courseId || !child.course_id || child.course_id === courseId;
        return leadMatches && courseMatches;
      });
  }, [selectedFeeProposal, leadId, courseId]);
  const selectedProposalChildOption =
    proposalChildOptions.find(option => option.key === selectedProposalChildKey) ||
    (proposalChildOptions.length === 1 ? proposalChildOptions[0] : null);
  const importedProposalWaivers = selectedFeeProposal && selectedProposalChildOption
    ? buildOfferWaiversFromFeeProposalChild({
        proposalId: selectedFeeProposal.id,
        revisionNumber: selectedFeeProposal.revision_number,
        childKey: selectedProposalChildOption.key,
        child: selectedProposalChildOption.child,
      })
    : [];
  const importedProposalWaiverTotal = importedProposalWaivers.reduce((sum, waiver) => sum + waiver.amount, 0);
  const proposalMismatch = selectedProposalChildOption
    ? proposalFeeSnapshotDiff(selectedProposalChildOption.child, programmeTotal)
    : null;
  const proposalLevelFullYearWaiver = Number(selectedFeeProposal?.proposal?.full_year_payment?.extra_waiver_amount || 0);
  const previewWaiverTotal = preWaiverTotal + importedProposalWaiverTotal;
  const previewNetFee = Math.max(0, programmeTotal - previewWaiverTotal);
  const schoolModeLabel = (() => {
    const st = schoolSelection.studentType || "day_scholar";
    const base = st === "boarder" ? "Boarder" : st === "day_boarder" ? "Day Boarding" : "Day Scholar";
    const boarding = st === "boarder"
      ? ({ non_ac: " · Non-AC", ac_central: " · AC (C Block)", ac_individual: " · AC (B Block)" }[schoolSelection.hostelType || ""] || "")
      : "";
    const transport = ({ zone_1: " · Transport ≤5km", zone_2: " · Transport 5–10km", zone_3: " · Transport >10km" }[schoolSelection.transportZone || ""] || "");
    return `${base}${boarding}${transport}`;
  })();
  const selectedEntranceName = form.entrance_exam_name === "Other"
    ? form.entrance_exam_other.trim()
    : form.entrance_exam_name.trim();
  const isCahetOffer = form.admission_mode === "entrance" && selectedEntranceName.toLowerCase().includes("cahet");
  const isUpdeledOffer = form.admission_mode === "entrance" && isUpdeledExamName(selectedEntranceName);

  /** Fee for a given term (e.g. 'year_1') from the active fee structure. */
  const feeForTerm = (term: string): number =>
    yearTotals.find(y => y.term === term)?.total ?? 0;

  const labelForTerm = (term: string): string =>
    yearTotals.find(y => y.term === term)?.label ?? feeTermLabel(term);
  const firstOfferTerm = firstOfferFeeTerm(yearTotals);
  const firstTermLabel = labelForTerm(firstOfferTerm);

  /** Sum of pre-issuance waivers already queued for the same term in the new-offer form. */
  const preWaiverTotalForTerm = (term: string): number =>
    preWaivers.filter(w => w.term === term).reduce((s, w) => s + Number(w.amount || 0), 0);

  const importedProposalWaiverTotalForTerm = (term: string): number =>
    importedProposalWaivers.filter(w => w.term === term).reduce((s, w) => s + Number(w.amount || 0), 0);

  /** Sum of post-issuance waivers (approved + pending) on an offer for the same term. */
  const offerWaiverTotalForTerm = (offerId: string, term: string): number =>
    (waiversByOffer[offerId] || [])
      .filter(w => w.term === term && (w.status === "approved" || w.status === "pending"))
      .reduce((s, w) => s + Number(w.amount || 0), 0);

  const courseNameForId = (id: string | null | undefined) =>
    id ? (courseOptions.find(c => c.id === id)?.name || (id === courseId ? courseName : null) || "Selected course") : (courseName || "Course not set");

  const courseCodeForId = (id: string | null | undefined) =>
    id ? courseOptions.find(c => c.id === id)?.code || null : null;

  const fetchCourseFeeSnapshot = async (nextCourseId: string, sessionId: string) => {
    const { data, error } = await supabase
      .from("fee_structures")
      .select("id, version, created_at, policy, fee_structure_items ( term, amount, fee_codes:fee_code_id ( code, category ) )")
      .eq("course_id", nextCourseId)
      .eq("session_id", sessionId)
      .eq("is_active", true);
    if (error) throw error;

    const feeStructure = pickOfferFeeStructure((data || []) as OfferFeeStructureRow[]);
    const yearTotalsForCourse = collectOfferFeeTermTotals(feeStructure?.fee_structure_items || []);
    const firstTerm = firstOfferFeeTerm(yearTotalsForCourse);

    return {
      firstYearFee: yearTotalsForCourse.find((item) => item.term === firstTerm)?.total || 0,
      totalFee: yearTotalsForCourse.reduce((sum, year) => sum + year.total, 0),
      tokenRequiredAmount: Number(feeStructure?.policy?.token_required_amount || 0),
    };
  };

  // Net first-period fee = gross first-period fee minus any matching waivers
  // already staged in the pre-issuance waiver list. The loan-letter token fee
  // defaults to 25% of this net figure.
  const netFirstYearFee = Math.max(
    0,
    firstYearFee - preWaiverTotalForTerm(firstOfferTerm) - importedProposalWaiverTotalForTerm(firstOfferTerm),
  );

  // School structures bill by admission + quarters, so the seat-booking token
  // defaults to the first real payment: Admission + Q1 + Security deposit
  // (boarders only), net of any waivers staged on those lines. Non-school
  // (year_N) offers keep the 25%-of-net-Year-1 default. Either way the applicant
  // can lower it while issuing, down to a ₹5,000 floor (schools) or the
  // course-specific seat-block floor.
  const netForTerm = (term: string): number => {
    const gross = yearTotals.find((y) => y.term === term)?.total || 0;
    return Math.max(0, gross - preWaiverTotalForTerm(term) - importedProposalWaiverTotalForTerm(term));
  };
  const usesSchoolTerms = yearTotals.some((y) => y.term === "q1");
  const schoolTokenBase = usesSchoolTerms
    ? netForTerm("admission") + netForTerm("q1") + netForTerm(SECURITY_DEPOSIT_TERM)
    : 0;
  const policyTokenRequiredAmount = Number(feePolicy?.token_required_amount || 0);
  const tokenFloor = usesSchoolTerms ? 5000 : (policyTokenRequiredAmount || 5000);
  const tokenDefault = usesSchoolTerms
    ? Math.max(schoolTokenBase, tokenFloor)
    : policyTokenRequiredAmount > 0
    ? policyTokenRequiredAmount
    : netFirstYearFee > 0
    ? Math.max(Math.round(netFirstYearFee * 0.25), tokenFloor)
    : 0;

  // Whenever the net Year-1 fee changes (waiver added/removed), always
  // recalculate the token and clear edit mode — the basis has shifted so the
  // old value is meaningless. The user can re-click Edit to customise after.
  useEffect(() => {
    if (!showForm) return;
    if (tokenDefault <= 0) return;
    setTokenFeeEdited(false);
    setForm(p => ({ ...p, token_fee_amount: String(tokenDefault) }));
  }, [showForm, tokenDefault]);

  useEffect(() => {
    if (!selectedFeeProposalId) {
      if (selectedProposalChildKey) setSelectedProposalChildKey("");
      return;
    }
    if (proposalChildOptions.length === 1 && selectedProposalChildKey !== proposalChildOptions[0].key) {
      setSelectedProposalChildKey(proposalChildOptions[0].key);
    }
    if (proposalChildOptions.length > 1 && selectedProposalChildKey && !proposalChildOptions.some(option => option.key === selectedProposalChildKey)) {
      setSelectedProposalChildKey("");
    }
  }, [selectedFeeProposalId, selectedProposalChildKey, proposalChildOptions]);

  const handleCreate = async () => {
    // Total fee is auto-derived from the published fee structure — no user input.
    const totalFee = programmeTotal;
    if (!totalFee || totalFee <= 0) {
      toast({
        title: "No fee structure published",
        description: "The selected course + session doesn't have an active fee structure with programme fee items. Publish one in Course & Campus master before issuing offers.",
        variant: "destructive",
      });
      return;
    }

    if (!form.acceptance_deadline) {
      toast({ title: "Acceptance deadline required", description: "Set the date by which the candidate must accept this offer.", variant: "destructive" });
      return;
    }
    const entranceName = form.entrance_exam_name === "Other"
      ? form.entrance_exam_other.trim()
      : form.entrance_exam_name.trim();
    if (registrationOfferBlocked) {
      toast({
        title: cahetOfferBlocked ? "CAHET registration required" : "UPDELED registration required",
        description: registrationOfferBlockMessage,
        variant: "destructive",
      });
      return;
    }
    if (form.admission_mode === "entrance" && !entranceName) {
      toast({ title: "Entrance details required", description: "Select the entrance/counselling route or type it under Other.", variant: "destructive" });
      return;
    }
    if (hasSchoolOptions && schoolSelection.studentType === "boarder" && !schoolSelection.hostelType) {
      toast({ title: "Select boarding type", description: "Choose a boarding type so the offer fee includes it.", variant: "destructive" });
      return;
    }
    if (selectedFeeProposal && !selectedProposalChildOption) {
      toast({
        title: "Select proposal student",
        description: "This approved proposal has multiple or no matching students for the selected course. Choose the student to map before issuing.",
        variant: "destructive",
      });
      return;
    }

    // Validate token fee — fall back to the computed default when the user
    // hasn't typed anything explicitly.
    const tokenFeeNum = Number(form.token_fee_amount || tokenDefault || 0);
    if (!tokenFeeNum || tokenFeeNum <= 0) {
      toast({ title: "Token fee required", description: "Enter the token fee for this offer.", variant: "destructive" });
      return;
    }
    if (tokenFeeNum < tokenFloor) {
      toast({
        title: "Token fee below minimum",
        description: `Token fee cannot be lower than ₹${tokenFloor.toLocaleString("en-IN")}.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    // If super_admin, principal, or the scoped academic partner offer role issues
    // directly, the offer is auto-approved. Other staff still need principal approval.
    const autoApproved = isPrincipalOrAbove || isAcademicPartnerOfferIssuer;
    const approvalStatus = autoApproved ? "approved" : "pending_principal";

    if (!form.session_id) { toast({ title: "Pick an academic session", variant: "destructive" }); setSaving(false); return; }

    // Wrap the remaining network work so setSaving(false) always runs — any
    // awaited call below (inserts, PDF gen) can throw "Failed to fetch" and
    // must not strand the button in its spinning/saving state.
    try {

    // School mode to persist on the offer (drives the PDF fee). NULL for non-school
    // structures or plain day scholars = base fee.
    const persistSchoolMode = hasSchoolOptions
      ? {
          student_type: schoolSelection.studentType || "day_scholar",
          hostel_type: schoolSelection.studentType === "boarder" ? (schoolSelection.hostelType || null) : null,
          transport_zone: schoolSelection.transportZone || null,
        }
      : { student_type: null, hostel_type: null, transport_zone: null };

    let insertedOffer: { id: string } | null = null;
    let error: { message: string } | null = null;

    if (isAcademicPartnerOfferIssuer) {
      if (preWaivers.length > 0 || importedProposalWaivers.length > 0) {
        toast({
          title: "Waivers unavailable",
          description: "Academic partners can issue the base approved offer. Internal staff must apply waivers.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      const result = await supabase.rpc("academic_partner_issue_offer", {
        _application_id: applicationId || "",
        _acceptance_deadline: form.acceptance_deadline,
        _session_id: form.session_id,
        _total_fee: totalFee,
        _net_fee: totalFee,
        _token_fee_amount: tokenFeeNum,
        _token_fee_user_edited: tokenFeeEdited,
        _admission_mode: form.admission_mode,
        _entrance_exam_name: form.admission_mode === "entrance" ? entranceName : null,
        _partner_id: isImpersonating && realRole === "super_admin" ? academicPartnerId || null : null,
        _student_type: persistSchoolMode.student_type,
        _hostel_type: persistSchoolMode.hostel_type,
        _transport_zone: persistSchoolMode.transport_zone,
      } as any);
      error = result.error;
      const resultData = result.data as { offer_letter_id?: string } | null;
      insertedOffer = resultData?.offer_letter_id ? { id: resultData.offer_letter_id } : null;
    } else {
      const result = await supabase.from("offer_letters").insert({
        lead_id: leadId,
        total_fee: totalFee,
        // Scholarship is no longer collected at offer creation — apply
        // discounts via year-wise waivers (with super-admin approval). We
        // persist 0 so legacy code paths reading scholarship_amount get a
        // sensible value.
        scholarship_amount: 0,
        net_fee: totalFee,
        token_fee_amount: tokenFeeNum,
        token_fee_user_edited: tokenFeeEdited,
        admission_mode: form.admission_mode,
        entrance_exam_name: form.admission_mode === "entrance" ? entranceName : null,
        acceptance_deadline: form.acceptance_deadline || null,
        course_id: courseId,
        campus_id: campusId,
        session_id: form.session_id,
        issued_by: user?.id || null,
        approval_status: approvalStatus,
        approved_by: autoApproved ? user?.id || null : null,
        approved_at: autoApproved ? new Date().toISOString() : null,
        source_fee_proposal_id: selectedFeeProposal && selectedProposalChildOption ? selectedFeeProposal.id : null,
        source_fee_proposal_child_key: selectedFeeProposal && selectedProposalChildOption ? selectedProposalChildOption.key : null,
        student_type: persistSchoolMode.student_type,
        hostel_type: persistSchoolMode.hostel_type,
        transport_zone: persistSchoolMode.transport_zone,
      } as any).select("id").single();
      insertedOffer = result.data;
      error = result.error;
    }

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      // Bulk-insert any pre-issuance waivers the user staged in the form.
      if (!isAcademicPartnerOfferIssuer && insertedOffer?.id && preWaivers.length > 0) {
        await supabase.from("offer_waivers").insert(
          preWaivers.map(w => ({
            offer_letter_id: insertedOffer.id,
            term: w.term,
            amount: w.amount,
            reason: w.reason || null,
          })) as any
        );
      }
      if (!isAcademicPartnerOfferIssuer && insertedOffer?.id && importedProposalWaivers.length > 0) {
        const { error: proposalWaiverError } = await supabase.from("offer_waivers").insert(
          importedProposalWaivers.map(w => ({
            offer_letter_id: insertedOffer.id,
            term: w.term,
            amount: w.amount,
            reason: w.reason,
            status: "approved",
            source_type: w.source_type,
            source_fee_proposal_id: w.source_fee_proposal_id,
            source_fee_proposal_child_key: w.source_fee_proposal_child_key,
            metadata: w.metadata,
          })) as any
        );
        if (proposalWaiverError) {
          toast({
            title: "Offer created, proposal waivers not copied",
            description: proposalWaiverError.message,
            variant: "destructive",
          });
        }
      }
      // Only advance lead stage if the offer is approved (not pending)
      if (autoApproved && !isAcademicPartnerOfferIssuer) {
        const transition = resolveLeadTransitionCommand({ currentStage: "application_approved", command: "issueOffer" });
        try {
          await applyResolvedLeadTransition(supabase as any, {
            leadId,
            transition,
            extraPatch: { offer_amount: totalFee },
          });
        } catch (e: any) {
          console.warn("[OfferLetterDialog] lead stage transition failed after offer create:", e);
        }
      }
      if (!isAcademicPartnerOfferIssuer) {
        await supabase.from("lead_activities").insert({
          lead_id: leadId, user_id: user?.id || null, type: "offer",
          description: autoApproved
            ? `Offer letter issued: ₹${totalFee.toLocaleString("en-IN")}`
            : `Offer letter submitted for principal approval: ₹${totalFee.toLocaleString("en-IN")}`,
        });
      }
      // If approved on create, generate the PDF immediately and poll for it
      // so the preview pane lights up without needing a manual refresh.
      if (autoApproved && insertedOffer?.id) {
        setSelectedOfferId(insertedOffer.id);
        await regeneratePdf(insertedOffer.id);
        // Notify student via WA + email with the offer letter (fire-and-forget)
        supabase.functions.invoke("notify-event", {
          body: {
            event: "offer_issued",
            lead_id: leadId,
            context: { offer_id: insertedOffer.id },
          },
        }).catch((e: any) => console.warn("[OfferLetterDialog] notify offer_issued failed:", e));
      }

      toast({
        title: autoApproved ? "Offer letter created" : "Offer submitted for approval",
        description: autoApproved ? "PDF will be ready in a few seconds." : "Principal will review and approve this offer.",
      });
      setShowForm(false);
      setForm({
        acceptance_deadline: "",
        session_id: "",
        token_fee_amount: "",
        admission_mode: "direct",
        entrance_exam_name: "",
        entrance_exam_other: "",
      });
      setTokenFeeEdited(false);
      setPreWaivers([]);
      setShowPreWaiverForm(false);
      setPreWaiverForm({ term: "year_1", amount: "", reason: "" });
      setSelectedFeeProposalId("");
      setSelectedProposalChildKey("");
      fetchOffers();
      onSuccess();
    }
    } catch (e: any) {
      // Transport-level failure on one of the awaited calls above. The offer may
      // already be persisted; surface the error rather than a silent stuck state.
      toast({ title: "Error", description: e?.message || "Network error while issuing the offer.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const decideOffer = async (offerId: string, decision: "approved" | "rejected", reason?: string) => {
    if (!isApprover) return;
    if (decision === "approved" && registrationOfferBlocked) {
      toast({
        title: cahetOfferBlocked ? "CAHET registration required" : "UPDELED registration required",
        description: registrationOfferBlockMessage,
        variant: "destructive",
      });
      return;
    }
    const updates: any = {
      approval_status: decision,
      approved_by: user?.id || null,
      approved_at: new Date().toISOString(),
    };
    if (decision === "rejected" && reason) updates.rejection_reason = reason;

    const { error } = await supabase.from("offer_letters").update(updates).eq("id", offerId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // If approved, advance the lead to offer_sent stage + set offer_amount
    if (decision === "approved") {
      const offer = offers.find(o => o.id === offerId);
      if (offer) {
        const transition = resolveLeadTransitionCommand({ currentStage: "application_approved", command: "issueOffer" });
        try {
          await applyResolvedLeadTransition(supabase as any, {
            leadId,
            transition,
            extraPatch: { offer_amount: offer.net_fee },
          });
        } catch (e: any) {
          console.warn("[OfferLetterDialog] lead stage transition failed after offer approval:", e);
        }
      }
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: `Offer letter approved by ${role === "principal" ? "principal" : "super admin"}`,
      });
      // Fire the PDF generator + notify student now that offer is officially approved.
      setSelectedOfferId(offerId);
      regeneratePdf(offerId).catch(() => {});
      supabase.functions.invoke("notify-event", {
        body: { event: "offer_issued", lead_id: leadId, context: { offer_id: offerId } },
      }).catch((e: any) => console.warn("[OfferLetterDialog] notify offer_issued (principal) failed:", e));
    } else {
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: `Offer letter rejected${reason ? `: ${reason}` : ""}`,
      });
    }

    toast({ title: decision === "approved" ? "Offer approved" : "Offer rejected" });
    fetchOffers();
    onSuccess();
  };

  const handleAddWaiver = async (offerId: string) => {
    const amt = Number(waiverForm.amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid waiver amount", variant: "destructive" });
      return;
    }
    if (!waiverForm.term) {
      toast({ title: "Pick a period for this waiver", variant: "destructive" });
      return;
    }
    // Cap: a single year's waivers (approved + pending + this one) cannot
    // exceed that year's published fee. Otherwise the offer goes negative
    // and the candidate ends up "owing" zero or negative money for that year.
    const yearFee = feeForTerm(waiverForm.term);
    const existing = offerWaiverTotalForTerm(offerId, waiverForm.term);
    const available = Math.max(0, yearFee - existing);
    if (yearFee <= 0) {
      toast({
        title: "No fee published for this period",
        description: `The active fee structure has no "${labelForTerm(waiverForm.term)}" line — can't apply a waiver against it.`,
        variant: "destructive",
      });
      return;
    }
    if (amt > available) {
      toast({
        title: "Waiver exceeds available fee",
        description: existing > 0
          ? `Published fee is ₹${yearFee.toLocaleString("en-IN")}; ₹${existing.toLocaleString("en-IN")} already waived (approved or pending). At most ₹${available.toLocaleString("en-IN")} more can be applied here.`
          : `Published fee is ₹${yearFee.toLocaleString("en-IN")}. The waiver can't exceed that.`,
        variant: "destructive",
      });
      return;
    }
    setWaiverSaving(true);
    try {
      const { error } = await supabase.from("offer_waivers").insert({
        offer_letter_id: offerId,
        term: waiverForm.term,
        amount: amt,
        reason: waiverForm.reason || null,
      } as any);
      if (error) throw error;
      toast({
        title: isSuperAdmin ? "Waiver applied" : "Waiver requested",
        description: isSuperAdmin
          ? "Auto-approved (super admin) and applied to this offer."
          : "Sent to super admin for approval.",
      });
      setAddingWaiverFor(null);
      setWaiverForm({ term: availableTerms[0] || "year_1", amount: "", reason: "" });
      await fetchOffers();
      // If super admin auto-approved, regenerate the PDF so the new waiver
      // shows up in the preview immediately.
      if (isSuperAdmin) await regeneratePdf(offerId);
      // NOTE: deliberately not calling onSuccess() — the parent closes the
      // dialog when onSuccess fires, which would dump the user mid-flow.
      // Waivers are a contained dialog action; the lead-level state in the
      // parent is unaffected.
    } catch (e: any) {
      toast({ title: "Couldn't add waiver", description: e.message, variant: "destructive" });
    } finally {
      setWaiverSaving(false);
    }
  };

  const handleDecideWaiver = async (
    waiver: OfferWaiver,
    decision: "approved" | "rejected",
  ) => {
    if (!isSuperAdmin) return;
    let rejectionReason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      rejectionReason = r || undefined;
    }
    setWaiverDecidingId(waiver.id);
    try {
      const { data, error } = await supabase.functions.invoke("decide-offer-waiver", {
        body: { waiver_id: waiver.id, decision, rejection_reason: rejectionReason },
      });
      if (error) {
        let message = error.message;
        try {
          const text = await (error as any)?.context?.text?.();
          if (text) {
            try { const body = JSON.parse(text); if (body?.error) message = body.error; }
            catch { message = text.slice(0, 200); }
          }
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      toast({ title: decision === "approved" ? "Waiver approved" : "Waiver rejected" });
      await fetchOffers();
      // Regenerate so the PDF reflects the newly approved waiver.
      if (decision === "approved") regeneratePdf(waiver.offer_letter_id).catch(() => {});
      // NOTE: deliberately not calling onSuccess() — see handleAddWaiver.
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setWaiverDecidingId(null);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    if (!isSuperAdmin) return;
    if (!window.confirm("Permanently delete this offer letter? This cannot be undone.")) return;
    setDeletingOfferId(offerId);
    try {
      const { error } = await supabase.from("offer_letters").delete().eq("id", offerId);
      if (error) throw error;
      if (selectedOfferId === offerId) setSelectedOfferId(null);
      toast({ title: "Offer letter deleted" });
      await fetchOffers();
      onSuccess();
    } catch (e: any) {
      toast({ title: "Couldn't delete offer", description: e.message, variant: "destructive" });
    } finally {
      setDeletingOfferId(null);
    }
  };

  const handleSubmitEditRequest = async (offerId: string) => {
    const offer = offers.find(o => o.id === offerId);
    if (!offer) {
      toast({ title: "Offer not found", variant: "destructive" });
      return;
    }

    const nextDeadline = editForm.acceptance_deadline || "";
    const currentDeadline = offer.acceptance_deadline?.slice(0, 10) || "";
    const nextCourseId = editForm.course_id || offer.course_id || courseId || "";
    const currentCourseId = offer.course_id || courseId || "";
    const deadlineChanged = nextDeadline !== currentDeadline;
    const courseChanged = isSuperAdmin && !!nextCourseId && nextCourseId !== currentCourseId;
    const nextTokenFeeRaw = editForm.token_fee_amount.trim();
    let nextTokenFeeAmount: number | null = null;
    if (nextTokenFeeRaw) {
      const parsed = Number(nextTokenFeeRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast({ title: "Enter a valid token fee", variant: "destructive" });
        return;
      }
      nextTokenFeeAmount = parsed;
    }
    const tokenFeeChanged = nextTokenFeeAmount != null && nextTokenFeeAmount !== Number(offer.token_fee_amount || 0);
    const proposedChanges: { acceptance_deadline?: string; course_id?: string; token_fee_amount?: number } = {};
    if (deadlineChanged && nextDeadline) proposedChanges.acceptance_deadline = nextDeadline;
    if (courseChanged) proposedChanges.course_id = nextCourseId;
    if (tokenFeeChanged && nextTokenFeeAmount != null) proposedChanges.token_fee_amount = nextTokenFeeAmount;

    if (!nextDeadline && !currentDeadline) {
      toast({ title: "Enter an acceptance deadline", variant: "destructive" });
      return;
    }
    if (!deadlineChanged && !courseChanged && !tokenFeeChanged) {
      toast({ title: "No changes to update", variant: "destructive" });
      return;
    }

    setEditSaving(true);
    try {
      if (isSuperAdmin) {
        let feeUpdate: Record<string, unknown> = {};
        if (courseChanged) {
          if (!offer.session_id) {
            throw new Error("This offer has no academic session. Set a session before changing course.");
          }
          const feeSnapshot = await fetchCourseFeeSnapshot(nextCourseId, offer.session_id);
          if (!feeSnapshot.totalFee || feeSnapshot.totalFee <= 0) {
            throw new Error("The selected course has no active year-wise fee structure for this offer's session.");
          }

          const nextCourseName = courseNameForId(nextCourseId);
          if (isBptOrBmritCourseName(nextCourseName) && !cahetRegistration) {
            throw new Error(cahetOfferBlockMessage);
          }
          const nextCourseCode = courseCodeForId(nextCourseId);
          const nextTokenFloor = feeSnapshot.tokenRequiredAmount || 5000;
          const nextTokenDefault = feeSnapshot.tokenRequiredAmount > 0
            ? feeSnapshot.tokenRequiredAmount
            : feeSnapshot.firstYearFee > 0
            ? Math.max(Math.round(feeSnapshot.firstYearFee * 0.25), nextTokenFloor)
            : nextTokenFloor;
          const currentToken = Number(offer.token_fee_amount || 0);

          feeUpdate = {
            course_id: nextCourseId,
            total_fee: feeSnapshot.totalFee,
            net_fee: feeSnapshot.totalFee,
            token_fee_amount: offer.token_fee_user_edited && currentToken >= nextTokenFloor
              ? currentToken
              : nextTokenDefault,
            token_fee_user_edited: offer.token_fee_user_edited && currentToken >= nextTokenFloor ? offer.token_fee_user_edited : false,
            letter_url: null,
            loan_letter_url: null,
          };
        }

        // Super admin edits directly — no approval needed
        const { error } = await supabase
          .from("offer_letters")
          .update({
            ...feeUpdate,
            ...proposedChanges,
            ...(proposedChanges.token_fee_amount != null ? { token_fee_user_edited: true } : {}),
          } as any)
          .eq("id", offerId);
        if (error) throw error;

        if (courseChanged) {
          await supabase.rpc("recalculate_offer_letter_net_fee" as any, { _offer_letter_id: offerId });
          await supabase.from("lead_activities").insert({
            lead_id: leadId,
            user_id: user?.id || null,
            type: "offer",
            description: `Offer letter course changed to ${courseNameForId(nextCourseId)}`,
          });
        }

        toast({ title: "Offer letter updated" });
        setEditingOfferId(null);
        setEditForm({ acceptance_deadline: "", course_id: "", token_fee_amount: "", reason: "" });
        await fetchOffers();
        await regeneratePdf(offerId);
      } else {
        if (!deadlineChanged && !tokenFeeChanged) {
          toast({ title: "No changes to request", variant: "destructive" });
          return;
        }
        // Non-super-admin: create edit request for approval
        const { error } = await supabase
          .from("offer_letter_edit_requests" as any)
          .insert({
            offer_letter_id: offerId,
            proposed_changes: proposedChanges,
            reason: editForm.reason || null,
          });
        if (error) throw error;
        toast({
          title: "Edit request submitted",
          description: "Super admin will be notified to review and approve.",
        });
        setEditingOfferId(null);
        setEditForm({ acceptance_deadline: "", course_id: "", token_fee_amount: "", reason: "" });
        await fetchOffers();
      }
    } catch (e: any) {
      toast({ title: "Failed to submit", description: e.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDecideEditRequest = async (req: OfferLetterEditRequest, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejectionReason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      rejectionReason = r || undefined;
    }
    setEditDecidingId(req.id);
    try {
      const updates: any = {
        status: decision,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      };
      if (decision === "approved" && req.proposed_changes.token_fee_amount == null) {
        const tokenFeeAmount = parseTokenFeeFromEditReason(req.reason);
        if (tokenFeeAmount != null) {
          updates.proposed_changes = {
            ...req.proposed_changes,
            token_fee_amount: tokenFeeAmount,
          };
        }
      }
      if (rejectionReason) updates.rejection_reason = rejectionReason;
      const { error } = await supabase
        .from("offer_letter_edit_requests" as any)
        .update(updates)
        .eq("id", req.id);
      if (error) throw error;
      toast({ title: decision === "approved" ? "Edit approved" : "Edit rejected" });
      await fetchOffers();
      if (decision === "approved") regeneratePdf(req.offer_letter_id).catch(() => {});
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setEditDecidingId(null);
    }
  };

  const updateOfferStatus = async (offerId: string, status: string) => {
    const updates: any = { status };
    if (status === "accepted") updates.accepted_at = new Date().toISOString();

    await supabase.from("offer_letters").update(updates).eq("id", offerId);
    if (status === "accepted") {
      // Note: stage stays at offer_sent until the actual token payment lands.
      // The lead_payments trigger flips stage to token_paid once the 10% threshold is met.
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: `Offer letter accepted (awaiting token payment)`,
      });
    }
    fetchOffers();
    onSuccess();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  const statusColors: Record<string, string> = {
    issued: "bg-pastel-blue", accepted: "bg-pastel-green", rejected: "bg-pastel-red", expired: "bg-muted",
  };
  const approvalColors: Record<string, string> = {
    pending_principal: "bg-warning/10 text-warning-foreground border-warning/20",
    approved: "bg-success/10 text-success border-success/20",
    rejected: "bg-destructive/10 text-destructive border-destructive/20",
  };

  const selectedOffer = offers.find(o => o.id === selectedOfferId) || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Offer Letters — {leadName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(360px,420px)_1fr]">
          {/* ─── Left: list + new-offer form ─── */}
          <div className="overflow-y-auto px-5 py-4 space-y-4 border-b md:border-b-0 md:border-r border-border">
          <CahetRegistrationDetails registration={cahetRegistration} />
          <UpdeledRegistrationDetails registration={updeledRegistration} />
          {/* ABVMU deposit challan — staff submit/track on the candidate's
              behalf; self-hides when the course has no seat-reservation deposit. */}
          <AbvmuDepositPanel leadId={leadId} onChanged={onSuccess} />
          {!showForm && (
            <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Offer</Button>
          )}

          {showForm && (
            <Card className="border-border/60">
              <CardContent className="p-4 space-y-3">
                {registrationOfferBlocked && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>{registrationOfferBlockMessage}</p>
                  </div>
                )}
                {/* Programme fee summary — read-only, sourced directly from the
                    published fee_structure for the selected course + session.
                    The offer's total_fee is stamped from this on submit; the
                    user no longer types it. */}
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Programme Fee</label>
                  {yearTotals.length > 0 ? (
                    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
                      {yearTotals.map(y => (
                        <div key={y.term} className="flex items-center justify-between">
                          <span className="text-muted-foreground">{y.label}</span>
                          <span className="text-foreground tabular-nums">₹{y.total.toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1 border-t border-border/40 font-semibold">
                        <span>Total Programme Fee</span>
                        <span className="tabular-nums">₹{programmeTotal.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-xs text-warning-foreground dark:border-warning/60/40 dark:bg-warning/90/20 dark:text-warning/40">
                      No active programme fee structure published for this course + session. Publish one in Course & Campus master before issuing.
                    </div>
                  )}
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70 leading-relaxed">
                    Sourced from the published fee structure for the selected session. Add period-wise discounts (scholarship, sibling, alumni, hardship etc.) as waivers below before issuing.
                  </p>
                </div>

                {hasSchoolOptions && (
                  <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] font-semibold text-foreground">School Mode & Add-ons</p>
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                      Boarding & transport vary the fee. Prefilled from the applicant's choice — adjust if needed. The programme fee above updates live.
                    </p>
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">Attendance mode</label>
                      <select
                        value={schoolSelection.studentType || "day_scholar"}
                        onChange={e => {
                          const studentType = e.target.value as SchoolStudentType;
                          setSchoolSelection(prev => ({
                            ...prev,
                            studentType,
                            hostelType: studentType === "boarder" ? prev.hostelType : null,
                          }));
                        }}
                        className={inputCls}
                      >
                        <option value="day_scholar">Day Scholar</option>
                        <option value="day_boarder">Day Boarding</option>
                        <option value="boarder">Boarder</option>
                      </select>
                    </div>
                    {schoolSelection.studentType === "boarder" && (
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Boarding type</label>
                        <select
                          value={schoolSelection.hostelType || ""}
                          onChange={e => setSchoolSelection(prev => ({ ...prev, hostelType: (e.target.value || null) as SchoolHostelType | null }))}
                          className={inputCls}
                        >
                          <option value="">Select boarding type…</option>
                          <option value="non_ac">Non-AC</option>
                          <option value="ac_central">AC (C Block)</option>
                          <option value="ac_individual">AC (B Block)</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">Transport</label>
                      <select
                        value={schoolSelection.transportZone || ""}
                        onChange={e => setSchoolSelection(prev => ({ ...prev, transportZone: (e.target.value || null) as SchoolTransportZone | null }))}
                        className={inputCls}
                      >
                        <option value="">Not required</option>
                        <option value="zone_1">Within 5 km</option>
                        <option value="zone_2">5–10 km</option>
                        <option value="zone_3">Over 10 km</option>
                      </select>
                    </div>
                    {schoolSelection.studentType === "boarder" && !schoolSelection.hostelType && (
                      <p className="text-[10px] text-warning-foreground">Select a boarding type so the fee includes it.</p>
                    )}
                  </div>
                )}

                {approvedFeeProposals.length > 0 && (
                  <div className="rounded-xl border border-success/20 bg-success/5/70 p-3 text-xs space-y-2 dark:border-success/60/40 dark:bg-success/90/20">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-success-foreground dark:text-success/30">
                          Apply approved fee proposal
                        </label>
                        <p className="mt-0.5 text-[10px] text-success-foreground/80 dark:text-success/40/80">
                          Optional. Selected proposal waivers are copied as approved offer waivers.
                        </p>
                      </div>
                      {importedProposalWaiverTotal > 0 && (
                        <Badge className="border-success/20 bg-white text-success dark:bg-success/90">
                          −₹{importedProposalWaiverTotal.toLocaleString("en-IN")}
                        </Badge>
                      )}
                    </div>
                    <select
                      value={selectedFeeProposalId}
                      onChange={(e) => {
                        setSelectedFeeProposalId(e.target.value);
                        setSelectedProposalChildKey("");
                      }}
                      className="w-full rounded-md border border-success/20 bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="">Do not apply proposal</option>
                      {approvedFeeProposals.map((proposal) => {
                        const children = proposal.proposal?.children || [];
                        const childNames = children.slice(0, 2).map((child, index) => feeProposalChildLabel(child, `Student ${index + 1}`).split(" - ")[0]).join(", ");
                        const more = children.length > 2 ? ` +${children.length - 2}` : "";
                        return (
                          <option key={proposal.id} value={proposal.id}>
                            Revision {proposal.revision_number || 1}{childNames ? ` - ${childNames}${more}` : ""} · payable ₹{Number(proposal.payable_at_admission || proposal.annual_total || 0).toLocaleString("en-IN")}
                          </option>
                        );
                      })}
                    </select>

                    {selectedFeeProposal && proposalChildOptions.length !== 1 && (
                      <div>
                        <label className="block text-[10px] font-medium text-success-foreground dark:text-success/30 mb-0.5">
                          Proposal student <span className="text-destructive">*</span>
                        </label>
                        <select
                          value={selectedProposalChildKey}
                          onChange={(e) => setSelectedProposalChildKey(e.target.value)}
                          className="w-full rounded-md border border-success/20 bg-background px-2 py-1.5 text-xs"
                        >
                          <option value="">Select student from proposal</option>
                          {proposalChildOptions.map(option => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </select>
                        {proposalChildOptions.length === 0 && (
                          <p className="mt-1 text-[10px] text-warning-foreground">
                            No child in this proposal matches this lead and course. Issue without proposal or choose a matching proposal.
                          </p>
                        )}
                      </div>
                    )}

                    {selectedFeeProposal && selectedProposalChildOption && (
                      <div className="space-y-1">
                        <div className="rounded-md border border-success/20/80 bg-white/70 p-2 dark:bg-background/40">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-success-foreground dark:text-success/30">
                              {selectedProposalChildOption.label}
                            </span>
                            <span className="tabular-nums font-semibold text-success">
                              {importedProposalWaiverTotal > 0 ? `−₹${importedProposalWaiverTotal.toLocaleString("en-IN")}` : "No waiver"}
                            </span>
                          </div>
                          {importedProposalWaivers.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {importedProposalWaivers.map((waiver, index) => (
                                <span key={`${waiver.term}-${index}`} className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success-foreground dark:bg-success/80/50 dark:text-success/30">
                                  {labelForTerm(waiver.term)}: ₹{waiver.amount.toLocaleString("en-IN")}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {proposalMismatch?.hasMismatch && (
                          <p className="rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning-foreground dark:border-warning/60/40 dark:bg-warning/90/20 dark:text-warning/40">
                            Fee structure changed since proposal: proposal gross ₹{proposalMismatch.proposalGross.toLocaleString("en-IN")}, current gross ₹{proposalMismatch.currentGross.toLocaleString("en-IN")}. You can still issue; the offer gross fee uses the current active structure.
                          </p>
                        )}
                        {proposalLevelFullYearWaiver > 0 && (selectedFeeProposal.proposal?.children?.length || 0) > 1 && (
                          <p className="rounded-md border border-warning/20 bg-warning/5 px-2 py-1.5 text-[10px] text-warning-foreground dark:border-warning/60/40 dark:bg-warning/90/20 dark:text-warning/40">
                            This proposal also has a proposal-level yearly-payment waiver of ₹{proposalLevelFullYearWaiver.toLocaleString("en-IN")}. It is not auto-split across children; add it manually if applicable.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Pre-issuance waivers — staged locally, inserted after offer creation */}
                {yearTotals.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-medium text-muted-foreground">Waivers / Discounts</label>
                      {!showPreWaiverForm && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowPreWaiverForm(true);
                            const usedTerms = new Set(preWaivers.map(w => w.term));
                            const nextTerm = availableTerms.find(t => !usedTerms.has(t)) ?? availableTerms[0] ?? "year_1";
                            setPreWaiverForm({ term: nextTerm, amount: "", reason: "" });
                          }}
                          className="text-[11px] text-primary hover:underline"
                        >
                          + Add Waiver
                        </button>
                      )}
                    </div>

                    {preWaivers.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {preWaivers.map((w, i) => (
                          <div key={i} className="flex items-center justify-between rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-xs">
                            <span className="text-muted-foreground">{labelForTerm(w.term)}</span>
                            <span className="font-medium">−₹{w.amount.toLocaleString("en-IN")}</span>
                            {w.reason && <span className="text-muted-foreground truncate max-w-[80px]">{w.reason}</span>}
                            <button
                              type="button"
                              onClick={() => setPreWaivers(prev => prev.filter((_, j) => j !== i))}
                              className="text-destructive hover:text-destructive/70 text-[10px] font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        {(() => {
                          const totalWaiver = preWaivers.reduce((s, w) => s + w.amount, 0) + importedProposalWaiverTotal;
                          const netFee = programmeTotal - totalWaiver;
                          return (
                            <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold border-t border-border/40 pt-1.5 mt-1">
                              <span>Net Programme Fee</span>
                              <span className="tabular-nums text-success">₹{netFee.toLocaleString("en-IN")}</span>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {showPreWaiverForm && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Period</label>
                            <select
                              value={preWaiverForm.term}
                              onChange={e => setPreWaiverForm(p => ({ ...p, term: e.target.value }))}
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                            >
                              {availableTerms.map(t => (
                                <option key={t} value={t}>{labelForTerm(t)}</option>
                              ))}
                            </select>
                          </div>
                          {(() => {
                            const yearFee = feeForTerm(preWaiverForm.term);
                            const existing = preWaiverTotalForTerm(preWaiverForm.term);
                            const available = Math.max(0, yearFee - existing);
                            return (
                              <div>
                                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                  Amount (₹) <span className="text-muted-foreground/60">— max ₹{available.toLocaleString("en-IN")}</span>
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={available || undefined}
                                  value={preWaiverForm.amount}
                                  onChange={e => setPreWaiverForm(p => ({ ...p, amount: e.target.value }))}
                                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                  placeholder="10000"
                                />
                              </div>
                            );
                          })()}
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Reason (optional)</label>
                          <input
                            value={preWaiverForm.reason}
                            onChange={e => setPreWaiverForm(p => ({ ...p, reason: e.target.value }))}
                            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                            placeholder="Sibling discount, alumni, etc."
                          />
                        </div>
                        {!isSuperAdmin && (
                          <p className="text-[10px] text-warning-foreground">
                            This waiver will need super admin approval before it reflects on the offer letter.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              const amt = Number(preWaiverForm.amount);
                              if (!amt || amt <= 0) {
                                toast({ title: "Enter a valid waiver amount", variant: "destructive" });
                                return;
                              }
                              // Cap against the year's published fee minus any waivers already
                              // queued for the same term in this form.
                              const yearFee = feeForTerm(preWaiverForm.term);
                              const existing = preWaiverTotalForTerm(preWaiverForm.term);
                              const available = Math.max(0, yearFee - existing);
                              if (yearFee <= 0) {
                                toast({
                                  title: "No fee published for this period",
                                  description: `The active fee structure has no "${labelForTerm(preWaiverForm.term)}" line.`,
                                  variant: "destructive",
                                });
                                return;
                              }
                              if (amt > available) {
                                toast({
                                  title: "Waiver exceeds available fee",
                                  description: existing > 0
                                    ? `Published fee is ₹${yearFee.toLocaleString("en-IN")}; ₹${existing.toLocaleString("en-IN")} already added in this form. At most ₹${available.toLocaleString("en-IN")} more can be applied here.`
                                    : `Published fee is ₹${yearFee.toLocaleString("en-IN")}. The waiver can't exceed that.`,
                                  variant: "destructive",
                                });
                                return;
                              }
                              const newPreWaivers = [...preWaivers, { term: preWaiverForm.term, amount: amt, reason: preWaiverForm.reason }];
                              setPreWaivers(newPreWaivers);
                              setShowPreWaiverForm(false);
                              const usedTerms = new Set(newPreWaivers.map(w => w.term));
                              const nextTerm = availableTerms.find(t => !usedTerms.has(t)) ?? availableTerms[0] ?? "year_1";
                              setPreWaiverForm({ term: nextTerm, amount: "", reason: "" });
                            }}
                          >
                            Add
                          </Button>
                          <Button type="button" size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowPreWaiverForm(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Admission Route
                  </label>
                  <select
                    value={form.admission_mode}
                    onChange={e => setForm(p => ({
                      ...p,
                      admission_mode: e.target.value as "direct" | "entrance",
                      entrance_exam_name: e.target.value === "direct" ? "" : p.entrance_exam_name,
                      entrance_exam_other: e.target.value === "direct" ? "" : p.entrance_exam_other,
                    }))}
                    className={inputCls}
                  >
                    <option value="direct">Direct Admission</option>
                    <option value="entrance">Admission via Entrance / Counselling</option>
                  </select>
                </div>

                {form.admission_mode === "entrance" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Entrance / Counselling <span className="text-destructive">*</span>
                      </label>
                      <select
                        value={form.entrance_exam_name}
                        onChange={e => setForm(p => ({ ...p, entrance_exam_name: e.target.value, entrance_exam_other: e.target.value === "Other" ? p.entrance_exam_other : "" }))}
                        className={inputCls}
                      >
                        <option value="">Select entrance</option>
                        {ENTRANCE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    {form.entrance_exam_name === "Other" && (
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Other Entrance <span className="text-destructive">*</span>
                        </label>
                        <input
                          value={form.entrance_exam_other}
                          onChange={e => setForm(p => ({ ...p, entrance_exam_other: e.target.value }))}
                          className={inputCls}
                          placeholder="Type entrance/counselling name"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Token fee — defaults to 25% of the first fee period, editable but floored at
                    the course-specific seat-block amount. The pencil icon flips edit mode;
                    the field is read-only otherwise to discourage casual changes. */}
                <div>
                  <label className="flex items-center justify-between text-[11px] font-medium text-muted-foreground mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <Coins className="h-3 w-3" /> Token Fee (₹)
                    </span>
                    <button
                      type="button"
                      onClick={() => setTokenFeeEdited(e => !e)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                      title={tokenFeeEdited ? "Reset to default" : "Edit token fee"}
                    >
                      <Pencil className="h-2.5 w-2.5" />
                      {tokenFeeEdited ? "Reset" : "Edit"}
                    </button>
                  </label>
                  <input
                    type="number"
                    value={form.token_fee_amount}
                    readOnly={!tokenFeeEdited}
                    min={tokenFeeEdited ? tokenFloor : undefined}
                    onChange={e => setForm(p => ({ ...p, token_fee_amount: e.target.value }))}
                    className={`${inputCls} ${!tokenFeeEdited ? "bg-muted/40 cursor-default" : ""}`}
                    placeholder={tokenDefault > 0 ? String(tokenDefault) : "—"}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground/70 leading-relaxed">
                    {tokenDefault > 0 ? (
                      tokenFeeEdited ? (
                        <>
                          Minimum <span className="font-semibold text-foreground">₹{tokenFloor.toLocaleString("en-IN")}</span>. This is the amount the applicant must pay to book the seat before the acceptance deadline.
                        </>
                      ) : usesSchoolTerms ? (
                        <>
                          Default = Admission + Q1{netForTerm(SECURITY_DEPOSIT_TERM) > 0 ? " + Security deposit" : ""} = ₹{schoolTokenBase.toLocaleString("en-IN")}. Click Edit to override (min ₹{tokenFloor.toLocaleString("en-IN")}).
                        </>
                      ) : (
                        <>
                          Default = 25% of net {firstTermLabel} fee (₹{netFirstYearFee.toLocaleString("en-IN")}) = ₹{tokenDefault.toLocaleString("en-IN")}.
                          {firstYearFee !== netFirstYearFee && (
                            <> Gross ₹{firstYearFee.toLocaleString("en-IN")} minus ₹{(firstYearFee - netFirstYearFee).toLocaleString("en-IN")} {firstTermLabel} waiver.</>
                          )}
                          {" "}Click Edit to override.
                        </>
                      )
                    ) : (
                      <>Pick a course + session above to compute the default.</>
                    )}
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Academic Session <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.session_id}
                    onChange={e => setForm(p => ({ ...p, session_id: e.target.value }))}
                    className={inputCls}
                    disabled={!isSuperAdmin && sessions.length > 0}
                  >
                    {sessions.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.is_active ? " (Active)" : ""}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Locks the fee structure for this offer. Token amount defaults to 25% of the first fee period from this session's structure.
                    {!isSuperAdmin && " Only super admin can pick a non-active session."}
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Acceptance Deadline <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.acceptance_deadline}
                    onChange={e => setForm(p => ({ ...p, acceptance_deadline: e.target.value }))}
                    className={`${inputCls} ${!form.acceptance_deadline ? "border-destructive/40" : ""}`}
                    min={new Date().toISOString().slice(0, 10)}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground/70">Date by which the candidate must accept and pay the token fee.</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreate} disabled={saving || programmeTotal <= 0 || registrationOfferBlocked} size="sm" className="gap-1.5"
                    title={registrationOfferBlocked ? registrationOfferBlockMessage : programmeTotal <= 0 ? "Publish a fee structure for this course + session first" : undefined}>
                    {saving ? <ButtonOrb state="composing" onFilled /> : <FileText className="h-4 w-4" />} Issue Offer
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    setShowForm(false);
                    setForm({
                      acceptance_deadline: "",
                      session_id: "",
                      token_fee_amount: "",
                      admission_mode: "direct",
                      entrance_exam_name: "",
                      entrance_exam_other: "",
                    });
                    setPreWaivers([]);
                    setShowPreWaiverForm(false);
                    setPreWaiverForm({ term: "year_1", amount: "", reason: "" });
                    setSelectedFeeProposalId("");
                    setSelectedProposalChildKey("");
                  }}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><OrbLoader state="composing" /></div>
          ) : offers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No offer letters yet</p>
          ) : (
            <div className="space-y-2">
              {offers.map(offer => {
                const approvalStatus = offer.approval_status || "approved";
                const isPending = approvalStatus === "pending_principal";
                const isApprovedOffer = approvalStatus === "approved";
                const isRejected = approvalStatus === "rejected";

                const isSelected = selectedOfferId === offer.id;
                return (
                  <Card
                    key={offer.id}
                    onClick={() => setSelectedOfferId(offer.id)}
                    className={`cursor-pointer transition-all ${isSelected ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border/60 hover:border-border"}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-lg font-bold text-foreground">₹{offer.net_fee.toLocaleString("en-IN")}</p>
                          <p className="text-xs font-medium text-foreground/80">{courseNameForId(offer.course_id || courseId)}</p>
                          <p className="text-xs text-muted-foreground">
                            Total: ₹{offer.total_fee.toLocaleString("en-IN")}
                            {(waiversByOffer[offer.id]?.filter(w => w.status === "approved").length || 0) > 0 && (
                              <> · {waiversByOffer[offer.id]!.filter(w => w.status === "approved").length} waiver{waiversByOffer[offer.id]!.filter(w => w.status === "approved").length === 1 ? "" : "s"} applied</>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {approvalStatus !== "approved" && (
                            <Badge className={`text-[10px] border ${approvalColors[approvalStatus] || ""}`}>
                              {isPending && <><ShieldCheck className="h-2.5 w-2.5 mr-1 inline" /> Pending Principal</>}
                              {isRejected && <><XCircle className="h-2.5 w-2.5 mr-1 inline" /> Rejected</>}
                            </Badge>
                          )}
                          {isApprovedOffer && (
                            <Badge className={`text-[10px] border-0 ${statusColors[offer.status] || "bg-muted"}`}>{offer.status}</Badge>
                          )}
                          {offer.source_fee_proposal_id && (
                            <Badge className="text-[10px] border border-success/20 bg-success/5 text-success">
                              Fee proposal
                            </Badge>
                          )}
                          {isSuperAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteOffer(offer.id); }}
                              disabled={deletingOfferId === offer.id}
                              className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                              title="Delete offer letter"
                            >
                              {deletingOfferId === offer.id
                                ? <ButtonOrb state="composing" onFilled />
                                : <Trash2 className="h-3 w-3" />}
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span>Issued: {new Date(offer.created_at).toLocaleDateString("en-IN")}</span>
                        {offer.acceptance_deadline && <span>Deadline: {(() => { const dt = new Date(offer.acceptance_deadline!); const ord = (n: number) => { const s = ["th","st","nd","rd"]; const v = n%100; return n+(s[(v-20)%10]??s[v]??s[0]); }; return `${dt.toLocaleDateString("en-IN",{weekday:"long"})}, ${ord(dt.getDate())} ${dt.toLocaleDateString("en-IN",{month:"long"})}`; })()}</span>}
                        {offer.accepted_at && <span>Accepted: {new Date(offer.accepted_at).toLocaleDateString("en-IN")}</span>}
                      </div>
                      {offer.rejection_reason && (
                        <p className="text-xs text-destructive mt-1">Rejection: {offer.rejection_reason}</p>
                      )}

                      {/* Year-wise waivers — visible only on approved offers,
                          since waivers attached to a pending/rejected offer
                          have no real meaning yet. */}
                      {isApprovedOffer && (() => {
                        const offerWaivers = waiversByOffer[offer.id] || [];
                        const isAdding = addingWaiverFor === offer.id;
                        return (
                          <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Waivers</p>
                              {!isAdding && (
                                <button
                                  onClick={() => {
                                    setAddingWaiverFor(offer.id);
                                    const existingTerms = new Set((waiversByOffer[offer.id] || []).map(w => w.term));
                                    const nextTerm = availableTerms.find(t => !existingTerms.has(t)) ?? availableTerms[0] ?? "year_1";
                                    setWaiverForm({ term: nextTerm, amount: "", reason: "" });
                                  }}
                                  className="text-[11px] text-primary hover:underline"
                                >
                                  + Add Waiver
                                </button>
                              )}
                            </div>

                            {offerWaivers.length === 0 && !isAdding && (
                              <p className="text-[11px] text-muted-foreground italic">No waivers on this offer.</p>
                            )}

                            {offerWaivers.map(w => {
                              const yearLabel = labelForTerm(w.term);
                              const statusCls =
                                w.status === "approved"  ? "bg-success/10 text-success border-success/20" :
                                w.status === "rejected"  ? "bg-destructive/10 text-destructive border-destructive/20" :
                                                           "bg-warning/10 text-warning-foreground border-warning/20";
                              return (
                                <div key={w.id} className="rounded-md border border-border/50 bg-background/50 p-2 text-xs space-y-1">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold">{yearLabel}</span>
                                      <span className="text-foreground/70">−₹{Number(w.amount).toLocaleString("en-IN")}</span>
                                      <Badge className={`text-[9px] border ${statusCls}`}>{w.status}</Badge>
                                      {w.source_type === "fee_proposal" && (
                                        <Badge className="text-[9px] border border-success/20 bg-success/5 text-success">
                                          Fee proposal
                                        </Badge>
                                      )}
                                    </div>
                                    {w.status === "pending" && isSuperAdmin && (
                                      <div className="flex gap-1">
                                        <button
                                          disabled={waiverDecidingId === w.id}
                                          onClick={() => handleDecideWaiver(w, "approved")}
                                          className="rounded bg-success hover:bg-success/90 text-white px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          disabled={waiverDecidingId === w.id}
                                          onClick={() => handleDecideWaiver(w, "rejected")}
                                          className="rounded border border-destructive/30 text-destructive hover:bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {(w.reason || w.requested_by_name || w.approved_by_name || w.rejection_reason) && (
                                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                                      {w.reason && <div>Reason: {w.reason}</div>}
                                      {w.source_type === "fee_proposal" && <div>Source: approved fee proposal</div>}
                                      {w.requested_by_name && (
                                        <div>Requested by {w.requested_by_name}{w.requested_by_role ? ` (${w.requested_by_role})` : ""}</div>
                                      )}
                                      {w.status === "approved" && w.approved_by_name && (
                                        <div className="text-success">Approved by {w.approved_by_name}</div>
                                      )}
                                      {w.status === "rejected" && w.rejection_reason && (
                                        <div className="text-destructive">Rejection: {w.rejection_reason}</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {isAdding && (
                              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Period</label>
                                    <select
                                      value={waiverForm.term}
                                      onChange={e => setWaiverForm(p => ({ ...p, term: e.target.value }))}
                                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    >
                                      {availableTerms.map(t => (
                                        <option key={t} value={t}>{labelForTerm(t)}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {(() => {
                                    const yearFee = feeForTerm(waiverForm.term);
                                    const existing = offerWaiverTotalForTerm(offer.id, waiverForm.term);
                                    const available = Math.max(0, yearFee - existing);
                                    return (
                                      <div>
                                        <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                          Amount (₹) <span className="text-muted-foreground/60">— max ₹{available.toLocaleString("en-IN")}</span>
                                        </label>
                                        <input
                                          type="number"
                                          min={1}
                                          max={available || undefined}
                                          value={waiverForm.amount}
                                          onChange={e => setWaiverForm(p => ({ ...p, amount: e.target.value }))}
                                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                          placeholder="10000"
                                        />
                                      </div>
                                    );
                                  })()}
                                </div>
                                <div>
                                  <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Reason (optional)</label>
                                  <input
                                    value={waiverForm.reason}
                                    onChange={e => setWaiverForm(p => ({ ...p, reason: e.target.value }))}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    placeholder="Sibling discount, alumni, etc."
                                  />
                                </div>
                                {!isSuperAdmin && (
                                  <p className="text-[10px] text-warning-foreground">
                                    This waiver will need super admin approval before it appears on the offer letter.
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <Button size="sm" className="text-xs h-7" disabled={waiverSaving} onClick={() => handleAddWaiver(offer.id)}>
                                    {waiverSaving && <ButtonOrb state="composing" onFilled />}
                                    {isSuperAdmin ? "Apply Waiver" : "Request Waiver"}
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAddingWaiverFor(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Principal / Super admin approve/reject buttons */}
                      {isPending && isApprover && (
                        <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            className="text-xs gap-1.5 bg-success hover:bg-success/90"
                            onClick={() => decideOffer(offer.id, "approved")}
                            disabled={registrationOfferBlocked}
                            title={registrationOfferBlocked ? registrationOfferBlockMessage : undefined}
                          >
                            <CheckCircle className="h-3 w-3" /> Approve Offer
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => {
                            const reason = window.prompt("Reason for rejection (optional):") || undefined;
                            decideOffer(offer.id, "rejected", reason);
                          }}>
                            <XCircle className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      )}

                      {/* ── Edit offer letter ── */}
                      {isApprovedOffer && (() => {
                        const editReqs = editRequestsByOffer[offer.id] || [];
                        const hasPendingEdit = editReqs.length > 0;
                        const isEditing = editingOfferId === offer.id;
                        return (
                          <div className="mt-3 pt-3 border-t border-border/40 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edit Offer</p>
                              {!isEditing && !hasPendingEdit && (
                                <button
                                  onClick={() => {
                                    setEditingOfferId(offer.id);
                                    setEditForm({
                                      acceptance_deadline: offer.acceptance_deadline?.slice(0, 10) || "",
                                      token_fee_amount: offer.token_fee_amount ? String(Number(offer.token_fee_amount)) : "",
                                      course_id: offer.course_id || courseId || "",
                                      reason: "",
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                >
                                  <Pencil className="h-3 w-3" /> Edit
                                </button>
                              )}
                            </div>

                            {/* Pending edit requests — super admin sees approve/reject */}
                            {editReqs.map((req) => (
                              <div key={req.id} className="rounded-md border border-warning/20 bg-warning/5 dark:border-warning/60/40 dark:bg-warning/90/20 p-2 text-xs space-y-1.5">
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div className="space-y-0.5">
                                    <p className="font-semibold text-warning-foreground dark:text-warning/40">
                                      Edit requested by {req.requested_by_name || "staff"}
                                      {req.requested_by_role && <span className="font-normal"> ({req.requested_by_role})</span>}
                                    </p>
                                    {req.proposed_changes.acceptance_deadline && (
                                      <p className="text-warning-foreground dark:text-warning/70">
                                        New deadline: {new Date(req.proposed_changes.acceptance_deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                      </p>
                                    )}
                                    {(req.proposed_changes.token_fee_amount != null || parseTokenFeeFromEditReason(req.reason) != null) && (
                                      <p className="text-warning-foreground dark:text-warning/70">
                                        New token fee: ₹{Number(req.proposed_changes.token_fee_amount ?? parseTokenFeeFromEditReason(req.reason)).toLocaleString("en-IN")}
                                      </p>
                                    )}
                                    {req.proposed_changes.course_id && (
                                      <p className="text-warning-foreground dark:text-warning/70">
                                        New course: {courseNameForId(req.proposed_changes.course_id)}
                                      </p>
                                    )}
                                    {req.reason && <p className="text-warning-foreground dark:text-warning">Reason: {req.reason}</p>}
                                  </div>
                                  {isSuperAdmin && (
                                    <div className="flex gap-1 shrink-0">
                                      <button
                                        disabled={editDecidingId === req.id}
                                        onClick={() => handleDecideEditRequest(req, "approved")}
                                        className="rounded bg-success hover:bg-success/90 text-white px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        {editDecidingId === req.id ? <ButtonOrb state="composing" onFilled /> : "Approve"}
                                      </button>
                                      <button
                                        disabled={editDecidingId === req.id}
                                        onClick={() => handleDecideEditRequest(req, "rejected")}
                                        className="rounded border border-destructive/30 text-destructive hover:bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}
                                  {!isSuperAdmin && (
                                    <span className="text-[10px] text-warning-foreground dark:text-warning italic">Awaiting super admin</span>
                                  )}
                                </div>
                              </div>
                            ))}

                            {/* Inline edit form */}
                            {isEditing && (
                              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
                                {isSuperAdmin && (
                                  <div>
                                    <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                      Course
                                    </label>
                                    <select
                                      value={editForm.course_id}
                                      onChange={(e) => setEditForm((p) => ({ ...p, course_id: e.target.value }))}
                                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    >
                                      <option value="">Select course</option>
                                      {courseOptions.map((course) => (
                                        <option key={course.id} value={course.id}>
                                          {course.name}{course.code ? ` (${course.code})` : ""}
                                        </option>
                                      ))}
                                    </select>
                                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                                      Changing course updates this issued offer letter's fee snapshot and regenerates the PDF.
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                    New Acceptance Deadline
                                  </label>
                                  <input
                                    type="date"
                                    value={editForm.acceptance_deadline}
                                    min={new Date().toISOString().slice(0, 10)}
                                    onChange={(e) => setEditForm((p) => ({ ...p, acceptance_deadline: e.target.value }))}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                    Token Fee Payable
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={editForm.token_fee_amount}
                                    onChange={(e) => setEditForm((p) => ({ ...p, token_fee_amount: e.target.value }))}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    placeholder="Amount shown on the offer PDF"
                                  />
                                </div>
                                {!isSuperAdmin && (
                                  <div>
                                    <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">
                                      Reason <span className="text-muted-foreground/60">(optional)</span>
                                    </label>
                                    <input
                                      value={editForm.reason}
                                      onChange={(e) => setEditForm((p) => ({ ...p, reason: e.target.value }))}
                                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                      placeholder="Why is this change needed?"
                                    />
                                  </div>
                                )}
                                {!isSuperAdmin && (
                                  <p className="text-[10px] text-warning-foreground dark:text-warning">
                                    This change requires super admin approval before it takes effect.
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <Button
                                    size="sm" className="text-xs h-7" disabled={editSaving}
                                    onClick={() => handleSubmitEditRequest(offer.id)}
                                  >
                                    {editSaving && <ButtonOrb state="composing" onFilled />}
                                    {isSuperAdmin ? "Update" : "Request Edit"}
                                  </Button>
                                  <Button
                                    size="sm" variant="outline" className="text-xs h-7"
                                    onClick={() => { setEditingOfferId(null); setEditForm({ acceptance_deadline: "", course_id: "", token_fee_amount: "", reason: "" }); }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Mark as accepted/rejected by student (only for approved offers in "issued" state).
                          Admins record the candidate's response here when the candidate has
                          communicated it verbally / over WhatsApp / in writing — i.e. these
                          buttons act on the candidate's behalf, before any payment is captured. */}
                      {isApprovedOffer && offer.status === "issued" && (
                        <div className="mt-3 pt-3 border-t border-border/40" onClick={(e) => e.stopPropagation()}>
                          <p className="text-[10px] text-muted-foreground mb-2 leading-snug">
                            Record the candidate's response on their behalf — use these when the candidate has confirmed acceptance or declined the offer outside the payment flow (call, WhatsApp, in person). Token-fee payment auto-confirms acceptance regardless.
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="text-xs" onClick={() => updateOfferStatus(offer.id, "accepted")}>Mark Accepted (on behalf)</Button>
                            <Button size="sm" variant="outline" className="text-xs text-destructive" onClick={() => updateOfferStatus(offer.id, "rejected")}>Mark Rejected (on behalf)</Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          </div>

          {/* ─── Right: PDF / pre-issue preview pane ─── */}
          <div className="flex flex-col bg-muted/20 min-h-[400px]">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {showForm
                  ? `Draft Preview · ₹${previewNetFee.toLocaleString("en-IN")}`
                  : selectedOffer ? `Preview · ₹${selectedOffer.net_fee.toLocaleString("en-IN")}` : "Preview"}
              </p>
              {selectedOffer && (
                <div className="flex items-center gap-1.5">
                  {selectedOffer.letter_url && (
                    <Button size="sm" variant="ghost" className="text-xs h-7 gap-1.5" asChild>
                      <a href={selectedOffer.letter_url} target="_blank" rel="noopener">
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </Button>
                  )}
                  {selectedOffer.approval_status === "approved" && (
                    <Button
                      size="sm" variant="ghost" className="text-xs h-7 gap-1.5"
                      onClick={() => regeneratePdf(selectedOffer.id)}
                      disabled={regeneratingId === selectedOffer.id}
                    >
                      {regeneratingId === selectedOffer.id
                        ? <ButtonOrb state="composing" />
                        : <RefreshCw className="h-3 w-3" />}
                      Regenerate
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 relative">
              {showForm ? (
                <div className="absolute inset-0 overflow-auto bg-white">
                  <div className="mx-auto my-6 max-w-[720px] rounded-sm border border-border bg-white p-8 shadow-sm">
                    <div className="border-b border-border pb-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Offer Letter Preview</p>
                      <h3 className="mt-1 text-xl font-bold text-foreground">Provisional Admission Offer</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        This preview is based on the form values on the left. The final PDF is generated after issuing and approval.
                      </p>
                    </div>

                    <div className="mt-5 space-y-4 text-sm">
                      <p>Dear <span className="font-semibold">{leadName || "Applicant"}</span>,</p>
                      <p className="leading-relaxed text-muted-foreground">
                        Congratulations. We are pleased to offer you provisional admission to the selected programme. Pay the token fee before the acceptance deadline to confirm your seat.
                      </p>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[
                          ["Admission Route", form.admission_mode === "entrance" ? `Entrance / Counselling${selectedEntranceName ? ` - ${selectedEntranceName}` : ""}` : "Direct Admission"],
                          ["Academic Session", selectedSessionName || "-"],
                          ...(hasSchoolOptions ? [["School Mode", schoolModeLabel]] : []),
                          ["Programme Fee", programmeTotal > 0 ? `₹${programmeTotal.toLocaleString("en-IN")}` : "-"],
                          ["Waivers / Discounts", previewWaiverTotal > 0 ? `₹${previewWaiverTotal.toLocaleString("en-IN")}` : "None"],
                          ["Net Programme Fee", previewNetFee > 0 ? `₹${previewNetFee.toLocaleString("en-IN")}` : "-"],
                          ["Token Fee Payable", Number(form.token_fee_amount || tokenDefault || 0) > 0 ? `₹${Number(form.token_fee_amount || tokenDefault || 0).toLocaleString("en-IN")}` : "-"],
                          ["Acceptance Deadline", form.acceptance_deadline ? new Date(form.acceptance_deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-md border border-border/70 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                            <p className="mt-1 font-medium text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>

                      {isCahetOffer && cahetRegistration && (
                        <div className="rounded-md border border-success/20 bg-success/5 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-success">CAHET Registration</p>
                          <p className="mt-1 text-sm font-semibold text-success-foreground">
                            Registration No. {cahetRegistration.registration_no}
                          </p>
                          {cahetRegistration.notes && (
                            <p className="mt-1 text-xs text-success-foreground/80">{cahetRegistration.notes}</p>
                          )}
                        </div>
                      )}

                      {isCahetOffer && !cahetRegistration && (
                        <div className="rounded-md border border-warning/20 bg-warning/5 p-3 text-sm text-warning-foreground">
                          CAHET is selected, but this candidate is not marked CAHET registered yet. The registration number will appear on the final offer only after registration is recorded.
                        </div>
                      )}

                      {isUpdeledOffer && updeledRegistration && (
                        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">UPDELED Registration</p>
                          <p className="mt-1 text-sm font-semibold text-primary">
                            Registration No. {updeledRegistration.registration_no}
                          </p>
                          {updeledRegistration.notes && (
                            <p className="mt-1 text-xs text-primary/80">{updeledRegistration.notes}</p>
                          )}
                        </div>
                      )}

                      {isUpdeledOffer && !updeledRegistration && (
                        <div className="rounded-md border border-warning/20 bg-warning/5 p-3 text-sm text-warning-foreground">
                          UPDELED is selected, but this candidate is not marked UPDELED registered yet. The registration number will appear on the final offer only after registration is recorded.
                        </div>
                      )}

                      {yearTotals.length > 0 && (
                        <div className="rounded-md border border-border/70">
                          <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fee Structure</div>
                          <div className="divide-y divide-border/60">
                            {yearTotals.map((year) => (
                              <div key={year.term} className="flex items-center justify-between px-3 py-2">
                                <span>{year.label}</span>
                                <span className="font-medium">₹{year.total.toLocaleString("en-IN")}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : !selectedOffer ? (
                <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                  <div className="text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No offer selected.</p>
                    <p className="text-xs mt-1">Issue a new offer to see its PDF preview here.</p>
                  </div>
                </div>
              ) : selectedOffer.letter_url ? (
                <iframe
                  // Key bump forces React to fully remount the iframe element,
                  // which triggers a fresh fetch. The stored PDF carries
                  // `cache-control: no-cache` so the browser revalidates and
                  // picks up the regenerated bytes even though the URL path
                  // didn't change (storage upload is upsert-in-place).
                  key={`${selectedOffer.id}:${pdfBust}`}
                  src={`${selectedOffer.letter_url}?cb=${pdfBust}`}
                  title="Offer letter preview"
                  className="absolute inset-0 w-full h-full border-0"
                />
              ) : selectedOffer.approval_status === "approved" ? (
                <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                  <div className="space-y-3">
                    <FileText className="h-10 w-10 mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-foreground font-medium">PDF not generated yet</p>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      The offer is approved but the letter PDF wasn't created. Generate it now to share with the student.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => regeneratePdf(selectedOffer.id)}
                      disabled={regeneratingId === selectedOffer.id}
                      className="gap-1.5"
                    >
                      {regeneratingId === selectedOffer.id
                        ? <><ButtonOrb state="composing" onFilled /> Generating…</>
                        : <><FileText className="h-3.5 w-3.5" /> Generate PDF</>}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                  <div className="text-muted-foreground">
                    <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Awaiting approval</p>
                    <p className="text-xs mt-1">PDF will be generated once the offer is approved.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
