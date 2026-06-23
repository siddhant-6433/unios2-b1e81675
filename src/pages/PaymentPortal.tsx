import { useState, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import { useScopedPaymentGateways } from "@/lib/paymentGatewayResolver";
import { brandForStudentOwner, NIMT_EDU_BRAND, type StudentBrand } from "@/lib/studentBranding";
import { useAuth } from "@/contexts/AuthContext";
import { openRazorpayCheckout, type RazorpayOrder } from "@/lib/razorpayCheckout";
import uniosLogo from "@/assets/unios-logo.png";
import {
  Loader2, AlertCircle, CheckCircle, CreditCard, ShieldCheck,
  ArrowRight, Download,
} from "lucide-react";

type Step = "verify" | "fees" | "paying" | "receipt";

interface StudentFee {
  id: string;
  fee_head: string;
  amount: number;
  balance: number;
  status: string;
  due_date: string;
}

interface StudentInfo {
  id: string;
  name: string;
  admission_no: string;
  course_id: string | null;
  campus_id: string | null;
  course_name: string;
  semester: string;
  campus_name: string;
  parent_phone: string;
  brand: StudentBrand;
}

interface StudentPortalPaymentHandoff {
  fromStudentPortal?: boolean;
  student?: StudentInfo;
  fees?: StudentFee[];
}

const readFunctionErrorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: { text?: () => Promise<string> } }).context
    : undefined;
  const text = await context?.text?.().catch(() => "");
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return text.slice(0, 200) || fallback;
  }
};

