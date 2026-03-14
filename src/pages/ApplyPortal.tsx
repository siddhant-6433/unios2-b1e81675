import { useState, useEffect } from "react";
import {
  GraduationCap, CheckCircle, Loader2, LogOut,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
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
import { SiblingDetails } from "@/components/apply/SiblingDetails";
import { ParentQuestionnaire } from "@/components/apply/ParentQuestionnaire";
import { PortalProvider, usePortal } from "@/components/apply/PortalContext";

// ─── OTP Login Screen ───
function OtpLogin({ onAuthenticated }: { onAuthenticated: (phone: string, name: string) => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [loginMode, setLoginMode] = useState<"phone" | "appid" | "google_phone">("phone");
  const [googleName, setGoogleName] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);

  // Check for existing Supabase session (e.g. after Google OAuth redirect)
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email || "Applicant";
        const userPhone = session.user.phone;

        // Check if user has phone in profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, display_name")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (profile?.phone) {
          onAuthenticated(profile.phone, profile.display_name || name);
          return;
        }

        if (userPhone) {
          onAuthenticated(userPhone, name);
          return;
        }

        // Google user without phone — ask for phone + WhatsApp verification
        setGoogleName(name);
        setLoginMode("google_phone");
      }
      setCheckingSession(false);
    };
    checkSession();
  }, []);

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
      if (error) {
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const body = await ctx.json(); throw new Error(body?.error || error.message); } catch (e: any) { if (e.message) throw e; }
        }
        throw error;
      }
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
      if (verifyErr) {
        const ctx = (verifyErr as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const body = await ctx.json(); throw new Error(body?.error || verifyErr.message); } catch (e: any) { if (e.message) throw e; }
        }
        throw verifyErr;
      }
      if (verifyData?.error) throw new Error(verifyData.error);
      if (!verifyData?.success && !verifyData?.verified) throw new Error("Invalid or expired OTP");

      if (loginMode === "google_phone") {
        // Update profile with phone for Google-authenticated user
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await supabase.from("profiles").update({ phone }).eq("user_id", session.user.id);
        }
        onAuthenticated(phone, googleName || "Applicant");
      } else {
        const { data: lead } = await supabase
          .from("leads")
          .select("name")
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        onAuthenticated(phone, lead?.name || "Applicant");
      }
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
      const { data: app, error } = await supabase
        .from("applications")
        .select("phone, full_name")
        .eq("application_id", applicationId.trim().toUpperCase())
        .maybeSingle();

      if (error) throw error;
      if (!app) {
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

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.href,
      });
      if (result.error) throw result.error;
    } catch (err: any) {
      toast({ title: "Google sign-in failed", description: err.message, variant: "destructive" });
    } finally {
      setGoogleLoading(false);
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

          {/* Divider */}
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Google Sign In */}
          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={googleLoading}
            onClick={handleGoogleSignIn}
          >
            {googleLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            Continue with Google
          </Button>
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

// ─── Step definitions ───
import { User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch, Baby, MessageSquare } from "lucide-react";

const SCHOOL_STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "parents", label: "Parents", icon: Users },
  { key: "siblings", label: "Siblings", icon: Baby },
  { key: "questionnaire", label: "Questionnaire", icon: MessageSquare },
  { key: "academic", label: "Academic", icon: BookOpen },
  { key: "payment", label: "Payment", icon: CreditCard },
  { key: "documents", label: "Documents", icon: Upload },
  { key: "review", label: "Review", icon: FileSearch },
] as const;

const DEFAULT_STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "parents", label: "Parents", icon: Users },
  { key: "academic", label: "Academic", icon: BookOpen },
  { key: "extracurricular", label: "Extra", icon: Trophy },
  { key: "payment", label: "Payment", icon: CreditCard },
  { key: "documents", label: "Documents", icon: Upload },
  { key: "review", label: "Review", icon: FileSearch },
] as const;

