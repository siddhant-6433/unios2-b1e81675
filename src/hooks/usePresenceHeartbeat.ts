import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const INTERVAL_MS = 60_000;

export function usePresenceHeartbeat() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const ping = () => {
      supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() } as any)
        .eq("user_id", user.id)
        .then(() => {});
    };

    ping();
    const id = setInterval(ping, INTERVAL_MS);
    return () => clearInterval(id);
  }, [user?.id]);
}

// Mount once under AuthProvider so EVERY logged-in user heartbeats — staff
// (AppLayout), portal students/parents (PortalLayout), and the partner/consultant
// portals that use neither. No-op until a user is present. Renders nothing.
export function PresenceHeartbeat() {
  usePresenceHeartbeat();
  return null;
}
