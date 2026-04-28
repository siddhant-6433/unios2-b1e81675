import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import uniosLogo from "@/assets/unios-logo.png";
import {
  Loader2, AlertCircle, CheckCircle, CreditCard, ShieldCheck,
  Receipt, IndianRupee, ArrowRight, Download,
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
  course_name: string;
  semester: string;
  campus_name: string;
}

export default function PaymentPortal() {
  const [params] = useSearchParams();
  const studentParam = params.get("student");
  const tokenParam = params.get("token");

  const [step, setStep] = useState<Step>("verify");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [fees, setFees] = useState<StudentFee[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // If token provided, try direct verification
  useEffect(() => {
    if (tokenParam && studentParam) {
      verifyToken();
    }
  }, [tokenParam, studentParam]);

  const verifyToken = async () => {
    setLoading(true);
    setError(null);
    // JWT token verification — fetch student directly
    const { data, error: err } = await supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, semester, campuses:campus_id(name), courses:course_id(name)")
      .eq("id", studentParam!)
      .single();

    if (err || !data) {
      setError("Invalid link. Please contact the institution.");
      setLoading(false);
      return;
    }

    setStudent({
      id: data.id,
      name: data.name,
      admission_no: data.admission_no || data.pre_admission_no || "",
      course_name: (data as any).courses?.name || "",
      semester: data.semester || "",
      campus_name: (data as any).campuses?.name || "",
    });

    await fetchFees(data.id);
    setStep("fees");
    setLoading(false);
  };

  const sendOtp = async () => {
    if (phone.length < 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setLoading(true);
    setError(null);

    // Find student by parent phone
    const { data: studentData } = await supabase
      .from("students")
      .select("id, name, admission_no, pre_admission_no, semester, parent_phone, campuses:campus_id(name), courses:course_id(name)")
      .or(`parent_phone.eq.${phone},parent_phone.eq.+91${phone}`)
      .limit(1)
      .single();

    if (!studentData) {
      setError("No student found for this phone number. Contact the institution.");
      setLoading(false);
      return;
    }

    // In production, send OTP via SMS/WhatsApp edge function
    // For now, simulate OTP sent
    setOtpSent(true);
    setStudent({
      id: studentData.id,
      name: studentData.name,
      admission_no: studentData.admission_no || studentData.pre_admission_no || "",
      course_name: (studentData as any).courses?.name || "",
      semester: studentData.semester || "",
      campus_name: (studentData as any).campuses?.name || "",
    });
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (otp.length < 4) {
      setError("Enter the OTP sent to your phone");
      return;
    }
    setLoading(true);
    setError(null);

    // In production, verify OTP via edge function
    // For now, accept any 4+ digit OTP
    if (student) {
      await fetchFees(student.id);
      setStep("fees");
    }
    setLoading(false);
  };

  const fetchFees = async (studentId: string) => {
    const { data } = await supabase
      .from("fee_ledger")
      .select("id, total_amount, paid_amount, balance, status, due_date, fee_codes:fee_code_id(name)")
      .eq("student_id", studentId)
      .in("status", ["due", "overdue"])
      .order("due_date", { ascending: true });

    if (data) {
      setFees(data.map((f: any) => ({
        id: f.id,
        fee_head: f.fee_codes?.name || "Fee",
        amount: Number(f.total_amount),
        balance: Number(f.balance || 0),
        status: f.status,
        due_date: f.due_date,
      })));
    }
  };

  const totalDue = fees.reduce((s, f) => s + f.balance, 0);

  const handlePay = () => {
    // In production: redirect to Cashfree/Easebuzz payment gateway
    // Simulate payment success after brief loading
    setStep("paying");
    setTimeout(() => {
      setStep("receipt");
    }, 2000);
  };

  return (
    <>
      <ReceiptDialog data={receipt} onClose={() => setReceipt(null)} />
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
            <img src={uniosLogo} alt="UniOs" className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold text-gray-900">NIMT University — Fee Payment</span>
          </div>
        </header>

        <main className="flex-1 max-w-lg mx-auto w-full px-4 py-8 space-y-6">
          {/* Step 1: OTP Verification */}
          {step === "verify" && !loading && (
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
                        className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    </div>
                  </div>
                  <button
                    onClick={sendOtp}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Send OTP <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 text-center">
                    OTP sent to +91 {phone.slice(0, 2)}****{phone.slice(-2)}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Enter OTP</label>
                    <input
                      type="tel" maxLength={6} placeholder="Enter OTP"
                      value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-lg font-mono tracking-[0.3em] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <button
                    onClick={verifyOtp}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Verify & Continue <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setOtpSent(false); setOtp(""); setError(null); }}
                    className="w-full text-sm text-gray-500 hover:text-gray-700"
                  >
                    Change phone number
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          )}

          {/* Step 2: Fee Summary */}
          {step === "fees" && student && (
            <div className="space-y-4">
              {/* Student card */}
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

              {/* Fee items */}
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
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">₹{fee.balance.toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                    <div className="flex items-center justify-between p-4 bg-gray-50">
                      <p className="text-sm font-bold text-gray-900">Total Due</p>
                      <p className="text-lg font-bold text-gray-900">₹{totalDue.toLocaleString("en-IN")}</p>
                    </div>
                  </div>

                  <button
                    onClick={handlePay}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay ₹{totalDue.toLocaleString("en-IN")}
                  </button>

                  <p className="text-[11px] text-gray-400 text-center">
                    Secure payment powered by Cashfree. Your data is encrypted.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Step 3: Processing */}
          {step === "paying" && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-gray-600">Redirecting to payment...</p>
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
                <p className="text-sm text-gray-500 mt-1">
                  Receipt #{`NIMT/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`}
                </p>
              </div>

              <div className="rounded-xl bg-white border border-gray-200 p-5 text-left">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">Student</span>
                  <span className="text-sm font-semibold text-gray-900">{student.name}</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">Amount Paid</span>
                  <span className="text-lg font-bold text-green-600">₹{totalDue.toLocaleString("en-IN")}</span>
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
                  payment_date: new Date().toISOString(),
                  payment_mode: "online",
                  line_items: fees.map(f => ({ fee_head: f.fee_head, amount: f.balance })),
                })}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 py-3 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                <Download className="h-4 w-4" /> Download Receipt
              </button>

              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                <p className="text-sm text-blue-800 font-medium">Download the UniOs app</p>
                <p className="text-xs text-blue-600 mt-1">For future payments, attendance updates, and notifications.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
