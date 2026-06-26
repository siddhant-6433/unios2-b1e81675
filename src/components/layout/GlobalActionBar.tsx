import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { AlertTriangle, Clock, MapPin, Phone, CalendarCheck, Sparkles, Inbox, PhoneMissed, Flame, MessageCircle, Timer } from "lucide-react";

interface ActionItem {
  key: string;
  label: string;
  count: number;
  icon: any;
  color: string;
  url: string;
}

export function GlobalActionBar() {
  const { role, user, profile } = useAuth();
  const navigate = useNavigate();
  const isTeamLeader = useIsTeamLeader();
  const [items, setItems] = useState<ActionItem[]>([]);
  const profileId = profile?.id || null;
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const isCounsellor = role === "counsellor";
  const canFilterCounsellor = role === "super_admin" || role === "admission_head" || role === "campus_admin" || isTeamLeader;

  useEffect(() => {
    if (!user?.id) return;
    if (!canFilterCounsellor) return;
    (async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("user_id", roleRows.map(r => r.user_id)).eq("login_disabled", false);
      if (profs) setCounsellorOptions(profs.map(p => ({ id: p.id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, [user?.id, canFilterCounsellor]);

  useEffect(() => {
    if (!role || ["student", "parent"].includes(role)) return;
    if (role === "academic_partner") {
      setItems([]);
      return;
    }
    if (!profileId && isCounsellor) return;

    const fetchCounts = async () => {
      try {
        const effectiveProfileId = counsellorFilter !== "all"
          ? counsellorFilter
          : (isCounsellor ? profileId : null);

        const { data, error } = await (supabase as any).rpc("action_badge_counts", {
          p_scope_counsellor_id: effectiveProfileId,
          p_include_unassigned: !isCounsellor && counsellorFilter === "all",
        });

        if (error) throw error;

        const c = (key: string) => Number(data?.[key] || 0);
        const result: ActionItem[] = [];

        if (c("missed_callbacks") > 0) result.push({
          key: "missed_callbacks", label: "Missed Callbacks", count: c("missed_callbacks"),
          icon: PhoneMissed, color: "text-white bg-red-600 border-red-700 animate-pulse",
          url: "/call-log",
        });
        if (c("ai_needs_followup") > 0) result.push({
          key: "ai_needs_followup", label: "AI Needs Follow-up", count: c("ai_needs_followup"),
          icon: PhoneMissed, color: "text-white bg-rose-600 border-rose-700 animate-pulse",
          url: "/missed-calls",
        });
        if (c("reclaim_soon") > 0) result.push({
          key: "reclaim_soon", label: "Reclaim in <30m", count: c("reclaim_soon"),
          icon: Timer, color: "text-white bg-red-600 border-red-700 animate-pulse",
          url: "/cloud-dialer",
        });
        if (c("unassigned") > 0) result.push({
          key: "unassigned", label: "Unassigned", count: c("unassigned"),
          icon: Inbox, color: "text-white bg-orange-500 border-orange-600 animate-pulse",
          url: "/lead-buckets",
        });
        if (c("hot") > 0) result.push({
          key: "hot", label: "Hot Leads", count: c("hot"),
          icon: Flame, color: "text-violet-700 bg-violet-50 border-violet-200",
          url: "/cloud-dialer",
        });
        if (c("overdue") > 0) result.push({
          key: "overdue", label: "Overdue Follow-ups", count: c("overdue"),
          icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200",
          url: "/pending-followups?tab=overdue",
        });
        if (c("today") > 0) result.push({
          key: "today", label: "Today's Follow-ups", count: c("today"),
          icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200",
          url: "/pending-followups?tab=today",
        });
        if (c("fresh") > 0) result.push({
          key: "fresh", label: "Fresh Leads", count: c("fresh"),
          icon: Sparkles, color: "text-orange-600 bg-orange-50 border-orange-200",
          url: "/fresh-leads",
        });
        if (c("post_visit") > 0) result.push({
          key: "post_visit", label: "Post-Visit", count: c("post_visit"),
          icon: Phone, color: "text-amber-600 bg-amber-50 border-amber-200",
          url: "/pending-followups?tab=post_visit",
        });
        if (c("unclosed") > 0) result.push({
          key: "unclosed", label: "Visits to Close", count: c("unclosed"),
          icon: MapPin, color: "text-red-600 bg-red-50 border-red-200",
          url: "/pending-followups?tab=unclosed_visits",
        });
        if (c("confirm") > 0) result.push({
          key: "confirm", label: "Visit Confirmations", count: c("confirm"),
          icon: CalendarCheck, color: "text-purple-600 bg-purple-50 border-purple-200",
          url: "/pending-followups?tab=visit_confirm",
        });
        if (c("wa_unread") > 0) result.push({
          key: "wa_unread", label: "WhatsApp Unreplied", count: c("wa_unread"),
          icon: MessageCircle, color: "text-emerald-700 bg-emerald-50 border-emerald-200",
          url: "/whatsapp-inbox",
        });

        setItems(result);
      } catch (err) {
        console.error("[GlobalActionBar] fetchCounts error:", err);
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [profileId, isCounsellor, role, counsellorFilter]);

  if (items.length === 0 && !canFilterCounsellor) return null;

  return (
    <div className="border-b border-border bg-card/80 backdrop-blur-sm px-5 py-1.5">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        {canFilterCounsellor && counsellorOptions.length > 0 && (
          <select
            value={counsellorFilter}
            onChange={e => setCounsellorFilter(e.target.value)}
            className="rounded-lg border border-input bg-card px-2 py-1 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring/20 shrink-0"
          >
            <option value="all">All Counsellors</option>
            {counsellorOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => navigate(item.url)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 whitespace-nowrap shrink-0 ${item.color}`}
          >
            <item.icon className="h-3.5 w-3.5" />
            <span className="font-bold">{item.count > 999 ? "999+" : item.count}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
