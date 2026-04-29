import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Lock, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import uniosLogo from "@/assets/unios-logo.png";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";

const PublisherLogin = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      navigate("/publisher-portal", { replace: true });
    }
  }, [session, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (error) throw error;
      navigate("/publisher-portal", { replace: true });
    } catch (error: any) {
      toast({ title: "Login Failed", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-600 to-violet-700 items-center justify-center p-12 relative">
        <div className="absolute top-6 left-6">
          <img src={nimtLogo} alt="NIMT" className="h-8 w-auto brightness-0 invert opacity-80" />
        </div>
        <div className="max-w-md text-center">
          <img src={uniosLogo} alt="UniOs" className="h-32 w-32 mx-auto mb-8 object-contain brightness-0 invert" />
          <h1 className="text-3xl font-bold text-white mb-3">Publisher Portal</h1>
          <p className="text-white/70 text-base leading-relaxed">
            Track your lead submissions, monitor conversion status, and manage your partnership with NIMT Educational Institutions.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-white/80">
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-2xl font-bold text-white">36+</p>
              <p className="text-xs mt-1">Programmes</p>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-2xl font-bold text-white">5</p>
              <p className="text-xs mt-1">Campuses</p>
            </div>
            <div className="rounded-xl bg-white/10 p-4">
              <p className="text-2xl font-bold text-white">37+</p>
              <p className="text-xs mt-1">Years</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 relative">
        <div className="lg:hidden absolute top-5 right-5">
          <img src={nimtLogo} alt="NIMT" className="h-7 w-auto opacity-60" />
        </div>

        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center gap-2 mb-4">
            <img src={uniosLogo} alt="UniOs" className="h-16 w-16 object-contain" />
            <span className="text-lg font-bold text-foreground">Publisher Portal</span>
          </div>

          <div>
            <h2 className="text-xl font-bold text-foreground">Publisher Login</h2>
            <p className="text-sm text-muted-foreground mt-1">Sign in with your publisher credentials.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password.trim()}
              className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
            </button>
          </form>

          <p className="text-center text-[11px] text-muted-foreground">
            This portal is for authorized lead publishers only.
            <br />
            Contact <a href="mailto:admissions@nimt.ac.in" className="text-indigo-600 hover:underline">admissions@nimt.ac.in</a> for access.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PublisherLogin;
