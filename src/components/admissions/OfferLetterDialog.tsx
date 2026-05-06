import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Plus, Gift, CheckCircle, XCircle, ShieldCheck, RefreshCw, ExternalLink, Pencil, Coins, Trash2 } from "lucide-react";

interface OfferLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  courseId: string | null;
  campusId: string | null;
  onSuccess: () => void;
}

interface OfferLetter {
  id: string;
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
}

interface SessionOption { id: string; name: string; is_active: boolean }

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
}

export function OfferLetterDialog({ open, onOpenChange, leadId, leadName, courseId, campusId, onSuccess }: OfferLetterDialogProps) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [offers, setOffers] = useState<OfferLetter[]>([]);
  const isApprover = role === "super_admin" || role === "principal";
  const isPrincipalOrAbove = isApprover;
  const isSuperAdmin = role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Note: scholarship is no longer collected here — discounts are applied as
  // waivers after the offer is issued. Total fee is also no longer typed by
  // the user — it comes directly from the published fee_structure for the
  // selected course + session.
  const [form, setForm] = useState({ acceptance_deadline: "", session_id: "", token_fee_amount: "" });
  const [tokenFeeEdited, setTokenFeeEdited] = useState(false);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  // First-year fee for the picked session — used to default + floor the token fee.
  const [firstYearFee, setFirstYearFee] = useState<number>(0);
  // Term keys present in the active fee structure (e.g. ['year_1', 'year_2']) —
  // drives the year picker in the Add-Waiver inline form.
  const [availableTerms, setAvailableTerms] = useState<string[]>([]);
  // Per-year totals from the active fee structure, used for the summary card
  // at offer-creation time and for stamping offer.total_fee.
  const [yearTotals, setYearTotals] = useState<{ term: string; total: number }[]>([]);
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
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  // Which offer's PDF is showing in the right-hand preview pane.
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  // Tracks an in-flight generate-offer-letter call so the preview pane can
  // show a spinner instead of an empty placeholder while waiting.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Bumped after every regenerate so the iframe url changes (?v=<n>) and the
  // browser actually fetches the new bytes — the storage path is reused on
  // upsert, so without this the cached PDF stays on screen.
  const [pdfBust, setPdfBust] = useState<number>(() => Date.now());

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
          .select("id, offer_letter_id, term, amount, reason, status, requested_by_name, requested_by_role, approved_by_name, rejection_reason, created_at")
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
        body: { offer_letter_id: offerId },
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
    } finally {
      setRegeneratingId(null);
    }
  };

  useEffect(() => { if (open) fetchOffers(); }, [open]);

  // Pull sessions whenever the form opens so the select has data + the active
  // session is preselected as default for the offer.
  useEffect(() => {
    if (!showForm) return;
    supabase.from("admission_sessions").select("id, name, is_active").order("name", { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as SessionOption[];
        setSessions(list);
        const active = list.find(s => s.is_active);
        setForm(p => ({ ...p, session_id: p.session_id || active?.id || (list[0]?.id ?? "") }));
      });
  }, [showForm]);

  // Resolve the first-year fee + the list of available year terms for the
  // picked course+session pair. firstYearFee drives token-fee defaults;
  // availableTerms drives the year picker in the Add-Waiver form.
  useEffect(() => {
    if (!courseId) { setFirstYearFee(0); setAvailableTerms([]); setYearTotals([]); return; }
    // For waiver picker, use the offer's session if any are loaded; otherwise
    // fall back to form.session_id (when the new-offer form is open).
    const sessionId = form.session_id || (offers.find(o => !!o.session_id)?.session_id || "");
    if (!sessionId) { setFirstYearFee(0); setAvailableTerms([]); setYearTotals([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("fee_structures")
        .select("id, fee_structure_items ( term, amount )")
        .eq("course_id", courseId)
        .eq("session_id", sessionId)
        .eq("is_active", true)
        .maybeSingle();
      if (cancelled) return;
      const items: any[] = (data as any)?.fee_structure_items ?? [];
      // Sum per year_N term so we have both Year-1 (for token math) and the
      // full per-year breakdown (for the summary card + offer.total_fee).
      const byTerm = new Map<string, number>();
      for (const it of items) {
        const t = String(it?.term || "");
        if (!/^year_\d+$/.test(t)) continue;
        byTerm.set(t, (byTerm.get(t) || 0) + Number(it?.amount || 0));
      }
      const sorted = Array.from(byTerm.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([term, total]) => ({ term, total }));
      const y1 = byTerm.get("year_1") || 0;
      setFirstYearFee(y1);
      setYearTotals(sorted);
      setAvailableTerms(sorted.length ? sorted.map(s => s.term) : ["year_1"]);
    })().catch(() => { setFirstYearFee(0); setAvailableTerms([]); setYearTotals([]); });
    return () => { cancelled = true; };
  }, [courseId, form.session_id, offers]);

  // Programme total = sum of year_N items from the published fee structure.
  // This is the canonical source of truth for the offer's "total fee" — the
  // form no longer asks the user to type it.
  const programmeTotal = yearTotals.reduce((sum, y) => sum + y.total, 0);

  // Default the token fee to 25% of Year-1 whenever inputs change AND the
  // user hasn't manually edited the field. Floor at max(10% of Year-1, ₹5K).
  // Waivers are added AFTER the offer exists, so at creation time we anchor
  // to the raw Year-1 fee — once a waiver is approved later, the token
  // threshold (lead_fee_status.token_required) drops accordingly.
  const tokenFloor = firstYearFee > 0
    ? Math.max(Math.round(firstYearFee * 0.10), 5000)
    : 5000;
  const tokenDefault = firstYearFee > 0
    ? Math.max(Math.round(firstYearFee * 0.25), tokenFloor)
    : 0;

  useEffect(() => {
    if (!showForm || tokenFeeEdited) return;
    if (firstYearFee <= 0) return;
    setForm(p => ({ ...p, token_fee_amount: String(tokenDefault) }));
  }, [showForm, tokenFeeEdited, firstYearFee, tokenDefault]);

  const handleCreate = async () => {
    // Total fee is auto-derived from the published fee structure — no user input.
    const totalFee = programmeTotal;
    if (!totalFee || totalFee <= 0) {
      toast({
        title: "No fee structure published",
        description: "The selected course + session doesn't have an active fee structure with year-wise items. Publish one in Course & Campus master before issuing offers.",
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
        description: `Token fee cannot be lower than ₹${tokenFloor.toLocaleString("en-IN")} (the greater of 10% of Year-1 fee and ₹5,000).`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    // If super_admin or principal issues directly, it's auto-approved.
    // Otherwise (counsellor, admission_head, campus_admin) it needs principal approval.
    const autoApproved = isPrincipalOrAbove;
    const approvalStatus = autoApproved ? "approved" : "pending_principal";

    if (!form.session_id) { toast({ title: "Pick an academic session", variant: "destructive" }); setSaving(false); return; }

    const { data: insertedOffer, error } = await supabase.from("offer_letters").insert({
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
      acceptance_deadline: form.acceptance_deadline || null,
      course_id: courseId,
      campus_id: campusId,
      session_id: form.session_id,
      issued_by: user?.id || null,
      approval_status: approvalStatus,
      approved_by: autoApproved ? user?.id || null : null,
      approved_at: autoApproved ? new Date().toISOString() : null,
    } as any).select("id").single();

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      // Bulk-insert any pre-issuance waivers the user staged in the form.
      if (insertedOffer?.id && preWaivers.length > 0) {
        await supabase.from("offer_waivers").insert(
          preWaivers.map(w => ({
            offer_letter_id: insertedOffer.id,
            term: w.term,
            amount: w.amount,
            reason: w.reason || null,
          })) as any
        );
      }
      // Only advance lead stage if the offer is approved (not pending)
      if (autoApproved) {
        await supabase.from("leads").update({ stage: "offer_sent" as any, offer_amount: totalFee }).eq("id", leadId);
      }
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: autoApproved
          ? `Offer letter issued: ₹${totalFee.toLocaleString("en-IN")}`
          : `Offer letter submitted for principal approval: ₹${totalFee.toLocaleString("en-IN")}`,
      });
      // If approved on create, generate the PDF immediately and poll for it
      // so the preview pane lights up without needing a manual refresh.
      if (autoApproved && insertedOffer?.id) {
        setSelectedOfferId(insertedOffer.id);
        await regeneratePdf(insertedOffer.id);
      }

      toast({
        title: autoApproved ? "Offer letter created" : "Offer submitted for approval",
        description: autoApproved ? "PDF will be ready in a few seconds." : "Principal will review and approve this offer.",
      });
      setShowForm(false);
      setForm({ acceptance_deadline: "", session_id: "", token_fee_amount: "" });
      setTokenFeeEdited(false);
      setPreWaivers([]);
      setShowPreWaiverForm(false);
      setPreWaiverForm({ term: "year_1", amount: "", reason: "" });
      fetchOffers();
      onSuccess();
    }
    setSaving(false);
  };

  const decideOffer = async (offerId: string, decision: "approved" | "rejected", reason?: string) => {
    if (!isApprover) return;
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
        await supabase.from("leads").update({ stage: "offer_sent" as any, offer_amount: offer.net_fee }).eq("id", leadId);
      }
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: `Offer letter approved by ${role === "principal" ? "principal" : "super admin"}`,
      });
      // Fire the PDF generator now that the offer is officially approved.
      setSelectedOfferId(offerId);
      regeneratePdf(offerId).catch(() => {});
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
      toast({ title: "Pick a year for this waiver", variant: "destructive" });
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
    pending_principal: "bg-amber-100 text-amber-700 border-amber-200",
    approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
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
          {!showForm && (
            <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Offer</Button>
          )}

          {showForm && (
            <Card className="border-border/60">
              <CardContent className="p-4 space-y-3">
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
                          <span className="text-muted-foreground">{y.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                          <span className="text-foreground tabular-nums">₹{y.total.toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1 border-t border-border/40 font-semibold">
                        <span>Total Programme Fee</span>
                        <span className="tabular-nums">₹{programmeTotal.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                      No active fee structure published for this course + session. Publish one in Course & Campus master before issuing.
                    </div>
                  )}
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70 leading-relaxed">
                    Sourced from the published fee structure for the selected session. Add year-wise discounts (scholarship, sibling, alumni, hardship etc.) as waivers below before issuing.
                  </p>
                </div>

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
                            setPreWaiverForm({ term: availableTerms[0] || "year_1", amount: "", reason: "" });
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
                            <span className="text-muted-foreground">{w.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
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
                          const totalWaiver = preWaivers.reduce((s, w) => s + w.amount, 0);
                          const netFee = programmeTotal - totalWaiver;
                          return (
                            <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold border-t border-border/40 pt-1.5 mt-1">
                              <span>Net Programme Fee</span>
                              <span className="tabular-nums text-emerald-700">₹{netFee.toLocaleString("en-IN")}</span>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {showPreWaiverForm && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Year</label>
                            <select
                              value={preWaiverForm.term}
                              onChange={e => setPreWaiverForm(p => ({ ...p, term: e.target.value }))}
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                            >
                              {availableTerms.map(t => (
                                <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Amount (₹)</label>
                            <input
                              type="number"
                              value={preWaiverForm.amount}
                              onChange={e => setPreWaiverForm(p => ({ ...p, amount: e.target.value }))}
                              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                              placeholder="10000"
                            />
                          </div>
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
                          <p className="text-[10px] text-amber-700">
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
                              setPreWaivers(prev => [...prev, { term: preWaiverForm.term, amount: amt, reason: preWaiverForm.reason }]);
                              setShowPreWaiverForm(false);
                              setPreWaiverForm({ term: availableTerms[0] || "year_1", amount: "", reason: "" });
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

                {/* Token fee — defaults to 25% of Year-1, editable but floored at
                    max(10% of Year-1, ₹5,000). The pencil icon flips edit mode;
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
                    onChange={e => setForm(p => ({ ...p, token_fee_amount: e.target.value }))}
                    className={`${inputCls} ${!tokenFeeEdited ? "bg-muted/40 cursor-default" : ""}`}
                    placeholder={tokenDefault > 0 ? String(tokenDefault) : "—"}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground/70 leading-relaxed">
                    {firstYearFee > 0 ? (
                      tokenFeeEdited ? (
                        <>
                          Minimum <span className="font-semibold text-foreground">₹{tokenFloor.toLocaleString("en-IN")}</span> —
                          the greater of 10% of Year-1 fee (₹{firstYearFee.toLocaleString("en-IN")}) and ₹5,000.
                        </>
                      ) : (
                        <>Default = 25% of Year-1 fee (₹{firstYearFee.toLocaleString("en-IN")}). Click Edit to override.</>
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
                    Locks the fee structure for this offer. Token amount = 10% of first-year fee from this session's structure.
                    {!isSuperAdmin && " Only super admin can pick a non-active session."}
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Acceptance Deadline</label>
                  <input type="date" value={form.acceptance_deadline} onChange={e => setForm(p => ({ ...p, acceptance_deadline: e.target.value }))} className={inputCls} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreate} disabled={saving || programmeTotal <= 0} size="sm" className="gap-1.5"
                    title={programmeTotal <= 0 ? "Publish a fee structure for this course + session first" : undefined}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Issue Offer
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setPreWaivers([]); setShowPreWaiverForm(false); setPreWaiverForm({ term: "year_1", amount: "", reason: "" }); }}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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
                          {isSuperAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteOffer(offer.id); }}
                              disabled={deletingOfferId === offer.id}
                              className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                              title="Delete offer letter"
                            >
                              {deletingOfferId === offer.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Trash2 className="h-3 w-3" />}
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span>Issued: {new Date(offer.created_at).toLocaleDateString("en-IN")}</span>
                        {offer.acceptance_deadline && <span>Deadline: {new Date(offer.acceptance_deadline).toLocaleDateString("en-IN")}</span>}
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
                                    setWaiverForm({ term: availableTerms[0] || "year_1", amount: "", reason: "" });
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
                              const yearLabel = w.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                              const statusCls =
                                w.status === "approved"  ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                                w.status === "rejected"  ? "bg-red-100 text-red-700 border-red-200" :
                                                           "bg-amber-100 text-amber-700 border-amber-200";
                              return (
                                <div key={w.id} className="rounded-md border border-border/50 bg-background/50 p-2 text-xs space-y-1">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold">{yearLabel}</span>
                                      <span className="text-foreground/70">−₹{Number(w.amount).toLocaleString("en-IN")}</span>
                                      <Badge className={`text-[9px] border ${statusCls}`}>{w.status}</Badge>
                                    </div>
                                    {w.status === "pending" && isSuperAdmin && (
                                      <div className="flex gap-1">
                                        <button
                                          disabled={waiverDecidingId === w.id}
                                          onClick={() => handleDecideWaiver(w, "approved")}
                                          className="rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
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
                                      {w.requested_by_name && (
                                        <div>Requested by {w.requested_by_name}{w.requested_by_role ? ` (${w.requested_by_role})` : ""}</div>
                                      )}
                                      {w.status === "approved" && w.approved_by_name && (
                                        <div className="text-emerald-700">Approved by {w.approved_by_name}</div>
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
                                    <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Year</label>
                                    <select
                                      value={waiverForm.term}
                                      onChange={e => setWaiverForm(p => ({ ...p, term: e.target.value }))}
                                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    >
                                      {availableTerms.map(t => (
                                        <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Amount (₹)</label>
                                    <input
                                      type="number"
                                      value={waiverForm.amount}
                                      onChange={e => setWaiverForm(p => ({ ...p, amount: e.target.value }))}
                                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                      placeholder="10000"
                                    />
                                  </div>
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
                                  <p className="text-[10px] text-amber-700">
                                    This waiver will need super admin approval before it appears on the offer letter.
                                  </p>
                                )}
                                <div className="flex gap-2">
                                  <Button size="sm" className="text-xs h-7" disabled={waiverSaving} onClick={() => handleAddWaiver(offer.id)}>
                                    {waiverSaving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
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
                          <Button size="sm" className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => decideOffer(offer.id, "approved")}>
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

          {/* ─── Right: PDF preview pane ─── */}
          <div className="flex flex-col bg-muted/20 min-h-[400px]">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {selectedOffer ? `Preview · ₹${selectedOffer.net_fee.toLocaleString("en-IN")}` : "Preview"}
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
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <RefreshCw className="h-3 w-3" />}
                      Regenerate
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 relative">
              {!selectedOffer ? (
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
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
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
