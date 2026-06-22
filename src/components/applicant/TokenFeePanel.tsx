import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CreditCard, FileText, IndianRupee, Clock, Check, GraduationCap, Sparkles, ChevronRight, CalendarDays } from "lucide-react";
import { buildApplicantFeeBreakdownRows, buildApplicantOneTimePaymentOptions } from "./feeBreakdown";
import {
  effectiveApplicationDeadline,
  INITIAL_APPLICATION_DEADLINE,
} from "@/lib/deadlineRollover";
import { useScopedPaymentGateways } from "@/lib/paymentGatewayResolver";
import { buildRazorpayReceipt, openRazorpayCheckout } from "@/lib/razorpayCheckout";

// Fallbacks if the get_applicant_deadlines RPC is unreachable.
// The single source of truth is _app_config — these are last-resort
// defaults so the UI still renders during a brief outage.
const DEFAULT_FEE_SUBMISSION_DEADLINE      = INITIAL_APPLICATION_DEADLINE;
const DEFAULT_FULL_COURSE_PAYMENT_DEADLINE = "2026-09-15";

type BankDetails = {
  beneficiary_name: string;
  bank_name: string;
  account_no: string;
  ifsc: string;
  branch: string;
  upi_id: string;
};

const DEFAULT_BANK_DETAILS: BankDetails = {
  beneficiary_name: "NIMT B. SCHOOL'S FOUNDATION",
  bank_name: "IDFC BANK",
  account_no: "10118454426",
  ifsc: "IDFB0020154",
  branch: "Alpha 1, Greater Noida",
  upi_id: "-",
};

type FeeStatus = {
  first_year_fee: number;
  post_scholarship_year_1: number;
  total_course_fee: number;
  additional_years_fee: number;
  token_required: number;
  token_paid: number;
  application_paid: number;
  total_paid: number;
  /** Sum of token_fee + 'other' lead_payments — i.e. money applied
   *  toward the course balance. Excludes application_fee and
   *  registration_fee which are separate charges. */
  paid_toward_course?: number;
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
  token_fee_amount?: number | null;
  approval_status: string;
  status: string;
  acceptance_deadline: string | null; // date string e.g. "2026-06-30"
  created_at: string;
  letter_url: string | null;
  loan_letter_url: string | null;
  admission_mode?: string | null;
  entrance_exam_name?: string | null;
}

interface Props {
  applicationId: string;
  leadId?: string | null;
  applicantName: string;
  applicantPhone: string | null;
  applicantEmail: string | null;
  courseName?: string | null;
  onPayment?: () => void;
}

const isMbaCourse = (name: string | null | undefined) =>
  !!name && /\bMBA\b/i.test(name);

const LOAN_LETTER_UNLOCK_TOKEN_FEE = 5000;
const DEFAULT_NIMT_LETTERHEAD_URL = "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_he/letterhead.png";
const DEFAULT_NIMT_FOOTER_URL = "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_he/footer.png";

