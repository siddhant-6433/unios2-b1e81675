import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard, FileText, IndianRupee, Clock, Check, GraduationCap, Sparkles, ChevronRight } from "lucide-react";

type FeeStatus = {
  first_year_fee: number;
  post_scholarship_year_1: number;
  total_course_fee: number;
  additional_years_fee: number;
  token_required: number;
  token_paid: number;
  application_paid: number;
  total_paid: number;
  twenty_five_pct: number;
  min_token_instalment?: number;
  token_complete: boolean;
  token_completed_at?: string | null;
  twenty_five_complete: boolean;
  lump_sum_pct?: number;
  multi_year_pct?: number;
  multi_year_window_days?: number;
  within_multi_year_window?: boolean;
  multi_year_window_expires_at?: string | null;
  full_first_year_discount?: number;
  full_first_year_amount_due?: number;
  full_course_discount?: number;
  full_course_amount_due?: number;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  session_id: string | null;
  token_amount: number | null;
  pre_admission_no: string | null;
  admission_no: string | null;
}

interface Offer {
  id: string;
  total_fee: number;
  scholarship_amount: number | null;
  net_fee: number;
  approval_status: string;
  status: string;
  acceptance_deadline: string | null; // date string e.g. "2026-06-30"
  created_at: string;
  letter_url: string | null;
}

interface Props {
  applicationId: string;
  leadId?: string | null;
  applicantName: string;
  applicantPhone: string | null;
  applicantEmail: string | null;
  onPayment?: () => void;
}

