import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Phone, Upload, FileText, CheckCircle, Shield, Building2, GraduationCap, User, X,
} from "lucide-react";

const COURSES = [
  "PGDM", "MBA", "BBA", "B.Tech", "M.Tech", "B.Sc Nursing", "GNM", "ANM",
  "BPT", "B.Pharm", "M.Pharm", "D.Pharm", "B.Ed", "BCA", "MCA",
  "BA LLB", "BBA LLB", "LLB", "LLM", "B.Sc", "M.Sc", "Other",
];

const POPULAR_COMPANIES = [
  "Tata Consultancy Services", "Infosys", "Wipro", "HCL Technologies", "Tech Mahindra",
  "Cognizant", "Accenture", "Capgemini", "IBM India", "Deloitte",
  "EY (Ernst & Young)", "KPMG", "PwC", "McKinsey", "BCG",
  "Amazon", "Google", "Microsoft", "Flipkart", "Reliance Industries",
  "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra",
  "Bajaj Finserv", "L&T", "Mahindra & Mahindra", "Adani Group", "Bharti Airtel",
  "BYJU'S", "Zomato", "Swiggy", "Paytm", "PhonePe",
];

// ---- OTP Login Component ----
function OtpLogin({ onVerified }: { onVerified: (phone: string) => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      toast({ title: "Enter valid phone number", variant: "destructive" });
      return;
    }
    setLoading(true);
    const digits = phone.replace(/\D/g, "");
    const formatted = digits.length === 10 ? `+91${digits}` : digits.startsWith("91") ? `+${digits}` : phone;

    const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
      body: { phone: formatted, action: "send" },
    });
    setLoading(false);
    if (error || data?.error) {
      toast({ title: "Failed to send OTP", description: data?.error || error?.message, variant: "destructive" });
    } else {
      setOtpSent(true);
      setPhone(formatted);
      toast({ title: "OTP sent via WhatsApp" });
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
      body: { phone, otp, action: "verify" },
    });
    setLoading(false);
    if (error || data?.error || !data?.verified) {
      toast({ title: "Invalid OTP", description: "Please check and try again", variant: "destructive" });
    } else {
      onVerified(phone);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-3">
          <Shield className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Alumni Verification Request</h2>
        <p className="text-sm text-muted-foreground mt-1">Verify your identity with WhatsApp OTP to proceed</p>
      </div>
      {!otpSent ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Your WhatsApp Number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <Button className="w-full gap-2" onClick={handleSendOtp} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Send OTP via WhatsApp
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">Enter OTP sent to {phone}</label>
          <input
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Enter 6-digit OTP"
            maxLength={6}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-center text-lg tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <Button className="w-full gap-2" onClick={handleVerifyOtp} disabled={loading || otp.length < 4}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Verify OTP
          </Button>
          <button onClick={() => { setOtpSent(false); setOtp(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground">
            Change number
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----
export default function AlumniVerification() {
  const { toast } = useToast();
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [step, setStep] = useState<"otp" | "form" | "payment" | "done">("otp");
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState<string>("");

  // Form state
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [employerSearch, setEmployerSearch] = useState("");
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [alumniName, setAlumniName] = useState("");
  const [course, setCourse] = useState("");
  const [yearOfPassing, setYearOfPassing] = useState("");
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [marksheetFiles, setMarksheetFiles] = useState<File[]>([]);

  const companyRef = useRef<HTMLDivElement>(null);

  // Close company dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredCompanies = POPULAR_COMPANIES.filter(c =>
    c.toLowerCase().includes(employerSearch.toLowerCase())
  ).slice(0, 8);

  const inputCls = "w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

  const handleSubmit = async () => {
    if (!verifiedPhone || !contactName || !contactPhone || !employerName || !alumniName || !course || !yearOfPassing) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    // 1. Create the verification request
    const { data: req, error } = await supabase
      .from("alumni_verification_requests" as any)
      .insert({
        requestor_phone: verifiedPhone,
        contact_name: contactName,
        contact_phone_spoc: contactPhone,
        employer_name: employerName,
        alumni_name: alumniName,
        course,
        year_of_passing: parseInt(yearOfPassing),
        status: "pending_payment",
      })
      .select("id, request_number")
      .single();

    if (error || !req) {
      toast({ title: "Submission failed", description: error?.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const id = (req as any).id;
    setRequestId(id);
    setRequestNumber((req as any).request_number);

    // 2. Upload documents
    if (diplomaFile) {
      const ext = diplomaFile.name.split(".").pop();
      await supabase.storage
        .from("alumni-verification-docs")
        .upload(`${id}/diploma-certificate.${ext}`, diplomaFile, { upsert: true });

      const { data: urlData } = supabase.storage
        .from("alumni-verification-docs")
        .getPublicUrl(`${id}/diploma-certificate.${ext}`);

      await supabase
        .from("alumni_verification_requests" as any)
        .update({ diploma_certificate_url: `${id}/diploma-certificate.${ext}` })
        .eq("id", id);
    }

    if (marksheetFiles.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < marksheetFiles.length; i++) {
        const f = marksheetFiles[i];
        const ext = f.name.split(".").pop();
        const path = `${id}/marksheet-${i + 1}.${ext}`;
        await supabase.storage
          .from("alumni-verification-docs")
          .upload(path, f, { upsert: true });
        paths.push(path);
      }
      await supabase
        .from("alumni_verification_requests" as any)
        .update({ marksheet_urls: paths })
        .eq("id", id);
    }

    setSubmitting(false);
    setStep("payment");
  };

  const handlePaymentDone = async () => {
    if (!requestId) return;
    // Mark as paid (in production, this would be verified via webhook)
    await supabase
      .from("alumni_verification_requests" as any)
      .update({
        status: "paid",
        payment_method: "razorpay_link",
        paid_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    setStep("done");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-gray-950 dark:to-gray-900">
      {/* Header */}
      <header className="border-b border-border/40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="https://pub-811305689b9049e6b317d47a98f724ae.r2.dev/web/images/nimt-beacon-logo.png" alt="NIMT" className="h-10" />
          <div>
            <h1 className="text-lg font-bold text-foreground">NIMT Educational Institutions</h1>
            <p className="text-xs text-muted-foreground">Alumni Verification Service</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {["Verify Identity", "Submit Details", "Payment", "Confirmation"].map((label, i) => {
            const stepIdx = ["otp", "form", "payment", "done"].indexOf(step);
            const isActive = i === stepIdx;
            const isDone = i < stepIdx;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className={`h-px w-8 ${isDone ? "bg-primary" : "bg-border"}`} />}
                <div className="flex flex-col items-center gap-1">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    isDone ? "bg-primary text-primary-foreground" : isActive ? "bg-primary/10 text-primary border-2 border-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {isDone ? <CheckCircle className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 sm:p-8">
            {/* Step 1: OTP */}
            {step === "otp" && (
              <OtpLogin onVerified={(phone) => { setVerifiedPhone(phone); setStep("form"); }} />
            )}

            {/* Step 2: Form */}
            {step === "form" && (
              <div className="space-y-6">
                <div className="text-center mb-4">
                  <h2 className="text-lg font-bold text-foreground">Verification Request Details</h2>
                  <p className="text-xs text-muted-foreground">Fill in the employer and alumni information</p>
                </div>

                {/* Requestor / Employer Info */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> Requestor Information
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Contact Name *</label>
                      <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="SPOC Name" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Contact Phone *</label>
                      <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+91 98765 43210" className={inputCls} />
                    </div>
                  </div>
                  <div ref={companyRef} className="relative">
                    <label className="text-xs font-medium text-foreground mb-1 block">Employer / Company Name *</label>
                    <input
                      value={employerName || employerSearch}
                      onChange={e => {
                        setEmployerSearch(e.target.value);
                        setEmployerName("");
                        setShowCompanyDropdown(true);
                      }}
                      onFocus={() => setShowCompanyDropdown(true)}
                      placeholder="Search company or type custom name"
                      className={inputCls}
                    />
                    {showCompanyDropdown && employerSearch && (
                      <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
                        {filteredCompanies.map(c => (
                          <button
                            key={c}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-muted/50 transition-colors"
                            onClick={() => { setEmployerName(c); setEmployerSearch(""); setShowCompanyDropdown(false); }}
                          >
                            {c}
                          </button>
                        ))}
                        {filteredCompanies.length === 0 && (
                          <button
                            className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-muted/50"
                            onClick={() => { setEmployerName(employerSearch); setShowCompanyDropdown(false); }}
                          >
                            Use "{employerSearch}"
                          </button>
                        )}
                        {filteredCompanies.length > 0 && !filteredCompanies.includes(employerSearch) && employerSearch.length > 2 && (
                          <button
                            className="w-full text-left px-4 py-2 text-sm border-t border-border text-primary hover:bg-muted/50"
                            onClick={() => { setEmployerName(employerSearch); setShowCompanyDropdown(false); }}
                          >
                            + Add "{employerSearch}"
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Alumni Info */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <GraduationCap className="h-3.5 w-3.5" /> Alumni Information
                  </p>
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Alumni Name (as on certificate) *</label>
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
                      <input
                        type="number"
                        value={yearOfPassing}
                        onChange={e => setYearOfPassing(e.target.value)}
                        placeholder="2020"
                        min="1990" max="2030"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>

                {/* Document Uploads */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Documents
                  </p>
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Diploma / Degree Certificate</label>
                    <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {diplomaFile ? diplomaFile.name : "Upload certificate (PDF/image)"}
                      </span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setDiplomaFile(e.target.files?.[0] || null)} />
                      {diplomaFile && (
                        <button onClick={(e) => { e.preventDefault(); setDiplomaFile(null); }} className="ml-auto">
                          <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </button>
                      )}
                    </label>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Marksheets</label>
                    <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {marksheetFiles.length > 0 ? `${marksheetFiles.length} file(s) selected` : "Upload marksheets (multiple allowed)"}
                      </span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden"
                        onChange={e => setMarksheetFiles(Array.from(e.target.files || []))} />
                    </label>
                    {marksheetFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {marksheetFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px]">
                            {f.name}
                            <button onClick={() => setMarksheetFiles(prev => prev.filter((_, j) => j !== i))}>
                              <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Submit & Proceed to Payment
                </Button>
              </div>
            )}

            {/* Step 3: Payment */}
            {step === "payment" && (
              <div className="space-y-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 mx-auto">
                  <Shield className="h-7 w-7 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Payment Required</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Request <span className="font-mono font-bold text-foreground">{requestNumber}</span> submitted successfully.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Please complete the verification fee payment to proceed.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-2xl font-bold text-foreground">&#8377; 500</p>
                  <p className="text-xs text-muted-foreground">Alumni Verification Fee (inclusive of GST)</p>
                </div>

                <a
                  href="https://pages.razorpay.com/pl_Qcbyq4u6RqZWtn/view"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Pay Now via Razorpay
                </a>

                <div className="pt-2">
                  <Button variant="outline" className="gap-2" onClick={handlePaymentDone}>
                    <CheckCircle className="h-4 w-4" />
                    I have completed the payment
                  </Button>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  After payment, click "I have completed the payment" to update your request status.
                </p>
              </div>
            )}

            {/* Step 4: Done */}
            {step === "done" && (
              <div className="space-y-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mx-auto">
                  <CheckCircle className="h-7 w-7 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Request Submitted Successfully</h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    Your alumni verification request <span className="font-mono font-bold text-foreground">{requestNumber}</span> has been received and payment confirmed.
                  </p>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40 p-4 text-left space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Request #</span>
                    <span className="font-mono font-bold">{requestNumber}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Alumni Name</span>
                    <span className="font-medium">{alumniName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Course</span>
                    <span className="font-medium">{course}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Year of Passing</span>
                    <span className="font-medium">{yearOfPassing}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-bold text-emerald-600">Paid — Under Review</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Our team will review the documents and verify the alumni records.
                  You will be notified via WhatsApp on <span className="font-medium">{verifiedPhone}</span> once verification is complete.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          NIMT Educational Institutions · Alumni Verification Service · For queries contact registrar@nimt.ac.in
        </p>
      </main>
    </div>
  );
}
