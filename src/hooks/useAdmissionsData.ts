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

export interface AdmissionsStats {
  new_leads: number;
  today_leads: number;
  app_started: number;
  app_submitted: number;
  admitted: number;
  fee_paid: number;
  offer_sent: number;
  token_paid: number;
  pre_admitted: number;
  pending_followups: number;
  today_followups: number;
  overdue_followups: number;
  upcoming_visits: number;
  completed_visits: number;
  post_visit_pending_lead_ids: string[];
}

/**
 * Cached wrapper around the admissions_stats RPC. Survives Admissions →
 * LeadDetail → Admissions navigation without a DB round trip.
 */
export function useAdmissionsStats(opts: {
  counsellorId: string | null;
  campusId: string | null;
}) {
  const { counsellorId, campusId } = opts;
  return useQuery<AdmissionsStats>({
    queryKey: ["admissions-stats", counsellorId, campusId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admissions_stats" as any, {
        p_counsellor_id: counsellorId,
        p_campus_id: campusId,
      });
      if (error) throw error;
      return (data || {}) as AdmissionsStats;
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