export function TokenFeePanel({ applicationId, leadId: leadIdProp, applicantName, applicantPhone, applicantEmail, onPayment }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [feeStatus, setFeeStatus] = useState<FeeStatus | null>(null);
  const [yearFees, setYearFees] = useState<Record<string, number>>({});
  const [offerWaivers, setOfferWaivers] = useState<{ term: string; amount: number }[]>([]);
  const [payments, setPayments] = useState<{
    id: string; receipt_no: string | null; type: string; amount: number;
    concession_amount: number; status: string; payment_date: string | null;
    created_at: string; receipt_url: string | null; waiver_reason: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [showInstalment, setShowInstalment] = useState(false);
  const [instalmentPreset, setInstalmentPreset] = useState<number | null>(null);
  const [customAmt, setCustomAmt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    setLoading(true);
    setError(null);

    // leads table is staff-only via RLS. Use SECURITY DEFINER RPCs so the
    // anon applicant key can read the fields it needs.
    let resolvedLeadId: string | null = leadIdProp || null;

    // If no leadId prop, resolve via application_id → lead_id through the
    // get_applicant_offer RPC (which already joins applications → leads).
    if (!resolvedLeadId) {
      const { data: offerPeek, error: peekErr } = await (supabase as any).rpc("get_applicant_offer", { _application_id: applicationId });
      if (peekErr) { setError(`[diag] get_applicant_offer error: ${peekErr.message}`); setLoading(false); return; }
      resolvedLeadId = offerPeek?.[0]?.lead_id || null;
    }

    if (!resolvedLeadId) {
      setError(`[diag] no lead_id — prop=${leadIdProp}, appId=${applicationId}`);
      setLoading(false);
      return;
    }

    // Fetch lead info + offer + fee status in parallel via SECURITY DEFINER functions.
    const [leadRes, statusRes, offerRes, yearRes] = await Promise.all([
      (supabase as any).rpc("get_applicant_lead_info", { _lead_id: resolvedLeadId }),
      supabase.rpc("lead_fee_status" as any, { _lead_id: resolvedLeadId }),
      (supabase as any).rpc("get_applicant_offer", { _application_id: applicationId }),
      supabase.rpc("lead_year_fees" as any, { _lead_id: resolvedLeadId }),
    ]);

    const diagParts: string[] = [];
    if (leadRes.error)   diagParts.push(`lead_info err: ${leadRes.error.message}`);
    if (statusRes.error) diagParts.push(`fee_status err: ${statusRes.error.message}`);
    if (offerRes.error)  diagParts.push(`offer err: ${offerRes.error.message}`);
    if (yearRes.error)   diagParts.push(`year_fees err: ${yearRes.error.message}`);
    if (diagParts.length) { setError(`[diag] lead=${resolvedLeadId}\n${diagParts.join("\n")}`); setLoading(false); return; }

    // Fetch per-term waivers and payment history in parallel.
    const offerId = (offerRes.data as any[])?.[0]?.id;
    const [waiverRes, payRes] = await Promise.all([
      offerId ? (supabase as any).rpc("get_applicant_offer_waivers", { _offer_id: offerId }) : Promise.resolve({ data: [] }),
      (supabase as any).rpc("get_applicant_payments", { _lead_id: resolvedLeadId }),
    ]);
    setOfferWaivers((waiverRes.data || []).map((w: any) => ({ term: w.term, amount: Number(w.amount) })));
    setPayments(payRes.data || []);

    const leadRow = (leadRes.data as any[])?.[0];
    if (!leadRow) {
      setError(`[diag] get_applicant_lead_info returned 0 rows for lead=${resolvedLeadId}`);
      setLoading(false);
      return;
    }

    const status   = statusRes.data;
    const offerRows = offerRes.data as any[] | null;
    const yearMap  = yearRes.data;

    // Merge the applicant-facing fields (name/phone/email come from the parent props)
    // with the RPC-fetched fields.
    setLead({
      id: leadRow.id,
      name: applicantName,
      phone: applicantPhone || "",
      email: applicantEmail,
      stage: leadRow.stage,
      session_id: leadRow.session_id,
      token_amount: null,
      pre_admission_no: leadRow.pre_admission_no,
      admission_no: leadRow.admission_no,
    } as Lead);

    if (status) setFeeStatus(status as FeeStatus);
    if (offerRows && offerRows.length > 0) setOffer(offerRows[0] as Offer);
    if (yearMap && typeof yearMap === "object") {
      const norm: Record<string, number> = {};
      Object.entries(yearMap as Record<string, any>).forEach(([k, v]) => { norm[k] = Number(v); });
      setYearFees(norm);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [applicationId]);

  // Tick a clock once a second so the multi-year countdown stays live
  // (only when there's an active window we care about).
  useEffect(() => {
    const expiresAt = feeStatus?.multi_year_window_expires_at
      ? new Date(feeStatus.multi_year_window_expires_at).getTime()
      : null;
    if (!expiresAt || expiresAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [feeStatus?.multi_year_window_expires_at]);

  // Listen for the popup's success/failure ping.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.eb_payment === "success") {
        // Refresh after a beat — gives the trigger time to commit.
        setTimeout(() => load(), 1500);
        onPayment?.();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPayment = async (
    amount: number,
    opts: { paymentType?: string; productinfo?: string; concession?: number; reason?: string; concessionBreakdown?: Record<string, number> } = {},
  ) => {
    if (!lead || !applicantPhone) return;
    if (amount <= 0) { setError("Enter a valid amount"); return; }

    // Open blank window synchronously — browsers block window.open() called
    // after an await because the user-gesture chain is broken in async context.
    const payWin = window.open("about:blank", "_blank");

    setPaying(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("easebuzz-payment", {
        body: {
          action: "initiate-lead-payment",
          lead_id: lead.id,
          payment_type: opts.paymentType || "token_fee",
          amount,
          firstname: applicantName.split(" ")[0] || applicantName,
          email: applicantEmail || undefined,
          phone: applicantPhone,
          productinfo: opts.productinfo || "Token Fee",
          concession_amount: opts.concession || 0,
          waiver_reason: opts.reason || null,
          concession_breakdown: opts.concessionBreakdown || null,
        },
      });
      if (invErr) {
        // FunctionsHttpError.message is always "Edge Function returned a non-2xx status code".
        // The real error is in invErr.context (a Response object) — extract it.
        let detail = invErr.message;
        try {
          const ctx = (invErr as any).context;
          const body = ctx?.json ? await ctx.json() : (ctx?.text ? await ctx.text() : null);
          if (body?.error) detail = body.error;
          else if (typeof body === "string" && body) detail = body;
        } catch (_) {}
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.pay_url) throw new Error("No payment URL returned");
      if (payWin) {
        payWin.location.href = data.pay_url;
      } else {
        // Popup was blocked — fall back to same-tab redirect
        window.location.href = data.pay_url;
      }
    } catch (e: any) {
      payWin?.close();
      setError(e?.message || "Failed to start payment");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking offer status…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap font-mono">
        {error}
      </div>
    );
  }

  if (!lead) return null;
  // No approved offer yet — nothing to show beyond a polite hint.
  if (!offer) return null;
  if (!feeStatus || feeStatus.first_year_fee <= 0) {
    return (
      <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        Offer letter is ready, but the fee structure for your course/session isn't published yet. Please contact admissions.
      </div>
    );
  }

  const tokenOutstanding = Math.max(0, feeStatus.token_required - feeStatus.token_paid);
  // Application fee is a separate charge — exclude it from course fee progress tracking.
  const coursePaid = feeStatus.total_paid - feeStatus.application_paid;
  const towardsAdmission = Math.max(0, feeStatus.twenty_five_pct - coursePaid);
  const minInstalment = feeStatus.min_token_instalment ?? 5000;
  const isAdmitted = !!lead.admission_no;
  const isPreAdmitted = !!lead.pre_admission_no;

  // Deadline calculations
  const deadlineDate = offer.acceptance_deadline ? new Date(offer.acceptance_deadline) : null;
  const daysLeft = deadlineDate ? Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000) : null;
  const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;
  const isExpired = daysLeft !== null && daysLeft < 0;

  // Multi-year waiver calculations
  const showFullCourse = (feeStatus.lump_sum_pct || 0) > 0
    && (feeStatus.additional_years_fee || 0) > 0
    && (feeStatus.full_course_amount_due || 0) > 0;
  const multiYearExpiresAt = feeStatus.multi_year_window_expires_at
    ? new Date(feeStatus.multi_year_window_expires_at).getTime() : null;
  const inMultiYearWindow = !!feeStatus.within_multi_year_window;
  const multiYearRemainingMs = multiYearExpiresAt ? multiYearExpiresAt - now : null;
  const showMultiYearTimer = inMultiYearWindow && multiYearRemainingMs !== null && multiYearRemainingMs > 0;

  // Milestone dates
  const tokenPaidAt = feeStatus.token_completed_at ? new Date(feeStatus.token_completed_at) : null;
  // After token is paid: actual due = paid date + 5 days.
  // Before token is paid: estimated due = token fee deadline + 5 days (so candidate knows in advance).
  const confirmDueDate = tokenPaidAt
    ? new Date(tokenPaidAt.getTime() + 5 * 86400000)
    : deadlineDate
    ? new Date(deadlineDate.getTime() + 5 * 86400000)
    : null;
  const semesterFeeDeadline = new Date("2026-06-15");
  const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);

  return (
    <div className="mt-4 space-y-3">

      {/* ── Hero Banner ─────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-200">Offer Issued</p>
            </div>
            <h3 className="text-xl font-bold leading-tight">Congratulations! 🎉</h3>
            <p className="text-sm text-blue-100 mt-1 leading-snug">
              Your seat is reserved. Complete the steps below to secure your admission.
            </p>
          </div>
          {offer.letter_url && (
            <a
              href={offer.letter_url} target="_blank" rel="noopener"
              className="shrink-0 inline-flex flex-col items-center gap-1 rounded-xl bg-white/15 hover:bg-white/25 active:bg-white/30 px-3 py-2.5 text-white transition-colors"
            >
              <FileText className="h-5 w-5" />
              <span className="text-[10px] font-semibold">Offer Letter</span>
            </a>
          )}
        </div>

        {/* Deadline strip */}
        {deadlineDate && (
          <div className={`mt-3 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 ${
            isExpired ? "bg-red-600/40 border border-red-400/40"
            : isUrgent ? "bg-orange-500/30 border border-orange-400/40"
            : "bg-white/10"
          }`}>
            <Clock className="h-4 w-4 shrink-0 text-white/80" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white">
                Token fee due by {deadlineDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </p>
              <p className={`text-[11px] font-medium mt-0.5 ${
                isExpired ? "text-red-200" : isUrgent ? "text-orange-200" : "text-blue-200"
              }`}>
                {isExpired
                  ? "Deadline passed — contact admissions immediately"
                  : daysLeft === 0 ? "Due today!"
                  : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining to pay token fee`}
              </p>
            </div>
            {isUrgent && !isExpired && (
              <span className="shrink-0 text-[10px] font-bold text-orange-200 bg-orange-500/30 rounded-full px-2 py-0.5 animate-pulse">URGENT</span>
            )}
          </div>
        )}
      </div>

      {/* ── Journey Steps ──────────────────────────────── */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-gray-50">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Your Admission Journey</p>
        </div>

        <div className="p-3 space-y-2">
          {/* Step 1 — Token Fee */}
          {(() => {
            const done = feeStatus.token_complete;
            const active = !done;
            return (
              <div className={`rounded-xl p-3 border transition-all ${
                done ? "border-green-200 bg-green-50"
                : "border-blue-200 bg-blue-50 ring-1 ring-blue-300/40"
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-sm shadow-sm ${
                    done ? "bg-green-500 text-white" : "bg-blue-600 text-white"
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : "1"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className={`text-sm font-bold ${done ? "text-green-800" : "text-blue-900"}`}>
                        Pay Token Fee
                      </p>
                      {done
                        ? <span className="text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">Completed ✓</span>
                        : <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full">Action Required</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                      Pay 10% of first-year fee to secure your seat and receive your Pre-Admission Number.
                      {tokenOutstanding > minInstalment && !done && ` You can pay in instalments of ₹${minInstalment.toLocaleString("en-IN")} or more.`}
                    </p>
                    <div className="mt-2.5 h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${done ? "bg-green-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.min(100, (feeStatus.token_paid / Math.max(1, feeStatus.token_required)) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[11px] text-gray-500">
                      <span>Paid: ₹{feeStatus.token_paid.toLocaleString("en-IN")}</span>
                      <span>Target: ₹{feeStatus.token_required.toLocaleString("en-IN")}</span>
                    </div>
                    {isPreAdmitted && lead.pre_admission_no && (
                      <p className="mt-1.5 text-xs text-emerald-700 font-semibold">✓ Pre-Admission No: {lead.pre_admission_no}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Step 2 — Pre-Admission Number */}
          <div className={`rounded-xl p-3 border ${isPreAdmitted ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"}`}>
            <div className="flex items-start gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-sm ${
                isPreAdmitted ? "bg-green-500 text-white shadow-sm" : "bg-gray-200 text-gray-500"
              }`}>
                {isPreAdmitted ? <Check className="h-4 w-4" /> : "2"}
              </div>
              <div>
                <p className={`text-sm font-semibold ${isPreAdmitted ? "text-green-800" : "text-gray-500"}`}>
                  Receive Pre-Admission Number
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Issued automatically once token fee target is reached
                </p>
              </div>
            </div>
          </div>

          {/* Step 3 — Confirm Admission (25%) */}
          {(() => {
            const done = feeStatus.twenty_five_complete;
            const active = isPreAdmitted && !done;
            const dLeft = confirmDueDate ? daysUntil(confirmDueDate) : null;
            const confirmUrgent = dLeft !== null && dLeft <= 2 && dLeft >= 0;
            const confirmExpired = dLeft !== null && dLeft < 0;
            return (
              <div className={`rounded-xl p-3 border ${
                done ? "border-green-200 bg-green-50"
                : active ? "border-emerald-200 bg-emerald-50 ring-1 ring-emerald-300/40"
                : "border-gray-100 bg-gray-50"
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-sm ${
                    done ? "bg-green-500 text-white shadow-sm"
                    : active ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-gray-200 text-gray-500"
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : "3"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${done ? "text-green-800" : active ? "text-emerald-900" : "text-gray-500"}`}>
                        Confirm Admission
                      </p>
                      {done && <span className="text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">Completed ✓</span>}
                      {!done && confirmUrgent && <span className="text-[10px] font-bold text-orange-700 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full animate-pulse">URGENT</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pay 25% of first-year fee (₹{feeStatus.twenty_five_pct.toLocaleString("en-IN")}) → Admission Number issued
                    </p>
                    {/* Deadline strip — always visible */}
                    {!done && (
                      <div className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold w-fit ${
                        confirmExpired    ? "bg-red-100 text-red-700"
                        : confirmUrgent  ? "bg-orange-100 text-orange-700"
                        : confirmDueDate ? "bg-emerald-100 text-emerald-700"
                        :                  "bg-gray-100 text-gray-500"
                      }`}>
                        <Clock className="h-3 w-3 shrink-0" />
                        {!confirmDueDate
                          ? "Due within 5 days of token fee payment"
                          : confirmExpired
                          ? `Overdue (was ${fmtDate(confirmDueDate)}) — contact admissions`
                          : dLeft === 0
                          ? `Due today! · ${fmtDate(confirmDueDate)}`
                          : `Due by ${fmtDate(confirmDueDate)} · ${dLeft} day${dLeft !== 1 ? "s" : ""} left`}
                      </div>
                    )}
                    {isPreAdmitted && (
                      <>
                        <div className="mt-2.5 h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${done ? "bg-green-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.min(100, (coursePaid / Math.max(1, feeStatus.twenty_five_pct)) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1 text-[11px] text-gray-500">
                          <span>Paid: ₹{coursePaid.toLocaleString("en-IN")}</span>
                          <span>Target: ₹{feeStatus.twenty_five_pct.toLocaleString("en-IN")}</span>
                        </div>
                      </>
                    )}
                    {isAdmitted && lead.admission_no && (
                      <p className="mt-1.5 text-xs text-emerald-700 font-semibold">✓ Admission No: {lead.admission_no}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Step 4 — First Semester Fee */}
          {(() => {
            const semDaysLeft = daysUntil(semesterFeeDeadline);
            const semDone = isAdmitted && feeStatus.twenty_five_complete; // admitted = semester fee paid or confirmed
            const semActive = isAdmitted && !semDone;
            const semUrgent = !semDone && semDaysLeft <= 7 && semDaysLeft >= 0;
            const semExpired = !semDone && semDaysLeft < 0;
            return (
              <div className={`rounded-xl p-3 border ${
                semDone ? "border-green-200 bg-green-50"
                : semActive ? "border-blue-200 bg-blue-50 ring-1 ring-blue-200/40"
                : "border-gray-100 bg-gray-50"
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-bold text-sm ${
                    semDone ? "bg-green-500 text-white shadow-sm"
                    : semActive ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-200 text-gray-500"
                  }`}>
                    {semDone ? <Check className="h-4 w-4" /> : "4"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${semDone ? "text-green-800" : semActive ? "text-blue-900" : "text-gray-500"}`}>
                        Pay First Semester Fee
                      </p>
                      {semUrgent && !semExpired && <span className="text-[10px] font-bold text-orange-700 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full animate-pulse">URGENT</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pay the remaining first-year fee by {fmtDate(semesterFeeDeadline)} to begin classes.
                    </p>
                    {!semDone && (
                      <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        semExpired ? "bg-red-100 text-red-700"
                        : semUrgent ? "bg-orange-100 text-orange-700"
                        : "bg-blue-100 text-blue-700"
                      }`}>
                        <Clock className="h-3 w-3" />
                        {semExpired
                          ? `Deadline passed — contact admissions immediately`
                          : semDaysLeft === 0 ? "Due today!"
                          : `Due by ${fmtDate(semesterFeeDeadline)} · ${semDaysLeft} day${semDaysLeft !== 1 ? "s" : ""} left`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Step 5 — Classes Begin */}
          <div className={`rounded-xl p-3 border ${isAdmitted ? "border-green-200 bg-gradient-to-r from-green-50 to-emerald-50" : "border-gray-100 bg-gray-50"}`}>
            <div className="flex items-start gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-sm ${
                isAdmitted ? "bg-green-500 text-white shadow-sm" : "bg-gray-200 text-gray-500"
              }`}>
                {isAdmitted ? <GraduationCap className="h-4 w-4" /> : "5"}
              </div>
              <div>
                <p className={`text-sm font-semibold ${isAdmitted ? "text-green-800" : "text-gray-500"}`}>
                  {isAdmitted ? "You're admitted! Welcome to NIMT 🎓" : "Start Your Classes"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isAdmitted
                    ? "Your admission is confirmed. Check your email for onboarding details and orientation schedule."
                    : "Complete the steps above to join NIMT"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Fee Breakdown ──────────────────────────────── */}
      {(() => {
        // Build sorted per-year rows from yearFees
        const yearKeys = Object.keys(yearFees).filter(k => k.startsWith("year_")).sort();
        const scholarship = offer.scholarship_amount || 0;
        // post_scholarship_year_1 bakes in both scholarship + approved year-1 waivers
        const y1Net = feeStatus.post_scholarship_year_1 ?? (feeStatus.first_year_fee - scholarship);

        const rows = yearKeys.map(term => {
          const raw = yearFees[term];
          const termWaivers = offerWaivers.filter(w => w.term === term).reduce((s, w) => s + w.amount, 0);
          const sch = term === "year_1" ? scholarship : 0;
          // For year_1, use the authoritative post-scholarship value from feeStatus
          // (it already accounts for all approved waivers on that term).
          const net = term === "year_1" ? y1Net : raw - termWaivers;
          const totalDeduction = raw - net;
          return { term, raw, sch, waivers: termWaivers, totalDeduction, net };
        });

        const grandRaw = rows.reduce((s, r) => s + r.raw, 0);
        const grandNet = rows.reduce((s, r) => s + r.net, 0);
        const grandDeductions = grandRaw - grandNet;
        const hasMultiYear = yearKeys.length > 1;
        const hasAnyDeduction = grandDeductions > 0;

        const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
        const termLabel = (t: string) => {
          const n = t.replace("year_", "");
          return n === "1" ? "Year 1" : `Year ${n}`;
        };

        return (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-50">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Fee Breakdown</p>
            </div>

            <div className="divide-y divide-gray-50">
              {/* Per-year rows */}
              {rows.map(({ term, raw, sch, waivers, totalDeduction, net }) => (
                <div key={term} className="px-4 py-3 space-y-1.5">
                  {/* Year header */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-800">{termLabel(term)} Fee</span>
                    <span className="text-sm font-semibold text-gray-900">{fmt(raw)}</span>
                  </div>
                  {/* Scholarship */}
                  {sch > 0 && (
                    <div className="flex justify-between items-center pl-3">
                      <span className="text-xs text-emerald-600">Scholarship</span>
                      <span className="text-xs font-medium text-emerald-600">− {fmt(sch)}</span>
                    </div>
                  )}
                  {/* Approved waivers (non-scholarship) */}
                  {waivers > 0 && (
                    <div className="flex justify-between items-center pl-3">
                      <span className="text-xs text-emerald-600">Approved Waiver</span>
                      <span className="text-xs font-medium text-emerald-600">− {fmt(waivers)}</span>
                    </div>
                  )}
                  {/* Net for this year */}
                  {totalDeduction > 0 && (
                    <div className="flex justify-between items-center pl-3 pt-0.5 border-t border-dashed border-gray-100">
                      <span className="text-xs font-semibold text-gray-600">{termLabel(term)} Net</span>
                      <span className="text-xs font-bold text-gray-800">{fmt(net)}</span>
                    </div>
                  )}
                </div>
              ))}

              {/* Grand total */}
              {hasMultiYear && (
                <div className="px-4 py-3 bg-gray-50">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Total Course Fee</span>
                    <span className="text-sm text-gray-500">{fmt(grandRaw)}</span>
                  </div>
                  {hasAnyDeduction && (
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-sm text-emerald-600">Total Deductions</span>
                      <span className="text-sm font-medium text-emerald-600">− {fmt(grandDeductions)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                    <span className="text-sm font-bold text-gray-900">Total Net Fee</span>
                    <span className="text-sm font-bold text-gray-900">{fmt(grandNet)}</span>
                  </div>
                </div>
              )}

              {/* Application / Registration Fee — separate from course structure */}
              {feeStatus.application_paid > 0 && (
                <div className="px-4 py-3 space-y-1.5 bg-gray-50/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Application / Registration Fee</p>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Registration Fee</span>
                    <span className="text-sm font-semibold text-gray-900">{fmt(feeStatus.application_paid)}</span>
                  </div>
                  <div className="flex justify-between items-center pl-3">
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Check className="h-3 w-3" /> Paid
                    </span>
                    <span className="text-xs font-medium text-green-600">− {fmt(feeStatus.application_paid)}</span>
                  </div>
                  <div className="flex justify-between items-center pl-3 pt-0.5 border-t border-dashed border-gray-200">
                    <span className="text-xs font-semibold text-gray-500">Balance</span>
                    <span className="text-xs font-bold text-gray-700">{fmt(0)}</span>
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

      {/* ── Admission nudge strip ─────────────────────── */}
      {!feeStatus.twenty_five_complete && (() => {
        const tokenPaid = feeStatus.token_complete;
        const dLeft = confirmDueDate ? daysUntil(confirmDueDate) : null;
        const isOverdue = dLeft !== null && dLeft < 0;
        const isUrgentConfirm = dLeft !== null && dLeft <= 2 && dLeft >= 0;

        if (tokenPaid && confirmDueDate) {
          // Token paid — show countdown to 25% deadline
          return (
            <div className={`rounded-2xl px-4 py-3.5 flex gap-3 items-start ${
              isOverdue      ? "bg-red-50 border border-red-200"
              : isUrgentConfirm ? "bg-orange-50 border border-orange-200"
              : "bg-amber-50 border border-amber-200"
            }`}>
              <Clock className={`h-4 w-4 shrink-0 mt-0.5 ${isOverdue ? "text-red-500" : isUrgentConfirm ? "text-orange-500" : "text-amber-500"}`} />
              <div className="min-w-0">
                <p className={`text-sm font-bold ${isOverdue ? "text-red-800" : isUrgentConfirm ? "text-orange-800" : "text-amber-900"}`}>
                  {isOverdue
                    ? "25% payment overdue — contact admissions immediately"
                    : dLeft === 0
                    ? "25% payment due today to confirm admission"
                    : `Confirm admission by ${fmtDate(confirmDueDate)}`}
                </p>
                <p className={`text-xs mt-0.5 leading-snug ${isOverdue ? "text-red-700" : isUrgentConfirm ? "text-orange-700" : "text-amber-700"}`}>
                  {isOverdue
                    ? "Your token fee holds the seat but admission is not confirmed until 25% is paid."
                    : `Your token fee holds your seat for 5 days. Pay ₹${towardsAdmission.toLocaleString("en-IN")} by ${fmtDate(confirmDueDate)} to receive your Admission Number.${dLeft !== null && dLeft > 0 ? ` ${dLeft} day${dLeft !== 1 ? "s" : ""} remaining.` : ""}`}
                </p>
              </div>
            </div>
          );
        }

        // Token not yet paid — pre-explain the 5-day rule
        return (
          <div className="rounded-2xl bg-blue-50 border border-blue-200 px-4 py-3.5 flex gap-3 items-start">
            <Clock className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-blue-900">Token fee holds your seat · 25% confirms it</p>
              <p className="text-xs text-blue-700 mt-0.5 leading-snug">
                Paying 10% (token fee) reserves your seat for <span className="font-semibold">5 days</span>.
                You must pay 25% within those 5 days to receive your Admission Number and confirm enrollment.
                Admission is <span className="font-semibold">not confirmed</span> until 25% is paid.
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── Payment CTAs ──────────────────────────────── */}
      {!feeStatus.twenty_five_complete && towardsAdmission > 0 && (() => {
        // Installment presets for the token fee alternative
        const presets: number[] = [];
        let p = minInstalment;
        while (p < tokenOutstanding && presets.length < 4) { presets.push(p); p += minInstalment; }
        if (!presets.includes(tokenOutstanding) && tokenOutstanding > 0) presets.push(tokenOutstanding);

        const selectedAmt = instalmentPreset !== null
          ? instalmentPreset
          : (customAmt && parseFloat(customAmt) > 0 ? parseFloat(customAmt) : null);

        return (
          <div className="space-y-3">
            {/* ── Primary: confirm admission (25%) ── */}
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-4 shadow-sm space-y-3">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Recommended</span>
                </div>
                <p className="text-base font-bold text-emerald-900">Confirm Your Admission</p>
                <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                  Pay 25% of first-year fee and receive your Admission Number — your seat is fully secured.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white border border-emerald-100 px-3.5 py-2.5">
                <div>
                  <p className="text-[10px] text-gray-400 font-medium">Amount due</p>
                  <p className="text-lg font-bold text-gray-900">₹{towardsAdmission.toLocaleString("en-IN")}</p>
                </div>
                {coursePaid > 0 && (
                  <p className="text-[10px] text-gray-400 text-right">
                    Already paid ₹{coursePaid.toLocaleString("en-IN")}<br />
                    of ₹{feeStatus.twenty_five_pct.toLocaleString("en-IN")} target
                  </p>
                )}
              </div>
              <button
                disabled={paying || !applicantPhone}
                onClick={() => startPayment(towardsAdmission, {
                  paymentType: "token_fee",
                  productinfo: "Admission Confirmation Fee (25%)",
                })}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white hover:bg-emerald-700 active:scale-[0.99] transition-all disabled:opacity-50 shadow-md shadow-emerald-200/60"
              >
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Pay ₹{towardsAdmission.toLocaleString("en-IN")} · Confirm Admission
              </button>
            </div>

            {/* ── Alternative: pay token fee ── */}
            {!feeStatus.token_complete && tokenOutstanding > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Collapsed header */}
                <button
                  onClick={() => { setShowInstalment(v => !v); setInstalmentPreset(tokenOutstanding); setCustomAmt(""); }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Can't pay full amount right now?</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Pay token fee to hold your seat first
                    </p>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${showInstalment ? "rotate-90" : ""}`} />
                </button>

                {showInstalment && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
                    {/* Default: full token amount */}
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 border border-gray-200 px-3.5 py-2.5">
                      <div>
                        <p className="text-[10px] text-gray-400 font-medium">Token fee (holds your seat)</p>
                        <p className="text-base font-bold text-gray-900">₹{tokenOutstanding.toLocaleString("en-IN")}</p>
                      </div>
                      <button
                        disabled={paying || !applicantPhone}
                        onClick={() => startPayment(tokenOutstanding)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
                      >
                        {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                        Pay Now
                      </button>
                    </div>

                    {/* Pay in parts toggle */}
                    <button
                      onClick={() => setInstalmentPreset(v => v === null ? minInstalment : null)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2"
                    >
                      {instalmentPreset === null && customAmt === "" && instalmentPreset !== tokenOutstanding
                        ? "Hide instalment options"
                        : "Pay in parts instead (min ₹" + minInstalment.toLocaleString("en-IN") + ")"}
                    </button>

                    {/* Instalment chips — revealed on toggle */}
                    {instalmentPreset !== null && instalmentPreset !== tokenOutstanding && (
                      <div className="space-y-3 pt-1">
                        <div className="flex flex-wrap gap-2">
                          {presets.filter(p => p < tokenOutstanding).map(amt => (
                            <button
                              key={amt}
                              onClick={() => { setInstalmentPreset(amt); setCustomAmt(""); }}
                              className={`rounded-xl px-3.5 py-2 text-sm font-semibold border transition-all active:scale-95 ${
                                instalmentPreset === amt
                                  ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                                  : "border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              ₹{amt.toLocaleString("en-IN")}
                            </button>
                          ))}
                          <button
                            onClick={() => { setInstalmentPreset(null); setCustomAmt(""); }}
                            className={`rounded-xl px-3.5 py-2 text-sm font-semibold border transition-all active:scale-95 ${
                              instalmentPreset === null
                                ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                                : "border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                            }`}
                          >
                            Custom
                          </button>
                        </div>

                        {instalmentPreset === null && (
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                              type="number" step="500" min={minInstalment} max={tokenOutstanding}
                              value={customAmt}
                              onChange={e => setCustomAmt(e.target.value)}
                              placeholder={`Min ₹${minInstalment.toLocaleString("en-IN")}`}
                              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-3 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300/40 focus:border-blue-300"
                            />
                          </div>
                        )}

                        <p className="text-[11px] text-gray-400">
                          Min ₹{minInstalment.toLocaleString("en-IN")} per payment · pay multiple times to reach the token fee target
                        </p>

                        <button
                          disabled={paying || !applicantPhone || selectedAmt === null || selectedAmt < minInstalment}
                          onClick={() => selectedAmt && startPayment(selectedAmt)}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 active:scale-[0.99] transition-all disabled:opacity-50 shadow-sm"
                        >
                          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                          {selectedAmt ? `Pay ₹${selectedAmt.toLocaleString("en-IN")} Now` : "Select an amount above"}
                        </button>
                      </div>
                    )}

                    {!applicantPhone && (
                      <p className="text-xs text-red-600 text-center bg-red-50 rounded-lg py-2 px-3">
                        Phone number missing — please contact admissions
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Waiver: Lump-sum first-year ──────────────── */}
      {(feeStatus.lump_sum_pct || 0) > 0 && (feeStatus.full_first_year_amount_due || 0) > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Special Offer</p>
              </div>
              <p className="text-sm font-bold text-amber-900">
                Save ₹{(feeStatus.full_first_year_discount || 0).toLocaleString("en-IN")} on Year 1
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Pay the full first-year fee by {fmtDate(semesterFeeDeadline)} and get {feeStatus.lump_sum_pct}% off.
              </p>
            </div>
            <button
              disabled={paying || !applicantPhone}
              onClick={() => startPayment(feeStatus.full_first_year_amount_due || 0, {
                paymentType: "other",
                productinfo: "First-year fee (lump-sum)",
                concession: feeStatus.full_first_year_discount || 0,
                reason: `Lump-sum first-year ${feeStatus.lump_sum_pct}%`,
                concessionBreakdown: { year_1: feeStatus.full_first_year_discount || 0 },
              })}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-3 text-xs font-bold text-white hover:bg-amber-700 active:scale-95 transition-all disabled:opacity-50 shadow-md shadow-amber-200/60"
            >
              {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Pay ₹{(feeStatus.full_first_year_amount_due || 0).toLocaleString("en-IN")}
            </button>
          </div>
        </div>
      )}

      {/* ── Waiver: Full course ───────────────────────── */}
      {showFullCourse && (
        <div className={`rounded-2xl border p-4 shadow-sm ${showMultiYearTimer ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-green-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600">Best Value</p>
              </div>
              <p className="text-sm font-bold text-emerald-900">
                Save ₹{(feeStatus.full_course_discount || 0).toLocaleString("en-IN")} on Full Course
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {feeStatus.lump_sum_pct}% off year-1
                {inMultiYearWindow
                  ? ` + extra ${feeStatus.multi_year_pct}% off all other years.`
                  : ` + ${feeStatus.lump_sum_pct}% off other years.`}
              </p>
              {showMultiYearTimer && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-emerald-700">Bonus expires in</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-900 tabular-nums">
                    {formatCountdown(multiYearRemainingMs!)}
                  </span>
                </div>
              )}
            </div>
            <button
              disabled={paying || !applicantPhone}
              onClick={() => {
                const lump  = (feeStatus.lump_sum_pct || 0) / 100;
                const multi = (feeStatus.multi_year_pct || 0) / 100;
                const breakdown: Record<string, number> = {};
                Object.entries(yearFees).forEach(([term, fee]) => {
                  const pct = term === "year_1" ? lump : lump + (inMultiYearWindow ? multi : 0);
                  if (pct > 0) breakdown[term] = Math.round(fee * pct);
                });
                startPayment(feeStatus.full_course_amount_due || 0, {
                  paymentType: "other",
                  productinfo: "Full course fee (with waivers)",
                  concession: feeStatus.full_course_discount || 0,
                  reason: inMultiYearWindow
                    ? `Full course: ${feeStatus.lump_sum_pct}% lump + ${feeStatus.multi_year_pct}% multi-year (within window)`
                    : `Full course: ${feeStatus.lump_sum_pct}% lump (window expired)`,
                  concessionBreakdown: Object.keys(breakdown).length ? breakdown : undefined,
                });
              }}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50 shadow-md shadow-emerald-200/60"
            >
              {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Pay ₹{(feeStatus.full_course_amount_due || 0).toLocaleString("en-IN")}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Contact strip */}
      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">Need help? Call our admissions team</p>
        <a href="tel:+919555192192" className="text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0">
          +91 9555 192192
        </a>
      </div>

      {/* Payment history */}
      {payments.length > 0 && (() => {
        const confirmed = payments.filter(p => p.status === "confirmed");
        const pending   = payments.filter(p => p.status === "pending");
        const TYPE_LABELS: Record<string, string> = {
          application_fee: "Application / Registration Fee",
          token_fee: "Token / Admission Fee",
          registration_fee: "Registration Fee",
          other: "Other",
        };
        const fmtAmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
        const fmtDt  = (s: string | null) => s
          ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "—";
        return (
          <details className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden" open={confirmed.length > 0}>
            <summary className="cursor-pointer px-4 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors list-none">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-700">Payment History</span>
                <span className="text-xs text-gray-400">{payments.length} transaction{payments.length !== 1 ? "s" : ""}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400 details-open:rotate-90 transition-transform" />
            </summary>

            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {payments.map(p => {
                const isConfirmed = p.status === "confirmed";
                const isPending   = p.status === "pending";
                return (
                  <div key={p.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">
                          {TYPE_LABELS[p.type] || p.type}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isConfirmed ? "bg-green-100 text-green-700"
                          : isPending  ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                        }`}>
                          {isConfirmed ? "Confirmed" : isPending ? "Pending" : p.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {p.receipt_no && (
                          <span className="text-[11px] font-mono text-gray-400">#{p.receipt_no}</span>
                        )}
                        <span className="text-[11px] text-gray-400">{fmtDt(p.payment_date || p.created_at)}</span>
                        {p.concession_amount > 0 && (
                          <span className="text-[11px] text-emerald-600">· {fmtAmt(p.concession_amount)} waiver applied</span>
                        )}
                        {p.waiver_reason && (
                          <span className="text-[11px] text-gray-400 italic">· {p.waiver_reason}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-bold ${isConfirmed ? "text-gray-900" : "text-amber-700"}`}>
                        {fmtAmt(p.amount)}
                      </p>
                      {p.receipt_url && (
                        <a
                          href={p.receipt_url} target="_blank" rel="noopener"
                          className="text-[11px] text-blue-600 hover:underline"
                        >
                          Receipt ↗
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Totals footer */}
              {confirmed.length > 0 && (
                <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500">Total Confirmed</span>
                  <span className="text-sm font-bold text-gray-900">
                    {fmtAmt(confirmed.reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
              )}
              {pending.length > 0 && (
                <div className="px-4 py-2 bg-amber-50 flex justify-between items-center">
                  <span className="text-xs text-amber-700">Pending verification</span>
                  <span className="text-xs font-semibold text-amber-700">
                    {fmtAmt(pending.reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
              )}
            </div>
          </details>
        );
      })()}
    </div>
  );
}
