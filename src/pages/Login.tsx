import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";

const RazorSense = lazy(() =>
  import("@razorpay/blade/components").then(m => ({ default: (m as any).RazorSense }))
);
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, MessageCircle, Loader2, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput, parsePhone } from "@/components/ui/phone-input";
import { COUNTRIES } from "@/components/apply/countries";
import uniosLogo from "@/assets/unios-logo.png";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";

type LoginMethod = "google" | "email_otp" | "whatsapp_sign_in" | "whatsapp_otp" | "dev_password" | "student_password";
type WhatsAppSignInState = "idle" | "waiting" | "verified" | "expired" | "failed" | "no_account";

const NO_ACCOUNT_PATTERN = /no.+account.+linked/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getErrorMessage = (error: unknown, fallback = "Something went wrong") => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
};

const readFunctionErrorMessage = async (error: unknown) => {
  let msg = getErrorMessage(error);
  const context = isRecord(error) ? error.context : undefined;
  const text = isRecord(context) && typeof context.text === "function"
    ? await (context.text as () => Promise<string>)().catch(() => "")
    : "";

  if (!text) return msg;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed.error === "string") msg = parsed.error;
    else msg = text.slice(0, 200);
  } catch {
    msg = text.slice(0, 200);
  }

  return msg;
};

const isEmailLike = (value: string) => /\S+@\S+\.\S+/.test(value.trim());

