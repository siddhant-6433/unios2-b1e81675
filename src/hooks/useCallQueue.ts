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

    try {
      const { data, error } = await supabase.rpc("cloud_dialer_queue" as any, {
        p_counsellor_id: resolvedCounsellorId,
        p_max_per_bucket: 10,
      });
      if (error) throw error;

      const rows = Array.isArray((data as any)?.queue) ? (data as any).queue : [];
      const bucketDefs = [
        { key: "post_visit", sourceLabel: "Post-Visit", label: "Post-Visit", color: "bg-amber-500" },
        { key: "overdue", sourceLabel: "Overdue", label: "Overdue", color: "bg-red-500" },
        { key: "today", sourceLabel: "Today", label: "Today", color: "bg-blue-500" },
        { key: "new", sourceLabel: "New Lead", label: "New Leads", color: "bg-orange-500" },
      ] as const;

      const seen = new Set<string>();
      const dedup = (arr: { id: string; name: string; phone: string }[]) => {
        return arr.filter(l => {
          if (seen.has(l.id)) return false;
          seen.add(l.id);
          return true;
        });
      };

      const b: QueueBucket[] = bucketDefs.map((bucket) => {
        const leads = dedup(
          rows
            .filter((row: any) => row.bucket === bucket.sourceLabel)
            .map((row: any) => ({
              id: row.id,
              name: row.name || "",
              phone: row.phone || "",
            })),
        );
        return {
          key: bucket.key,
          label: bucket.label,
          color: bucket.color,
          count: leads.length,
          leads,
        };
      }).filter((bucket) => bucket.count > 0);

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
