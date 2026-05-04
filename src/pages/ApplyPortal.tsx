import { useState, useEffect } from "react";
import {
  GraduationCap, CheckCircle, Loader2, LogOut, MapPin, Pencil, ChevronDown, ChevronUp,
  FileText, Receipt, Award, Clock, Plus, Wallet, ArrowLeft,
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
import { TokenFeePanel } from "@/components/applicant/TokenFeePanel";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { ReceiptDialog, type ReceiptData } from "@/components/receipts/ReceiptDialog";
import { captureAttribution } from "@/lib/analytics";

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

  // Check for ?token= magic link first; if present, redeem it and sign the user in.
  // Falls through to the normal session/OTP flow on any failure.
  const hasMagicToken = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("token");
  useEffect(() => {
    const url = new URL(window.location.href);
    const magicToken = url.searchParams.get("token");
    if (!magicToken) return;

    (async () => {
      try {
        // NOTE: do NOT call supabase.auth.signOut() here. Supabase auth state
        // lives in localStorage which is SHARED across all tabs on the same
        // origin — signing out here would log the staff member out of their
        // /applications dashboard tab too. The checkSession useEffect already
        // skips when `hasMagicToken` is true, so contamination isn't a concern.

        // Call the edge function via raw fetch instead of supabase.functions.invoke.
        // The SDK consumes the response body when constructing FunctionsHttpError,
        // so we can never read the server-side error message from a non-2xx — the
        // user just sees the generic "Edge Function returned a non-2xx status code".
        // Raw fetch lets us read the JSON body directly and surface the real reason
        // (e.g. "This link has expired. Ask your counsellor for a new one.").
        const supaUrl = (supabase as any).supabaseUrl as string;
        const supaKey = (supabase as any).supabaseKey as string;
        const res = await fetch(`${supaUrl}/functions/v1/redeem-apply-link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supaKey,
            Authorization: `Bearer ${supaKey}`,
          },
          body: JSON.stringify({ token: magicToken }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          throw new Error(data?.error || `Login failed (HTTP ${res.status}). Please ask your counsellor for a new link or use phone OTP.`);
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.phone) throw new Error("Invalid link response");

        // Strip the token from the URL so refreshing doesn't try to re-redeem.
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.toString());

        // Mirror the OTP login flow: just hand phone+name to onAuthenticated.
        // The apply portal is session-less for applicants — RLS on `applications`
        // already permits anon writes scoped by phone.
        onAuthenticated(data.phone, data.name || "Applicant");
      } catch (err: any) {
        toast({
          title: "Login link expired or invalid",
          description: err?.message || "Please ask your counsellor for a new link, or use phone OTP.",
          variant: "destructive",
        });
        // Fall through to OTP login by stripping the token
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.toString());
      }
    })();
  }, []);

  // Check for existing Supabase session (e.g. after Google OAuth redirect).
  // Skip when a magic-link token is in the URL — that flow handles auth itself
  // and we don't want a stale admin session in the same browser to win the race.
  useEffect(() => {
    if (hasMagicToken) { setCheckingSession(false); return; }
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

/* ─── Application Dashboard ─── */
type DashboardApp = {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string | null;
  status: string;
  payment_status: string | null;
  fee_amount: number | null;
  course_selections: any[];
  form_pdf_url: string | null;
  fee_receipt_url: string | null;
  phone: string;
  email: string | null;
  created_at: string;
};

function statusBadge(status: string, paymentStatus: string | null) {
  if (status === "approved") return { label: "Approved", className: "bg-green-100 text-green-700", Icon: CheckCircle };
  if (status === "submitted" || status === "under_review") return { label: status === "submitted" ? "Submitted" : "Under Review", className: "bg-emerald-100 text-emerald-700", Icon: CheckCircle };
  if (status === "rejected") return { label: "Rejected", className: "bg-red-100 text-red-700", Icon: Clock };
  if (paymentStatus === "paid") return { label: "Fee Paid · Continue", className: "bg-blue-100 text-blue-700", Icon: Clock };
  return { label: "Draft · In Progress", className: "bg-amber-100 text-amber-700", Icon: Clock };
}

function ApplicationDashboardView({
  apps, leadName, offerLetters, openAppId, setOpenAppId, onContinue, onStartNew, onLogout,
}: {
  apps: any[];
  leadName: string;
  offerLetters: Record<string, { letter_url: string | null; approval_status: string }>;
  openAppId: string | null;
  setOpenAppId: (id: string | null) => void;
  onContinue: (app: any) => void;
  onStartNew: () => void;
  onLogout: () => void;
}) {
  const portal = usePortal();
  // Which app's fee-receipt dialog is open. Builds the same modern receipt
  // the student gets via email — single canonical format.
  const [receiptApp, setReceiptApp] = useState<any | null>(null);
  const buildReceiptData = (a: any): ReceiptData => {
    const nameIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.full_name || "");
    const courses = (a.course_selections as any[]) || [];
    return {
      type: "application_fee",
      application_id: a.application_id,
      applicant_name: nameIsEmail ? undefined : a.full_name,
      phone: a.phone,
      email: a.email || (nameIsEmail ? a.full_name : undefined),
      amount: Number(a.fee_amount || 0),
      payment_ref: a.payment_ref,
      // Best signal of when the payment cleared. submitted_at is closest if
      // present, else fall back to row updated_at, else now.
      payment_date: a.submitted_at || a.updated_at || new Date().toISOString(),
      institution_name: portal.name,
      campus_name: courses[0]?.campus_name,
      logo: portal.logo,
      primaryColor: portal.primaryColor,
    };
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Lightweight header — keep parity with the editor's header but no progress bar */}
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          {portal.logo ? (
            <img src={portal.logo} alt={portal.name} className="h-8 sm:h-10 w-auto object-contain" />
          ) : (
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold text-foreground">{portal.name}</span>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1.5 shrink-0"><LogOut className="h-4 w-4" /> Logout</Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome, {leadName}</h1>
          <p className="text-sm text-muted-foreground mt-1">Here are all your applications. Pick one to view details, continue editing, or pay your token fee.</p>
        </div>

        <div className="space-y-4">
          {apps.map((app) => {
            const a = app as DashboardApp;
            const courses = (a.course_selections || []).map((c: any) => c.course_name).filter(Boolean);
            const badge = statusBadge(a.status, a.payment_status);
            const offer = a.lead_id ? offerLetters[a.lead_id] : undefined;
            // An offer is "live" (token fee payable) the moment it's approved —
            // PDF generation is asynchronous and shouldn't block payment.
            const hasApprovedOffer = offer?.approval_status === "approved";
            const hasLetterPdf = hasApprovedOffer && !!offer.letter_url;
            const isDraft = a.status === "draft";
            const isPaid = a.payment_status === "paid";
            const isOpen = openAppId === a.id;
            return (
              <Card key={a.id} className="border-border/60 shadow-none overflow-hidden">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-primary">{a.application_id}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
                          <badge.Icon className="h-3 w-3" />{badge.label}
                        </span>
                      </div>
                      <p className="text-sm text-foreground mt-2">
                        {courses.length > 0 ? courses.join(", ") : <span className="text-muted-foreground italic">No course selected yet</span>}
                      </p>
                      {a.fee_amount != null && a.fee_amount > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Application fee: <span className="font-medium text-foreground">₹{a.fee_amount.toLocaleString("en-IN")}</span>
                          {isPaid && <span className="ml-1 text-green-600">· Paid</span>}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {isDraft ? (
                      <Button size="sm" className="gap-1.5" onClick={() => onContinue(a)}>
                        <Pencil className="h-3.5 w-3.5" /> Continue Editing
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onContinue(a)}>
                        <CheckCircle className="h-3.5 w-3.5" /> View Submission
                      </Button>
                    )}
                    {a.form_pdf_url && (
                      <Button size="sm" variant="outline" className="gap-1.5" asChild>
                        <a href={a.form_pdf_url} target="_blank" rel="noreferrer">
                          <FileText className="h-3.5 w-3.5" /> Application PDF
                        </a>
                      </Button>
                    )}
                    {isPaid && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReceiptApp(a)}>
                        <Receipt className="h-3.5 w-3.5" /> Fee Receipt
                      </Button>
                    )}
                    {hasLetterPdf && (
                      <Button size="sm" variant="outline" className="gap-1.5" asChild>
                        <a href={offer!.letter_url!} target="_blank" rel="noreferrer">
                          <Award className="h-3.5 w-3.5" /> Offer Letter
                        </a>
                      </Button>
                    )}
                    {hasApprovedOffer && !hasLetterPdf && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Offer letter being prepared…
                      </span>
                    )}
                    {hasApprovedOffer && (
                      <Button
                        size="sm"
                        variant={isOpen ? "secondary" : "default"}
                        className="gap-1.5"
                        onClick={() => setOpenAppId(isOpen ? null : a.id)}
                      >
                        <Wallet className="h-3.5 w-3.5" /> {isOpen ? "Hide Token Fee" : "Pay Token Fee"}
                      </Button>
                    )}
                  </div>

                  {/* Inline TokenFeePanel — only mounts when expanded so its
                      DB queries don't fire for unrelated cards. */}
                  {isOpen && hasApprovedOffer && (
                    <TokenFeePanel
                      applicationId={a.application_id}
                      applicantName={a.full_name || ""}
                      applicantPhone={a.phone}
                      applicantEmail={a.email}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Button variant="outline" className="w-full gap-2" onClick={onStartNew}>
          <Plus className="h-4 w-4" /> Start a new application
        </Button>
      </main>

      {receiptApp && (
        <ReceiptDialog data={buildReceiptData(receiptApp)} onClose={() => setReceiptApp(null)} />
      )}
    </div>
  );
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
    setAppsList(null);
    setDashboardOpenAppId(null);
    setOfferLetters({});
    setPreviewDocs([]);
    setHasDashboard(false);
  };

  const [app, setApp] = useState<ApplicationData | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showCourseSelector, setShowCourseSelector] = useState(true);
  // Dashboard listing all applications for the authenticated phone in this portal.
  // Shown when ≥1 non-draft app exists OR there are multiple apps. From here the
  // user can continue editing a draft, view PDFs, view the offer letter, or pay
  // the token fee — i.e. everything the student would normally need post-submit.
  const [appsList, setAppsList] = useState<any[] | null>(null);
  const [dashboardOpenAppId, setDashboardOpenAppId] = useState<string | null>(null);
  const [offerLetters, setOfferLetters] = useState<Record<string, { letter_url: string | null; approval_status: string }>>({});
  // Uploaded docs for the currently-previewed submission (loaded on demand).
  const [previewDocs, setPreviewDocs] = useState<PreviewDoc[]>([]);
  // Whether the dashboard exists to go back to (i.e. multiple apps OR any non-draft).
  const [hasDashboard, setHasDashboard] = useState(false);

  const steps = isSchool ? SCHOOL_STEPS : DEFAULT_STEPS;
  const totalSteps = steps.length;

  const handleAuthenticated = async (phoneVal: string, name: string) => {
    setPhone(phoneVal);
    setLeadName(name);
    setAuthed(true);

    // Fetch ALL applications for this phone (any status) so already-submitted
    // / under-review / approved apps load correctly. The submitted-state UI
    // (line ~1081) handles displaying them — without this we'd silently start
    // a fresh draft on top of an existing submitted application.
    const { data: existingApps } = await supabase
      .from("applications")
      .select("*")
      .eq("phone", phoneVal)
      .order("created_at", { ascending: false });

    // Pick apps belonging to this portal. There can be multiple — e.g. a
    // submitted app + a new draft.
    //
    // Three cases:
    //   1) flags includes `portal:${portal.id}` → match
    //   2) flags has NO `portal:*` entry at all → legacy/test/manually-inserted
    //      app from before the flagging logic existed; show it (better to surface
    //      the existing submitted application than silently start a fresh draft
    //      on top of it).
    //   3) flags has a `portal:*` for a DIFFERENT portal → don't match.
    const portalApps = (existingApps || []).filter(app => {
      const flags = (app.flags as string[]) || [];
      if (flags.includes(`portal:${portal.id}`)) return true;
      const hasAnyPortalFlag = flags.some((f: string) => f.startsWith("portal:"));
      return !hasAnyPortalFlag;
    });

    // Self-heal: any matched app whose flags don't yet carry the portal tag
    // gets it added so future visits don't rely on the unflagged-fallback
    // branch above. Fire-and-forget — the dashboard render doesn't depend on
    // this completing. RLS on applications permits anon writes scoped by phone.
    const needsTag = portalApps.filter(a => {
      const f = (a.flags as string[]) || [];
      return !f.includes(`portal:${portal.id}`);
    });
    if (needsTag.length > 0) {
      void Promise.all(needsTag.map(a => {
        const merged = [...((a.flags as string[]) || []), `portal:${portal.id}`];
        return supabase.from("applications").update({ flags: merged }).eq("id", a.id);
      })).catch(e => console.error("portal-flag self-heal failed:", e));
    }

    // When ≥1 non-draft application exists, OR multiple apps exist, show the
    // dashboard so the student can pick what to do (continue, view PDFs,
    // pay token fee, view offer letter, or start a new one).
    const hasNonDraft = portalApps.some(a => a.status !== "draft");
    if (hasNonDraft || portalApps.length > 1) {
      setAppsList(portalApps);
      setHasDashboard(true);
      // Pre-fetch approved offer letters for the leads behind these apps so the
      // dashboard can surface "View Offer Letter" without an extra round-trip.
      const leadIds = [...new Set(portalApps.map((a: any) => a.lead_id).filter(Boolean))];
      if (leadIds.length > 0) {
        const { data: letters } = await supabase
          .from("offer_letters")
          .select("lead_id, letter_url, approval_status, created_at")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false });
        const byLead: Record<string, { letter_url: string | null; approval_status: string }> = {};
        (letters || []).forEach((l: any) => {
          if (!byLead[l.lead_id]) byLead[l.lead_id] = { letter_url: l.letter_url, approval_status: l.approval_status };
        });
        setOfferLetters(byLead);
      }
      setShowCourseSelector(false);
      return;
    }

    // Only one app and it's a draft → load straight into the editor (continue
    // editing, current behaviour).
    const existingApp = portalApps[0];
    if (existingApp) {
      loadAppIntoEditor(existingApp);
    }
  };

  // Load a row from the dashboard into the step-by-step editor.
  const loadAppIntoEditor = (existingApp: any) => {
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
    setAppsList(null); // leave the dashboard
    if (existingApp.status === 'submitted' || existingApp.status === 'under_review' || existingApp.status === 'approved') {
      setSubmitted(true);
      // Fetch uploaded documents for the preview view
      setPreviewDocs([]);
      supabase.functions
        .invoke("list-app-docs", { body: { application_id: existingApp.application_id } })
        .then(({ data }) => setPreviewDocs(((data as any)?.docs || []) as PreviewDoc[]))
        .catch(() => setPreviewDocs([]));
      return;
    }
    const stepKeys = steps.map(s => s.key);
    const cs = appData.completed_sections as Record<string, boolean>;
    const firstIncomplete = stepKeys.findIndex(k => !cs[k]);
    setStep(firstIncomplete >= 0 ? firstIncomplete : totalSteps - 1);
  };

  // Return to the dashboard from a submitted/preview view (only available
  // when the dashboard was previously shown — i.e. multiple apps).
  const backToDashboard = () => {
    setApp(null);
    setSubmitted(false);
    setPreviewDocs([]);
    // Re-fetch the list so newly added/changed apps are reflected.
    handleAuthenticated(phone, leadName);
  };

  // From dashboard → start a fresh new application
  const startNewApplication = () => {
    setAppsList(null);
    setApp(null);
    setSubmitted(false);
    setShowCourseSelector(true);
    setStep(0);
  };

  const handleCourseSelected = async (sessionId: string, selections: CourseSelection[], leadId: string | null) => {
    setSaving(true);

    const primaryCategory = selections[0]?.program_category || 'undergraduate';
    const feeAmount = calculateFee(selections);
    const flags: string[] = [];
    if (feeAmount > 0) flags.push('payment_pending');

    // If app already exists, update instead of insert
    if (app) {
      // Check if courses actually changed
      const oldCourseIds = (app.course_selections || []).map((s: any) => s.course_id).sort().join(",");
      const newCourseIds = selections.map(s => s.course_id).sort().join(",");
      const coursesChanged = oldCourseIds !== newCourseIds;

      // Reset completed_sections when courses change (data stays, but tabs need re-validation)
      const resetSections = coursesChanged
        ? Object.fromEntries(Object.keys(app.completed_sections || {}).map(k => [k, false]))
        : undefined;

      const { error } = await supabase
        .from("applications")
        .update({
          course_selections: selections as any,
          fee_amount: feeAmount,
          program_category: primaryCategory,
          session_id: sessionId,
          ...(resetSections ? { completed_sections: resetSections } : {}),
        })
        .eq("id", app.id);

      if (error) {
        toast({ title: "Failed to update courses", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      setApp(prev => prev ? {
        ...prev,
        course_selections: selections,
        fee_amount: feeAmount,
        program_category: primaryCategory,
        session_id: sessionId,
        ...(resetSections ? { completed_sections: resetSections } : {}),
      } : prev);
      setShowCourseSelector(false);
      setSaving(false);
      toast({
        title: "Course selections updated",
        description: coursesChanged ? "Please review and save each section again." : undefined,
      });
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
    // the authenticated applicant, who has no staff role).
    // Attribution params (gclid, utm_*, _ga client_id, hostname) are captured
    // from cookies + URL so the ga-conversions DB trigger can later fire
    // generate_lead / purchase / admission_confirmed events back to the
    // originating GA4 property via Measurement Protocol. Server-side is the
    // single source of truth — we don't fire these events browser-side because
    // GA has no transaction_id on generate_lead, so dual fires would double-count.
    let resolvedLeadId = leadId;
    const attribution = captureAttribution();
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
        ...attribution,
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

    // Fire both PDF generators so the candidate has branded copies in
    // storage (fire-and-forget). Application form is generated for every
    // submission; fee receipt is generated only when the application fee
    // is already paid (typical flow: pay fee then submit).
    //
    // After PDFs are kicked off, fire the lifecycle notification so the
    // applicant gets WhatsApp confirmation and counsellor / TL / super_admin
    // get the internal email. Brief delay so the form-PDF generator has a
    // chance to populate applications.form_pdf_url before notify-event
    // looks it up — keeps the WA button URL non-empty for most cases.
    supabase.functions.invoke("generate-application-form", {
      body: { application_id: app.application_id },
    }).catch(() => {});
    if (app.payment_status === "paid") {
      supabase.functions.invoke("generate-application-fee-receipt", {
        body: { application_id: app.application_id },
      }).catch(() => {});
    }
    if (app.lead_id) {
      setTimeout(() => {
        supabase.functions.invoke("notify-event", {
          body: {
            event: "app_submitted",
            lead_id: app.lead_id,
            context: { application_id: app.application_id },
          },
        }).catch(() => {});
      }, 4000);
    }
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

  // ── Dashboard ── (multiple apps, or any non-draft → student picks what to do)
  if (appsList) {
    return (
      <ApplicationDashboardView
        apps={appsList}
        leadName={leadName}
        offerLetters={offerLetters}
        openAppId={dashboardOpenAppId}
        setOpenAppId={setDashboardOpenAppId}
        onContinue={loadAppIntoEditor}
        onStartNew={startNewApplication}
        onLogout={handleLogout}
      />
    );
  }

  // ── Submitted (full preview) ──
  if (submitted && app) {
    const submittedBadge = app.status === "approved"
      ? { label: "Approved", className: "bg-green-100 text-green-700" }
      : app.status === "under_review"
      ? { label: "Under Review", className: "bg-blue-100 text-blue-700" }
      : { label: "Submitted", className: "bg-emerald-100 text-emerald-700" };

    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              {hasDashboard && (
                <Button variant="ghost" size="sm" onClick={backToDashboard} className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" /> Back to Dashboard
                </Button>
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-foreground truncate">{app.full_name || "Application"}</h1>
                <p className="text-xs font-mono text-primary">{app.application_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${submittedBadge.className}`}>
                <CheckCircle className="h-3 w-3" />{submittedBadge.label}
              </span>
              {app.payment_status === "paid" && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-700">
                  Paid
                </span>
              )}
              {app.form_pdf_url && (
                <a href={app.form_pdf_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
                  <FileText className="h-3.5 w-3.5" />Application PDF
                </a>
              )}
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5">
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-6 space-y-5">
          {(() => {
            // Banner reflects actual lifecycle state, not just "submitted".
            // Order matters — rejected wins, then approved (paid vs unpaid),
            // then plain submitted (paid vs unpaid).
            const paid = app.payment_status === "paid";
            const status = app.status;
            const rejectionReason = (app as any).rejection_reason as string | undefined;

            if (status === "rejected") {
              return (
                <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-rose-900">Application not accepted.</p>
                    <p className="text-xs text-rose-700 mt-0.5">
                      {rejectionReason || "The admissions team has declined this application. Please contact us for next steps."}
                    </p>
                  </div>
                </div>
              );
            }

            if (status === "approved") {
              return (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">
                      {paid ? "Application approved and fee paid." : "Application approved."}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      {paid
                        ? "An offer letter and next-step instructions will follow shortly. Below is a summary of your application."
                        : "Please complete your application fee payment to proceed. Below is a summary of your application."}
                    </p>
                  </div>
                </div>
              );
            }

            // status === 'submitted' (or anything else past draft)
            return (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">
                    {paid ? "Application submitted and fee paid." : "Your application has been received."}
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {paid
                      ? "Our admissions team is reviewing your application. Below is a summary of what you submitted."
                      : "Our admissions team will review and contact you shortly. Below is a summary of what you submitted."}
                  </p>
                </div>
              </div>
            );
          })()}

          <ApplicationPreview app={app} docs={previewDocs} />
        </main>
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
