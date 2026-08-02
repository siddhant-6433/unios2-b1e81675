import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cached profile.id lookup for the current auth user.
 * Used by ~15 sites in the codebase that each refetch the same row on every mount.
 * Profile rarely changes, so we cache for 10 min.
 */
export function useMyProfileId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-profile-id", user?.id ?? null],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
  });
}

export interface AdmissionsFollowupCounts {
  pending: number;
  overdue: number;
  today: number;
  upcoming: number;
}

export interface AdmissionsOverviewPayload {
  stage_counts: Record<string, number>;
  new_lead_assignment_counts: {
    assigned: number;
    unassigned: number;
    unassigned_ai_called: number;
    unassigned_not_ai_called: number;
  };
  interested_lead_ids: string[];
  visit_action_counts: {
    missedCallbacks: number;
    overdueFollowups: number;
    scheduled: number;
    scheduledToday: number;
    scheduledThisWeek: number;
    checkinPending: number;
    visitsCompleted: number;
    visitsCompletedPendingFollowup: number;
  };
  visit_funnel_counts: {
    scheduled: number;
    confirmed: number;
    completed: number;
    visit_followup: number;
    applied: number;
    admitted: number;
  };
  visit_funnel_leakage: number;
  visit_funnel_box_ids: Record<string, string[]>;
}

/**
 * Counts for the Admissions follow-up alert/card. Uses the same RPC as the
 * destination page so the dashboard numbers match the Today/Overdue tabs.
 */
export function useAdmissionsFollowupCounts(opts: {
  counsellorId: string | null;
  enabled?: boolean;
}) {
  const { counsellorId, enabled = true } = opts;
  return useQuery<AdmissionsFollowupCounts>({
    queryKey: ["admissions-followup-counts", counsellorId],
    enabled,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pending_followups_payload" as any, {
        p_tab: "overdue",
        p_scope_counsellor_id: counsellorId,
        p_scope_unassigned: false,
        p_page: 0,
        p_page_size: 1,
      });
      if (error) throw error;

      const counts = ((data as any)?.counts ?? {}) as Record<string, unknown>;
      const overdue = Number(counts.overdue ?? 0);
      const today = Number(counts.today ?? 0);
      const upcoming = Number(counts.upcoming ?? 0);

      return {
        pending: overdue + today + upcoming,
        overdue,
        today,
        upcoming,
      };
    },
  });
}

/**
 * Collapsed admissions dashboard payload. Replaces the old mix of stage-count,
 * call-log, visit-count, and visit-funnel queries with a single RLS-safe RPC.
 */
export function useAdmissionsOverview(opts: {
  counsellorId: string | null;
  campusId: string | null;
}) {
  const { counsellorId, campusId } = opts;
  return useQuery<AdmissionsOverviewPayload>({
    queryKey: ["admissions-overview", counsellorId, campusId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admissions_overview" as any, {
        p_counsellor_id: counsellorId,
        p_campus_id: campusId,
      });
      if (error) throw error;
      return (data || {
        stage_counts: {},
        new_lead_assignment_counts: {
          assigned: 0,
          unassigned: 0,
          unassigned_ai_called: 0,
          unassigned_not_ai_called: 0,
        },
        interested_lead_ids: [],
        visit_action_counts: {
          missedCallbacks: 0,
          overdueFollowups: 0,
          scheduled: 0,
          scheduledToday: 0,
          scheduledThisWeek: 0,
          checkinPending: 0,
          visitsCompleted: 0,
          visitsCompletedPendingFollowup: 0,
        },
        visit_funnel_counts: {
          scheduled: 0,
          confirmed: 0,
          completed: 0,
          visit_followup: 0,
          applied: 0,
          admitted: 0,
        },
        visit_funnel_leakage: 0,
        visit_funnel_box_ids: {},
      }) as AdmissionsOverviewPayload;
    },
  });
}

export interface CloudDialerQueueLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_id: string | null;
  course_name: string;
  course_fee_per_year: number | null;
  campus_name: string;
  bucket: string;
  bucket_priority: number;
  attempt_count: number;
}

export interface CloudDialerBucket {
  bucket_priority: number;
  label: string;
  count: number;
}

export interface CloudDialerQueuePayload {
  queue: CloudDialerQueueLead[];
  buckets: CloudDialerBucket[];
}

export interface CloudDialerBootstrapPayload {
  counsellor_identity: {
    display_name: string;
    phone: string | null;
  };
  most_used_templates: {
    key: string;
    label: string;
  }[];
  source_sla_hours: Record<string, number>;
  course_options: {
    id: string;
    name: string;
    campus: string;
  }[];
}

/**
 * Cached list of all active campuses. Reference data — changes rarely.
 * Used by transfer/edit dialogs across many pages.
 */
export function useCampuses() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["ref:campuses"],
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campuses")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