const openPdfUrl = (url: string, previewWindow: Window | null) => {
  if (previewWindow && !previewWindow.closed) {
    previewWindow.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const shouldUseLocalLoanLetterPreview = () => {
  if (!import.meta.env.DEV) return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
};

const buildLoanReferenceNo = (offerId?: string | null, appId?: string | null) => {
  const year = new Date().getFullYear();
  const suffix = (appId || offerId || "NA").replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase() || "NA";
  return `NIMT/EL/${year}/${suffix}`;
};

const loadImageForPdf = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load letterhead (${res.status})`);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  return { dataUrl, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
};

export function TokenFeePanel({ applicationId, leadId: leadIdProp, applicantName, applicantPhone, applicantEmail, courseName, onPayment }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [feeStatus, setFeeStatus] = useState<FeeStatus | null>(null);
  const [yearFees, setYearFees] = useState<Record<string, number>>({});
  const [offerWaivers, setOfferWaivers] = useState<{ term: string; amount: number }[]>([]);
  const [payments, setPayments] = useState<{
    id: string; receipt_no: string | null; type: string; amount: number;
    concession_amount: number; status: string; payment_date: string | null;
    created_at: string; receipt_url: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [generatingLoanLetter, setGeneratingLoanLetter] = useState(false);
  const [showInstalment, setShowInstalment] = useState(false);
  const [instalmentPreset, setInstalmentPreset] = useState<number | null>(null);
  const [customAmt, setCustomAmt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedGateway, setSelectedGateway] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<{ fee_submission_deadline: string; full_course_payment_deadline: string }>({
    fee_submission_deadline:      DEFAULT_FEE_SUBMISSION_DEADLINE,
    full_course_payment_deadline: DEFAULT_FULL_COURSE_PAYMENT_DEADLINE,
  });
  const [bankDetails, setBankDetails] = useState<BankDetails>(DEFAULT_BANK_DETAILS);
  const { gateways: tokenGateways, loading: tokenGatewayLoading } = useScopedPaymentGateways({
    context: "token_fee",
    applicationId,
    enabled: !!lead,
  });

  useEffect(() => {
    if (tokenGatewayLoading) return;
    if (tokenGateways.length === 1) {
      setSelectedGateway(tokenGateways[0].gateway);
    } else if (selectedGateway && !tokenGateways.some((g) => g.gateway === selectedGateway)) {
      setSelectedGateway(null);
    }
  }, [tokenGatewayLoading, tokenGateways, selectedGateway]);

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

    // Fetch lead info + offer + fee status + global deadlines in parallel
    // via SECURITY DEFINER functions. We pull POST-WAIVER per-year fees
    // (lead_year_fees_net) — the concession breakdown sent to easebuzz must
    // apportion against what the candidate actually owes, not the gross fee.
    const [leadRes, statusRes, offerRes, yearRes, dlRes] = await Promise.all([
      (supabase as any).rpc("get_applicant_lead_info", { _lead_id: resolvedLeadId }),
      supabase.rpc("lead_fee_status" as any, { _lead_id: resolvedLeadId }),
      (supabase as any).rpc("get_applicant_offer", { _application_id: applicationId }),
      supabase.rpc("lead_year_fees_net" as any, { _lead_id: resolvedLeadId }),
      (supabase as any).rpc("get_applicant_deadlines"),
    ]);

    // Deadlines are non-critical — log but don't block render if missing.
    if (!dlRes.error && dlRes.data) {
      const d = dlRes.data as Record<string, string>;
      const feeSubmissionDeadline = d.fee_submission_deadline || DEFAULT_FEE_SUBMISSION_DEADLINE;
      setDeadlines({
        fee_submission_deadline:      effectiveApplicationDeadline(feeSubmissionDeadline),
        full_course_payment_deadline: d.full_course_payment_deadline || DEFAULT_FULL_COURSE_PAYMENT_DEADLINE,
      });
      setBankDetails({
        beneficiary_name: d.loan_letter_bank_beneficiary_name || DEFAULT_BANK_DETAILS.beneficiary_name,
        bank_name: d.loan_letter_bank_name || DEFAULT_BANK_DETAILS.bank_name,
        account_no: d.loan_letter_bank_account_no || DEFAULT_BANK_DETAILS.account_no,
        ifsc: d.loan_letter_bank_ifsc || DEFAULT_BANK_DETAILS.ifsc,
        branch: d.loan_letter_bank_branch || DEFAULT_BANK_DETAILS.branch,
        upi_id: d.loan_letter_bank_upi_id || DEFAULT_BANK_DETAILS.upi_id,
      });
    }

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

  useEffect(() => {
    if (!feeStatus) return;

    const nextOutstanding = Math.max(0, feeStatus.token_required - feeStatus.token_paid);

    setInstalmentPreset((current) => {
      if (current === null || current <= nextOutstanding) return current;
      return nextOutstanding > 0 ? nextOutstanding : null;
    });

    setCustomAmt((current) => {
      if (!current) return current;
      const parsed = parseFloat(current);
      if (!Number.isFinite(parsed) || parsed <= nextOutstanding) return current;
      return nextOutstanding > 0 ? String(nextOutstanding) : "";
    });
  }, [feeStatus]);

  // Listen for the popup's success/failure ping.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.eb_payment === "success" || e.data?.icici_payment === "success") {
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

    const gateway = selectedGateway || tokenGateways[0]?.gateway || "easebuzz";
    if (gateway === "razorpay") {
      setPaying(true);
      setError(null);
      try {
        await openRazorpayCheckout({
          amountPaise: Math.round(amount * 100),
          receipt: buildRazorpayReceipt("lead", lead.id),
          context: "token_fee",
          description: opts.productinfo || "Token Fee",
          leadId: lead.id,
          paymentType: opts.paymentType || "token_fee",
          customerName: applicantName,
          customerEmail: applicantEmail || undefined,
          customerPhone: applicantPhone,
          productInfo: opts.productinfo || "Token Fee",
          concessionAmount: opts.concession || 0,
          waiverReason: opts.reason || null,
          concessionBreakdown: opts.concessionBreakdown || null,
        });
        await load();
        onPayment?.();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Payment was cancelled.");
      } finally {
        setPaying(false);
      }
      return;
    }

    // Open blank window synchronously — browsers block window.open() called
    // after an await because the user-gesture chain is broken in async context.
    const payWin = window.open("about:blank", "_blank");

    setPaying(true);
    setError(null);
    try {
      const functionName = gateway === "icici" ? "icici-payment" : "easebuzz-payment";
      const { data, error: invErr } = await supabase.functions.invoke(functionName, {
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

  const generateLocalLoanLetterPreview = async () => {
    if (!offer || !lead || !feeStatus) throw new Error("Offer details are not loaded yet");

    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 36;
    let y = 90;
    let bottomReserve = 50;

    try {
      const [letterhead, footer] = await Promise.all([
        loadImageForPdf(DEFAULT_NIMT_LETTERHEAD_URL),
        loadImageForPdf(DEFAULT_NIMT_FOOTER_URL),
      ]);
      const aspectHW = letterhead.height / letterhead.width;
      if (aspectHW >= 1.2) {
        doc.addImage(letterhead.dataUrl, "PNG", 0, 0, pageWidth, pageHeight);
        y = 150;
        bottomReserve = 104;
      } else {
        const h = pageWidth * aspectHW;
        doc.addImage(letterhead.dataUrl, "PNG", 0, 0, pageWidth, h);
        y = h + 16;
        const footerAspect = footer.height / footer.width;
        const footerH = Math.min(pageWidth * footerAspect, 120);
        doc.addImage(footer.dataUrl, "PNG", 0, pageHeight - footerH, pageWidth, footerH);
        bottomReserve = footerH + 8;
      }
    } catch {
      doc.setFillColor(20, 24, 40);
      doc.rect(0, 0, pageWidth, 70, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("NIMT Educational Institutions", margin, 36);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Greater Noida - Ghaziabad - Kotputli, Jaipur", margin, 54);
      doc.setTextColor(20, 24, 40);
      y = 90;
    }

    const fmt = (n: number) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const ensureSpace = (need: number) => {
      if (y + need < pageHeight - bottomReserve) return;
      doc.addPage();
      y = 90;
      doc.setFillColor(20, 24, 40);
      doc.rect(0, 0, pageWidth, 70, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("NIMT Educational Institutions", margin, 36);
      doc.setTextColor(20, 24, 40);
    };
    const write = (text: string, size = 7.7, gap = 2) => {
      ensureSpace(28);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * (size + 3) + gap;
    };
    const heading = (text: string) => {
      ensureSpace(18);
      doc.setFillColor(20, 24, 40);
      doc.rect(margin, y - 12, pageWidth - margin * 2, 14, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.8);
      doc.text(text, margin + 8, y - 1);
      doc.setTextColor(20, 24, 40);
      y += 16;
    };
    const kvGrid = (pairs: { label: string; value: string }[], cols = 4) => {
      const totalW = pageWidth - margin * 2;
      const cellW = totalW / cols;
      const valueSize = 6.8;
      const valueLineH = valueSize + 2.2;
      for (let i = 0; i < pairs.length; i += cols) {
        const row = pairs.slice(i, i + cols);
        const wrappedValues = row.map(pair => doc.splitTextToSize(pair.value || "-", cellW - 8).slice(0, 2));
        const maxLines = Math.max(1, ...wrappedValues.map(lines => lines.length));
        const cellH = Math.max(25, 18 + maxLines * valueLineH);
        ensureSpace(cellH + 4);
        let x = margin;
        for (let j = 0; j < cols; j++) {
          const pair = row[j];
          doc.setDrawColor(140, 140, 153);
          doc.setFillColor(255, 255, 255);
          doc.rect(x, y - 16, cellW, cellH);
          if (pair) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(5.8);
            doc.setTextColor(105, 105, 115);
            doc.text(pair.label, x + 4, y - 6);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(valueSize);
            doc.setTextColor(20, 24, 40);
            const valueLines = wrappedValues[j] || ["-"];
            valueLines.forEach((line: string, index: number) => {
              doc.text(line, x + 4, y + 3 + index * valueLineH);
            });
          }
          x += cellW;
        }
        y += cellH;
      }
    };
    const feeTable = (rows: { label: string; dueDate: string; published: number; waiver: number; applicable: number; total?: boolean }[]) => {
      const totalW = pageWidth - margin * 2;
      const widths = [totalW * 0.28, totalW * 0.18, totalW * 0.18, totalW * 0.18, totalW * 0.18];
      const xs = [margin, margin + widths[0], margin + widths[0] + widths[1], margin + widths[0] + widths[1] + widths[2], margin + widths[0] + widths[1] + widths[2] + widths[3]];
      const draw = (values: string[], header = false, total = false) => {
        ensureSpace(16);
        values.forEach((value, i) => {
          doc.setDrawColor(140, 140, 153);
          if (header) doc.setFillColor(237, 237, 245);
          else if (total) doc.setFillColor(240, 247, 240);
          else doc.setFillColor(255, 255, 255);
          doc.rect(xs[i], y - 14, widths[i], 16, "FD");
          doc.setFont("helvetica", header || total || i === 4 ? "bold" : "normal");
          doc.setFontSize(header ? 6.6 : 6.8);
          doc.setTextColor(20, 24, 40);
          if (i === 0) {
            doc.text(value, xs[i] + 8, y - 1);
          } else {
            const textWidth = doc.getTextWidth(value);
            doc.text(value, xs[i] + widths[i] - textWidth - 8, y - 1);
          }
        });
        y += 16;
      };
      draw(["Year", "Due Date", "Published", "Waiver", "Applicable"], true);
      rows.forEach(row => draw([
        row.label,
        row.dueDate,
        fmt(row.published),
        row.waiver > 0 ? `- ${fmt(row.waiver)}` : "-",
        fmt(row.applicable),
      ], false, !!row.total));
    };

    const feeRows = buildApplicantFeeBreakdownRows({
      yearFeesNet: yearFees,
      offerWaivers,
      scholarshipAmount: offer.scholarship_amount || 0,
      feeStatus,
    });
    const generatedAt = new Date();
    const generatedStamp = generatedAt.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const totalCourseFee = feeRows.reduce((sum, r) => sum + r.net, 0) || offer.net_fee || offer.total_fee || 0;
    const programmeName = courseName || "the selected programme";
    const paidTowardCourse = feeStatus.paid_toward_course ?? Math.max(0, (feeStatus.total_paid || 0) - (feeStatus.application_paid || 0));
    const firstYearNet = feeRows.find(r => r.term === "year_1")?.net || feeStatus.post_scholarship_year_1 || 0;
    const firstYearAmountDue = Math.max(0, firstYearNet - paidTowardCourse);
    const loanReferenceNo = buildLoanReferenceNo(offer.id, applicationId);
    const admissionMode = offer.admission_mode === "entrance"
      ? `Entrance / Counselling${offer.entrance_exam_name ? ` - ${offer.entrance_exam_name}` : ""}`
      : "Direct Admission";
    const fmtShortDate = (value: string | null) =>
      value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-";
    const estimatedDueDate = (term: string) => {
      const match = term.match(/^year_(\d+)$/);
      if (!match) return "-";
      const base = new Date(deadlines.fee_submission_deadline || DEFAULT_FEE_SUBMISSION_DEADLINE);
      base.setFullYear(base.getFullYear() + Math.max(0, Number(match[1]) - 1));
      return fmtShortDate(base.toISOString());
    };

    const badgeLabel = "Application ID";
    const badgeRef = applicationId || "";
    const badgeW = Math.max(doc.getTextWidth(badgeLabel), doc.getTextWidth(badgeRef)) + 36;
    const badgeH = 58;
    const badgeX = pageWidth - margin - badgeW;
    doc.setFillColor(51, 176, 99);
    doc.roundedRect(badgeX, 18, badgeW, badgeH, 10, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(badgeLabel, badgeX + (badgeW - doc.getTextWidth(badgeLabel)) / 2, 39);
    doc.setFontSize(16);
    doc.text(badgeRef, badgeX + (badgeW - doc.getTextWidth(badgeRef)) / 2, 62);
    doc.setTextColor(20, 24, 40);

    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(105, 105, 115);
    doc.text(`Letter Date: ${generatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`, margin, y);
    doc.text(`Reference No.: ${loanReferenceNo}`, pageWidth - margin, y, { align: "right" });
    y += 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("EDUCATION LOAN SUPPORT LETTER", margin, y);
    doc.setTextColor(20, 24, 40);
    y += 16;

    write("To Whom It May Concern,", 8, 2);
    write(`This is to certify that ${lead.name || applicantName || "the applicant"} has been offered provisional admission to ${programmeName} at NIMT Educational Institutions.`);
    write(`The applicant has paid at least ${fmt(LOAN_LETTER_UNLOCK_TOKEN_FEE)} as token fee against the admission offer. This letter is issued to support the applicant's education loan application with a bank or financial institution. Please quote Loan Reference Letter No. ${loanReferenceNo} for verification.`);

    heading("APPLICANT AND PROGRAMME DETAILS");
    kvGrid([
      { label: "Applicant Name", value: lead.name || applicantName || "-" },
      { label: "Application ID", value: applicationId || "-" },
      { label: "Loan Reference Letter No.", value: loanReferenceNo },
      { label: "Programme", value: programmeName },
      { label: "Pre-Admission No.", value: lead.pre_admission_no || "-" },
      { label: "Admission Mode", value: admissionMode },
    ]);

    y += 3;
    heading("INSTITUTION BANK ACCOUNT DETAILS");
    kvGrid([
      { label: "Beneficiary Name", value: bankDetails.beneficiary_name },
      { label: "Bank Name", value: bankDetails.bank_name },
      { label: "Account No.", value: bankDetails.account_no },
      { label: "IFSC Code", value: bankDetails.ifsc },
      { label: "Branch", value: bankDetails.branch },
      { label: "UPI ID", value: bankDetails.upi_id },
    ], 3);

    y += 3;
    write(`Banks may remit the sanctioned education-loan amount directly to the above college account on behalf of ${lead.name || applicantName || "the applicant"}.`, 7, 2);
    y += 1;
    heading("FEE DETAILS");
    feeTable([
      ...feeRows.map(r => ({
        label: r.term.replace("year_", "Year "),
        dueDate: estimatedDueDate(r.term),
        published: r.raw,
        waiver: r.totalDeduction,
        applicable: r.net,
      })),
      {
        label: "Total Programme Fee",
        dueDate: "-",
        published: feeRows.reduce((sum, r) => sum + r.raw, 0),
        waiver: feeRows.reduce((sum, r) => sum + r.totalDeduction, 0),
        applicable: totalCourseFee,
        total: true,
      },
    ]);
    y += 3;
    kvGrid([
      { label: "Token Fee Required", value: fmt(feeStatus.token_required || offer.token_fee_amount || 0) },
      { label: "Token Fee Paid", value: fmt(feeStatus.token_paid) },
      { label: "First-Year Amount Due", value: fmt(firstYearAmountDue) },
    ], 3);

    y += 3;
    write("Examination Fee, Uniform Fee and other university / examination-body charges are not included in the above fee structure.", 7, 2);
    write("This letter does not constitute a guarantee of loan approval. Final sanction, amount, terms, and disbursement are subject to the lending institution's policies and verification.", 7, 5);

    ensureSpace(42);
    const signRowH = 32;
    const totalW = pageWidth - margin * 2;
    doc.setDrawColor(140, 140, 153);
    doc.rect(margin, y, totalW * 0.55, signRowH);
    doc.rect(margin + totalW * 0.55, y, totalW * 0.45, signRowH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(105, 105, 115);
    doc.text("Principal / Director Signature & Seal", margin + 6, y + 9);
    doc.text("For the Institution", margin + totalW * 0.55 + 6, y + 9);
    doc.line(margin + 12, y + 24, margin + totalW * 0.55 - 12, y + 24);
    doc.line(margin + totalW * 0.55 + 12, y + 22, margin + totalW - 12, y + 22);
    doc.setFont("helvetica", "bold");
    doc.text("AUTHORISED SIGNATORY", margin + totalW * 0.55 + 6, y + signRowH - 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(105, 105, 115);
    doc.text(`System-generated loan support letter. Generated: ${generatedStamp}`, margin, pageHeight - bottomReserve + 10);
    doc.text("Page 1 of 1", pageWidth / 2, pageHeight - bottomReserve + 10, { align: "center" });

    return URL.createObjectURL(doc.output("blob"));
  };

  const generateLoanLetter = async () => {
    if (!offer) return;
    const previewWindow = window.open("about:blank", "_blank");
    setGeneratingLoanLetter(true);
    setError(null);
    try {
      if (shouldUseLocalLoanLetterPreview()) {
        const localUrl = await generateLocalLoanLetterPreview();
        setOffer(prev => {
          if (prev?.loan_letter_url?.startsWith("blob:")) URL.revokeObjectURL(prev.loan_letter_url);
          return prev ? { ...prev, loan_letter_url: localUrl } : prev;
        });
        openPdfUrl(localUrl, previewWindow);
        return;
      }

      const { data, error: invErr } = await supabase.functions.invoke("generate-loan-letter", {
        body: { offer_letter_id: offer.id, application_id: applicationId, force: true },
      });
      if (invErr) {
        let detail = invErr.message;
        try {
          const ctx = (invErr as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } }).context;
          const body = ctx?.json ? await ctx.json() : (ctx?.text ? await ctx.text() : null);
          if (body && typeof body === "object" && "error" in body && typeof body.error === "string") detail = body.error;
          else if (typeof body === "string" && body) detail = body;
        } catch {
          // Keep the generic function error if the response body cannot be parsed.
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      const url = data?.loan_letter_url;
      if (!url) throw new Error("No loan letter URL returned");
      setOffer(prev => prev ? { ...prev, loan_letter_url: url } : prev);
      openPdfUrl(url, previewWindow);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to generate loan letter";
      const canPreviewLocally = import.meta.env.DEV && /failed to send a request|failed to fetch|network/i.test(message);
      if (!canPreviewLocally) {
        previewWindow?.close();
        setError(message);
      } else {
        try {
          const localUrl = await generateLocalLoanLetterPreview();
          setOffer(prev => {
            if (prev?.loan_letter_url?.startsWith("blob:")) URL.revokeObjectURL(prev.loan_letter_url);
            return prev ? { ...prev, loan_letter_url: localUrl } : prev;
          });
          openPdfUrl(localUrl, previewWindow);
        } catch (fallbackErr) {
          previewWindow?.close();
          setError(fallbackErr instanceof Error ? fallbackErr.message : message);
        }
      }
    } finally {
      setGeneratingLoanLetter(false);
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
  const loanLetterUnlocked = feeStatus.token_paid >= LOAN_LETTER_UNLOCK_TOKEN_FEE;
  const isAdmitted = !!lead.admission_no;
  const isPreAdmitted = !!lead.pre_admission_no;
  const useLocalLoanLetterPreview = shouldUseLocalLoanLetterPreview();

  // Deadline calculations
  const deadlineDate = offer.acceptance_deadline ? new Date(offer.acceptance_deadline) : null;
  const daysLeft = deadlineDate ? Math.ceil((deadlineDate.getTime() - Date.now()) / 86400000) : null;
  const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;
  const isExpired = daysLeft !== null && daysLeft < 0;

  // Global deadlines (super_admin-editable via _app_config). Parse as IST
  // midnight so end-of-day comparisons are correct for India users.
  const semesterFeeDeadline       = new Date(deadlines.fee_submission_deadline);
  const fullCoursePaymentDeadline = new Date(deadlines.full_course_payment_deadline);
  // The 1-year fee conversion (additional scholarship) shares its deadline
  // with the pending-fee submission — a single date the super_admin can
  // extend in one shot for every active offer.
  const scholarshipDeadline       = semesterFeeDeadline;
  const todayMs                   = Date.now();
  const fullCourseWindowOpen      = todayMs <= fullCoursePaymentDeadline.getTime() + 86399000;
  const scholarshipWindowOpen     = todayMs <= scholarshipDeadline.getTime() + 86399000;

  // Multi-year waiver visibility — driven by the global scholarship
  // deadline, NOT the per-lead countdown the policy used to enforce.
  // Show the additional-years discount whenever today ≤ scholarship
  // deadline AND the offer has additional years.
  const inMultiYearWindow = scholarshipWindowOpen;

  // Milestone dates
  const tokenPaidAt = feeStatus.token_completed_at ? new Date(feeStatus.token_completed_at) : null;
  // After token is paid: actual due = paid date + 5 days.
  // Before token is paid: estimated due = token fee deadline + 5 days (so candidate knows in advance).
  const confirmDueDate = tokenPaidAt
    ? new Date(tokenPaidAt.getTime() + 5 * 86400000)
    : deadlineDate
    ? new Date(deadlineDate.getTime() + 5 * 86400000)
    : null;
  const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtDateLong = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
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
          {offer.letter_url && !isMbaCourse(courseName) && (
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

      {/* ── Education loan letter ───────────────────────── */}
      {loanLetterUnlocked && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-indigo-950">
                Education Loan Letter
              </p>
              <p className="text-xs mt-0.5 leading-snug text-indigo-700">
                You have paid at least ₹{LOAN_LETTER_UNLOCK_TOKEN_FEE.toLocaleString("en-IN")} token fee. Download the loan support letter for bank processing.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                disabled={generatingLoanLetter}
                onClick={generateLoanLetter}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {generatingLoanLetter ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {useLocalLoanLetterPreview ? "Preview latest local" : offer.loan_letter_url ? "View Latest" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      Pay the token fee shown on your offer to secure your seat and receive your Pre-Admission Number.
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
        const rows = buildApplicantFeeBreakdownRows({
          yearFeesNet: yearFees,
          offerWaivers,
          scholarshipAmount: offer.scholarship_amount || 0,
          feeStatus,
        });

        const grandRaw = rows.reduce((s, r) => s + r.raw, 0);
        const grandNet = rows.reduce((s, r) => s + r.net, 0);
        const grandDeductions = grandRaw - grandNet;
        const hasMultiYear = rows.length > 1;
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
                Paying the token fee reserves your seat for <span className="font-semibold">5 days</span>.
                You must pay 25% within those 5 days to receive your Admission Number and confirm enrollment.
                Admission is <span className="font-semibold">not confirmed</span> until 25% is paid.
              </p>
            </div>
          </div>
        );
      })()}

      {!feeStatus.twenty_five_complete && !tokenGatewayLoading && tokenGateways.length > 1 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Payment Gateway</p>
          <div className="flex flex-wrap gap-2">
            {tokenGateways.map((gateway) => (
              <button
                key={gateway.gateway}
                onClick={() => setSelectedGateway(gateway.gateway)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                  selectedGateway === gateway.gateway
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50"
                }`}
              >
                {gateway.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Payment CTAs ──────────────────────────────── */}
      {!feeStatus.twenty_five_complete && towardsAdmission > 0 && (() => {
        // Installment presets for the token fee alternative
        const presets: number[] = [];
        let p = minInstalment;
        while (p < feeStatus.token_required && presets.length < 4) { presets.push(p); p += minInstalment; }
        if (!presets.includes(feeStatus.token_required) && feeStatus.token_required > 0) presets.push(feeStatus.token_required);

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
                      onClick={() => {
                        setInstalmentPreset(v => v === tokenOutstanding ? minInstalment : tokenOutstanding);
                        setCustomAmt("");
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2"
                    >
                      {instalmentPreset !== tokenOutstanding
                        ? "Hide instalment options"
                        : "Pay in parts instead (min ₹" + minInstalment.toLocaleString("en-IN") + ")"}
                    </button>

                    {/* Instalment chips — revealed on toggle */}
                    {instalmentPreset !== tokenOutstanding && (
                      <div className="space-y-3 pt-1">
                        <div className="flex flex-wrap gap-2">
                          {presets.filter(p => p <= tokenOutstanding).map(amt => (
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

      {/* ── Lump-sum payment options ───────────────────────────────────
           Hero "Best Value" full-course card with the marketing
           headline ("Save ₹X on Full Course") plus a collapsible
           breakdown for transparency. Year-1 sits below as a
           smaller alternative — visible but visually secondary so the
           full-course pitch lands first.
      */}
      {(feeStatus.lump_sum_pct || 0) > 0 && (() => {
        const rows = buildApplicantFeeBreakdownRows({
          yearFeesNet: yearFees,
          offerWaivers,
          scholarshipAmount: offer.scholarship_amount || 0,
          feeStatus,
        });
        // Use paid_toward_course (token_fee + 'other'), NOT total_paid —
        // application_fee and registration_fee are separate charges and
        // shouldn't reduce the course-fee due. Falls back to total_paid
        // for older RPC responses missing the new field.
        const paid      = feeStatus.paid_toward_course ?? feeStatus.total_paid ?? 0;
        const paymentOptions = buildApplicantOneTimePaymentOptions({
          rows,
          paidTowardCourse: paid,
          lumpSumPct: feeStatus.lump_sum_pct || 0,
          multiYearPct: feeStatus.multi_year_pct || 0,
          includeMultiYearWaiver: inMultiYearWindow,
        });
        const y1Fee     = paymentOptions.year1NetFee;
        const totalFee  = paymentOptions.totalNetFee;
        const y1Disc    = paymentOptions.year1Discount;
        const fcDisc    = paymentOptions.fullCourseDiscount;
        const y1Due     = paymentOptions.year1AmountDue;
        const fcDue     = paymentOptions.fullCourseAmountDue;
        const multiDisc = paymentOptions.fullCourseAdditionalDiscount;
        const y1Covered = y1Due === 0 && y1Fee > 0;
        const fcCovered = fcDue === 0 && totalFee > 0;
        const surplusPaidVsY1 = Math.max(0, paid - y1Fee + y1Disc);
        const fmtRupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
        const hasFullCourse = paymentOptions.additionalYearsNetFee > 0;

        return (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">One-time payment waivers</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Calculated on fee after approved waiver.</p>
            </div>

            {/* ── HERO: Full course (Best Value) ──────────────────────────
                Gated on full_course_payment_deadline — after that date the
                lump-sum CTA disappears (only year-1 lump-sum remains
                below). The card stays visible if the candidate already
                paid in full, so they always see the receipt state. */}
            {hasFullCourse && (fullCourseWindowOpen || fcCovered) && (
              <div className={`rounded-2xl border-2 p-5 shadow-lg relative ${
                fcCovered ? "border-gray-200 bg-gray-50" :
                "border-emerald-300 bg-emerald-50"
              }`}>
                {!fcCovered && (
                  <div className="absolute -top-3 left-4 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold text-white shadow-md">
                    <Sparkles className="h-3 w-3" /> BEST VALUE
                  </div>
                )}

                <div className="relative flex items-start justify-between gap-4 mt-2">
                  <div className="min-w-0 flex-1">
                    {fcCovered ? (
                      <>
                        <p className="text-sm font-bold text-emerald-900 flex items-center gap-1.5">
                          <Check className="h-4 w-4" /> Full course paid
                        </p>
                        <p className="text-xs text-emerald-700 mt-0.5">Your fee is fully settled. Welcome aboard.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-bold text-emerald-900 leading-tight">
                          Pay full course now
                        </p>
                        <p className="text-xs text-emerald-700 mt-1">
                          One-time waiver: save {fmtRupee(fcDisc)} on the post-waiver course fee.
                        </p>
                        <p className="text-[11px] text-emerald-700 mt-0.5">
                          {feeStatus.lump_sum_pct}% off year 1
                          {inMultiYearWindow
                            ? ` + extra ${feeStatus.multi_year_pct}% off all other years.`
                            : ` + ${feeStatus.lump_sum_pct}% off other years.`}
                        </p>
                        {inMultiYearWindow && (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-emerald-200 px-2.5 py-1">
                            <CalendarDays className="h-3 w-3 text-emerald-700" />
                            <span className="text-[10px] font-semibold text-emerald-700">Additional scholarship available until</span>
                            <span className="text-[11px] font-bold text-emerald-900">
                              {fmtDateLong(scholarshipDeadline)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {fcCovered ? (
                    <button
                      disabled
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-200 px-5 py-3.5 text-sm font-bold text-gray-500 cursor-not-allowed"
                    >
                      <Check className="h-4 w-4" /> Paid
                    </button>
                  ) : (
                    <button
                      disabled={paying || !applicantPhone || fcDue <= 0}
                      onClick={() => {
                        const lump  = (feeStatus.lump_sum_pct || 0) / 100;
                        const multi = (feeStatus.multi_year_pct || 0) / 100;
                        const breakdown: Record<string, number> = {};
                        Object.entries(yearFees).forEach(([term, fee]) => {
                          const pct = term === "year_1" ? lump : lump + (inMultiYearWindow ? multi : 0);
                          if (pct > 0) breakdown[term] = Math.round(fee * pct);
                        });
                        startPayment(fcDue, {
                          paymentType: "other",
                          productinfo: "Full course fee (with waivers)",
                          concession: fcDisc,
                          reason: inMultiYearWindow
                            ? `Full course: ${feeStatus.lump_sum_pct}% lump + ${feeStatus.multi_year_pct}% multi-year (within window)`
                            : `Full course: ${feeStatus.lump_sum_pct}% lump (window expired)`,
                          concessionBreakdown: Object.keys(breakdown).length ? breakdown : undefined,
                        });
                      }}
                      className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-bold text-white hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-emerald-300/40"
                    >
                      {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                      Pay {fmtRupee(fcDue)}
                    </button>
                  )}
                </div>

                {/* Collapsible breakdown — tucked away by default to keep
                    the marketing copy clean, expanded on click. */}
                {!fcCovered && (
                  <details className="relative mt-3 group">
                    <summary className="cursor-pointer text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      View breakdown
                    </summary>
                    <div className="mt-2 space-y-1 text-[12px] font-mono bg-white/60 rounded-lg p-3 border border-emerald-200/60">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Course fee after waiver</span>
                        <span className="text-gray-900">{fmtRupee(totalFee)}</span>
                      </div>
                      {paid > 0 && (
                        <div className="flex justify-between text-blue-700">
                          <span>Already paid</span>
                          <span>− {fmtRupee(Math.min(paid, totalFee))}</span>
                        </div>
                      )}
                      {y1Disc > 0 && (
                        <div className="flex justify-between text-emerald-700">
                          <span>{feeStatus.lump_sum_pct}% one-time off year 1</span>
                          <span>− {fmtRupee(y1Disc)}</span>
                        </div>
                      )}
                      {multiDisc > 0 && (
                        <div className="flex justify-between text-emerald-700">
                          <span>
                            {inMultiYearWindow
                              ? `${(feeStatus.lump_sum_pct || 0) + (feeStatus.multi_year_pct || 0)}% off years 2-N`
                              : `${feeStatus.lump_sum_pct}% off years 2-N`}
                          </span>
                          <span>− {fmtRupee(multiDisc)}</span>
                        </div>
                      )}
                      <div className="border-t border-emerald-300/60 pt-1.5 mt-1.5 flex justify-between font-bold">
                        <span className="text-gray-700">Pay now</span>
                        <span className="text-emerald-900">{fmtRupee(fcDue)}</span>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* ── Year 1 only — secondary alternative ─────────────────── */}
            {(y1Fee > 0) && (
              <div className={`rounded-xl border p-3 ${
                y1Covered ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50/60"
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-0.5">
                      {hasFullCourse ? "Or pay year 1 only" : "Pay year 1"}
                    </p>
                    {y1Covered ? (
                      <p className="text-xs text-gray-600 inline-flex items-center gap-1">
                        <Check className="h-3 w-3 text-emerald-600" />
                        Year 1 covered.
                        {surplusPaidVsY1 > 0 && (
                          <span className="text-gray-500 italic">
                            {fmtRupee(surplusPaidVsY1)} surplus carries forward.
                          </span>
                        )}
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-amber-900">
                          Pay year 1 now
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          One-time waiver: save {fmtRupee(y1Disc)} · pay {fmtRupee(y1Due)}
                        </p>
                      </>
                    )}
                  </div>

                  {y1Covered ? (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-1 text-[10px] font-bold">
                      <Check className="h-3 w-3" /> Covered
                    </span>
                  ) : (
                    <button
                      disabled={paying || !applicantPhone || y1Due <= 0}
                      onClick={() => startPayment(y1Due, {
                        paymentType: "other",
                        productinfo: "First-year fee (lump-sum)",
                        concession: y1Disc,
                        reason: `Lump-sum first-year ${feeStatus.lump_sum_pct}%`,
                        concessionBreakdown: y1Disc > 0 ? { year_1: y1Disc } : undefined,
                      })}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                    >
                      {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                      Pay {fmtRupee(y1Due)}
                    </button>
                  )}
                </div>

                {/* Compact breakdown — only show when there's something to pay */}
                {!y1Covered && (
                  <details className="mt-2 group">
                    <summary className="cursor-pointer text-[10px] font-semibold text-amber-700 hover:text-amber-900 inline-flex items-center gap-1 list-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-2.5 w-2.5 transition-transform group-open:rotate-90" />
                      View breakdown
                    </summary>
                    <div className="mt-1.5 space-y-0.5 text-[11px] font-mono bg-white/70 rounded-md p-2 border border-amber-200/50">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Year 1 fee after waiver</span>
                        <span className="text-gray-900">{fmtRupee(y1Fee)}</span>
                      </div>
                      {paid > 0 && (
                        <div className="flex justify-between text-blue-700">
                          <span>Already paid</span>
                          <span>− {fmtRupee(Math.min(paid, y1Fee))}</span>
                        </div>
                      )}
                      {y1Disc > 0 && (
                        <div className="flex justify-between text-emerald-700">
                          <span>{feeStatus.lump_sum_pct}% one-time off</span>
                          <span>− {fmtRupee(y1Disc)}</span>
                        </div>
                      )}
                      <div className="border-t border-amber-200/60 pt-1 mt-1 flex justify-between font-bold">
                        <span className="text-gray-700">Pay now</span>
                        <span className="text-amber-900">{fmtRupee(y1Due)}</span>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })()}

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
        const otherTxns = payments.filter(p => p.status !== "confirmed");
        return (
          <>
            {/* Receipts — confirmed payments only */}
            {confirmed.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3.5 flex items-center justify-between border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-semibold text-gray-700">Receipts</span>
                    <span className="text-xs text-gray-400">{confirmed.length} receipt{confirmed.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {confirmed.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">
                            {TYPE_LABELS[p.type] || p.type}
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
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-gray-900">{fmtAmt(p.amount)}</p>
                        {p.receipt_url ? (
                          <a
                            href={p.receipt_url} target="_blank" rel="noopener"
                            className="text-[11px] text-blue-600 hover:underline"
                          >
                            Receipt ↗
                          </a>
                        ) : (
                          <span className="text-[11px] text-gray-400">Generating…</span>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                    <span className="text-xs font-semibold text-gray-500">Total Confirmed</span>
                    <span className="text-sm font-bold text-gray-900">
                      {fmtAmt(confirmed.reduce((s, p) => s + Number(p.amount), 0))}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Transaction History — pending + failed/abandoned attempts */}
            {otherTxns.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3.5 flex items-center justify-between border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-semibold text-gray-700">Transaction History</span>
                    <span className="text-xs text-gray-400">{otherTxns.length} unconfirmed</span>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {otherTxns.map(p => {
                    const isPending = p.status === "pending";
                    return (
                      <div key={p.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-700">
                              {TYPE_LABELS[p.type] || p.type}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isPending ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            }`}>
                              {isPending ? "Pending" : p.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[11px] text-gray-400">{fmtDt(p.created_at)}</span>
                            {p.transaction_ref && (
                              <span className="text-[11px] font-mono text-gray-400">· {p.transaction_ref}</span>
                            )}
                          </div>
                        </div>
                        <p className={`text-sm font-medium ${isPending ? "text-amber-700" : "text-gray-500"}`}>
                          {fmtAmt(p.amount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
