import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/contexts/AuthContext";
import { GraduationCap, Mail, Lock, Eye, EyeOff, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Login = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) {
      navigate("/", { replace: true });
    }
  }, [session, loading, navigate]);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (forgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({ title: "Check your email", description: "Password reset link sent to your email." });
        setForgotPassword(false);
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast({ title: "Account created!", description: "Check your email to confirm your account." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary items-center justify-center p-12">
        <div className="max-w-md text-center">
          <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-2xl bg-primary-foreground/10 mb-8">
            <GraduationCap className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-primary-foreground mb-3">NIMT UniOs</h1>
          <p className="text-primary-foreground/70 text-base leading-relaxed">
            Multi-campus education management platform. Manage admissions, students, finance, and more — all in one place.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 justify-center mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">
              {forgotPassword ? "Reset Password" : isSignUp ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {forgotPassword
                ? "Enter your email to receive a reset link."
                : isSignUp
                ? "Sign up to get started."
                : "Sign in to your account."}
            </p>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && !forgotPassword && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                />
              </div>
            )}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                required
              />
            </div>
            {!forgotPassword && (
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                  minLength={6}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}

            {!isSignUp && !forgotPassword && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setForgotPassword(true)} className="text-xs text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Please wait..." : forgotPassword ? "Send Reset Link" : isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          {!forgotPassword && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-3 text-muted-foreground">or continue with</span>
                </div>
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-input bg-card py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Sign in with Google
              </button>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            {forgotPassword ? (
              <button onClick={() => setForgotPassword(false)} className="text-primary hover:underline">
                ← Back to sign in
              </button>
            ) : isSignUp ? (
              <>Already have an account?{" "}<button onClick={() => setIsSignUp(false)} className="text-primary hover:underline">Sign in</button></>
            ) : (
              <>Don't have an account?{" "}<button onClick={() => setIsSignUp(true)} className="text-primary hover:underline">Sign up</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
