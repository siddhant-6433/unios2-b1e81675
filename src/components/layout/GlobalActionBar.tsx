import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Clock, MapPin, Phone, CalendarCheck, X, Sparkles, Inbox } from "lucide-react";

interface ActionItem {
  key: string;
  label: string;
  count: number;
  icon: any;
  color: string;
  url: string;
}

export function GlobalActionBar() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const isCounsellor = role === "counsellor";

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("id").eq("user_id", user.id).single()
      .then(({ data }) => { if (data) setProfileId(data.id); });
  }, [user?.id]);

  useEffect(() => {
    if (!profileId && isCounsellor) return;
    // Don't show for non-staff roles
    if (!role || ["student", "parent"].includes(role)) return;

    const fetchCounts = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const todayStart = `${today}T00:00:00+05:30`;
      const todayEnd = `${today}T23:59:59+05:30`;

      // For counsellors, get their lead IDs
      let myLeadIds: string[] | null = null;
      if (isCounsellor && profileId) {
        const { data: myLeads } = await supabase.from("leads").select("id").eq("counsellor_id", profileId);
        myLeadIds = (myLeads || []).map((l: any) => l.id);
        if (!myLeadIds.length) { setItems([]); return; }
      }

      const queries = await Promise.all([
        // Overdue followups
        (() => {
          let q = supabase.from("lead_followups" as any).select("id", { count: "exact", head: true })
            .eq("status", "pending").lt("scheduled_at", todayStart);
          if (myLeadIds) q = q.in("lead_id", myLeadIds);
          return q;
        })(),
        // Today's followups
        (() => {
          let q = supabase.from("lead_followups" as any).select("id", { count: "exact", head: true })
            .eq("status", "pending").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd);
          if (myLeadIds) q = q.in("lead_id", myLeadIds);
          return q;
        })(),
        // Fresh leads (assigned but not called)
        (() => {
          let q = supabase.from("leads").select("id", { count: "exact", head: true })
            .eq("stage", "new_lead" as any).is("first_contact_at", null);
          if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
          return q;
        })(),
        // Unassigned leads bucket
        (() => {
          if (isCounsellor) return Promise.resolve({ count: 0 });
          return supabase.from("leads").select("id", { count: "exact", head: true })
            .eq("stage", "new_lead" as any).is("counsellor_id", null);
        })(),
        // Unclosed visits
        (() => {
          let q = supabase.from("visits_unclosed_today" as any).select("visit_id", { count: "exact", head: true });
          if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
          return q;
        })(),
        // Visit confirmations needed
        (() => {
          let q = supabase.from("visits_needing_confirmation" as any).select("visit_id", { count: "exact", head: true });
          if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
          return q;
        })(),
        // Post-visit followups
        (() => {
          let q = supabase.from("post_visit_pending_followups" as any).select("visit_id", { count: "exact", head: true });
          if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
          return q;
        })(),
      ]);

      const result: ActionItem[] = [];
      const [overdueRes, todayRes, freshRes, unassignedRes, unclosedRes, confirmRes, postVisitRes] = queries;

      if ((freshRes.count || 0) > 0) result.push({
        key: "fresh", label: isCounsellor ? "Fresh Leads" : "Fresh Leads", count: freshRes.count || 0,
        icon: Sparkles, color: "text-orange-600 bg-orange-50 border-orange-200", url: "/fresh-leads",
      });
      if ((unassignedRes as any).count > 0) result.push({
        key: "unassigned", label: "Unassigned", count: (unassignedRes as any).count || 0,
        icon: Inbox, color: "text-white bg-red-500 border-red-600 animate-pulse", url: "/lead-buckets",
      });
      if ((overdueRes.count || 0) > 0) result.push({
        key: "overdue", label: "Overdue Follow-ups", count: overdueRes.count || 0,
        icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200", url: "/pending-followups?tab=overdue",
      });
      if ((todayRes.count || 0) > 0) result.push({
        key: "today", label: "Today's Follow-ups", count: todayRes.count || 0,
        icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", url: "/pending-followups?tab=today",
      });
      if ((unclosedRes.count || 0) > 0) result.push({
        key: "unclosed", label: "Visits to Close", count: unclosedRes.count || 0,
        icon: MapPin, color: "text-red-600 bg-red-50 border-red-200", url: "/pending-followups?tab=unclosed_visits",
      });
      if ((confirmRes.count || 0) > 0) result.push({
        key: "confirm", label: "Visit Confirmations", count: confirmRes.count || 0,
        icon: CalendarCheck, color: "text-purple-600 bg-purple-50 border-purple-200", url: "/pending-followups?tab=visit_confirm",
      });
      if ((postVisitRes.count || 0) > 0) result.push({
        key: "post_visit", label: "Post-Visit Follow-ups", count: postVisitRes.count || 0,
        icon: Phone, color: "text-amber-600 bg-amber-50 border-amber-200", url: "/pending-followups?tab=post_visit",
      });

      setItems(result);
    };

    fetchCounts();
    // Refresh every 5 minutes
    const interval = setInterval(fetchCounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [profileId, isCounsellor, role]);

  if (dismissed || items.length === 0) return null;

  return (
    <div className="border-b border-border bg-card/80 backdrop-blur-sm px-5 py-1.5">
      <div className="flex items-center gap-2 overflow-x-auto">
        {items.map(item => (
          <button key={item.key} onClick={() => navigate(item.url)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 whitespace-nowrap ${item.color}`}>
            <item.icon className="h-3.5 w-3.5" />
            <span className="font-bold">{item.count}</span>
            {item.label}
          </button>
        ))}
        <button onClick={() => setDismissed(true)}
          className="ml-auto rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Dismiss for now">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
