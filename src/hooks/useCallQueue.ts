import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface QueueBucket {
  key: string;
  label: string;
  color: string;
  count: number;
  leads: { id: string; name: string; phone: string }[];
}

export interface NextLead {
  id: string;
  name: string;
  phone: string;
  bucketName: string;
  bucketPriority: number;
}

/**
 * @param currentLeadId - exclude from queue
 * @param counsellorId - scope queue to this counsellor (for admins viewing a specific counsellor's leads).
 *                       If omitted and user is counsellor, uses own profile.id.
 *                       If omitted and user is admin, uses the current lead's counsellor_id.
 */
export function useCallQueue(currentLeadId?: string, counsellorId?: string) {
  const { profile, role } = useAuth();
  const [buckets, setBuckets] = useState<QueueBucket[]>([]);
  const [nextLead, setNextLead] = useState<NextLead | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvedCounsellorId, setResolvedCounsellorId] = useState<string | null>(null);

  // Resolve which counsellor to scope to
  useEffect(() => {
    if (counsellorId) {
      setResolvedCounsellorId(counsellorId);
      return;
    }
    if (role === "counsellor" && profile?.id) {
      setResolvedCounsellorId(profile.id);
      return;
    }
    // For admins: resolve from the current lead's counsellor_id
    if (currentLeadId) {
      (async () => {
        const { data } = await supabase
          .from("leads")
          .select("counsellor_id")
          .eq("id", currentLeadId)
          .single();
        setResolvedCounsellorId(data?.counsellor_id || null);
      })();
    }
  }, [counsellorId, role, profile?.id, currentLeadId]);

  const fetchQueue = useCallback(async () => {
    if (!resolvedCounsellorId) return;
    setLoading(true);

    const now = new Date();
    const todayStart = now.toISOString().slice(0, 10);
    const todayEnd = todayStart + "T23:59:59";

    try {
      const [r1, r2, r3, r4] = await Promise.all([
        supabase.from("post_visit_pending_followups" as any)
          .select("lead_id, lead_name, lead_phone")
          .eq("counsellor_id", resolvedCounsellorId)
          .order("visit_date", { ascending: true })
          .limit(10),
        supabase.from("overdue_followups" as any)
          .select("lead_id, lead_name, lead_phone")
          .eq("counsellor_id", resolvedCounsellorId)
          .order("scheduled_at", { ascending: true })
          .limit(10),
        supabase.from("lead_followups")
          .select("lead_id, leads!inner(id, name, phone, counsellor_id)")
          .eq("status", "pending")
          .eq("leads.counsellor_id", resolvedCounsellorId)
          .gte("scheduled_at", todayStart)
          .lte("scheduled_at", todayEnd)
          .order("scheduled_at", { ascending: true })
          .limit(10),
        supabase.from("leads")
          .select("id, name, phone")
          .eq("counsellor_id", resolvedCounsellorId)
          .eq("stage", "new_lead")
          .is("first_contact_at", null)
          .order("created_at", { ascending: true })
          .limit(10),
      ]);

      const postVisit = (r1.data || []).map((r: any) => ({ id: r.lead_id, name: r.lead_name, phone: r.lead_phone }));
      const overdue = (r2.data || []).map((r: any) => ({ id: r.lead_id, name: r.lead_name, phone: r.lead_phone }));
      const todayFu = (r3.data || []).map((r: any) => ({ id: r.lead_id, name: (r.leads as any)?.name || "", phone: (r.leads as any)?.phone || "" }));
      const newLeads = (r4.data || []).map((r: any) => ({ id: r.id, name: r.name, phone: r.phone }));

      const seen = new Set<string>();
      const dedup = (arr: { id: string; name: string; phone: string }[]) => {
        return arr.filter(l => {
          if (seen.has(l.id)) return false;
          seen.add(l.id);
          return true;
        });
      };

      const b: QueueBucket[] = [
        { key: "post_visit", label: "Post-Visit", color: "bg-amber-500", count: postVisit.length, leads: dedup(postVisit) },
        { key: "overdue", label: "Overdue", color: "bg-red-500", count: overdue.length, leads: dedup(overdue) },
        { key: "today", label: "Today", color: "bg-blue-500", count: todayFu.length, leads: dedup(todayFu) },
        { key: "new", label: "New Leads", color: "bg-orange-500", count: newLeads.length, leads: dedup(newLeads) },
      ].filter(b => b.count > 0);

      setBuckets(b);

      for (const bucket of b) {
        const next = bucket.leads.find(l => l.id !== currentLeadId);
        if (next) {
          setNextLead({ ...next, bucketName: bucket.label, bucketPriority: b.indexOf(bucket) });
          setLoading(false);
          return;
        }
      }
      setNextLead(null);
    } catch (err) {
      console.error("Call queue error:", err);
    } finally {
      setLoading(false);
    }
  }, [resolvedCounsellorId, currentLeadId]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  return { buckets, nextLead, loading, refetch: fetchQueue };
}
