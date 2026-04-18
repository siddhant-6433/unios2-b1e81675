import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Phone, Upload, FileText, CheckCircle, Shield, Building2, GraduationCap, Mail, X, Users,
  ScrollText, Award, BookOpen,
} from "lucide-react";

const COURSES = [
  "PGDM", "MBA", "BBA", "B.Tech", "M.Tech", "B.Sc Nursing", "GNM", "ANM",
  "BPT", "B.Pharm", "M.Pharm", "D.Pharm", "B.Ed", "BCA", "MCA",
  "BA LLB", "BBA LLB", "LLB", "LLM", "B.Sc", "M.Sc", "Other",
];

const CAMPUSES = [
  "Greater Noida Campus",
  "Jaipur Campus",
  "Kotputli Jaipur Campus",
];

const POPULAR_COMPANIES = [
  "Tata Consultancy Services", "Infosys", "Wipro", "HCL Technologies", "Tech Mahindra",
  "Cognizant", "Accenture", "Capgemini", "IBM India", "Deloitte",
  "EY (Ernst & Young)", "KPMG", "PwC", "McKinsey", "BCG",
  "Amazon", "Google", "Microsoft", "Flipkart", "Reliance Industries",
  "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra",
  "Bajaj Finserv", "L&T", "Mahindra & Mahindra", "Adani Group", "Bharti Airtel",
];

type RequestType = "verification" | "marksheet" | "diploma" | "transcript";

const SERVICE_TYPES: { key: RequestType; label: string; icon: any; desc: string; fee: number }[] = [
  { key: "verification", label: "Alumni Verification", icon: Shield, desc: "For employers / background check agencies to verify alumni records", fee: 1500 },
  { key: "marksheet", label: "Marksheet Request", icon: ScrollText, desc: "Request original or duplicate marksheets", fee: 2500 },
  { key: "diploma", label: "Degree / Diploma Request", icon: Award, desc: "Request original or duplicate degree certificate", fee: 2500 },
  { key: "transcript", label: "Transcript Request", icon: BookOpen, desc: "Request official academic transcript", fee: 2500 },
];

// ---- Phone Input ----
function PhoneInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex rounded-xl border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/20">
      <div className="flex items-center gap-1.5 px-3 bg-muted/50 border-r border-input shrink-0">
        <span className="text-base">🇮🇳</span>
        <span className="text-sm font-medium text-muted-foreground">+91</span>
      </div>
      <input type="tel" value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        placeholder={placeholder || "98765 43210"} maxLength={10}
        className="flex-1 px-3 py-3 text-sm bg-transparent focus:outline-none" />
      {value.length > 0 && (
        <span className={`flex items-center px-3 text-[10px] font-medium ${value.length === 10 ? "text-emerald-600" : "text-muted-foreground"}`}>
          {value.length}/10
        </span>
      )}
    </div>
  );
}

