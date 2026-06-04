import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ActionLead {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_name: string;
  campus_name: string;
  counsellor_id: string | null;
  counsellor_name: string | null;
  // Bucket-specific context
  days_overdue?: number;
  assigned_ago?: string;
  scheduled_at?: string;
  followup_type?: string;
  visit_date?: string;
  visit_campus?: string;
  days_since_visit?: number;
  days_inactive?: number;
  app_completion_pct?: number | null;
  visit_id?: string;
}

export interface ActionCenterData {
  overdueFollowups: ActionLead[];
  newLeads: ActionLead[];
  todayFollowups: ActionLead[];
  todayVisits: ActionLead[];
  postVisitPending: ActionLead[];
  stalledApps: ActionLead[];
  upcomingWeek: ActionLead[];
}

const EMPTY: ActionCenterData = {
  overdueFollowups: [],
  newLeads: [],
  todayFollowups: [],
  todayVisits: [],
  postVisitPending: [],
  stalledApps: [],
  upcomingWeek: [],
};

const normalizePayload = (payload: Partial<ActionCenterData> | null | undefined): ActionCenterData => ({
  overdueFollowups: payload?.overdueFollowups ?? [],
  newLeads: payload?.newLeads ?? [],
  todayFollowups: payload?.todayFollowups ?? [],
  todayVisits: payload?.todayVisits ?? [],
  postVisitPending: payload?.postVisitPending ?? [],
  stalledApps: payload?.stalledApps ?? [],
  upcomingWeek: payload?.upcomingWeek ?? [],
});

export function useActionCenter(counsellorFilterId?: string) {
  const { role, profile } = useAuth();
  const [data, setData] = useState<ActionCenterData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine which counsellor to scope to
  const isCounsellor = role === "counsellor";
  const scopedCounsellorId = isCounsellor ? profile?.id : counsellorFilterId;

  const fetchAll = useCallback(async (showLoading = true) => {
    if (isCounsellor && !profile?.id) {
      setData(EMPTY);
      setLoading(false);
      return;
    }

    if (showLoading) setLoading(true);

    try {
      const { data: payload, error } = await (supabase as any).rpc("action_center_payload", {
        p_counsellor_id: scopedCounsellorId ?? null,
      });

      if (error) throw error;
      setData(normalizePayload(payload as Partial<ActionCenterData>));
    } catch (err) {
      console.error("Action center fetch error:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [profile?.id, isCounsellor, scopedCounsellorId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Real-time refresh on key table changes. Debounce to avoid turning write
  // bursts into repeated full-page payload refreshes.
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => fetchAll(false), 600);
    };

    const channel = supabase
      .channel("action-center-realtime")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "lead_followups" }, scheduleRefresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "campus_visits" }, scheduleRefresh)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "leads" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  return { data, loading, refetch: () => fetchAll() };
}
