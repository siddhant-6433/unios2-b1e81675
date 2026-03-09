import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns true if the current user is a team leader (their profile id
 * matches any teams.leader_id).
 */
export function useIsTeamLeader() {
  const { user } = useAuth();
  const [isTeamLeader, setIsTeamLeader] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      // Get profile id
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!profile) return;

      const { data: teams } = await supabase
        .from("teams")
        .select("id")
        .eq("leader_id", profile.id)
        .limit(1);

      setIsTeamLeader(!!teams && teams.length > 0);
    })();
  }, [user?.id]);

  return isTeamLeader;
}
