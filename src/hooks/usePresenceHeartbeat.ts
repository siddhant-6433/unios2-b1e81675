import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const INTERVAL_MS = 5 * 60_000;
const MIN_PING_GAP_MS = 60_000;

export function usePresenceHeartbeat() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    let lastPingAt = 0;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastPingAt < MIN_PING_GAP_MS) return;
      lastPingAt = now;
      supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() } as any)
        .eq("user_id", user.id)
        .then(() => {});
    };

    ping();
    const id = setInterval(ping, INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [user?.id]);
}

// Mount once under AuthProvider so EVERY logged-in user heartbeats — staff
// (AppLayout), portal students/parents (PortalLayout), and the partner/consultant
// portals that use neither. No-op until a user is present. Renders nothing.
export function PresenceHeartbeat() {
  usePresenceHeartbeat();
  return null;
}
