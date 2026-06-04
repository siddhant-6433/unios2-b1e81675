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

type TatDefaultsPayload = {
  profile_id?: string | null;
  user_id?: string | null;
  counsellor_name?: string | null;
  new_leads_overdue?: number | string | null;
  overdue_followups?: number | string | null;
  app_checkins_overdue?: number | string | null;
  total_defaults?: number | string | null;
};

type UntypedSupabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: TatDefaultsPayload | null }>;
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: TatDefaults[] | null }>;
  };
};

/**
 * Hook to fetch TAT defaults for the current user (if counsellor)
 * or all counsellors (if admin/team leader).
 */
export function useTatDefaults() {
  const { user, role, profile } = useAuth();
  const profileId = profile?.id;
  const profileName = profile?.display_name;
  const [myDefaults, setMyDefaults] = useState<TatDefaults | null>(null);
  const [allDefaults, setAllDefaults] = useState<TatDefaults[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    if (role === "counsellor" && !profileId) return;

    (async () => {
      setLoading(true);
      if (role === "counsellor") {
        const { data } = await (supabase as unknown as UntypedSupabase).rpc("my_tat_defaults", {
          p_scope_counsellor_id: profileId,
        });

        const mine: TatDefaults = {
          profile_id: data?.profile_id || profileId!,
          user_id: data?.user_id || user.id,
          counsellor_name: data?.counsellor_name || profileName || "You",
          new_leads_overdue: Number(data?.new_leads_overdue || 0),
          overdue_followups: Number(data?.overdue_followups || 0),
          app_checkins_overdue: Number(data?.app_checkins_overdue || 0),
          total_defaults: Number(data?.total_defaults || 0),
        };

        setMyDefaults(mine);
        setAllDefaults([mine]);
        setLoading(false);
        return;
      }

      const { data } = await (supabase as unknown as UntypedSupabase)
        .from("counsellor_tat_defaults")
        .select("*");

      const all = (data || []) as TatDefaults[];
      setAllDefaults(all);

      // Find current user's defaults
      const mine = all.find(d => d.user_id === user.id);
      setMyDefaults(mine || null);

      setLoading(false);
    })();
  }, [user?.id, role, profileId, profileName]);

  const totalTeamDefaults = allDefaults.reduce((s, d) => s + d.total_defaults, 0);
  const counsellorsWithDefaults = allDefaults.filter(d => d.total_defaults > 0);

  return { myDefaults, allDefaults, counsellorsWithDefaults, totalTeamDefaults, loading };
}