// ---- OTP Login ----
function OtpLogin({ onVerified }: { onVerified: (phone: string) => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (phone.length !== 10) { toast({ title: "Enter a valid 10-digit phone number", variant: "destructive" }); return; }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-otp", { body: { phone: `+91${phone}`, action: "send" } });
    setLoading(false);
    if (error || data?.error) { toast({ title: "Failed to send OTP", description: data?.error || error?.message, variant: "destructive" }); }
    else { setOtpSent(true); toast({ title: "OTP sent via WhatsApp" }); }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-otp", { body: { phone: `+91${phone}`, otp, action: "verify" } });
    setLoading(false);
    if (error || data?.error || !data?.verified) { toast({ title: "Invalid OTP", variant: "destructive" }); }
    else { onVerified(`+91${phone}`); }
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-3">
          <Shield className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Alumni Services Portal</h2>
        <p className="text-sm text-muted-foreground mt-1">Verify your identity with WhatsApp OTP to proceed</p>
      </div>
      {!otpSent ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Your WhatsApp Number</label>
          <PhoneInput value={phone} onChange={setPhone} />
          <Button className="w-full gap-2" onClick={handleSendOtp} disabled={loading || phone.length !== 10}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Send OTP via WhatsApp
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Enter OTP sent to +91 {phone}</label>
          <input type="text" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Enter 6-digit OTP" maxLength={6}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-lg tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <Button className="w-full gap-2" onClick={handleVerifyOtp} disabled={loading || otp.length < 4}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Verify OTP
          </Button>
          <button onClick={() => { setOtpSent(false); setOtp(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground">Change number</button>
        </div>
      )}
    </div>
  );
}

// ---- File Upload ----
function FileUploadField({ label, file, onChange, multiple, files, onFilesChange }: {
  label: string; file?: File | null; onChange?: (f: File | null) => void;
  multiple?: boolean; files?: File[]; onFilesChange?: (f: File[]) => void;
}) {
  if (multiple) {
    return (
      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">{label}</label>
        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{(files?.length || 0) > 0 ? `${files!.length} file(s) selected` : "Upload files (PDF/image)"}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden" onChange={e => onFilesChange?.(Array.from(e.target.files || []))} />
        </label>
        {(files?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files!.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px]">
                {f.name}
                <button onClick={() => onFilesChange?.(files!.filter((_, j) => j !== i))}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="text-xs font-medium text-foreground mb-1 block">{label}</label>
      <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
        <Upload className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{file ? file.name : "Upload file (PDF/image)"}</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => onChange?.(e.target.files?.[0] || null)} />
        {file && <button onClick={e => { e.preventDefault(); onChange?.(null); }} className="ml-auto"><X className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button>}
      </label>
    </div>
  );
}

// ---- Main Page ----
export default function AlumniVerification() {
  const { toast } = useToast();
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [step, setStep] = useState<"otp" | "dashboard" | "select" | "form" | "payment" | "done">("otp");
  const [existingRequests, setExistingRequests] = useState<any[]>([]);
  const [requestType, setRequestType] = useState<RequestType>("verification");
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState("");

  // Common fields
  const [alumniName, setAlumniName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [course, setCourse] = useState("");
  const [yearOfPassing, setYearOfPassing] = useState("");
  const [campus, setCampus] = useState("");
  const [enrollmentNo, setEnrollmentNo] = useState("");
  const [copyType, setCopyType] = useState<"original" | "duplicate">("original");

  // Verification-specific
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [thirdPartyCompany, setThirdPartyCompany] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [employerSearch, setEmployerSearch] = useState("");
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);

  // Documents
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [marksheetFiles, setMarksheetFiles] = useState<File[]>([]);
  const [firFile, setFirFile] = useState<File | null>(null);
  const [originalDocFile, setOriginalDocFile] = useState<File | null>(null);

  const fetchExistingRequests = async (phone: string) => {
    const { data } = await supabase
      .from("alumni_verification_requests" as any)
      .select("*")
      .eq("requestor_phone", phone)
      .order("created_at", { ascending: false });
    setExistingRequests(data || []);
  };

  const companyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (companyRef.current && !companyRef.current.contains(e.target as Node)) setShowCompanyDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredCompanies = POPULAR_COMPANIES.filter(c => c.toLowerCase().includes(employerSearch.toLowerCase())).slice(0, 8);
  const inputCls = "w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";
  const currentService = SERVICE_TYPES.find(s => s.key === requestType)!;

  const validate = () => {
    if (!alumniName || !contactEmail || !course || !yearOfPassing) {
      toast({ title: "Please fill all required fields", variant: "destructive" }); return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      toast({ title: "Enter a valid email address", variant: "destructive" }); return false;
    }
    if (requestType === "verification" && (!contactName || !contactPhone || !employerName)) {
      toast({ title: "Please fill employer and contact details", variant: "destructive" }); return false;
    }
    if ((requestType === "marksheet" || requestType === "diploma") && !enrollmentNo) {
      toast({ title: "Enrollment number is required", variant: "destructive" }); return false;
    }
    if ((requestType === "marksheet" || requestType === "diploma") && !campus) {
      toast({ title: "Campus is required", variant: "destructive" }); return false;
    }
    if (requestType === "diploma" && marksheetFiles.length === 0) {
      toast({ title: "Please upload marksheet copies for diploma request", variant: "destructive" }); return false;
    }
    if (requestType === "diploma" && copyType === "duplicate" && !firFile) {
      toast({ title: "Please upload FIR copy for duplicate diploma request", variant: "destructive" }); return false;
    }
    if (requestType === "marksheet" && copyType === "duplicate" && !firFile) {
      toast({ title: "Please upload FIR copy for duplicate marksheet request", variant: "destructive" }); return false;
    }
    if (requestType === "transcript" && marksheetFiles.length === 0) {
      toast({ title: "Please upload marksheet copies for transcript request", variant: "destructive" }); return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);

    const { data: req, error } = await supabase
      .from("alumni_verification_requests" as any)
      .insert({
        request_type: requestType,
        requestor_phone: verifiedPhone,
        contact_name: requestType === "verification" ? contactName : alumniName,
        contact_phone_spoc: requestType === "verification" ? `+91${contactPhone}` : verifiedPhone,
        contact_email: contactEmail,
        employer_name: requestType === "verification" ? employerName : "Self",
        third_party_company: thirdPartyCompany || null,
        alumni_name: alumniName,
        course, campus: campus || null,
        year_of_passing: parseInt(yearOfPassing),
        enrollment_no: enrollmentNo || null,
        copy_type: requestType !== "verification" ? copyType : null,
        fee_amount: currentService.fee,
        status: "pending_payment",
      })
      .select("id, request_number")
      .single();

    if (error || !req) {
      toast({ title: "Submission failed", description: error?.message, variant: "destructive" });
      setSubmitting(false); return;
    }

    const id = (req as any).id;
    setRequestId(id);
    setRequestNumber((req as any).request_number);

    // Upload documents
    const additionalPaths: string[] = [];

    if (diplomaFile) {
      const ext = diplomaFile.name.split(".").pop();
      await supabase.storage.from("alumni-verification-docs").upload(`${id}/diploma.${ext}`, diplomaFile, { upsert: true });
      await supabase.from("alumni_verification_requests" as any).update({ diploma_certificate_url: `${id}/diploma.${ext}` }).eq("id", id);
    }
    if (marksheetFiles.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < marksheetFiles.length; i++) {
        const ext = marksheetFiles[i].name.split(".").pop();
        const path = `${id}/marksheet-${i + 1}.${ext}`;
        await supabase.storage.from("alumni-verification-docs").upload(path, marksheetFiles[i], { upsert: true });
        paths.push(path);
      }
      await supabase.from("alumni_verification_requests" as any).update({ marksheet_urls: paths }).eq("id", id);
    }
    if (firFile) {
      const ext = firFile.name.split(".").pop();
      const path = `${id}/fir-report.${ext}`;
      await supabase.storage.from("alumni-verification-docs").upload(path, firFile, { upsert: true });
      additionalPaths.push(path);
    }
    if (originalDocFile) {
      const ext = originalDocFile.name.split(".").pop();
      const path = `${id}/original-doc-copy.${ext}`;
      await supabase.storage.from("alumni-verification-docs").upload(path, originalDocFile, { upsert: true });
      additionalPaths.push(path);
    }
    if (additionalPaths.length > 0) {
      await supabase.from("alumni_verification_requests" as any).update({ additional_doc_urls: additionalPaths }).eq("id", id);
    }

    setSubmitting(false);
    setStep("payment");
  };

  const [paymentLoading, setPaymentLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handlePayNow = async () => {
    if (!requestId) return;
    setPaymentLoading(true);

    const { data, error } = await supabase.functions.invoke("alumni-payment", {
      body: {
        action: "initiate",
        request_id: requestId,
        amount: currentService.fee,
        firstname: requestType === "verification" ? contactName : alumniName,
        email: contactEmail,
        phone: verifiedPhone,
        productinfo: `${currentService.label} - ${requestNumber}`,
      },
    });

    if (error || data?.error || !data?.pay_url) {
      toast({ title: "Payment initiation failed", description: data?.error || error?.message, variant: "destructive" });
      setPaymentLoading(false);
      return;
    }

    // Open EaseBuzz payment page in popup
    const popup = window.open(data.pay_url, "alumni_payment", "width=600,height=700,scrollbars=yes");

    // Listen for postMessage from return page
    const msgHandler = (e: MessageEvent) => {
      if (e.data?.alumni_payment === "success") {
        window.removeEventListener("message", msgHandler);
        if (pollRef.current) clearInterval(pollRef.current);
        setPaymentLoading(false);
        if (verifiedPhone) fetchExistingRequests(verifiedPhone);
        setStep("dashboard");
        toast({ title: "Payment successful!", description: `Request ${requestNumber} is now under review.` });
      }
    };
    window.addEventListener("message", msgHandler);

    // Poll DB every 3 seconds as fallback
    pollRef.current = setInterval(async () => {
      const { data: req } = await supabase
        .from("alumni_verification_requests" as any)
        .select("status, payment_ref")
        .eq("id", requestId)
        .single();

      if (req && (req as any).status === "paid") {
        if (pollRef.current) clearInterval(pollRef.current);
        window.removeEventListener("message", msgHandler);
        setPaymentLoading(false);
        if (verifiedPhone) fetchExistingRequests(verifiedPhone);
        setStep("dashboard");
        toast({ title: "Payment successful!", description: `Request ${requestNumber} is now under review.` });
      }
    }, 3000);

    setPaymentLoading(false);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-gray-950 dark:to-gray-900">
      <header className="border-b border-border/40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="https://pub-811305689b9049e6b317d47a98f724ae.r2.dev/web/images/nimt-beacon-logo.png" alt="NIMT" className="h-10" />
          <div>
            <h1 className="text-lg font-bold text-foreground">NIMT Educational Institutions</h1>
            <p className="text-xs text-muted-foreground">Alumni Services Portal</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(step === "dashboard" ? [] : ["Verify Identity", "Select Service", "Details", "Payment"]).map((label, i) => {
            const stepIdx = ["otp", "select", "form", "payment"].indexOf(step);
            const isActive = i === stepIdx;
            const isDone = i < stepIdx;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className={`h-px w-6 sm:w-8 ${isDone ? "bg-primary" : "bg-border"}`} />}
                <div className="flex flex-col items-center gap-1">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                    isDone ? "bg-primary text-primary-foreground" : isActive ? "bg-primary/10 text-primary border-2 border-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {isDone ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={`text-[9px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"} hidden sm:block`}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 sm:p-8">
            {/* Step 1: OTP */}
            {step === "otp" && <OtpLogin onVerified={async (phone) => { setVerifiedPhone(phone); await fetchExistingRequests(phone); setStep("dashboard"); }} />}

            {/* Step 2: Service Selection */}
            {/* Dashboard — shows existing requests + new request button */}
            {step === "dashboard" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Alumni Services Dashboard</h2>
                    <p className="text-xs text-muted-foreground">Welcome! Your verified phone: {verifiedPhone}</p>
                  </div>
                  <Button size="sm" className="gap-1.5" onClick={() => setStep("select")}>
                    + New Request
                  </Button>
                </div>

                {existingRequests.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
                    <Shield className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No requests yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Submit your first alumni service request</p>
                    <Button size="sm" className="mt-4 gap-1.5" onClick={() => setStep("select")}>
                      + Submit New Request
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {existingRequests.map((req: any) => {
                      const svc = SERVICE_TYPES.find(s => s.key === (req.request_type || "verification"));
                      const statusCfg: Record<string, { label: string; color: string }> = {
                        pending_payment: { label: "Pending Payment", color: "bg-gray-100 text-gray-700" },
                        paid: { label: "Under Review", color: "bg-blue-100 text-blue-700" },
                        under_review: { label: "Under Review", color: "bg-amber-100 text-amber-700" },
                        verified: { label: "Verified", color: "bg-emerald-100 text-emerald-700" },
                        rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
                      };
                      const st = statusCfg[req.status] || statusCfg.pending_payment;
                      const SvcIcon = svc?.icon || Shield;
                      return (
                        <div key={req.id} className="rounded-xl border border-border p-4 hover:border-primary/30 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                              <SvcIcon className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-sm text-primary">{req.request_number}</span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}>{st.label}</span>
                              </div>
                              <p className="text-sm font-medium text-foreground mt-0.5">{req.alumni_name} — {req.course} ({req.year_of_passing})</p>
                              <p className="text-xs text-muted-foreground">{svc?.label || "Verification"} · {req.employer_name !== "Self" ? req.employer_name : ""}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Submitted {new Date(req.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                                {req.paid_at && ` · Paid ${new Date(req.paid_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                                {req.payment_ref && ` · Ref: ${req.payment_ref}`}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-bold text-foreground">&#8377;{req.fee_amount}</p>
                              {req.status === "pending_payment" && (
                                <Button size="sm" variant="outline" className="mt-1 text-[10px] h-7" onClick={() => {
                                  setRequestId(req.id);
                                  setRequestNumber(req.request_number);
                                  setRequestType(req.request_type || "verification");
                                  setAlumniName(req.alumni_name);
                                  setContactEmail(req.contact_email || "");
                                  setCourse(req.course);
                                  setYearOfPassing(String(req.year_of_passing));
                                  setContactName(req.contact_name);
                                  setEmployerName(req.employer_name);
                                  setStep("payment");
                                }}>
                                  Pay Now
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground text-sm">Need Help?</p>
                  <p>Email: <a href="mailto:registrar@nimt.ac.in" className="text-primary hover:underline">registrar@nimt.ac.in</a></p>
                  <p>Phone: <a href="tel:+911204167822" className="text-primary hover:underline">+91-120-4167822</a></p>
                  <p>Office: NIMT Educational Institutions, Knowledge Park-1, Greater Noida, UP - 201310</p>
                </div>
              </div>
            )}

            {step === "select" && (
              <div className="space-y-5">
                <div className="text-center mb-2">
                  <h2 className="text-lg font-bold text-foreground">Select Service</h2>
                  <p className="text-xs text-muted-foreground">Choose the type of request you'd like to submit</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SERVICE_TYPES.map(s => (
                    <button
                      key={s.key}
                      onClick={() => { setRequestType(s.key); setStep("form"); }}
                      className={`rounded-xl border-2 p-4 text-left hover:border-primary/40 transition-all ${
                        requestType === s.key ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                          <s.icon className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <span className="font-semibold text-sm text-foreground">{s.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">{s.desc}</p>
                      <p className="text-xs font-bold text-primary mt-2">&#8377; {s.fee}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Form */}
            {step === "form" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{currentService.label}</h2>
                    <p className="text-xs text-muted-foreground">{currentService.desc}</p>
                  </div>
                  <button onClick={() => setStep("select")} className="text-xs text-primary hover:underline">Change</button>
                </div>

                {/* Verification: Third-party + Employer sections */}
                {requestType === "verification" && (
                  <>
                    <div className="space-y-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" /> Third-Party / Verification Agency
                      </p>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Company / Agency Name</label>
                        <input value={thirdPartyCompany} onChange={e => setThirdPartyCompany(e.target.value)}
                          placeholder="e.g. AuthBridge, HireRight (leave blank if direct employer)" className={inputCls} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1 block">SPOC Name *</label>
                          <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Contact person" className={inputCls} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-foreground mb-1 block">SPOC Phone *</label>
                          <PhoneInput value={contactPhone} onChange={setContactPhone} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" /> Employer (For Whom Verification is Sought)
                      </p>
                      <div ref={companyRef} className="relative">
                        <label className="text-xs font-medium text-foreground mb-1 block">Employer / University Name *</label>
                        <input
                          value={employerName || employerSearch}
                          onChange={e => { setEmployerSearch(e.target.value); setEmployerName(""); setShowCompanyDropdown(true); }}
                          onFocus={() => { if (!employerName) setShowCompanyDropdown(true); }}
                          placeholder="Search company or type custom name" className={inputCls} />
                        {showCompanyDropdown && (employerSearch || !employerName) && (
                          <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
                            {filteredCompanies.map(c => (
                              <button key={c} className="w-full text-left px-4 py-2 text-sm hover:bg-muted/50"
                                onClick={() => { setEmployerName(c); setEmployerSearch(""); setShowCompanyDropdown(false); }}>{c}</button>
                            ))}
                            {employerSearch.length > 2 && !filteredCompanies.includes(employerSearch) && (
                              <button className="w-full text-left px-4 py-2 text-sm border-t border-border text-primary hover:bg-muted/50"
                                onClick={() => { setEmployerName(employerSearch); setEmployerSearch(""); setShowCompanyDropdown(false); }}>
                                + Use "{employerSearch}"
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Email (all types) */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block flex items-center gap-1">
                    <Mail className="h-3 w-3" /> Email Address *
                    <span className="text-[10px] text-muted-foreground font-normal">(result will be sent here)</span>
                  </label>
                  <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                    placeholder="email@company.com" className={inputCls} />
                </div>

                {/* Copy type for marksheet/diploma */}
                {(requestType === "marksheet" || requestType === "diploma") && (
                  <div>
                    <label className="text-xs font-medium text-foreground mb-2 block">Request Type *</label>
                    <div className="flex gap-3">
                      {(["original", "duplicate"] as const).map(t => (
                        <button key={t} onClick={() => setCopyType(t)}
                          className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium capitalize transition-all ${
                            copyType === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/30"
                          }`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Alumni Info (all types) */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <GraduationCap className="h-3.5 w-3.5" /> Alumni Information
                  </p>
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Full Name (as on certificate) *</label>
                    <input value={alumniName} onChange={e => setAlumniName(e.target.value)} placeholder="Full name" className={inputCls} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Course / Programme *</label>
                      <select value={course} onChange={e => setCourse(e.target.value)} className={inputCls}>
                        <option value="">Select course</option>
                        {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Year of Passing *</label>
                      <input type="number" value={yearOfPassing} onChange={e => setYearOfPassing(e.target.value)}
                        placeholder="2020" min="1990" max="2030" className={inputCls} />
                    </div>
                  </div>

                  {/* Enrollment + Campus (for marksheet, diploma, transcript) */}
                  {requestType !== "verification" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Enrollment Number {requestType !== "transcript" ? "*" : ""}</label>
                        <input value={enrollmentNo} onChange={e => setEnrollmentNo(e.target.value)} placeholder="e.g. NIMT/2020/001" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Campus {requestType !== "transcript" ? "*" : ""}</label>
                        <select value={campus} onChange={e => setCampus(e.target.value)} className={inputCls}>
                          <option value="">Select campus</option>
                          {CAMPUSES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Documents */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Documents
                  </p>

                  {/* Verification: optional diploma + marksheets */}
                  {requestType === "verification" && (
                    <>
                      <FileUploadField label="Diploma / Degree Certificate (if available)" file={diplomaFile} onChange={setDiplomaFile} />
                      <FileUploadField label="Marksheets (if available)" multiple files={marksheetFiles} onFilesChange={setMarksheetFiles} />
                    </>
                  )}

                  {/* Marksheet request */}
                  {requestType === "marksheet" && copyType === "original" && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">No documents required for original marksheet request. Your enrollment details will be verified from our records.</p>
                  )}
                  {requestType === "marksheet" && copyType === "duplicate" && (
                    <>
                      <FileUploadField label="FIR / Police Report (for lost marksheet) *" file={firFile} onChange={setFirFile} />
                      <FileUploadField label="Scan of Original Marksheet (if available)" file={originalDocFile} onChange={setOriginalDocFile} />
                    </>
                  )}

                  {/* Diploma request */}
                  {requestType === "diploma" && (
                    <>
                      <FileUploadField label="Marksheets (scan/copy) *" multiple files={marksheetFiles} onFilesChange={setMarksheetFiles} />
                      {copyType === "duplicate" && (
                        <>
                          <FileUploadField label="FIR / Police Report (for lost diploma) *" file={firFile} onChange={setFirFile} />
                          <FileUploadField label="Scan of Original Diploma (if available)" file={originalDocFile} onChange={setOriginalDocFile} />
                        </>
                      )}
                    </>
                  )}

                  {/* Transcript */}
                  {requestType === "transcript" && (
                    <>
                      <FileUploadField label="Marksheets (scan/copy) *" multiple files={marksheetFiles} onFilesChange={setMarksheetFiles} />
                      <FileUploadField label="Diploma / Degree Certificate (if available)" file={diplomaFile} onChange={setDiplomaFile} />
                    </>
                  )}
                </div>

                <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Submit & Proceed to Payment (&#8377; {currentService.fee})
                </Button>
              </div>
            )}

            {/* Step 4: Payment */}
            {step === "payment" && (
              <div className="space-y-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 mx-auto">
                  <currentService.icon className="h-7 w-7 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Payment Required</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Request <span className="font-mono font-bold text-foreground">{requestNumber}</span> submitted.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-2xl font-bold text-foreground">&#8377; {currentService.fee.toLocaleString("en-IN")}</p>
                  <p className="text-xs text-muted-foreground">{currentService.label} Fee (inclusive of GST)</p>
                </div>

                <div className="space-y-3">
                  <Button className="w-full gap-2 py-3 text-sm" onClick={handlePayNow} disabled={paymentLoading}>
                    {paymentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    Pay &#8377; {currentService.fee.toLocaleString("en-IN")} via Secure Gateway
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Powered by EaseBuzz. Supports UPI, Credit/Debit Cards, Net Banking, Wallets.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-3 text-left space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Request Summary</p>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Service</span><span className="font-medium">{currentService.label}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Alumni</span><span className="font-medium">{alumniName}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Course</span><span className="font-medium">{course} ({yearOfPassing})</span></div>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Receipt to</span><span className="font-medium">{contactEmail}</span></div>
                </div>
              </div>
            )}

            {/* Back to Dashboard link on sub-steps */}
            {["select", "form"].includes(step) && verifiedPhone && (
              <div className="mt-4 text-center">
                <button onClick={async () => { await fetchExistingRequests(verifiedPhone); setStep("dashboard"); }}
                  className="text-xs text-muted-foreground hover:text-primary">
                  Back to Dashboard
                </button>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-[10px] text-muted-foreground mt-6">NIMT Educational Institutions · Alumni Services Portal · registrar@nimt.ac.in</p>
      </main>
    </div>
  );
}