const Login = () => {
  const { session, loading, role, roleLoaded } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const forceStudentLogin = searchParams.get("student") === "1";
  const clearedForcedSessionRef = useRef(false);

  useEffect(() => {
    if (forceStudentLogin && session && !clearedForcedSessionRef.current) {
      clearedForcedSessionRef.current = true;
      sessionStorage.removeItem("unios_impersonation");
      supabase.auth.signOut();
      return;
    }
    if (loading || !session || !roleLoaded) return;
    if (role === "student") navigate("/student", { replace: true });
    else if (role === "parent") navigate("/parent", { replace: true });
    else if (role === null) navigate("/my-applications", { replace: true });
    else if (role === "counsellor") navigate("/cloud-dialer", { replace: true });
    else navigate("/", { replace: true });
  }, [session, loading, role, roleLoaded, navigate, forceStudentLogin]);

  const [method, setMethod] = useState<LoginMethod>("whatsapp_sign_in");
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [studentUsername, setStudentUsername] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [waIntentId, setWaIntentId] = useState<string | null>(null);
  const [waClientSecret, setWaClientSecret] = useState<string | null>(null);
  const [waDeepLink, setWaDeepLink] = useState<string | null>(null);
  const [waSignInState, setWaSignInState] = useState<WhatsAppSignInState>("idle");
  const [waExpiresAt, setWaExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (forceStudentLogin) {
      sessionStorage.removeItem("unios_impersonation");
      setMethod("student_password");
    }
  }, [forceStudentLogin]);

  useEffect(() => {
    if (!otpSent || !otpSentAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [otpSent, otpSentAt]);

  const elapsed = otpSentAt ? (now - otpSentAt) / 1000 : 0;
  const otpTimeLeft = Math.max(0, 300 - elapsed);
  const resendCountdown = Math.max(0, 60 - Math.floor(elapsed));
  const isOtpExpired = otpTimeLeft <= 0;
  const canResend = elapsed >= 60;

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const resetWhatsAppSignIn = () => {
    setWaIntentId(null);
    setWaClientSecret(null);
    setWaDeepLink(null);
    setWaSignInState("idle");
    setWaExpiresAt(null);
  };


  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!("PublicKeyCredential" in window)) {
      toast({
        title: "Passkeys unavailable",
        description: "This browser or device does not support passkey sign-in.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      navigate("/");
    } catch (error: unknown) {
      toast({
        title: "Could not sign in with passkey",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setOtpSent(true);
      toast({ title: "Check your email", description: "A magic link has been sent to your email." });
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const pollWhatsAppSignIn = useCallback(async (intentId: string, clientSecret: string) => {
    const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
      body: { action: "status_sign_in", intent_id: intentId, client_secret: clientSecret },
    });
    if (error) {
      throw new Error(await readFunctionErrorMessage(error));
    }
    if (data?.error && !data?.status) throw new Error(data.error);
    return data;
  }, []);

  useEffect(() => {
    if (method !== "whatsapp_sign_in" || waSignInState !== "waiting" || !waIntentId || !waClientSecret) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await pollWhatsAppSignIn(waIntentId, waClientSecret);
        if (cancelled) return;

        if (data?.status === "pending") return;

        if (data?.status === "verified" && data?.token) {
          setWaSignInState("verified");
          const { error: signInError } = await supabase.auth.setSession({
            access_token: data.token.access_token,
            refresh_token: data.token.refresh_token,
          });
          if (signInError) throw signInError;
          navigate("/");
          return;
        }

        if (data?.status === "expired") {
          setWaSignInState("expired");
          toast({ title: "Login request expired", description: "Start again to get a fresh WhatsApp sign-in message.", variant: "destructive" });
          return;
        }

        if (data?.status === "failed") {
          const msg: string = data.error || "No account is linked to that WhatsApp number.";
          if (NO_ACCOUNT_PATTERN.test(msg)) {
            setWaSignInState("no_account");
          } else {
            setWaSignInState("failed");
            toast({ title: "Could not sign in", description: msg, variant: "destructive" });
          }
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setWaSignInState("failed");
          toast({ title: "Could not check login", description: getErrorMessage(error), variant: "destructive" });
        }
      }
    };

    poll();
    const id = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [method, waSignInState, waIntentId, waClientSecret, navigate, toast, pollWhatsAppSignIn]);

  const handleWhatsAppSignIn = async () => {
    resetWhatsAppSignIn();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
        body: { action: "start_sign_in" },
      });
      if (error) {
        throw new Error(await readFunctionErrorMessage(error));
      }
      if (data?.error) throw new Error(data.error);

      setWaIntentId(data.intent_id);
      setWaClientSecret(data.client_secret);
      setWaDeepLink(data.deeplink_url);
      setWaExpiresAt(data.expires_at);
      setWaSignInState("waiting");
      window.open(data.deeplink_url, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      setWaSignInState("failed");
      const message = getErrorMessage(error);
      toast({
        title: "Failed to start WhatsApp sign-in",
        description: message === "Invalid action"
          ? "WhatsApp sign-in backend is not deployed yet. Use WhatsApp OTP for now."
          : message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sendWhatsAppOtp = async () => {
    // Show OTP screen immediately — don't wait for API round-trip
    const ts = Date.now();
    setOtpSentAt(ts);
    setNow(ts);
    setOtpSent(true);
    setOtp("");
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
        body: { action: "send", phone: phone.trim() },
      });
      if (error) {
        throw new Error(await readFunctionErrorMessage(error));
      }
      if (data?.error) throw new Error(data.error);
      const waId = data?.wa_id;
      if (!waId) toast({
        title: "Sent (number not on WhatsApp?)",
        description: `No WhatsApp account found for this number. wamid: ${data?.wamid?.slice(-10) ?? "none"}`,
        variant: "destructive",
      });
    } catch (error: unknown) {
      // Roll back to phone screen on failure
      setOtpSent(false);
      setOtpSentAt(null);
      toast({ title: "Failed to send OTP", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // For +91 the WABA only accepts 10-digit local numbers; reject anything
  // shorter or longer before invoking the OTP function. Same rule per
  // country's `digits` so other ISDs aren't false-positive blocked.
  const phoneDigitCount = (() => {
    const { countryCode, number } = parsePhone(phone);
    const country = COUNTRIES.find(c => c.code === countryCode);
    return { actual: number.replace(/\D/g, "").length, expected: country?.digits ?? 10 };
  })();
  const phoneValid = phoneDigitCount.actual === phoneDigitCount.expected;

  const handleWhatsAppSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneValid) {
      toast({
        title: "Invalid number",
        description: `Enter exactly ${phoneDigitCount.expected} digits for the selected country code.`,
        variant: "destructive",
      });
      return;
    }
    sendWhatsAppOtp();
  };

  const handleWhatsAppVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
        body: { action: "verify", phone: phone.trim(), otp: otp.trim() },
      });
      if (error) {
        throw new Error(await readFunctionErrorMessage(error));
      }
      if (data?.error) throw new Error(data.error);

      // Sign in with the custom token returned by the edge function
      if (data?.token) {
        const { error: signInError } = await supabase.auth.setSession({
          access_token: data.token.access_token,
          refresh_token: data.token.refresh_token,
        });
        if (signInError) throw signInError;
        navigate("/");
      }
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error, "Verification failed"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: devEmail, password: devPassword });
      if (error) throw error;
      navigate("/");
    } catch (error: unknown) {
      toast({ title: "Error", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStudentPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = studentUsername.trim();
    if (!username || !studentPassword) {
      toast({ title: "Enter username and password", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (isEmailLike(username)) {
        sessionStorage.removeItem("unios_impersonation");
        const { error } = await supabase.auth.signInWithPassword({
          email: username,
          password: studentPassword,
        });
        if (error) throw error;
        navigate("/");
        return;
      }

      const { data, error } = await supabase.functions.invoke("student-password-login", {
        body: {
          username,
          password: studentPassword,
        },
      });
      if (error) throw new Error(await readFunctionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      if (!data?.session?.access_token || !data?.session?.refresh_token) {
        throw new Error("Invalid login response");
      }

      sessionStorage.removeItem("unios_impersonation");
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) throw sessionError;
      window.location.assign("/student");
    } catch (error: unknown) {
      toast({ title: "Login failed", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetState = () => {
    setOtpSent(false);
    setOtp("");
    setEmail("");
    setPhone("");
    setStudentUsername("");
    setStudentPassword("");
    setOtpSentAt(null);
    resetWhatsAppSignIn();
  };

  return (
    <div className="min-h-screen flex bg-background animate-fade-in">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center relative overflow-hidden">
        {/* RzpGlass WebGL background — the actual Razorpay fluted glass effect */}
        <Suspense fallback={<div className="absolute inset-0 bg-primary" />}>
          <RazorSense
            preset="default"
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0 }}
            backgroundColor={[0.0, 0.13, 0.49]}
          />
        </Suspense>
        {/* Content overlay */}
        <div className="relative z-10 p-12">
          <div className="absolute top-6 left-6">
            <img src={nimtLogo} alt="NIMT" className="h-8 w-auto brightness-0 invert opacity-80" />
          </div>
          <div className="max-w-md text-center">
            <img src={uniosLogo} alt="UniOs" className="h-32 w-32 mx-auto mb-8 object-contain brightness-0 invert" />
            <h1 className="text-3xl font-bold text-white mb-3">NIMT UniOs</h1>
            <p className="text-white/70 text-base leading-relaxed">
              Multi-campus education management platform. Manage admissions, students, finance, and more — all in one place.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 relative">
        {/* NIMT logo — top right on mobile, hidden on desktop (shown on left panel) */}
        <div className="lg:hidden absolute top-5 right-5">
          <img src={nimtLogo} alt="NIMT" className="h-7 w-auto opacity-60" />
        </div>

        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center gap-2 mb-4">
            <img src={uniosLogo} alt="UniOs" className="h-16 w-16 object-contain" />
            <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">Sign in to UniOs</h2>
            <p className="text-sm text-muted-foreground mt-1">Use your registered WhatsApp number for the fastest access.</p>
          </div>

          {import.meta.env.DEV && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { resetState(); setMethod(method === "dev_password" ? "whatsapp_sign_in" : "dev_password"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-warning" />
                {method === "dev_password" ? "Standard sign in" : "Dev sign in"}
              </button>
            </div>
          )}

          {/* Login method forms — keyed for RazorSense entrance animation */}
          <div key={method + (otpSent ? "-otp" : "")} className="animate-rs-slide-up">

          {/* Dev Password Login (localhost only) */}
          {method === "dev_password" && import.meta.env.DEV && (
            <form onSubmit={handleDevPasswordLogin} className="space-y-4">
              <div className="rounded-xl bg-warning/10 border border-warning/35/20 px-4 py-2 text-xs text-warning-foreground dark:text-warning font-medium">
                Dev mode — not visible in production
              </div>
              <input
                type="email"
                placeholder="Email"
                value={devEmail}
                onChange={e => setDevEmail(e.target.value)}
                className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={devPassword}
                onChange={e => setDevPassword(e.target.value)}
                className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                required
              />
              <button
                type="submit"
                disabled={submitting || !devEmail || !devPassword}
                className="w-full rounded-xl bg-warning py-3 text-sm font-medium text-white hover:bg-warning transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In (Dev)"}
              </button>
            </form>
          )}

          {/* WhatsApp sign-in */}
          {method === "whatsapp_sign_in" && (
            <div className="space-y-4">
              {waSignInState === "no_account" ? (
                <div className="rounded-xl bg-warning/50/5 border border-warning/35/30 p-5">
                  <p className="text-sm font-medium text-foreground">No UniOs account on this WhatsApp number</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Sign-in is for existing students, parents, and staff. New applicants should start an application instead.
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <a
                      href="/apply"
                      className="w-full rounded-xl bg-primary py-2.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Start a new application
                    </a>
                    <button
                      type="button"
                      onClick={handleWhatsAppSignIn}
                      disabled={submitting}
                      className="w-full rounded-xl border border-input py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Try a different WhatsApp number
                    </button>
                  </div>
                </div>
              ) : waSignInState === "waiting" ? (
                <div className="rounded-xl bg-success/50/5 border border-success/35/20 p-5 text-center">
                  <Loader2 className="h-7 w-7 text-success mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-medium text-foreground">Waiting for WhatsApp</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Send the prefilled message from WhatsApp to finish signing in.
                  </p>
                  {waExpiresAt && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Expires at {new Date(waExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleWhatsAppSignIn}
                  disabled={submitting}
                  className="w-full rounded-xl bg-success py-3 text-sm font-medium text-white hover:bg-success/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  Continue with WhatsApp
                </button>
              )}

              <button
                type="button"
                onClick={() => { resetState(); setMethod("whatsapp_otp"); }}
                className="w-full rounded-xl border border-success/40/25 bg-success/5 py-2.5 text-xs font-medium text-success hover:bg-success/10 transition-colors"
              >
                Use WhatsApp OTP instead
              </button>

              <button
                type="button"
                onClick={() => { resetState(); setMethod("student_password"); }}
                className="w-full rounded-xl border border-input bg-card py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Sign in with username and password
              </button>

              {waSignInState === "waiting" && waDeepLink && (
                <a
                  href={waDeepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full rounded-xl border border-input py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Open WhatsApp again
                </a>
              )}

              {(waSignInState === "expired" || waSignInState === "failed") && (
                <button
                  type="button"
                  onClick={handleWhatsAppSignIn}
                  disabled={submitting}
                  className="w-full rounded-xl border border-input py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Try again
                </button>
              )}

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="truncate">Sign in with Gmail</span>
                  <span className="text-xs font-normal text-muted-foreground">Google account</span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={submitting}
                className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="truncate">Sign in with passkey</span>
                  <span className="text-xs font-normal text-muted-foreground">Face ID, fingerprint, or security key</span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            </div>
          )}

          {/* Temporary student username/password login */}
          {method === "student_password" && (
            <form onSubmit={handleStudentPasswordLogin} className="space-y-4">
              <button
                type="button"
                onClick={() => { resetState(); setMethod("whatsapp_sign_in"); }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to WhatsApp sign-in
              </button>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username or email</label>
                <input
                  value={studentUsername}
                  onChange={(e) => setStudentUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
                <input
                  type="password"
                  value={studentPassword}
                  onChange={(e) => setStudentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !studentUsername.trim() || !studentPassword}
                className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Sign in
              </button>
            </form>
          )}

          {/* Google */}
          {method === "google" && (
            <button
              onClick={handleGoogleLogin}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="white" fillOpacity={0.8} />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="white" fillOpacity={0.9} />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="white" fillOpacity={0.7} />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="white" fillOpacity={0.85} />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
          )}

          {/* Email OTP */}
          {method === "email_otp" && (
            otpSent ? (
              <div className="space-y-4 text-center">
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-6">
                  <Mail className="h-8 w-8 text-primary mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Magic link sent!</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Check <strong>{email}</strong> and click the link to sign in.
                  </p>
                </div>
                <button
                  onClick={() => setOtpSent(false)}
                  className="text-xs text-primary hover:underline"
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleEmailOtp} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Magic Link"}
                </button>
              </form>
            )
          )}

          {/* WhatsApp OTP */}
          {method === "whatsapp_otp" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => { resetState(); setMethod("whatsapp_sign_in"); }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Continue with WhatsApp
              </button>
              {otpSent ? (
              <form onSubmit={handleWhatsAppVerifyOtp} className="space-y-4">
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-center">
                  {submitting
                    ? <Loader2 className="h-6 w-6 text-primary mx-auto mb-2 animate-spin" />
                    : <ShieldCheck className="h-6 w-6 text-primary mx-auto mb-2" />}
                  <p className="text-xs text-muted-foreground">
                    {submitting ? "Sending OTP to " : "OTP sent to "}
                    <strong>{phone}</strong> via WhatsApp
                  </p>
                  {!submitting && (
                    <p className={`text-xs font-medium mt-1.5 ${isOtpExpired ? "text-destructive" : "text-muted-foreground"}`}>
                      {isOtpExpired ? "OTP expired — request a new one" : `Expires in ${formatTime(otpTimeLeft)}`}
                    </p>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={isOtpExpired}
                  className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm text-foreground text-center tracking-[0.3em] font-mono placeholder:text-muted-foreground placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  required
                />
                <button
                  type="submit"
                  disabled={submitting || otp.length !== 6 || isOtpExpired}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Sign In"}
                </button>
                <button
                  type="button"
                  onClick={() => sendWhatsAppOtp()}
                  disabled={submitting || !canResend}
                  className="w-full rounded-xl border border-input py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {canResend ? "Resend OTP" : `Resend in ${resendCountdown}s`}
                </button>
                <button
                  type="button"
                  onClick={() => { setOtpSent(false); setOtp(""); setOtpSentAt(null); }}
                  className="w-full text-xs text-primary hover:underline"
                >
                  Use a different number
                </button>
              </form>
            ) : (
              <form onSubmit={handleWhatsAppSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    WhatsApp Number <span className="text-destructive">*</span>
                  </label>
                  <PhoneInput value={phone} onChange={setPhone} required />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Enter your registered mobile number. OTP will be sent via WhatsApp.
                </p>
                <button
                  type="submit"
                  disabled={submitting || !phoneValid}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send WhatsApp OTP"}
                </button>
              </form>
            )}
            </div>
          )}

          </div>{/* end keyed animation wrapper */}

          <p className="text-center text-[11px] text-muted-foreground">
            By signing in, you agree to our{" "}
            <a href="/terms" className="underline hover:text-foreground transition-colors">Terms of Service</a>
            {" "}and{" "}
            <a href="/privacy" className="underline hover:text-foreground transition-colors">Privacy Policy</a>.
          </p>

          <div className="text-center pt-2">
            <a href="/publisher-login" className="text-[11px] text-muted-foreground/70 hover:text-primary transition-colors">
              Publisher Portal →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
