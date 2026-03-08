import { useState, useEffect } from "react";
import {
  GraduationCap, FileText, Upload, User, Phone, Mail, Calendar,
  CheckCircle, ArrowRight, ArrowLeft, Loader2, BookOpen, MapPin,
  CreditCard, LogOut, Shield
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// ─── Sub-stage progress type ───
interface AppProgress {
  personal_details: boolean;
  education_details: boolean;
  application_fee_paid: boolean;
  documents_uploaded: boolean;
}

const DEFAULT_PROGRESS: AppProgress = {
  personal_details: false,
  education_details: false,
  application_fee_paid: false,
  documents_uploaded: false,
};

const STEPS = [
  { key: "personal_details", label: "Personal Details", icon: User },
  { key: "education_details", label: "Education Details", icon: BookOpen },
  { key: "application_fee_paid", label: "Application Fee", icon: CreditCard },
  { key: "documents_uploaded", label: "Upload Documents", icon: Upload },
] as const;

// ─── OTP Login Screen ───
function OtpLogin({ onAuthenticated }: { onAuthenticated: (lead: any) => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [loginMode, setLoginMode] = useState<"phone" | "appid">("phone");

  const handleSendOtp = async () => {
    if (!phone || phone.length < 12) {
      toast({ title: "Enter a valid phone number", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
        body: { phone, action: "send" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOtpSent(true);
      toast({ title: "OTP sent via WhatsApp" });
    } catch (err: any) {
      toast({ title: "Failed to send OTP", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 4) {
      toast({ title: "Enter the OTP", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // Verify OTP
      const { data: verifyData, error: verifyErr } = await supabase.functions.invoke("whatsapp-otp", {
        body: { phone, otp, action: "verify" },
      });
      if (verifyErr) throw verifyErr;
      if (!verifyData?.verified) throw new Error("Invalid or expired OTP");

      // Find lead by phone
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("*")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (leadErr) throw leadErr;
      if (!lead) {
        toast({ title: "No application found", description: "Please submit an enquiry first.", variant: "destructive" });
        setLoading(false);
        return;
      }

      onAuthenticated(lead);
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAppIdLookup = async () => {
    if (!applicationId.trim()) {
      toast({ title: "Enter your Application ID", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data: lead, error } = await supabase
        .from("leads")
        .select("*")
        .eq("application_id", applicationId.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      if (!lead) {
        toast({ title: "Application not found", description: "Check your Application ID and try again.", variant: "destructive" });
        setLoading(false);
        return;
      }

      // Still need OTP verification for the lead's phone
      setPhone(lead.phone);
      setLoginMode("phone");
      toast({ title: "Found! Verify your phone to continue." });
    } catch (err: any) {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-md w-full border-border/60 shadow-none">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Application Portal</h2>
              <p className="text-xs text-muted-foreground">Login to continue your application</p>
            </div>
          </div>

          {loginMode === "phone" ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Phone Number (used during enquiry)
                </label>
                <PhoneInput value={phone} onChange={setPhone} required />
              </div>

              {otpSent && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Enter OTP sent via WhatsApp
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter 6-digit OTP"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground text-center tracking-[0.3em] font-mono placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              )}

              <Button
                className="w-full gap-2"
                disabled={loading}
                onClick={otpSent ? handleVerifyOtp : handleSendOtp}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {otpSent ? "Verify & Continue" : "Send OTP via WhatsApp"}
              </Button>

              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                onClick={() => setLoginMode("appid")}
              >
                Login with Application ID instead
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Application ID
                </label>
                <input
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                  placeholder="e.g. APP-26-1234"
                  className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground font-mono placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>

              <Button className="w-full gap-2" disabled={loading} onClick={handleAppIdLookup}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Find My Application
              </Button>

              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                onClick={() => setLoginMode("phone")}
              >
                Login with phone number instead
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Application Form ───
const ApplyPortal = () => {
  const { toast } = useToast();
  const [lead, setLead] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<AppProgress>(DEFAULT_PROGRESS);
  const [submitted, setSubmitted] = useState(false);

  // Form data
  const [personal, setPersonal] = useState({
    name: "", email: "", guardian_name: "", guardian_phone: "", dob: "", address: "",
  });
  const [education, setEducation] = useState({
    previous_school: "", previous_class: "", percentage: "", board: "", passing_year: "",
  });

  // Initialize form from lead data
  useEffect(() => {
    if (!lead) return;
    const prog = (lead.application_progress as AppProgress) || DEFAULT_PROGRESS;
    setProgress(prog);
    setPersonal({
      name: lead.name || "",
      email: lead.email || "",
      guardian_name: lead.guardian_name || "",
      guardian_phone: lead.guardian_phone || "",
      dob: "",
      address: "",
    });

    // Check if already submitted
    if (lead.stage === "application_submitted") {
      setSubmitted(true);
    }

    // Move to first incomplete step
    const steps = ["personal_details", "education_details", "application_fee_paid", "documents_uploaded"] as const;
    const firstIncomplete = steps.findIndex((s) => !prog[s]);
    setStep(firstIncomplete >= 0 ? firstIncomplete : 0);
  }, [lead]);

  const updateProgress = async (key: keyof AppProgress, value: boolean) => {
    const newProgress = { ...progress, [key]: value };
    setProgress(newProgress);

    // Determine new stage
    const allDone = Object.values(newProgress).every(Boolean);
    const newStage = allDone ? "application_submitted" : "application_in_progress";

    const { error } = await supabase
      .from("leads")
      .update({
        application_progress: newProgress as any,
        stage: newStage,
      })
      .eq("id", lead.id);

    if (error) {
      console.error("Progress save error:", error);
    }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: lead.id,
      type: "application_progress",
      description: `Application step completed: ${key.replace(/_/g, " ")}`,
      ...(allDone ? { new_stage: "application_submitted" as any, old_stage: lead.stage } : {}),
    });

    if (allDone) {
      setSubmitted(true);
    }
  };

  const savePersonalDetails = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("leads")
        .update({
          name: personal.name.trim(),
          email: personal.email.trim() || null,
          guardian_name: personal.guardian_name.trim() || null,
          guardian_phone: personal.guardian_phone || null,
          stage: "application_in_progress" as any,
        })
        .eq("id", lead.id);

      if (error) throw error;
      await updateProgress("personal_details", true);
      toast({ title: "Personal details saved" });
      setStep(1);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveEducationDetails = async () => {
    setSaving(true);
    try {
      // Store education details in notes (since we don't have dedicated columns)
      const eduNote = `Previous School: ${education.previous_school}\nClass: ${education.previous_class}\nBoard: ${education.board}\nPercentage: ${education.percentage}%\nPassing Year: ${education.passing_year}`;
      
      await supabase.from("lead_notes").insert({
        lead_id: lead.id,
        content: `[Education Details]\n${eduNote}`,
      });

      await updateProgress("education_details", true);
      toast({ title: "Education details saved" });
      setStep(2);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const markFeePaid = async () => {
    // This will be replaced with actual Stripe payment
    setSaving(true);
    try {
      await updateProgress("application_fee_paid", true);
      toast({ title: "Application fee recorded" });
      setStep(3);
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const markDocumentsUploaded = async () => {
    setSaving(true);
    try {
      await updateProgress("documents_uploaded", true);
      toast({ title: "Documents uploaded successfully" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Not logged in ──
  if (!lead) {
    return <OtpLogin onAuthenticated={setLead} />;
  }

  // ── Application submitted ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-border/60 shadow-none">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Application Submitted!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Your application has been received. Application ID:
            </p>
            <p className="text-lg font-mono font-bold text-primary mt-1">
              {lead.application_id || lead.id.slice(0, 8).toUpperCase()}
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Our admissions team will review your application and contact you shortly.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => { setLead(null); setSubmitted(false); }}>
              <LogOut className="h-4 w-4 mr-2" /> Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completedCount = Object.values(progress).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
              <span className="text-[11px] text-muted-foreground block">Application Portal</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/10 text-primary border-0 text-xs">
              {completedCount}/4 complete
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => { setLead(null); setSubmitted(false); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Welcome, {lead.name}</h1>
          <p className="text-sm text-muted-foreground">Complete all steps below to submit your application.</p>
        </div>

        {/* Step Progress */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => {
            const done = progress[s.key];
            const active = step === i;
            return (
              <button
                key={s.key}
                onClick={() => setStep(i)}
                className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  done
                    ? "bg-primary/10 text-primary"
                    : active
                    ? "bg-card border border-border text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {done ? (
                  <CheckCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <s.icon className="h-4 w-4 shrink-0" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Step 0: Personal Details ── */}
        {step === 0 && (
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <User className="h-5 w-5 text-muted-foreground" /> Personal Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Full Name *</label>
                  <input
                    required
                    value={personal.name}
                    onChange={(e) => setPersonal({ ...personal, name: e.target.value })}
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={personal.email}
                    onChange={(e) => setPersonal({ ...personal, email: e.target.value })}
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date of Birth</label>
                  <input
                    type="date"
                    value={personal.dob}
                    onChange={(e) => setPersonal({ ...personal, dob: e.target.value })}
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guardian Name</label>
                  <input
                    value={personal.guardian_name}
                    onChange={(e) => setPersonal({ ...personal, guardian_name: e.target.value })}
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guardian Phone</label>
                  <PhoneInput value={personal.guardian_phone} onChange={(v) => setPersonal({ ...personal, guardian_phone: v })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Address</label>
                <textarea
                  value={personal.address}
                  onChange={(e) => setPersonal({ ...personal, address: e.target.value })}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={savePersonalDetails} disabled={saving || !personal.name.trim()} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Save & Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 1: Education Details ── */}
        {step === 1 && (
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-muted-foreground" /> Education Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Previous School / College</label>
                  <input
                    value={education.previous_school}
                    onChange={(e) => setEducation({ ...education, previous_school: e.target.value })}
                    placeholder="Name of last institution"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Last Class / Degree</label>
                  <input
                    value={education.previous_class}
                    onChange={(e) => setEducation({ ...education, previous_class: e.target.value })}
                    placeholder="e.g. 12th, B.Sc"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Board / University</label>
                  <input
                    value={education.board}
                    onChange={(e) => setEducation({ ...education, board: e.target.value })}
                    placeholder="e.g. CBSE, AKTU"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Percentage / CGPA</label>
                  <input
                    value={education.percentage}
                    onChange={(e) => setEducation({ ...education, percentage: e.target.value })}
                    placeholder="e.g. 85 or 8.5"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Passing Year</label>
                  <input
                    value={education.passing_year}
                    onChange={(e) => setEducation({ ...education, passing_year: e.target.value })}
                    placeholder="e.g. 2025"
                    className="w-full rounded-xl border border-input bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(0)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={saveEducationDetails} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Save & Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Application Fee ── */}
        {step === 2 && (
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-muted-foreground" /> Application Fee
              </h2>

              {progress.application_fee_paid ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Application fee has been paid</p>
                  <p className="text-xs text-muted-foreground mt-1">You can proceed to the next step.</p>
                </div>
              ) : (
                <div className="text-center py-8 space-y-4">
                  <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mx-auto">
                    <CreditCard className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">₹500</p>
                    <p className="text-sm text-muted-foreground">Application Processing Fee</p>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    This is a non-refundable application processing fee. Online payment integration coming soon — 
                    please contact our admissions team or pay at the campus.
                  </p>
                  <Button onClick={markFeePaid} disabled={saving} variant="outline" className="gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Shield className="h-4 w-4" /> Mark as Paid (Staff Use)
                  </Button>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={() => setStep(3)} disabled={!progress.application_fee_paid} className="gap-2">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Documents ── */}
        {step === 3 && (
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Upload className="h-5 w-5 text-muted-foreground" /> Upload Documents
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: "Passport Photo", desc: "Recent photo (JPG/PNG)" },
                  { label: "Previous Marksheet", desc: "Last year's marksheet" },
                  { label: "Aadhaar Card", desc: "Front & back (PDF/JPG)" },
                  { label: "Transfer Certificate", desc: "If applicable" },
                ].map((doc) => (
                  <Card key={doc.label} className="border-border/60 border-dashed shadow-none">
                    <CardContent className="p-5 text-center">
                      <Upload className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                      <h4 className="text-sm font-semibold text-foreground">{doc.label}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
                      <Button variant="outline" size="sm" className="mt-3 text-xs">
                        Choose File
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={markDocumentsUploaded} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Submit Application
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ApplyPortal;
