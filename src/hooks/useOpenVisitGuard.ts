// While one of my leads is checked in on campus (and not checked out), I
// shouldn't be browsing OTHER leads — redirect to the Visit Center to check
// the visitor out first. The checked-in lead itself stays fully accessible
// (that's where payment links / fee proposals happen). Admin roles exempt.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const EXEMPT_ROLES = ["super_admin", "admission_head", "campus_admin", "accountant"];

export function useOpenVisitGuard(currentLeadId: string | undefined) {
  const navigate = useNavigate();
  const { user, role } = useAuth();

  useEffect(() => {
    if (!currentLeadId || !user?.id) return;
    if (role && EXEMPT_ROLES.includes(role)) return;

    let cancelled = false;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!prof || cancelled) return;

      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data: open } = await (supabase.from("campus_visits") as any)
        .select("lead_id, leads!inner(counsellor_id)")
        .eq("leads.counsellor_id", prof.id)
        .gte("checked_in_at", start.toISOString())
        .is("checked_out_at", null)
        .limit(10);
      if (cancelled || !open || open.length === 0) return;

      const checkedInLeadIds = new Set((open as { lead_id: string }[]).map(v => v.lead_id));
      if (!checkedInLeadIds.has(currentLeadId)) {
        toast.warning("You have a visitor on campus — check them out first.");
        navigate("/visit-center", { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [currentLeadId, user?.id, role, navigate]);
}
