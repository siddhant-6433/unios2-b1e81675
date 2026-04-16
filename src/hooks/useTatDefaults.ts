import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TatDefaults {
  profile_id: string;
  user_id: string;
  counsellor_name: string;
  new_leads_overdue: number;
  overdue_followups: number;
  app_checkins_overdue: number;
  total_defaults: number;
}

/**
 * Hook to fetch TAT defaults for the current user (if counsellor)
 * or all counsellors (if admin/team leader).
 */
export function useTatDefaults() {
  const { user, role } = useAuth();
  const [myDefaults, setMyDefaults] = useState<TatDefaults | null>(null);
  const [allDefaults, setAllDefaults] = useState<TatDefaults[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("counsellor_tat_defaults" as any)
        .select("*");

      const all = (data || []) as TatDefaults[];
      setAllDefaults(all);

      // Find current user's defaults
      const mine = all.find(d => d.user_id === user.id);
      setMyDefaults(mine || null);

      setLoading(false);
    })();
  }, [user?.id]);

  const totalTeamDefaults = allDefaults.reduce((s, d) => s + d.total_defaults, 0);
  const counsellorsWithDefaults = allDefaults.filter(d => d.total_defaults > 0);

  return { myDefaults, allDefaults, counsellorsWithDefaults, totalTeamDefaults, loading };
}