function DynamicStepProgress({ steps, currentStep, completedSections, onStepClick }: {
  steps: readonly { key: string; label: string; icon: any }[];
  currentStep: number;
  completedSections: Record<string, boolean>;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
      {steps.map((s, i) => {
        const done = completedSections[s.key] === true;
        const active = currentStep === i;
        const Icon = s.icon;
        return (
          <button
            key={s.key}
            onClick={() => onStepClick(i)}
            className={`flex-1 min-w-[44px] flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-medium transition-all ${
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
              <Icon className="h-4 w-4 shrink-0" />
            )}
            <span className="hidden md:inline truncate">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Portal ───
const ApplyPortal = () => {
  const { toast } = useToast();
  const portal = usePortal();
  const isSchool = portal.programCategories.includes("school");

  const [authed, setAuthed] = useState(false);
  const [phone, setPhone] = useState("");
  const [leadName, setLeadName] = useState("");
  const [childDob, setChildDob] = useState("");

  const [app, setApp] = useState<ApplicationData | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCourseSelector, setShowCourseSelector] = useState(true);

  const steps = isSchool ? SCHOOL_STEPS : DEFAULT_STEPS;
  const totalSteps = steps.length;

  const handleAuthenticated = async (phoneVal: string, name: string) => {
    setPhone(phoneVal);
    setLeadName(name);
    setAuthed(true);

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
      if (appData.dob) setChildDob(appData.dob);
      setShowCourseSelector(false);

      if (existingApp.status === 'submitted') {
        setSubmitted(true);
        return;
      }

      const stepKeys = steps.map(s => s.key);
      const cs = appData.completed_sections as Record<string, boolean>;
      const firstIncomplete = stepKeys.findIndex(k => !cs[k]);
      setStep(firstIncomplete >= 0 ? firstIncomplete : totalSteps - 1);
    }
  };

  const handleCourseSelected = async (sessionId: string, selections: CourseSelection[], leadId: string | null) => {
    setSaving(true);

    const appId = generateApplicationId();
    const primaryCategory = selections[0]?.program_category || 'undergraduate';
    const feeAmount = calculateFee(selections);

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
      ...(childDob ? { dob: childDob } : {}),
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
      dob: childDob || '',
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
        <Header appId={null} completedCount={0} totalSteps={totalSteps} onLogout={() => { setAuthed(false); setApp(null); }} />
        <div className="max-w-3xl mx-auto px-6 py-8">
          <CourseSelector
            phone={phone}
            leadName={leadName}
            childDob={childDob}
            onDobChange={setChildDob}
            onComplete={handleCourseSelected}
          />
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

  // Build step rendering based on portal type
  const renderStep = () => {
    const stepKey = steps[step]?.key;

    if (stepKey === "personal") {
      return (
        <PersonalDetails
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('personal', step + 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "parents") {
      return (
        <ParentDetails
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('parents', step + 1)}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "siblings") {
      return (
        <SiblingDetails
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('siblings', step + 1)}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "questionnaire") {
      return (
        <ParentQuestionnaire
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('questionnaire', step + 1)}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "academic") {
      return (
        <AcademicDetails
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('academic', step + 1)}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "extracurricular") {
      return (
        <ExtracurricularDetails
          data={app}
          onChange={onChange}
          onNext={() => handleStepNext('extracurricular', step + 1)}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "payment") {
      return (
        <PaymentSection
          data={app}
          onChange={onChange}
          onNext={async () => {
            await saveSection({ payment_status: app.payment_status }, 'payment');
            setStep(step + 1);
          }}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "documents") {
      return (
        <DocumentUpload
          data={app}
          onNext={async () => {
            await saveSection({}, 'documents');
            setStep(step + 1);
          }}
          onBack={() => setStep(step - 1)}
          saving={saving}
        />
      );
    }
    if (stepKey === "review") {
      return (
        <ReviewSubmit
          data={app}
          onBack={() => setStep(step - 1)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header appId={app.application_id} completedCount={completedCount} totalSteps={totalSteps} onLogout={() => { setAuthed(false); setApp(null); }} />

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Welcome, {app.full_name || leadName}</h1>
          <p className="text-sm text-muted-foreground">Complete all steps to submit your application.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Application ID: <span className="font-mono font-semibold text-primary">{app.application_id}</span>
          </p>
        </div>

        <DynamicStepProgress
          steps={steps}
          currentStep={step}
          completedSections={app.completed_sections as any}
          onStepClick={setStep}
        />

        <Card className="border-border/60 shadow-none">
          <CardContent className="p-6">
            {renderStep()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// ─── Header ───
function Header({ appId, completedCount, totalSteps, onLogout }: { appId: string | null; completedCount: number; totalSteps: number; onLogout: () => void }) {
  const portal = usePortal();
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={portal.logo} alt={portal.name} className="h-10 w-10 rounded-xl object-contain" />
          <div>
            <span className="text-sm font-bold text-foreground tracking-tight">{portal.name}</span>
            <span className="text-[11px] text-muted-foreground block">{portal.tagline}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {appId && (
            <Badge className="bg-primary/10 text-primary border-0 text-xs">
              {completedCount}/{totalSteps} complete
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

// ─── Wrapped with PortalProvider ───
function ApplyPortalWrapper() {
  return (
    <PortalProvider>
      <ApplyPortal />
    </PortalProvider>
  );
}

export default ApplyPortalWrapper;
