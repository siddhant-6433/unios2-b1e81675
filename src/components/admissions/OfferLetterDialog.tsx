import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Plus, Gift, CheckCircle, XCircle, ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";

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
  const [form, setForm] = useState({ total_fee: "", scholarship_amount: "0", acceptance_deadline: "", session_id: "" });
  const [sessions, setSessions] = useState<SessionOption[]>([]);
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
    }
    setLoading(false);
  };

  // Trigger PDF regeneration and poll until letter_url updates (or 20s elapse).
  // Used both as a "Generate PDF" call when letter_url is null and as a manual
  // "Regenerate" action when staff want to refresh an existing letter.
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
      // Poll for the freshly written letter_url. The generator updates the row
      // synchronously, so usually one fetch is enough; we poll for resilience.
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const { data } = await supabase.from("offer_letters").select("*").eq("id", offerId).single();
        if (data?.letter_url) {
          await fetchOffers();
          // Bump cache-bust so the iframe re-fetches even though the URL
          // path didn't change (upsert overwrites in place).
          setPdfBust(Date.now());
          toast({ title: "PDF ready" });
          return;
        }
      }
      toast({ title: "Still preparing", description: "PDF is taking longer than usual — refresh in a minute." });
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

  const handleCreate = async () => {
    const totalFee = Number(form.total_fee);
    const scholarship = Number(form.scholarship_amount) || 0;
    if (!totalFee || totalFee <= 0) { toast({ title: "Error", description: "Enter valid total fee", variant: "destructive" }); return; }

    setSaving(true);
    // If super_admin or principal issues directly, it's auto-approved.
    // Otherwise (counsellor, admission_head, campus_admin) it needs principal approval.
    const autoApproved = isPrincipalOrAbove;
    const approvalStatus = autoApproved ? "approved" : "pending_principal";

    if (!form.session_id) { toast({ title: "Pick an academic session", variant: "destructive" }); setSaving(false); return; }

    const { data: insertedOffer, error } = await supabase.from("offer_letters").insert({
      lead_id: leadId,
      total_fee: totalFee,
      scholarship_amount: scholarship,
      net_fee: totalFee - scholarship,
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
      // Only advance lead stage if the offer is approved (not pending)
      if (autoApproved) {
        await supabase.from("leads").update({ stage: "offer_sent" as any, offer_amount: totalFee - scholarship }).eq("id", leadId);
      }
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "offer",
        description: autoApproved
          ? `Offer letter issued: ₹${(totalFee - scholarship).toLocaleString("en-IN")} (Scholarship: ₹${scholarship.toLocaleString("en-IN")})`
          : `Offer letter submitted for principal approval: ₹${(totalFee - scholarship).toLocaleString("en-IN")}`,
      });
      // If approved on create, generate the PDF immediately and poll for it
      // so the preview pane lights up without needing a manual refresh.
      if (autoApproved && insertedOffer?.id) {
        setSelectedOfferId(insertedOffer.id);
        regeneratePdf(insertedOffer.id).catch(() => {});
      }

      toast({
        title: autoApproved ? "Offer letter created" : "Offer submitted for approval",
        description: autoApproved ? "PDF will be ready in a few seconds." : "Principal will review and approve this offer.",
      });
      setShowForm(false);
      setForm({ total_fee: "", scholarship_amount: "0", acceptance_deadline: "", session_id: "" });
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Total Fee (₹) *</label>
                    <input type="number" value={form.total_fee} onChange={e => setForm(p => ({ ...p, total_fee: e.target.value }))} className={inputCls} placeholder="100000" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Scholarship (₹)</label>
                    <input type="number" value={form.scholarship_amount} onChange={e => setForm(p => ({ ...p, scholarship_amount: e.target.value }))} className={inputCls} />
                  </div>
                </div>
                {form.total_fee && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-pastel-green">
                    <Gift className="h-4 w-4 text-foreground/70" />
                    <span className="text-sm font-semibold text-foreground">Net Fee: ₹{(Number(form.total_fee) - Number(form.scholarship_amount || 0)).toLocaleString("en-IN")}</span>
                  </div>
                )}
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
                  <Button onClick={handleCreate} disabled={saving} size="sm" className="gap-1.5">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Issue Offer
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
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
                          <p className="text-xs text-muted-foreground">Total: ₹{offer.total_fee.toLocaleString("en-IN")} · Scholarship: ₹{(offer.scholarship_amount || 0).toLocaleString("en-IN")}</p>
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

                      {/* Mark as accepted/rejected by student (only for approved offers in "issued" state) */}
                      {isApprovedOffer && offer.status === "issued" && (
                        <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => updateOfferStatus(offer.id, "accepted")}>Mark Accepted</Button>
                          <Button size="sm" variant="outline" className="text-xs text-destructive" onClick={() => updateOfferStatus(offer.id, "rejected")}>Mark Rejected</Button>
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
                  src={selectedOffer.letter_url}
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
