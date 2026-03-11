import { useState, useEffect } from "react";
import {
  GraduationCap, CheckCircle, Loader2, LogOut,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { ApplicationData, DEFAULT_APPLICATION, generateApplicationId, calculateFee, CourseSelection } from "@/components/apply/types";
import { StepProgress } from "@/components/apply/StepProgress";
import { CourseSelector } from "@/components/apply/CourseSelector";
import { PersonalDetails } from "@/components/apply/PersonalDetails";
import { ParentDetails } from "@/components/apply/ParentDetails";
import { AcademicDetails } from "@/components/apply/AcademicDetails";
import { ExtracurricularDetails } from "@/components/apply/ExtracurricularDetails";
import { PaymentSection } from "@/components/apply/PaymentSection";
import { DocumentUpload } from "@/components/apply/DocumentUpload";
import { ReviewSubmit } from "@/components/apply/ReviewSubmit";
import { PortalProvider, usePortal } from "@/components/apply/PortalContext";

// ─── OTP Login Screen ───
function OtpLogin({ onAuthenticated }: { onAuthenticated: (phone: string, name: string) => void }) {
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
      const { data: verifyData, error: verifyErr } = await supabase.functions.invoke("whatsapp-otp", {
        body: { phone, otp, action: "verify" },
      });
      if (verifyErr) throw verifyErr;
      if (!verifyData?.verified) throw new Error("Invalid or expired OTP");

      // Check for existing lead to get name
      const { data: lead } = await supabase
        .from("leads")
        .select("name")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      onAuthenticated(phone, lead?.name || "Applicant");
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
      // Look up in applications table
      const { data: app, error } = await supabase
        .from("applications")
        .select("phone, full_name")
        .eq("application_id", applicationId.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      if (!app) {
        // Fallback: check leads table
        const { data: lead } = await supabase
          .from("leads")
          .select("phone, name")
          .eq("application_id", applicationId.trim().toUpperCase())
          .maybeSingle();

        if (!lead) {
          toast({ title: "Application not found", variant: "destructive" });
          setLoading(false);
          return;
        }
        setPhone(lead.phone);
      } else {
        setPhone(app.phone);
      }

      setLoginMode("phone");
      toast({ title: "Found! Verify your phone to continue." });
    } catch (err: any) {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const portal = usePortal();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-md w-full border-border/60 shadow-none">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <img src={portal.logo} alt={portal.name} className="h-10 w-10 rounded-xl object-contain" />
            <div>
              <h2 className="text-lg font-bold text-foreground">{portal.name}</h2>
              <p className="text-xs text-muted-foreground">{portal.tagline}</p>
            </div>
          </div>

          {loginMode === "phone" ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">WhatsApp Number</label>
                <PhoneInput value={phone} onChange={setPhone} required />
              </div>

              {otpSent && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Enter OTP sent via WhatsApp</label>
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

              <Button className="w-full gap-2" disabled={loading} onClick={otpSent ? handleVerifyOtp : handleSendOtp}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {otpSent ? "Verify & Continue" : "Send OTP via WhatsApp"}
              </Button>

              <button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center" onClick={() => setLoginMode("appid")}>
                Login with Application ID instead
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Application ID</label>
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

              <button type="button" className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center" onClick={() => setLoginMode("phone")}>
                Login with phone number instead
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Portal ───
const ApplyPortal = () => {
  const { toast } = useToast();

  // Auth state
  const [authed, setAuthed] = useState(false);
  const [phone, setPhone] = useState("");
  const [leadName, setLeadName] = useState("");

  // Application state
  const [app, setApp] = useState<ApplicationData | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCourseSelector, setShowCourseSelector] = useState(true);

  const handleAuthenticated = async (phoneVal: string, name: string) => {
    setPhone(phoneVal);
    setLeadName(name);
    setAuthed(true);

    // Check for existing draft application
    const { data: existingApp } = await supabase
      .from("applications")
      .select("*")
      .eq("phone", phoneVal)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingApp) {
      const appData: ApplicationData = {
        ...DEFAULT_APPLICATION,
        ...existingApp,
        course_selections: (existingApp.course_selections as any) || [],
        address: (existingApp.address as any) || {},
        father: (existingApp.father as any) || {},
        mother: (existingApp.mother as any) || {},
        guardian: (existingApp.guardian as any) || {},
        academic_details: (existingApp.academic_details as any) || {},
        result_status: (existingApp.result_status as any) || {},
        extracurricular: (existingApp.extracurricular as any) || {},
        school_details: (existingApp.school_details as any) || {},
        completed_sections: (existingApp.completed_sections as any) || DEFAULT_APPLICATION.completed_sections,
        flags: (existingApp.flags as string[]) || [],
      } as ApplicationData;

      setApp(appData);
      setShowCourseSelector(false);

      // Check if already submitted
      if (existingApp.status === 'submitted') {
        setSubmitted(true);
        return;
      }

      // Find first incomplete step
      const sections = ['personal', 'parents', 'academic', 'extracurricular', 'payment', 'documents', 'review'];
      const cs = appData.completed_sections;
      const firstIncomplete = sections.findIndex(s => !(cs as any)[s]);
      setStep(firstIncomplete >= 0 ? firstIncomplete : 6);
    }
  };

  const handleCourseSelected = async (sessionId: string, selections: CourseSelection[], leadId: string | null) => {
    setSaving(true);

    const appId = generateApplicationId();
    const primaryCategory = selections[0]?.program_category || 'undergraduate';
    const feeAmount = calculateFee(selections);

    // Build flags
    const flags: string[] = [];
    if (feeAmount > 0) flags.push('payment_pending');

    const newApp: any = {
      application_id: appId,
      lead_id: leadId,
      session_id: sessionId,
      status: 'draft',
      course_selections: selections,
      full_name: leadName,
      phone,
      whatsapp_verified: true,
      fee_amount: feeAmount,
      program_category: primaryCategory,
      flags,
      completed_sections: DEFAULT_APPLICATION.completed_sections,
    };

    const { data: inserted, error } = await supabase
      .from("applications")
      .insert(newApp)
      .select()
      .single();

    if (error) {
      toast({ title: "Failed to create application", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Update lead stage if linked
    if (leadId) {
      await supabase.from("leads").update({
        stage: "application_in_progress" as any,
        application_id: appId,
        course_id: selections[0]?.course_id,
        campus_id: selections[0]?.campus_id,
      }).eq("id", leadId);

      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        type: "application_started",
        description: `Application ${appId} started with ${selections.length} course(s)`,
        old_stage: "new_lead" as any,
        new_stage: "application_in_progress" as any,
      });
    }

    setApp({
      ...DEFAULT_APPLICATION,
      ...inserted,
      course_selections: selections,
      address: {},
      father: {},
      mother: {},
      guardian: {},
      academic_details: {},
      result_status: {},
      extracurricular: {},
      school_details: {},
      completed_sections: DEFAULT_APPLICATION.completed_sections,
      flags,
    } as ApplicationData);
    setShowCourseSelector(false);
    setStep(0);
    setSaving(false);
    toast({ title: "Application created", description: `ID: ${appId}` });
  };

  const saveSection = async (updates: Partial<ApplicationData>, sectionKey?: string) => {
    if (!app) return;
    setSaving(true);

    const newSections = sectionKey
      ? { ...app.completed_sections, [sectionKey]: true }
      : app.completed_sections;

    // Build flags
    const flags = [...(app.flags || [])];
    const academic = (updates.academic_details || app.academic_details) as any;
    if (academic?.class_12?.result_status === 'not_declared' || academic?.graduation?.result_status === 'not_declared') {
      if (!flags.includes('result_awaited')) flags.push('result_awaited');
    }

    const saveData: any = {
      ...updates,
      completed_sections: newSections,
      flags,
    };

    const { error } = await supabase
      .from("applications")
      .update(saveData)
      .eq("id", app.id);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    setApp(prev => prev ? { ...prev, ...updates, completed_sections: newSections, flags } : prev);
    setSaving(false);
  };

  const handleSubmit = async () => {
    if (!app) return;
    setSaving(true);

    const { error } = await supabase
      .from("applications")
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        completed_sections: { ...app.completed_sections, review: true } as any,
      })
      .eq("id", app.id);

    if (error) {
      toast({ title: "Submit failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Update lead stage
    if (app.lead_id) {
      await supabase.from("leads").update({
        stage: "application_submitted" as any,
        application_progress: { personal_details: true, education_details: true, application_fee_paid: true, documents_uploaded: true } as any,
      }).eq("id", app.lead_id);

      await supabase.from("lead_activities").insert({
        lead_id: app.lead_id,
        type: "application_submitted",
        description: `Application ${app.application_id} submitted`,
        old_stage: "application_in_progress" as any,
        new_stage: "application_submitted" as any,
      });
    }

    setSubmitted(true);
    setSaving(false);
    toast({ title: "Application submitted!" });
  };

  const onChange = (updates: Partial<ApplicationData>) => {
    setApp(prev => prev ? { ...prev, ...updates } : prev);
  };

  const handleStepNext = async (sectionKey: string, nextStep: number) => {
    await saveSection({}, sectionKey);
    setStep(nextStep);
  };

  // ── Not logged in ──
  if (!authed) {
    return <OtpLogin onAuthenticated={handleAuthenticated} />;
  }

  // ── Course selection ──
  if (showCourseSelector) {
    return (
      <div className="min-h-screen bg-background">
        <Header appId={null} completedCount={0} onLogout={() => { setAuthed(false); setApp(null); }} />
        <div className="max-w-3xl mx-auto px-6 py-8">
          <CourseSelector phone={phone} leadName={leadName} onComplete={handleCourseSelected} />
        </div>
      </div>
    );
  }

  // ── Submitted ──
  if (submitted && app) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-border/60 shadow-none">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Application Submitted!</h2>
            <p className="text-sm text-muted-foreground mt-2">Your application has been received.</p>
            <p className="text-lg font-mono font-bold text-primary mt-1">{app.application_id}</p>
            <p className="text-xs text-muted-foreground mt-4">Our admissions team will review your application and contact you shortly.</p>
            <Button variant="outline" className="mt-6" onClick={() => { setAuthed(false); setApp(null); setSubmitted(false); }}>
              <LogOut className="h-4 w-4 mr-2" /> Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!app) return null;

  const completedCount = Object.values(app.completed_sections).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background">
      <Header appId={app.application_id} completedCount={completedCount} onLogout={() => { setAuthed(false); setApp(null); }} />

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Welcome, {app.full_name || leadName}</h1>
          <p className="text-sm text-muted-foreground">Complete all steps to submit your application.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Application ID: <span className="font-mono font-semibold text-primary">{app.application_id}</span>
          </p>
        </div>

        <StepProgress currentStep={step} completedSections={app.completed_sections as any} onStepClick={setStep} />

        <Card className="border-border/60 shadow-none">
          <CardContent className="p-6">
            {step === 0 && (
              <PersonalDetails
                data={app}
                onChange={onChange}
                onNext={() => handleStepNext('personal', 1)}
                saving={saving}
              />
            )}
            {step === 1 && (
              <ParentDetails
                data={app}
                onChange={onChange}
                onNext={() => handleStepNext('parents', 2)}
                onBack={() => setStep(0)}
                saving={saving}
              />
            )}
            {step === 2 && (
              <AcademicDetails
                data={app}
                onChange={onChange}
                onNext={() => handleStepNext('academic', 3)}
                onBack={() => setStep(1)}
                saving={saving}
              />
            )}
            {step === 3 && (
              <ExtracurricularDetails
                data={app}
                onChange={onChange}
                onNext={() => handleStepNext('extracurricular', 4)}
                onBack={() => setStep(2)}
                saving={saving}
              />
            )}
            {step === 4 && (
              <PaymentSection
                data={app}
                onChange={onChange}
                onNext={async () => {
                  await saveSection({ payment_status: app.payment_status }, 'payment');
                  setStep(5);
                }}
                onBack={() => setStep(3)}
                saving={saving}
              />
            )}
            {step === 5 && (
              <DocumentUpload
                data={app}
                onNext={async () => {
                  await saveSection({}, 'documents');
                  setStep(6);
                }}
                onBack={() => setStep(4)}
                saving={saving}
              />
            )}
            {step === 6 && (
              <ReviewSubmit
                data={app}
                onBack={() => setStep(5)}
                onSubmit={handleSubmit}
                saving={saving}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ─── Header ───
function Header({ appId, completedCount, onLogout }: { appId: string | null; completedCount: number; onLogout: () => void }) {
  return (
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
          {appId && (
            <Badge className="bg-primary/10 text-primary border-0 text-xs">
              {completedCount}/7 complete
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

export default ApplyPortal;
