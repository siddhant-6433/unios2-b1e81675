import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, MessageCircle, Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import uniosLogo from "@/assets/unios-logo.png";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";

type LoginMethod = "google" | "email_otp" | "whatsapp_otp" | "dev_password";

const Login = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && session) {
      navigate("/", { replace: true });
    }
  }, [session, loading, navigate]);

  const [method, setMethod] = useState<LoginMethod>(import.meta.env.DEV ? "dev_password" : "google");
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

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


  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
        let msg = error.message;
        try { const text = await (error as any)?.context?.text?.(); if (text) { try { msg = JSON.parse(text)?.error || msg; } catch { msg = text.slice(0, 200); } } } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      const waId = data?.wa_id;
      if (!waId) toast({
        title: "Sent (number not on WhatsApp?)",
        description: `No WhatsApp account found for this number. wamid: ${data?.wamid?.slice(-10) ?? "none"}`,
        variant: "destructive",
      });
    } catch (error: any) {
      // Roll back to phone screen on failure
      setOtpSent(false);
      setOtpSentAt(null);
      toast({ title: "Failed to send OTP", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWhatsAppSendOtp = (e: React.FormEvent) => { e.preventDefault(); if (phone.trim()) sendWhatsAppOtp(); };

  const handleWhatsAppVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-otp", {
        body: { action: "verify", phone: phone.trim(), otp: otp.trim() },
      });
      if (error) {
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const body = await ctx.json(); throw new Error(body?.error || error.message); } catch (e: any) { if (e.message) throw e; }
        }
        throw error;
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Verification failed", variant: "destructive" });
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
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetState = () => {
    setOtpSent(false);
    setOtp("");
    setEmail("");
    setPhone("");
    setOtpSentAt(null);
  };

  const methods: { key: LoginMethod; label: string; icon: React.ReactNode }[] = [
    ...(import.meta.env.DEV ? [{
      key: "dev_password" as LoginMethod,
      label: "Dev",
      icon: <ShieldCheck className="h-4 w-4 text-orange-500" />,
    }] : []),
    {
      key: "google",
      label: "Google",
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      ),
    },
    { key: "email_otp", label: "Email OTP", icon: <Mail className="h-4 w-4" /> },
    { key: "whatsapp_otp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary items-center justify-center p-12 relative">
        {/* NIMT logo — top left */}
        <div className="absolute top-6 left-6">
          <img src={nimtLogo} alt="NIMT" className="h-8 w-auto brightness-0 invert opacity-80" />
        </div>
        <div className="max-w-md text-center">
          <img src={uniosLogo} alt="UniOs" className="h-32 w-32 mx-auto mb-8 object-contain brightness-0 invert" />
          <h1 className="text-3xl font-bold text-primary-foreground mb-3">NIMT UniOs</h1>
          <p className="text-primary-foreground/70 text-base leading-relaxed">
            Multi-campus education management platform. Manage admissions, students, finance, and more — all in one place.
          </p>
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
            <h2 className="text-xl font-bold text-foreground">Welcome Back</h2>
            <p className="text-sm text-muted-foreground mt-1">Choose how you'd like to sign in.</p>
          </div>

          {/* Method selector */}
          <div className="flex rounded-xl bg-muted p-1 gap-1">
            {methods.map((m) => (
              <button
                key={m.key}
                onClick={() => { setMethod(m.key); resetState(); }}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-medium transition-colors ${
                  method === m.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {/* Dev Password Login (localhost only) */}
          {method === "dev_password" && import.meta.env.DEV && (
            <form onSubmit={handleDevPasswordLogin} className="space-y-4">
              <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 px-4 py-2 text-xs text-orange-700 dark:text-orange-400 font-medium">
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
                className="w-full rounded-xl bg-orange-500 py-3 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In (Dev)"}
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
            otpSent ? (
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
                  disabled={submitting || !phone.trim()}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send WhatsApp OTP"}
                </button>
              </form>
            )
          )}

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