export default function PaymentPortal() {
  const { user: authUser, loading: authLoading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const studentParam = params.get("student");
  const tokenParam   = params.get("token");
  const feeParam     = params.get("fee");
  const scopeParam   = params.get("scope");
  const paymentScope = feeParam ? "fee" : scopeParam === "all" ? "all" : "due";

  const [step, setStep]         = useState<Step>("verify");
  const [phone, setPhone]       = useState("");
  const [otp, setOtp]           = useState("");
  const [otpSent, setOtpSent]   = useState(false);
  const [loading, setLoading]   = useState(!!studentParam);
  const [error, setError]       = useState<string | null>(null);
  const [student, setStudent]   = useState<StudentInfo | null>(null);
  const [fees, setFees]         = useState<StudentFee[]>([]);
  const [receipt, setReceipt]   = useState<ReceiptData | null>(null);
  const [paidTxnId, setPaidTxnId] = useState<string | null>(null);
  const [selectedGateway, setSelectedGateway] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const userSelectedGatewayRef = useRef(false);
  const { gateways: feeGateways, loading: gatewaysLoading } = useScopedPaymentGateways({
    context: "student_fee",
    studentId: student?.id,
    courseId: student?.course_id,
    campusId: student?.campus_id,
    enabled: !!student,
  });
  const brand = student?.brand || NIMT_EDU_BRAND;
  const isStudentPortalHandoff = tokenParam === "student_portal";
  const paymentHandoff = location.state as StudentPortalPaymentHandoff | null;

  // Cleanup poll on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    if (gatewaysLoading) return;
    if (feeGateways.length > 0 && (!userSelectedGatewayRef.current || !selectedGateway || !feeGateways.some((g) => g.gateway === selectedGateway))) {
      setSelectedGateway(feeGateways[0].gateway);
    }
  }, [gatewaysLoading, feeGateways, selectedGateway]);

  const selectGateway = (gateway: string) => {
    userSelectedGatewayRef.current = true;
    setSelectedGateway(gateway);
  };

  // Listen for postMessage from popup gateways
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.eb_payment === "success" || e.data?.icici_payment === "success") {
        stopPolling();
        checkFeesPaid();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [student?.id]);

  // Student portal handoff: use the active logged-in student session instead
  // of asking for phone verification again. Public token links keep the
  // existing direct-link behavior.
  useEffect(() => {
    if (!studentParam) {
      setLoading(false);
      return;
    }

    if (tokenParam && tokenParam !== "student_portal") {
      verifyToken();
      return;
    }

    if (
      isStudentPortalHandoff &&
      paymentHandoff?.fromStudentPortal &&
      paymentHandoff.student?.id === studentParam &&
      Array.isArray(paymentHandoff.fees)
    ) {
      setStudent(paymentHandoff.student);
      setFees(paymentHandoff.fees);
      setStep("fees");
      setLoading(false);
      return;
    }

    if (authLoading) {
      setLoading(true);
      return;
    }

    let cancelled = false;
    const loadFromActiveSession = async () => {
      setLoading(true);
      setError(null);

      if (!authUser?.id) {
        if (tokenParam === "student_portal") {
          setError("Open this payment from the student portal after signing in.");
        }
        setLoading(false);
        return;
      }

      await loadStudentFromSession(authUser.id, () => cancelled);
    };

    loadFromActiveSession();
    return () => { cancelled = true; };
  }, [studentParam, tokenParam, scopeParam, feeParam, authLoading, authUser?.id, isStudentPortalHandoff, paymentHandoff]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  const verifyToken = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("students")
      .select("id, name, admission_no, pre_admission_no, phone, father_phone, mother_phone, guardian_phone, campus_id, course_id, user_id, campuses:campus_id(name), courses:course_id(name, code, departments(institutions(name, type)))")
      .eq("id", studentParam!)
      .single();
    if (err || !data) { setError("Invalid link. Contact the institution."); setLoading(false); return; }
    setStudent(toInfo(data));
    await fetchFees(data.id);
    setStep("fees");
    setLoading(false);
  };

  const loadStudentFromSession = async (userId: string, isCancelled: () => boolean = () => false) => {
    setError(null);
    const { data, error: err } = await (supabase as any)
      .from("students")
      .select("id, name, admission_no, pre_admission_no, phone, father_phone, mother_phone, guardian_phone, campus_id, course_id, user_id, campuses:campus_id(name), courses:course_id(name, code, departments(institutions(name, type)))")
      .eq("id", studentParam!)
      .maybeSingle();

    if (isCancelled()) return;

    if (err || !data) {
      setError(`Could not open this student's payment page for the signed-in account (${userId.slice(0, 8)}). Please go back to the student portal and click Pay Now again.`);
      setLoading(false);
      return;
    }

    if (data.user_id && data.user_id !== userId) {
      setError(`This payment link belongs to a different student login. Please sign out and log in as the student linked to this record.`);
      setLoading(false);
      return;
    }

    setStudent(toInfo(data));
    await fetchFees(data.id);
    if (isCancelled()) return;
    setStep("fees");
    setLoading(false);
  };

  function toInfo(data: any): StudentInfo {
    const course = data.courses;
    const institution = course?.departments?.institutions;
    return {
      id: data.id,
      name: data.name,
      admission_no: data.admission_no || data.pre_admission_no || "",
      course_id: data.course_id || null,
      campus_id: data.campus_id || null,
      course_name: course?.name || "",
      semester: "",
      campus_name: data.campuses?.name || "",
      parent_phone: data.father_phone || data.mother_phone || data.guardian_phone || data.phone || "",
      brand: brandForStudentOwner({
        campusName: data.campuses?.name,
        courseName: course?.name,
        courseCode: course?.code,
        institutionName: institution?.name,
        institutionType: institution?.type,
      }),
    };
  }

  const sendOtp = async () => {
    if (phone.length < 10) { setError("Enter a valid 10-digit phone number"); return; }
    setLoading(true);
    setError(null);

    const { data: studentData } = await (supabase as any)
      .from("students")
      .select("id, name, admission_no, pre_admission_no, phone, father_phone, mother_phone, guardian_phone, campus_id, course_id, campuses:campus_id(name), courses:course_id(name, code, departments(institutions(name, type)))")
      .or([
        `phone.eq.${phone}`, `phone.eq.+91${phone}`,
        `father_phone.eq.${phone}`, `father_phone.eq.+91${phone}`,
        `mother_phone.eq.${phone}`, `mother_phone.eq.+91${phone}`,
        `guardian_phone.eq.${phone}`, `guardian_phone.eq.+91${phone}`,
      ].join(","))
      .limit(1)
      .single();

    if (!studentData) {
      setError("No student found for this number. Contact the institution.");
      setLoading(false);
      return;
    }

    const { data: otpData, error: otpErr } = await supabase.functions.invoke("whatsapp-otp", {
      body: { action: "send", phone: `+91${phone}` },
    });

    if (otpErr || otpData?.error) {
      setError(otpData?.error || otpErr?.message || "Could not send OTP. Try again.");
      setLoading(false);
      return;
    }

    setStudent(toInfo(studentData));
    setOtpSent(true);
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (otp.length < 4) { setError("Enter the OTP"); return; }
    setLoading(true);
    setError(null);

    const { data: otpData, error: otpErr } = await supabase.functions.invoke("whatsapp-otp", {
      body: { action: "verify", phone: `+91${phone}`, otp },
    });

    if (otpErr || otpData?.error) {
      setError(otpData?.error || otpErr?.message || "Invalid or expired OTP.");
      setLoading(false);
      return;
    }

    if (student) await fetchFees(student.id);
    setStep("fees");
    setLoading(false);
  };

  const fetchFees = async (studentId: string) => {
    const { data } = await supabase
      .from("fee_ledger")
      .select("id, total_amount, paid_amount, balance, status, due_date, fee_codes:fee_code_id(name)")
      .eq("student_id", studentId)
      .in("status", ["due", "overdue"])
      .order("due_date", { ascending: true });

    const todayKey = new Date().toLocaleDateString("en-CA");
    const mapped = (data || []).map((f: any) => ({
      id: f.id,
      fee_head: f.fee_codes?.name || "Fee",
      amount: Number(f.total_amount),
      balance: Number(f.balance || 0),
      status: f.status,
      due_date: f.due_date,
    })).filter((fee: StudentFee) => {
      if (fee.balance <= 0) return false;
      if (feeParam) return fee.id === feeParam;
      if (paymentScope === "all") return true;
      return fee.due_date <= todayKey;
    });

    setFees(mapped);
  };

  const checkFeesPaid = async (): Promise<boolean> => {
    if (!student) return false;
    const { data } = await supabase
      .from("fee_ledger")
      .select("id")
      .eq("student_id", student.id)
      .in("status", ["due", "overdue"])
      .in("id", fees.map((fee) => fee.id));

    if (!data || data.length === 0) {
      setStep("receipt");
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
      return true;
    }
    return false;
  };

  const totalDue = fees.reduce((s, f) => s + f.balance, 0);
  const waiverAmount = paymentScope === "all" ? Math.round(totalDue * 0.05) : 0;
  const payableAmount = Math.max(totalDue - waiverAmount, 0);
  const paymentTitle = paymentScope === "all"
    ? "Annual Fee Payment"
    : paymentScope === "fee"
      ? "Future Fee Payment"
      : "Due Fee Payment";
  const activeGateway = selectedGateway || feeGateways[0]?.gateway || "easebuzz";
  const activeGatewayName =
    feeGateways.find((gateway) => gateway.gateway === activeGateway)?.display_name ||
    (activeGateway === "razorpay" ? "Razorpay" : activeGateway === "icici" ? "ICICI Bank PG" : "EaseBuzz");

  const handlePay = async () => {
    if (!student) return;
    setError(null);
    setLoading(true);

    try {
      const nameParts = student.name.trim().split(" ");
      if (activeGateway === "razorpay") {
        const { data: order, error: orderError } = await supabase.functions.invoke("razorpay-payment", {
          body: {
            action: "create-order",
            context: "student_fee",
            student_id: student.id,
            amount: Math.round(payableAmount * 100),
            currency: "INR",
            receipt: `fee_${student.id}`,
            payment_scope: paymentScope,
            fee_ids: paymentScope === "all" ? [] : fees.map((fee) => fee.id),
            waiver_amount: waiverAmount,
            customer_name: student.name,
            customer_phone: student.parent_phone,
            productinfo: paymentTitle,
          },
        });
        if (orderError) throw new Error(await readFunctionErrorMessage(orderError));
        if (order?.error) throw new Error(order.error);

        const checkoutResponse = await openRazorpayCheckout({
          order: order as RazorpayOrder,
          name: brand.name,
          description: paymentTitle,
          customerName: student.name,
          customerPhone: student.parent_phone,
        });

        const { data: verifyData, error: verifyError } = await supabase.functions.invoke("razorpay-payment", {
          body: {
            action: "verify-payment",
            context: "student_fee",
            order_id: order.order_id,
            student_id: student.id,
            payment_scope: paymentScope,
            fee_ids: paymentScope === "all" ? [] : fees.map((fee) => fee.id),
            waiver_amount: waiverAmount,
            ...checkoutResponse,
          },
        });
        if (verifyError) throw new Error(await readFunctionErrorMessage(verifyError));
        if (verifyData?.error) throw new Error(verifyData.error);

        setPaidTxnId(verifyData?.payment_id || checkoutResponse.razorpay_payment_id);
        const alreadyPaid = await checkFeesPaid();
        if (!alreadyPaid) setStep("receipt");
        setLoading(false);
        return;
      }

      const txnid = `FEE${student.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}${Date.now()}`.slice(0, 50);
      const functionName = activeGateway === "icici" ? "icici-payment" : "easebuzz-payment";

      const { data: fnData, error: fnError } = await supabase.functions.invoke(functionName, {
        body: {
          action: "initiate-fee-payment",
          student_id: student.id,
          txnid,
          amount: totalDue,
          payment_scope: paymentScope,
          fee_ids: paymentScope === "all" ? [] : fees.map((fee) => fee.id),
          waiver_amount: waiverAmount,
          productinfo: "Fee Payment",
          firstname: nameParts[0],
          email: undefined,
          phone: student.parent_phone || phone || "9999999999",
        },
      });

      if (fnError) throw new Error(await readFunctionErrorMessage(fnError));
      if (fnData?.error) throw new Error(fnData.error);

      const { pay_url } = fnData;
      const gatewayTxnId = fnData?.txnid || txnid;
      setPaidTxnId(gatewayTxnId);

      popupRef.current = window.open(
        pay_url,
        "easebuzz_fee_payment",
        "width=680,height=720,scrollbars=yes,resizable=yes"
      );

      if (!popupRef.current) {
        throw new Error("Popup was blocked. Please allow popups for this site and try again.");
      }

      setStep("paying");
      setLoading(false);

      // Poll every 2s for payment confirmation
      pollRef.current = setInterval(async () => {
        if (popupRef.current?.closed) {
          stopPolling();
          const alreadyPaid = await checkFeesPaid();
          if (!alreadyPaid) {
            // DB not yet updated — ask the gateway server to confirm, then re-check DB
            const { data: verifyData } = await supabase.functions.invoke(functionName, {
              body: {
                action: "verify-payment",
                txnid: gatewayTxnId,
                application_id: "",
                student_id: student.id,
                fee_ids: paymentScope === "all" ? [] : fees.map((fee) => fee.id),
                payment_scope: paymentScope,
                waiver_amount: waiverAmount,
              },
            });
            const verified = verifyData?.status?.toLowerCase() === "success" ||
              verifyData?.status === "SUC" ||
              verifyData?.raw?.responseCode === "0000" ||
              verifyData?.raw?.responseCode === "000";
            if (verified) {
              // Server confirmed success — re-check DB to confirm ledger is updated
              const confirmedPaid = await checkFeesPaid();
              if (!confirmedPaid) {
                // Ledger not yet updated (webhook delay) — show success and wait
                setStep("receipt");
              }
            } else {
              setError("Payment window was closed. If your payment was deducted, it will be confirmed shortly.");
              setStep("fees");
            }
          }
        } else {
          await checkFeesPaid();
        }
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
            <img src={student ? brand.logo : uniosLogo} alt={student ? brand.logoAlt : "UniOs"} className="h-8 max-w-[150px] object-contain" />
            <span className="text-sm font-semibold text-gray-900 truncate">{brand.name} - Fee Payment</span>
          </div>
        </header>

        <main className="flex-1 max-w-lg mx-auto w-full px-4 py-8 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          )}

          {step === "verify" && !loading && isStudentPortalHandoff && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4">
                  <ShieldCheck className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">Checking Student Session</h1>
                <p className="text-sm text-gray-500 mt-1">Open fee payment from the signed-in student portal.</p>
              </div>

              {error && (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {/* Step 1: OTP */}
          {step === "verify" && !loading && !isStudentPortalHandoff && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4">
                  <ShieldCheck className="h-7 w-7 text-primary" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">Verify Your Identity</h1>
                <p className="text-sm text-gray-500 mt-1">Enter the phone number registered with the institution</p>
              </div>

              {error && (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {!otpSent ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                    <div className="flex items-center gap-2">
                      <span className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">+91</span>
                      <input
                        type="tel" maxLength={10} placeholder="9876543210"
                        value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                        className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  </div>
                  <button onClick={sendOtp} className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                    Send OTP <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 text-center">
                    OTP sent via WhatsApp to +91 {phone.slice(0, 2)}****{phone.slice(-2)}
                  </p>
                  <input
                    type="tel" maxLength={6} placeholder="Enter OTP"
                    value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-lg font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <button onClick={verifyOtp} className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                    Verify & Continue <ArrowRight className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setOtpSent(false); setOtp(""); setError(null); }} className="w-full text-sm text-gray-500 hover:text-gray-700">
                    Change phone number
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Fee Summary */}
          {step === "fees" && student && !loading && (
            <div className="space-y-4">
              {error && (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="rounded-2xl bg-white border border-gray-200 p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                    {student.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-gray-900 truncate">{student.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-500 mt-0.5">
                      {student.course_name && <span>{student.course_name}</span>}
                      {student.semester && <span>Sem {student.semester}</span>}
                      <span className="font-mono">{student.admission_no}</span>
                    </div>
                  </div>
                </div>
              </div>

              {fees.length === 0 ? (
                <div className="rounded-xl bg-white border border-gray-200 p-8 text-center">
                  <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900">All fees paid!</h3>
                  <p className="text-sm text-gray-500 mt-1">No outstanding fees at this time.</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
                    {fees.map((fee) => (
                      <div key={fee.id} className="flex items-center justify-between p-4">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{fee.fee_head}</p>
                          <p className="text-xs text-gray-400">
                            Due {new Date(fee.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                            {fee.status === "overdue" && <span className="ml-2 text-red-500 font-medium">Overdue</span>}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">₹{fee.balance.toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                  <div className="flex items-center justify-between p-4 bg-gray-50">
                      <p className="text-sm font-bold text-gray-900">{paymentTitle}</p>
                      <p className="text-lg font-bold text-gray-900">₹{totalDue.toLocaleString("en-IN")}</p>
                    </div>
                    {waiverAmount > 0 && (
                      <>
                        <div className="flex items-center justify-between p-4 bg-green-50">
                          <p className="text-sm font-semibold text-green-700">Pay All Waiver (5%)</p>
                          <p className="text-sm font-bold text-green-700">-₹{waiverAmount.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-gray-50">
                          <p className="text-sm font-bold text-gray-900">Payable Now</p>
                          <p className="text-lg font-bold text-gray-900">₹{payableAmount.toLocaleString("en-IN")}</p>
                        </div>
                      </>
                    )}
                  </div>

                  {!gatewaysLoading && feeGateways.length > 1 && (
                    <div className="rounded-xl bg-white border border-gray-200 p-4 space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment Gateway</p>
                      <div className="flex flex-wrap gap-2">
                        {feeGateways.map((gateway) => (
                          <button
                            key={gateway.gateway}
                            onClick={() => selectGateway(gateway.gateway)}
                            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                              selectedGateway === gateway.gateway
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-gray-200 text-gray-600 hover:border-primary/40"
                            }`}
                          >
                            {gateway.display_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button onClick={handlePay} className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
                    <CreditCard className="h-4 w-4" />
                    Pay ₹{payableAmount.toLocaleString("en-IN")}
                  </button>
                  <p className="text-[11px] text-gray-400 text-center">
                    Secure payment powered by {activeGatewayName}. Your data is encrypted.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Step 3: Waiting for popup */}
          {step === "paying" && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-gray-600">Complete payment in the popup window</p>
              <p className="text-xs text-gray-400">Do not close this page</p>
            </div>
          )}

          {/* Step 4: Receipt */}
          {step === "receipt" && student && (
            <div className="space-y-6 text-center">
              <div>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Payment Successful!</h2>
                {paidTxnId && <p className="text-xs text-gray-400 mt-1 font-mono">{paidTxnId}</p>}
              </div>

              <div className="rounded-xl bg-white border border-gray-200 p-5 text-left">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">Student</span>
                  <span className="text-sm font-semibold text-gray-900">{student.name}</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">Amount Paid</span>
                  <span className="text-lg font-bold text-green-600">₹{payableAmount.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Date</span>
                  <span className="text-sm text-gray-700">
                    {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setReceipt({
                  type: "student_fee",
                  student_name: student.name,
                  admission_no: student.admission_no,
                  course_name: student.course_name,
                  semester: student.semester,
                  campus_name: student.campus_name,
                  amount: totalDue,
                  concession_amount: waiverAmount,
                  payment_date: new Date().toISOString(),
                  payment_mode: "online",
                  line_items: fees.map(f => ({ fee_head: f.fee_head, amount: f.balance })),
                })}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 py-3 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                <Download className="h-4 w-4" /> Download Receipt
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
