import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const DISMISS_PREFIX = "passkey_setup_prompt_dismissed_v1";

export function PasskeySetupBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user?.id || !("PublicKeyCredential" in window)) {
      setVisible(false);
      return;
    }

    const dismissKey = `${DISMISS_PREFIX}_${user.id}`;
    if (window.localStorage.getItem(dismissKey) === "1") {
      setVisible(false);
      return;
    }

    let cancelled = false;
    async function loadPasskeys() {
      const { data, error } = await supabase.auth.passkey.list();
      if (cancelled) return;
      setVisible(!error && (data || []).length === 0);
    }

    loadPasskeys();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!user?.id || !visible || location.pathname === "/settings") return null;

  const dismiss = () => {
    window.localStorage.setItem(`${DISMISS_PREFIX}_${user.id}`, "1");
    setVisible(false);
  };

  const openSettings = () => {
    navigate("/settings?tab=account");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950 sm:px-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
        <KeyRound className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="font-semibold">New: passkey sign-in is available.</span>
        <span className="ml-1 text-blue-900/80">Add Face ID, fingerprint, device PIN, or a security key for faster login.</span>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={openSettings}
        className="h-7 gap-1.5 bg-blue-700 px-2.5 text-xs text-white hover:bg-blue-800"
      >
        Set up passkey
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-blue-800/60 transition-colors hover:bg-blue-100 hover:text-blue-950"
        aria-label="Dismiss passkey setup prompt"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