/**
 * Cached list of all courses. Reference data — changes rarely.
 */
export function useCourses() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["ref:courses"],
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

export interface LeadDetailPayload {
  lead: any | null;
  notes: any[];
  followups: any[];
  visits: any[];
  activities: any[];
  call_logs: any[];
}

/**
 * Single-RPC fetch for a lead's detail page.
 * Replaces 6 parallel client queries (lead + notes + followups + visits +
 * activities + call_logs) with one round trip and one RLS evaluation pass.
 */
export function useLeadDetail(leadId: string | undefined | null) {
  return useQuery<LeadDetailPayload>({
    queryKey: ["lead-detail", leadId ?? null],
    enabled: !!leadId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lead_detail" as any, {
        p_lead_id: leadId,
      });
      if (error) throw error;
      const p: any = data || {};
      return {
        lead: p.lead ?? null,
        notes: Array.isArray(p.notes) ? p.notes : [],
        followups: Array.isArray(p.followups) ? p.followups : [],
        visits: Array.isArray(p.visits) ? p.visits : [],
        activities: Array.isArray(p.activities) ? p.activities : [],
        call_logs: Array.isArray(p.call_logs) ? p.call_logs : [],
      };
    },
  });
}

/**
 * Cached wrapper around cloud_dialer_queue RPC. Queue freshness matters more
 * here than for stats — a 15s staleTime + manual refetch on action covers
 * the common cases without spamming the DB on every CloudDialer mount.
 */
export function useCloudDialerQueue(opts: {
  counsellorId: string | null;
  maxPerBucket?: number;
  enabled?: boolean;
}) {
  const { counsellorId, maxPerBucket = 100, enabled = true } = opts;
  return useQuery<CloudDialerQueuePayload>({
    queryKey: ["cloud-dialer-queue", counsellorId, maxPerBucket],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cloud_dialer_queue" as any, {
        p_counsellor_id: counsellorId,
        p_max_per_bucket: maxPerBucket,
      });
      if (error) throw error;
      return (data || { queue: [], buckets: [] }) as CloudDialerQueuePayload;
    },
  });
}

export function useCloudDialerListQueue(opts: {
  counsellorId: string | null;
  mode: "fresh" | "all";
  limit?: number;
  enabled?: boolean;
}) {
  const { counsellorId, mode, limit = 100, enabled = true } = opts;
  return useQuery<CloudDialerQueuePayload>({
    queryKey: ["cloud-dialer-list-queue", counsellorId, mode, limit],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cloud_dialer_list_queue" as any, {
        p_counsellor_id: counsellorId,
        p_mode: mode,
        p_limit: limit,
      });
      if (error) throw error;
      return (data || { queue: [], buckets: [] }) as CloudDialerQueuePayload;
    },
  });
}

/**
 * A call list assigned by a principal / admission head / team leader, rendered
 * as a start-to-finish dialer queue. Same payload shape as the smart queue, so
 * CloudDialer's existing parser handles it unchanged.
 */
export function useCloudDialerCampaignQueue(opts: {
  listId: string | null;
  counsellorId: string | null;
  limit?: number;
  enabled?: boolean;
}) {
  const { listId, counsellorId, limit = 500, enabled = true } = opts;
  return useQuery<CloudDialerQueuePayload>({
    queryKey: ["cloud-dialer-campaign-queue", listId, counsellorId, limit],
    enabled: enabled && !!listId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cloud_dialer_campaign_queue" as any, {
        p_list_id: listId,
        p_counsellor_id: counsellorId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data || { queue: [], buckets: [] }) as CloudDialerQueuePayload;
    },
  });
}

export interface MyCallList {
  id: string;
  name: string;
  priority_note: string | null;
  due_date: string | null;
  total: number;
  pending: number;
  worked: number;
  skipped: number;
  last_worked_at: string | null;
}

/** Call lists assigned to me (all active call lists, for admins/team leaders). */
export function useMyCallLists(opts?: { enabled?: boolean }) {
  const { user } = useAuth();
  const enabled = opts?.enabled ?? true;
  return useQuery<MyCallList[]>({
    queryKey: ["my-call-lists", user?.id ?? null],
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_call_lists" as any);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as MyCallList[];
    },
  });
}

export function useCloudDialerBootstrap(opts?: { enabled?: boolean }) {
  const { user } = useAuth();
  const enabled = opts?.enabled ?? true;
  return useQuery<CloudDialerBootstrapPayload>({
    queryKey: ["cloud-dialer-bootstrap", user?.id ?? null],
    enabled: enabled && !!user?.id,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cloud_dialer_bootstrap" as any);
      if (error) throw error;
      return (data || {
        counsellor_identity: { display_name: "the admissions team", phone: null },
        most_used_templates: [],
        source_sla_hours: {},
        course_options: [],
      }) as CloudDialerBootstrapPayload;
    },
  });
}
