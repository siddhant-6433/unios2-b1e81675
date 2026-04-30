import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard, CheckCircle2, FileText, IndianRupee } from "lucide-react";

type FeeStatus = {
  first_year_fee: number;
  total_course_fee: number;
  additional_years_fee: number;
  token_required: number;
  token_paid: number;
  application_paid: number;
  total_paid: number;
  twenty_five_pct: number;
  min_token_instalment?: number;
  token_complete: boolean;
  twenty_five_complete: boolean;
  lump_sum_pct?: number;
  multi_year_pct?: number;
  multi_year_window_days?: number;
  within_multi_year_window?: boolean;
  full_first_year_discount?: number;
  full_first_year_amount_due?: number;
  full_course_discount?: number;
  full_course_amount_due?: number;
};

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
  acceptance_deadline: string | null;
  created_at: string;
}

interface Props {
  applicationId: string;
  applicantName: string;
  applicantPhone: string | null;
  applicantEmail: string | null;
  onPayment?: () => void;
}

export function TokenFeePanel({ applicationId, applicantName, applicantPhone, applicantEmail, onPayment }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [feeStatus, setFeeStatus] = useState<FeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [payAmount, setPayAmount] = useState<string>("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    // Lead is linked via application_id text column.
    const { data: leadRow } = await supabase
      .from("leads")
      .select("id, name, phone, email, stage, session_id, token_amount, pre_admission_no, admission_no")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (!leadRow) { setLoading(false); return; }
    setLead(leadRow as Lead);

    const [{ data: status }, { data: offerRows }] = await Promise.all([
      supabase.rpc("lead_fee_status" as any, { _lead_id: leadRow.id }),
      supabase.from("offer_letters")
        .select("id, total_fee, scholarship_amount, net_fee, approval_status, status, acceptance_deadline, created_at")
        .eq("lead_id", leadRow.id)
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (status) setFeeStatus(status as FeeStatus);
    if (offerRows && offerRows.length > 0) setOffer(offerRows[0] as Offer);
    setLoading(false);
  };

  useEffect(() => { load(); }, [applicationId]);

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
    opts: { paymentType?: string; productinfo?: string; concession?: number; reason?: string } = {},
  ) => {
    if (!lead || !applicantPhone) return;
    if (amount <= 0) { setError("Enter a valid amount"); return; }
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
        },
      });
      if (invErr) throw invErr;
      if (data?.error) throw new Error(data.error);
      if (!data?.pay_url) throw new Error("No payment URL returned");
      window.open(data.pay_url, "_blank", "noopener");
    } catch (e: any) {
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
  const towardsAdmission = Math.max(0, feeStatus.twenty_five_pct - feeStatus.total_paid);
  const minInstalment = feeStatus.min_token_instalment ?? 5000;
  const isAdmitted = !!lead.admission_no;
  const isPreAdmitted = !!lead.pre_admission_no;

  return (
    <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-gray-900">Offer Letter Issued</span>
        </div>
        <span className="text-xs text-gray-500">
          {offer.acceptance_deadline ? `Accept by ${new Date(offer.acceptance_deadline).toLocaleDateString("en-IN")}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-white p-2.5 border border-gray-200">
          <p className="text-gray-500 text-[10px] uppercase tracking-wide">First-Year Fee</p>
          <p className="font-bold text-gray-900 text-sm">₹{feeStatus.first_year_fee.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg bg-white p-2.5 border border-gray-200">
          <p className="text-gray-500 text-[10px] uppercase tracking-wide">Net Offer (after scholarship)</p>
          <p className="font-bold text-gray-900 text-sm">₹{offer.net_fee.toLocaleString("en-IN")}</p>
        </div>
      </div>

      {/* Progress: Token */}
      <div className="rounded-lg bg-white p-3 border border-gray-200 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-700 font-medium">Token Fee (10%) → Pre-Admission</span>
          {feeStatus.token_complete && <CheckCircle2 className="h-4 w-4 text-green-600" />}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(100, (feeStatus.token_paid / Math.max(1, feeStatus.token_required)) * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-gray-600">
          <span>Paid: ₹{feeStatus.token_paid.toLocaleString("en-IN")}</span>
          <span>Required: ₹{feeStatus.token_required.toLocaleString("en-IN")}</span>
        </div>
        {isPreAdmitted && lead.pre_admission_no && (
          <p className="text-[11px] text-emerald-700 font-medium">PAN issued: {lead.pre_admission_no}</p>
        )}
      </div>

      {/* Progress: 25% / Admission */}
      <div className="rounded-lg bg-white p-3 border border-gray-200 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-700 font-medium">Towards Admission (25% of first year)</span>
          {feeStatus.twenty_five_complete && <CheckCircle2 className="h-4 w-4 text-green-600" />}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, (feeStatus.total_paid / Math.max(1, feeStatus.twenty_five_pct)) * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-gray-600">
          <span>Paid: ₹{feeStatus.total_paid.toLocaleString("en-IN")}</span>
          <span>Required: ₹{feeStatus.twenty_five_pct.toLocaleString("en-IN")}</span>
        </div>
        {isAdmitted && lead.admission_no && (
          <p className="text-[11px] text-emerald-700 font-medium">Admission No: {lead.admission_no}</p>
        )}
      </div>

      {/* Action */}
      {!feeStatus.token_complete && tokenOutstanding > 0 && (
        <div className="rounded-lg bg-white p-3 border border-gray-200 space-y-2">
          <p className="text-xs text-gray-700">
            Outstanding token: <span className="font-semibold">₹{tokenOutstanding.toLocaleString("en-IN")}</span>
            {tokenOutstanding > minInstalment && <span className="text-gray-500"> · min instalment ₹{minInstalment.toLocaleString("en-IN")}</span>}
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="number"
                step="100"
                min={tokenOutstanding > minInstalment ? minInstalment : 1}
                max={tokenOutstanding}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder={tokenOutstanding.toString()}
                className="w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              disabled={paying || !applicantPhone}
              onClick={() => startPayment(parseFloat(payAmount || tokenOutstanding.toString()))}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Pay Token Fee
            </button>
          </div>
          <button
            disabled={paying || !applicantPhone}
            onClick={() => startPayment(tokenOutstanding)}
            className="text-[11px] text-primary hover:underline disabled:opacity-50"
          >
            Pay full outstanding (₹{tokenOutstanding.toLocaleString("en-IN")})
          </button>
        </div>
      )}

      {feeStatus.token_complete && !feeStatus.twenty_five_complete && towardsAdmission > 0 && (
        <button
          disabled={paying || !applicantPhone}
          onClick={() => startPayment(towardsAdmission)}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
          Pay ₹{towardsAdmission.toLocaleString("en-IN")} to confirm admission
        </button>
      )}

      {/* Waiver CTAs — shown when waivers are non-zero and there's still
          balance owed. Pay-full-first-year and Pay-full-course apply the
          policy-driven discount automatically. */}
      {(feeStatus.lump_sum_pct || 0) > 0 && (feeStatus.full_first_year_amount_due || 0) > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-900">
                Pay full first-year fee — save ₹{(feeStatus.full_first_year_discount || 0).toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-amber-700">
                {feeStatus.lump_sum_pct}% off the first-year fee when you clear it in one go.
              </p>
            </div>
            <button
              disabled={paying || !applicantPhone}
              onClick={() => startPayment(feeStatus.full_first_year_amount_due || 0, {
                paymentType: "other",
                productinfo: "First-year fee (lump-sum, 5% off)",
                concession: feeStatus.full_first_year_discount || 0,
                reason: `Lump-sum first-year ${feeStatus.lump_sum_pct}%`,
              })}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Pay ₹{(feeStatus.full_first_year_amount_due || 0).toLocaleString("en-IN")}
            </button>
          </div>
        </div>
      )}

      {(feeStatus.lump_sum_pct || 0) > 0 && (feeStatus.additional_years_fee || 0) > 0 && (feeStatus.full_course_amount_due || 0) > 0 && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-900">
                Pay full course fee — save ₹{(feeStatus.full_course_discount || 0).toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-emerald-700">
                {feeStatus.lump_sum_pct}% on year-1
                {feeStatus.within_multi_year_window
                  ? ` + extra ${feeStatus.multi_year_pct}% on later years (within ${feeStatus.multi_year_window_days} days of token).`
                  : ` + ${feeStatus.lump_sum_pct}% on later years (multi-year bonus window expired).`}
              </p>
            </div>
            <button
              disabled={paying || !applicantPhone}
              onClick={() => startPayment(feeStatus.full_course_amount_due || 0, {
                paymentType: "other",
                productinfo: "Full course fee (with waivers)",
                concession: feeStatus.full_course_discount || 0,
                reason: feeStatus.within_multi_year_window
                  ? `Full course: ${feeStatus.lump_sum_pct}% lump + ${feeStatus.multi_year_pct}% multi-year (within window)`
                  : `Full course: ${feeStatus.lump_sum_pct}% lump (window expired)`,
              })}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Pay ₹{(feeStatus.full_course_amount_due || 0).toLocaleString("en-IN")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
