import { useState, useEffect, useCallback } from "react";
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function useActionCenter(counsellorFilterId?: string) {
  const { role, profile } = useAuth();
  const [data, setData] = useState<ActionCenterData>(EMPTY);
  const [loading, setLoading] = useState(true);

  // Determine which counsellor to scope to
  const isCounsellor = role === "counsellor";
  const scopedCounsellorId = isCounsellor ? profile?.id : counsellorFilterId;

  const fetchAll = useCallback(async () => {
    if (isCounsellor && !profile?.id) return;
    setLoading(true);

    const now = new Date();
    const todayStart = now.toISOString().slice(0, 10);
    const todayEnd = todayStart + "T23:59:59";

    // Calculate end of week (Sunday)
    const dayOfWeek = now.getDay(); // 0=Sun
    const daysUntilSunday = dayOfWeek === 0 ? 6 : 7 - dayOfWeek;
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + daysUntilSunday);
    const weekEndStr = weekEnd.toISOString().slice(0, 10) + "T23:59:59";

    // Tomorrow start for "upcoming" (exclude today)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = tomorrow.toISOString().slice(0, 10);

    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = threeDaysAgo.toISOString();

    try {
      // Build all 7 queries
      // 1. Overdue followups
      let q1 = supabase
        .from("overdue_followups" as any)
        .select("*")
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q1 = q1.eq("counsellor_id", scopedCounsellorId);

      // 2. New leads (no first contact)
      let q2 = supabase
        .from("leads")
        .select("id, name, phone, stage, source, counsellor_id, created_at, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
        .eq("stage", "new_lead")
        .is("first_contact_at", null)
        .order("created_at", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q2 = q2.eq("counsellor_id", scopedCounsellorId);

      // 3. Today's followups
      let q3 = supabase
        .from("lead_followups")
        .select("id, lead_id, scheduled_at, type, leads!inner(id, name, phone, stage, source, counsellor_id, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name))")
        .eq("status", "pending")
        .gte("scheduled_at", todayStart)
        .lte("scheduled_at", todayEnd)
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q3 = q3.eq("leads.counsellor_id", scopedCounsellorId);

      // 4. Today's visits
      let q4 = supabase
        .from("campus_visits")
        .select("id, lead_id, visit_date, status, campus_id, leads!inner(id, name, phone, stage, source, counsellor_id, profiles:counsellor_id(display_name), courses:course_id(name)), campuses:campus_id(name)")
        .gte("visit_date", todayStart)
        .lte("visit_date", todayEnd)
        .in("status", ["scheduled", "confirmed"])
        .order("visit_date", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q4 = q4.eq("leads.counsellor_id", scopedCounsellorId);

      // 5. Post-visit pending
      let q5 = supabase
        .from("post_visit_pending_followups" as any)
        .select("*")
        .order("visit_date", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q5 = q5.eq("counsellor_id", scopedCounsellorId);

      // 6. Stalled apps (application stages, no activity in 3+ days)
      const appStages = ["application_in_progress", "application_fee_paid", "application_submitted"];
      let q6 = supabase
        .from("leads")
        .select("id, name, phone, stage, source, counsellor_id, updated_at, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
        .in("stage", appStages)
        .lt("updated_at", threeDaysAgoStr)
        .order("updated_at", { ascending: true })
        .limit(50);
      if (scopedCounsellorId) q6 = q6.eq("counsellor_id", scopedCounsellorId);

      // 7a. Upcoming followups (rest of week, after today)
      let q7a = supabase
        .from("lead_followups")
        .select("id, lead_id, scheduled_at, type, leads!inner(id, name, phone, stage, source, counsellor_id, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name))")
        .eq("status", "pending")
        .gte("scheduled_at", tomorrowStart)
        .lte("scheduled_at", weekEndStr)
        .order("scheduled_at", { ascending: true })
        .limit(30);
      if (scopedCounsellorId) q7a = q7a.eq("leads.counsellor_id", scopedCounsellorId);

      // 7b. Upcoming visits (rest of week, after today)
      let q7b = supabase
        .from("campus_visits")
        .select("id, lead_id, visit_date, status, campus_id, leads!inner(id, name, phone, stage, source, counsellor_id, courses:course_id(name), profiles:counsellor_id(display_name)), campuses:campus_id(name)")
        .gte("visit_date", tomorrowStart)
        .lte("visit_date", weekEndStr)
        .in("status", ["scheduled", "confirmed"])
        .order("visit_date", { ascending: true })
        .limit(30);
      if (scopedCounsellorId) q7b = q7b.eq("leads.counsellor_id", scopedCounsellorId);

      const [r1, r2, r3, r4, r5, r6, r7a, r7b] = await Promise.all([q1, q2, q3, q4, q5, q6, q7a, q7b]);

      // Transform results into ActionLead[]
      const overdueFollowups: ActionLead[] = (r1.data || []).map((r: any) => ({
        id: r.id,
        lead_id: r.lead_id,
        name: r.lead_name,
        phone: r.lead_phone,
        stage: r.lead_stage,
        source: "",
        course_name: "",
        campus_name: "",
        counsellor_id: r.counsellor_id,
        counsellor_name: null,
        days_overdue: r.days_overdue,
        followup_type: r.type,
        scheduled_at: r.scheduled_at,
      }));

      const newLeads: ActionLead[] = (r2.data || []).map((r: any) => ({
        id: r.id,
        lead_id: r.id,
        name: r.name,
        phone: r.phone,
        stage: r.stage,
        source: r.source,
        course_name: r.courses?.name || "—",
        campus_name: r.campuses?.name || "—",
        counsellor_id: r.counsellor_id,
        counsellor_name: r.profiles?.display_name || null,
        assigned_ago: timeAgo(r.created_at),
      }));

      const todayFollowups: ActionLead[] = (r3.data || []).map((r: any) => {
        const lead = r.leads;
        return {
          id: r.id,
          lead_id: r.lead_id,
          name: lead?.name || "",
          phone: lead?.phone || "",
          stage: lead?.stage || "",
          source: lead?.source || "",
          course_name: lead?.courses?.name || "—",
          campus_name: lead?.campuses?.name || "—",
          counsellor_id: lead?.counsellor_id,
          counsellor_name: lead?.profiles?.display_name || null,
          scheduled_at: r.scheduled_at,
          followup_type: r.type,
        };
      });

      const todayVisits: ActionLead[] = (r4.data || []).map((r: any) => {
        const lead = r.leads;
        return {
          id: r.id,
          lead_id: r.lead_id,
          name: lead?.name || "",
          phone: lead?.phone || "",
          stage: lead?.stage || "",
          source: lead?.source || "",
          course_name: lead?.courses?.name || "—",
          campus_name: r.campuses?.name || "—",
          counsellor_id: lead?.counsellor_id,
          counsellor_name: lead?.profiles?.display_name || null,
          visit_date: r.visit_date,
          visit_campus: r.campuses?.name || "",
          visit_id: r.id,
        };
      });

      const postVisitPending: ActionLead[] = (r5.data || []).map((r: any) => ({
        id: r.visit_id,
        lead_id: r.lead_id,
        name: r.lead_name,
        phone: r.lead_phone,
        stage: r.lead_stage,
        source: r.lead_source || "",
        course_name: "",
        campus_name: r.campus_name || "",
        counsellor_id: r.counsellor_id,
        counsellor_name: null,
        days_since_visit: r.days_since_visit,
        visit_date: r.visit_date,
      }));

      const stalledApps: ActionLead[] = (r6.data || []).map((r: any) => ({
        id: r.id,
        lead_id: r.id,
        name: r.name,
        phone: r.phone,
        stage: r.stage,
        source: r.source,
        course_name: r.courses?.name || "—",
        campus_name: r.campuses?.name || "—",
        counsellor_id: r.counsellor_id,
        counsellor_name: r.profiles?.display_name || null,
        days_inactive: Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000),
      }));

      // Merge upcoming followups + visits, sort by date
      const upcomingWeek: ActionLead[] = [
        ...(r7a.data || []).map((r: any) => {
          const lead = r.leads;
          return {
            id: r.id,
            lead_id: r.lead_id,
            name: lead?.name || "",
            phone: lead?.phone || "",
            stage: lead?.stage || "",
            source: lead?.source || "",
            course_name: lead?.courses?.name || "—",
            campus_name: lead?.campuses?.name || "—",
            counsellor_id: lead?.counsellor_id,
            counsellor_name: lead?.profiles?.display_name || null,
            scheduled_at: r.scheduled_at,
            followup_type: r.type,
          };
        }),
        ...(r7b.data || []).map((r: any) => {
          const lead = r.leads;
          return {
            id: r.id,
            lead_id: r.lead_id,
            name: lead?.name || "",
            phone: lead?.phone || "",
            stage: lead?.stage || "",
            source: lead?.source || "",
            course_name: lead?.courses?.name || "—",
            campus_name: r.campuses?.name || "—",
            counsellor_id: lead?.counsellor_id,
            counsellor_name: lead?.profiles?.display_name || null,
            visit_date: r.visit_date,
            visit_campus: r.campuses?.name || "",
          };
        }),
      ].sort((a, b) => {
        const dateA = a.scheduled_at || a.visit_date || "";
        const dateB = b.scheduled_at || b.visit_date || "";
        return dateA.localeCompare(dateB);
      });

      setData({
        overdueFollowups,
        newLeads,
        todayFollowups,
        todayVisits,
        postVisitPending,
        stalledApps,
        upcomingWeek,
      });
    } catch (err) {
      console.error("Action center fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, isCounsellor, scopedCounsellorId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Real-time refresh on key table changes
  useEffect(() => {
    const channel = supabase
      .channel("action-center-realtime")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "lead_followups" }, () => fetchAll())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "campus_visits" }, () => fetchAll())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "leads" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  return { data, loading, refetch: fetchAll };
}
