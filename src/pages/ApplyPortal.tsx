import { useState, useEffect } from "react";
import {
  GraduationCap, CheckCircle, Loader2, LogOut, MapPin, Pencil, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { ApplicationData, DEFAULT_APPLICATION, generateApplicationId, calculateFee, CourseSelection, FEE_MAP } from "@/components/apply/types";
import { validateDobEligibility, fetchEligibilityRules, EligibilityRule } from "@/components/apply/eligibilityRules";
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

  // Pre-fill phone from URL query parameter (e.g. ?phone=9876543210)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("phone");
    if (!p) return;
    const digits = p.replace(/\D/g, "");
    let formatted = "";
    if (digits.length === 10) formatted = `+91${digits}`;
    else if (digits.length === 12 && digits.startsWith("91")) formatted = `+${digits}`;
    else if (p.startsWith("+")) formatted = p;
    if (formatted) setPhone(formatted);
  }, []);

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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ title: "Google sign-in failed", description: err.message, variant: "destructive" });
    } finally {
      setGoogleLoading(false);
    }
  };

  const portal = usePortal();

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left branded panel ── */}
      <div
        className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col justify-between p-10 relative overflow-hidden"
        style={portal.loginBgImage ? {} : { background: portal.loginGradient }}
      >
        {/* Background photo with gradient overlay */}
        {portal.loginBgImage && (
          <>
            <div className="absolute inset-0 z-0" style={{
              backgroundImage: `url(${portal.loginBgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }} />
            <div className="absolute inset-0 z-0" style={{ background: portal.loginGradient, opacity: 0.88 }} />
          </>
        )}

        {/* Mirai man watermark */}
        {portal.loginWatermark && (
          <div className="absolute -bottom-8 -right-8 w-72 h-72 z-0 pointer-events-none opacity-10">
            <img src={portal.loginWatermark} alt="" className="w-full h-full object-contain brightness-0 invert" />
          </div>
        )}

        {/* Logo */}
        <div className="relative z-10">
          {portal.logoWhite ? (
            <img src={portal.logoWhite} alt={portal.name} className="h-12 w-auto object-contain max-w-[200px]" />
          ) : (
            <img src={portal.logo} alt={portal.name} className="h-12 w-auto object-contain max-w-[200px] brightness-0 invert" />
          )}
        </div>

        {/* Headline */}
        <div className="relative z-10 space-y-3">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-[0.2em]">{portal.tagline}</p>
          <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight whitespace-pre-line">
            {portal.loginHeadline}
          </h1>
          {portal.loginSubheadline && (
            <p className="text-sm text-white/65 leading-relaxed">{portal.loginSubheadline}</p>
          )}
        </div>

        {/* Course list — NIMT only */}
        {portal.loginCourses && (
          <div className="relative z-10 space-y-3">
            {portal.loginCourses.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.courses.map((c) => (
                    <span key={c} className="text-[11px] text-white/70 bg-white/10 rounded-md px-2 py-0.5">{c}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Badges + footer */}
        <div className="relative z-10 flex items-end justify-between">
          {portal.loginBadges && portal.loginBadges.length > 0 ? (
            <div className="flex items-center gap-3">
              {portal.loginBadges.map((badge) => (
                <img key={badge.alt} src={badge.src} alt={badge.alt} className="h-9 w-auto object-contain bg-white rounded-lg p-1.5" />
              ))}
            </div>
          ) : (
            <span />
          )}
          <p className="text-xs text-white/30">© 2026 {portal.name}</p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center bg-background p-6 lg:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 lg:hidden">
            <img src={portal.logo} alt={portal.name} className="h-9 w-auto object-contain" />
            <p className="text-xs text-muted-foreground mt-1">{portal.tagline}</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              {loginMode === "appid" ? "Find your application" : "Start your application"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              {loginMode === "google_phone"
                ? "Verify your WhatsApp number to continue"
                : loginMode === "appid"
                ? "Enter your application ID to resume"
                : otpSent
                ? `OTP sent to ${phone}`
                : "Enter your WhatsApp number to get started"}
            </p>
          </div>

          {loginMode === "google_phone" ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-primary/5 border border-primary/10 p-3.5 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">{googleName}</p>
                  <p className="text-xs text-muted-foreground">Verify your WhatsApp to continue</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">WhatsApp Number</label>
                <PhoneInput value={phone} onChange={setPhone} required />
              </div>
              {otpSent && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">6-digit OTP</label>
                  <input
                    type="text" maxLength={6} value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="· · · · · ·"
                    className="w-full rounded-xl border border-input bg-card py-3 px-4 text-xl text-foreground text-center tracking-[0.6em] font-mono placeholder:tracking-normal placeholder:text-base focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              )}
              <Button className="w-full gap-2 h-11" disabled={loading} onClick={otpSent ? handleVerifyOtp : handleSendOtp}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {otpSent ? "Verify & Continue" : "Send OTP via WhatsApp"}
              </Button>
            </div>
          ) : loginMode === "phone" ? (
            <div className="space-y-4">
              {!otpSent ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">WhatsApp Number</label>
                  <PhoneInput value={phone} onChange={setPhone} required />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl bg-primary/5 border border-primary/10 p-3.5 flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">OTP sent to</p>
                      <p className="text-sm font-mono font-semibold text-foreground">{phone}</p>
                    </div>
                    <button
                      type="button"
                      className="ml-auto text-xs text-primary hover:underline"
                      onClick={() => { setOtpSent(false); setOtp(""); }}
                    >
                      Change
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">6-digit OTP</label>
                    <input
                      type="text" maxLength={6} value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="· · · · · ·"
                      className="w-full rounded-xl border border-input bg-card py-3 px-4 text-xl text-foreground text-center tracking-[0.6em] font-mono placeholder:tracking-normal placeholder:text-base focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                </div>
              )}
              <Button className="w-full gap-2 h-11" disabled={loading} onClick={otpSent ? handleVerifyOtp : handleSendOtp}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {otpSent ? "Verify & Continue" : "Get OTP on WhatsApp"}
              </Button>
              {!otpSent && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                  onClick={() => setLoginMode("appid")}
                >
                  Have an Application ID? Login instead
                </button>
              )}
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
              <Button className="w-full gap-2 h-11" disabled={loading} onClick={handleAppIdLookup}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Find My Application
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                onClick={() => setLoginMode("phone")}
              >
                ← Back to phone login
              </button>
            </div>
          )}

          {loginMode !== "google_phone" && !otpSent && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <Button variant="outline" className="w-full gap-2 h-11" disabled={googleLoading} onClick={handleGoogleSignIn}>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step definitions ───
import { User, Users, BookOpen, Trophy, CreditCard, Upload, FileSearch, Baby, MessageSquare, Lock } from "lucide-react";

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

function DynamicStepProgress({ steps, currentStep, completedSections, onStepClick, isPaid, editUnlocked, unlockedSections }: {
  steps: readonly { key: string; label: string; icon: any }[];
  currentStep: number;
  completedSections: Record<string, boolean>;
  onStepClick: (step: number) => void;
  isPaid: boolean;
  editUnlocked?: boolean;
  unlockedSections?: string[] | null;
}) {
  const paymentIdx = steps.findIndex(s => s.key === "payment");

  return (
    <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
      {steps.map((s, i) => {
        const done    = completedSections[s.key] === true;
        const active  = currentStep === i;
        // Sequential navigation: a step is locked if any previous step is incomplete.
        // User must complete steps in order. They CAN come back to edit completed ones.
        // Exception: once payment is done, ALL pre-payment steps are permanently locked.
        // Override: if staff granted edit access, pre-payment steps become editable again
        //   (either all, or only the sections in unlockedSections)
        const allPrevDone = steps.slice(0, i).every(prev => completedSections[prev.key] === true);
        const basePaymentLock = isPaid && i < paymentIdx;
        const inUnlockedScope = editUnlocked && i < paymentIdx && (
          !unlockedSections || unlockedSections.length === 0 || unlockedSections.includes(s.key)
        );
        const lockedByPayment = basePaymentLock && !inUnlockedScope;
        const lockedBySequence = !allPrevDone && !active;
        const locked  = lockedByPayment || lockedBySequence;
        const Icon    = s.icon;
        const title = lockedByPayment
          ? "Locked after payment"
          : lockedBySequence ? "Complete previous steps first" : undefined;
        return (
          <button
            key={s.key}
            onClick={() => !locked && onStepClick(i)}
            disabled={locked}
            title={title}
            className={`flex-1 min-w-[44px] flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-medium transition-all ${
              locked
                ? "text-muted-foreground/40 cursor-not-allowed"
                : done
                ? "bg-primary/10 text-primary"
                : active
                ? "bg-card border border-border text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {locked ? (
              <Lock className="h-4 w-4 shrink-0" />
            ) : done ? (
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

// ─── Course Summary Banner ───
function CourseSummaryBanner({ app, leadName, onEdit }: { app: ApplicationData; leadName: string; onEdit: () => void | null }) {
  const [expanded, setExpanded] = useState(false);
  const selections = app.course_selections || [];
  const estimatedFee = calculateFee(selections);
  const dob = app.dob;
  const programCategory = app.program_category || '';

  // Fetch DB rules for eligibility badges
  const [courseRules, setCourseRules] = useState<Record<string, EligibilityRule>>({});
  useEffect(() => {
    const ids = selections.map(s => s.course_id);
    if (ids.length) fetchEligibilityRules(ids).then(setCourseRules);
  }, [selections]);

  // Merge rules for age validation
  const mergedRule = Object.keys(courseRules).length > 0
    ? Object.values(courseRules).reduce<EligibilityRule>((acc, r) => ({
        minAge: Math.max(acc.minAge || 0, r.minAge || 0) || undefined,
        maxAge: acc.maxAge && r.maxAge ? Math.min(acc.maxAge, r.maxAge) : (acc.maxAge || r.maxAge),
      }), {})
    : undefined;

  const ageValidation = dob && programCategory ? validateDobEligibility(programCategory, dob, 2026, mergedRule) : null;

  return (
    <div className="mb-6 space-y-3">
      <div>
        <h1 className="text-xl font-bold text-foreground">Welcome, {app.full_name || leadName}</h1>
        <p className="text-sm text-muted-foreground">Complete all steps to submit your application.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Application ID: <span className="font-mono font-semibold text-primary">{app.application_id}</span>
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-muted/30 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {selections.length} Course{selections.length !== 1 ? 's' : ''} Selected
            </span>
            {estimatedFee > 0 && (
              <Badge className="bg-primary/10 text-primary border-0 text-xs">
                Fee: ₹{estimatedFee.toLocaleString('en-IN')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {app.payment_status !== "paid" ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground/60 px-2">
                <Lock className="h-3 w-3" /> Locked
              </span>
            )}
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-3 space-y-2 border-t border-border/40">
            {selections.map((s, i) => (
              <div key={s.course_id} className="flex items-center gap-3 py-2">
                <Badge className="bg-primary/10 text-primary border-0 text-xs shrink-0">P{s.preference_order}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.course_name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {s.campus_name}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{s.program_category}</Badge>
              </div>
            ))}
            {ageValidation && (
              <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                {ageValidation.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Portal ───
// Valid lead sources in DB enum — UTM source will be mapped to these
const VALID_LEAD_SOURCES = new Set([
  "website", "meta_ads", "google_ads", "shiksha", "walk_in",
  "consultant", "justdial", "referral", "education_fair",
  "other", "collegedunia", "collegehai",
]);

// Capture UTM params on first load and persist to sessionStorage
// so source survives OTP flow / page refreshes within the session
function captureUtmSource(): string {
  if (typeof window === "undefined") return "website";
  try {
    const existing = sessionStorage.getItem("unios_utm_source");
    const params = new URLSearchParams(window.location.search);
    const utmSource = (params.get("utm_source") || "").toLowerCase().trim();
    if (utmSource && VALID_LEAD_SOURCES.has(utmSource)) {
      sessionStorage.setItem("unios_utm_source", utmSource);
      return utmSource;
    }
    // Map common aliases
    const aliases: Record<string, string> = {
      "college_hai": "collegehai", "college-hai": "collegehai",
      "college_dunia": "collegedunia", "college-dunia": "collegedunia",
      "facebook": "meta_ads", "fb": "meta_ads", "instagram": "meta_ads", "meta": "meta_ads",
      "google": "google_ads", "adwords": "google_ads",
      "jd": "justdial",
    };
    if (aliases[utmSource]) {
      sessionStorage.setItem("unios_utm_source", aliases[utmSource]);
      return aliases[utmSource];
    }
    return existing || "website";
  } catch {
    return "website";
  }
}

const ApplyPortal = () => {
  const { toast } = useToast();
  const portal = usePortal();
  const isSchool = portal.programCategories.includes("school");

  const [authed, setAuthed] = useState(false);
  const [phone, setPhone] = useState("");
  const [leadName, setLeadName] = useState("");
  const [childDob, setChildDob] = useState("");
  const [leadSource] = useState<string>(() => captureUtmSource());

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setAuthed(false);
    setApp(null);
    setSubmitted(false);
  };

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

    // Fetch all drafts for this phone to find the one matching the current portal
    const { data: existingApps } = await supabase
      .from("applications")
      .select("*")
      .eq("phone", phoneVal)
      .eq("status", "draft")
      .order("created_at", { ascending: false });

    // Find the one that belongs to this portal
    const existingApp = existingApps?.find(app => {
      const flags = (app.flags as string[]) || [];
      return flags.includes(`portal:${portal.id}`);
    });

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

    const primaryCategory = selections[0]?.program_category || 'undergraduate';
    const feeAmount = calculateFee(selections);
    const flags: string[] = [];
    if (feeAmount > 0) flags.push('payment_pending');

    // If app already exists, update instead of insert
    if (app) {
      const { error } = await supabase
        .from("applications")
        .update({
          course_selections: selections as any,
          fee_amount: feeAmount,
          program_category: primaryCategory,
          session_id: sessionId,
        })
        .eq("id", app.id);

      if (error) {
        toast({ title: "Failed to update courses", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      setApp(prev => prev ? { ...prev, course_selections: selections, fee_amount: feeAmount, program_category: primaryCategory, session_id: sessionId } : prev);
      setShowCourseSelector(false);
      setSaving(false);
      toast({ title: "Course selections updated" });
      return;
    }

    const appId = generateApplicationId();
    const flagsForNewApp = [...flags, `portal:${portal.id}`];

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
      flags: flagsForNewApp,
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

    // Create/link lead via SECURITY DEFINER RPC (bypasses RLS restrictions on
    // the authenticated applicant, who has no staff role)
    let resolvedLeadId = leadId;
    const { data: upsertedLeadId, error: leadErr } = await supabase.rpc(
      "upsert_application_lead" as any,
      {
        _name: leadName,
        _phone: phone,
        _email: null,
        _course_id: selections[0]?.course_id ?? null,
        _campus_id: selections[0]?.campus_id ?? null,
        _application_id: appId,
        _source: leadSource,
      }
    );
    if (leadErr) {
      console.error("Failed to upsert lead for application:", leadErr);
    } else if (upsertedLeadId) {
      resolvedLeadId = upsertedLeadId as unknown as string;
      // Link the application to the lead
      await supabase.from("applications").update({ lead_id: resolvedLeadId }).eq("id", inserted.id);
    }

    if (resolvedLeadId) {
      await supabase.from("lead_activities").insert({
        lead_id: resolvedLeadId,
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
      flags: flagsForNewApp,
      dob: childDob || '',
    } as ApplicationData);
    setShowCourseSelector(false);
    setStep(0);
    setSaving(false);
    toast({ title: "Application created", description: `ID: ${appId}` });
  };

  const saveSection = async (updates: Partial<ApplicationData>, sectionKey?: string): Promise<boolean> => {
    if (!app) return false;
    setSaving(true);

    const newSections = sectionKey
      ? { ...app.completed_sections, [sectionKey]: true }
      : app.completed_sections;

    const flags = [...(app.flags || [])];
    const academic = (updates.academic_details || app.academic_details) as any;
    if (academic?.class_12?.result_status === 'not_declared' || academic?.graduation?.result_status === 'not_declared') {
      if (!flags.includes('result_awaited')) flags.push('result_awaited');
    }

    // Strip fields that exist in the frontend type but have no DB column
    const { passport_number: _pn, passport_photo_path: _ppp, ...cleanUpdates } = updates as any;

    const saveData: any = {
      ...cleanUpdates,
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
      return false;
    }

    // Sync the linked lead's name when the candidate's full_name changes
    // so the CRM shows the real name instead of "Applicant"
    if (app.lead_id && updates.full_name && updates.full_name.trim() && updates.full_name !== leadName) {
      await supabase
        .from("leads")
        .update({ name: updates.full_name.trim(), person_role: "applicant" as any })
        .eq("id", app.lead_id);
    }

    setApp(prev => prev ? { ...prev, ...updates, completed_sections: newSections, flags } : prev);
    setSaving(false);
    return true;
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
      // Only advance stage if lead is in a stage where submission makes sense
      // DNC/rejected/ineligible leads keep their stage (but application is still saved)
      const { data: currentLead } = await supabase.from("leads").select("stage").eq("id", app.lead_id).single();
      const advanceableStages = ["new_lead", "ai_called", "counsellor_call", "application_in_progress", "application_fee_paid", "not_interested", "deferred"];
      if (currentLead && advanceableStages.includes(currentLead.stage)) {
        await supabase.from("leads").update({
          stage: "application_submitted" as any,
          application_progress: { personal_details: true, education_details: true, application_fee_paid: true, documents_uploaded: true } as any,
        }).eq("id", app.lead_id);

        await supabase.from("lead_activities").insert({
          lead_id: app.lead_id,
          type: "application_submitted",
          description: `Application ${app.application_id} submitted`,
          old_stage: currentLead.stage as any,
          new_stage: "application_submitted" as any,
        });
      } else {
        // Still update application progress even if stage isn't advanced
        await supabase.from("leads").update({
          application_progress: { personal_details: true, education_details: true, application_fee_paid: true, documents_uploaded: true } as any,
        }).eq("id", app.lead_id);
      }
    }

    setSubmitted(true);
    setSaving(false);
    toast({ title: "Application submitted!" });
  };

  const onChange = (updates: Partial<ApplicationData>) => {
    setApp(prev => prev ? { ...prev, ...updates } : prev);
  };

  const handleStepNext = async (sectionKey: string, nextStep: number) => {
    if (!app) return;
    // Persist the entire current application state (strip read-only/meta fields)
    const {
      id: _id, lead_id: _lid, created_at: _ca, updated_at: _ua,
      application_id: _aid, submitted_at: _sa,
      ...saveable
    } = app as any;
    const ok = await saveSection(saveable, sectionKey);
    if (ok) setStep(nextStep);
  };

  // ── Not logged in ──
  if (!authed) {
    return <OtpLogin onAuthenticated={handleAuthenticated} />;
  }

  // ── Course selection ──
  if (showCourseSelector) {
    return (
      <div className="min-h-screen bg-background">
        <Header appId={app?.application_id || null} completedCount={0} totalSteps={totalSteps} onLogout={handleLogout} />
        <div className="max-w-3xl mx-auto px-6 py-8">
          <CourseSelector
            phone={phone}
            leadName={leadName}
            childDob={childDob}
            onDobChange={setChildDob}
            onComplete={handleCourseSelected}
            existingSelections={app?.course_selections}
            existingSession={app?.session_id || undefined}
            onCancel={app ? () => setShowCourseSelector(false) : undefined}
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
            <Button variant="outline" className="mt-6" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!app) return null;

  const completedCount = Object.values(app.completed_sections).filter(Boolean).length;
  const isPaid = app.payment_status === "paid";
  const paymentStepIdx = steps.findIndex(s => s.key === "payment");
  const cs = app.completed_sections as Record<string, boolean>;
  // Staff-granted edit access window
  const editUnlockedUntil = (app as any).edit_unlocked_until as string | undefined;
  const unlockedSections = (app as any).edit_unlocked_sections as string[] | null | undefined;
  const editUnlocked = !!editUnlockedUntil && new Date(editUnlockedUntil).getTime() > Date.now();

  // Determine if user can navigate back from current step.
  // Users CAN freely go back to edit previously completed steps.
  // Blocked only if:
  //  - we're at the first step (nowhere to go)
  //  - payment is done and the previous step would be a pre-payment (locked) step
  //    UNLESS staff granted edit access
  const canGoBack = (() => {
    if (step === 0) return false;
    const prevKey = steps[step - 1]?.key;
    if (isPaid && (step - 1) < paymentStepIdx) {
      if (!editUnlocked) return false;
      // In scope: either no section filter (all) or this specific prev section is unlocked
      if (!unlockedSections || unlockedSections.length === 0 || unlockedSections.includes(prevKey)) {
        return true;
      }
      return false;
    }
    return true;
  })();

  const backHandler = canGoBack ? () => setStep(step - 1) : undefined;

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
          onBack={backHandler}
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
          onBack={backHandler}
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
          onBack={backHandler}
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
          onBack={backHandler}
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
          onBack={backHandler}
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
            const ok = await saveSection({ payment_status: app.payment_status }, 'payment');
            if (ok) setStep(step + 1);
          }}
          onBack={backHandler}
          saving={saving}
        />
      );
    }
    if (stepKey === "documents") {
      return (
        <DocumentUpload
          data={app}
          onChange={(partial) => setApp(prev => ({ ...prev, ...partial }))}
          onNext={async () => {
            const ok = await saveSection({}, 'documents');
            if (ok) setStep(step + 1);
          }}
          onBack={backHandler}
          saving={saving}
        />
      );
    }
    if (stepKey === "review") {
      return (
        <ReviewSubmit
          data={app}
          onBack={backHandler}
          onSubmit={handleSubmit}
          saving={saving}
        />
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header appId={app.application_id} completedCount={completedCount} totalSteps={totalSteps} onLogout={handleLogout} />

      <div className="max-w-3xl mx-auto px-6 py-8">
        <CourseSummaryBanner
          app={app}
          leadName={leadName}
          onEdit={app.payment_status === "paid" ? () => null : () => setShowCourseSelector(true)}
        />

        {editUnlocked && editUnlockedUntil && (
          <div className="mb-6 rounded-xl border border-green-300 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40 shrink-0">
                <CheckCircle className="h-4 w-4 text-green-700 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-900 dark:text-green-200">Edit access granted</p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                  A counsellor has unlocked your application for editing.
                  {unlockedSections && unlockedSections.length > 0 && (
                    <> You can edit: <span className="font-medium">{unlockedSections.join(", ")}</span>.</>
                  )}
                  {" "}Access expires on <span className="font-medium">{new Date(editUnlockedUntil).toLocaleString("en-IN")}</span>.
                </p>
              </div>
            </div>
          </div>
        )}

        <DynamicStepProgress
          steps={steps}
          currentStep={step}
          completedSections={app.completed_sections as any}
          onStepClick={setStep}
          isPaid={app.payment_status === "paid"}
          editUnlocked={editUnlocked}
          unlockedSections={unlockedSections}
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
        <div className="flex items-center">
          <img src={portal.logo} alt={portal.name} className="h-8 w-auto object-contain" />
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
