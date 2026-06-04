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
    if (!profileId && isCounsellor) return;

    const fetchCounts = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const todayStart = `${today}T00:00:00+05:30`;
        const todayEnd   = `${today}T23:59:59+05:30`;

        // Determine scope — counsellor filter or counsellor role
        const effectiveProfileId = counsellorFilter !== "all"
          ? counsellorFilter
          : (isCounsellor ? profileId : null);

        // Use allSettled — if one source breaks (RLS, missing view, schema
        // mismatch), the rest of the bar still renders. Promise.all would
        // wipe ALL pills on a single failure, which is the bug we hit when
        // one of the eight sources silently 404'd.
        const queries = [
          (() => {
            let q = (supabase.from("overdue_followups" as any) as any)
              .select("id", { count: "exact", head: true });
            if (effectiveProfileId) q = q.eq("counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            let q = supabase.from("lead_followups")
              .select(effectiveProfileId ? "id, leads!inner(counsellor_id)" : "id", { count: "exact", head: true })
              .eq("status", "pending")
              .gte("scheduled_at", todayStart)
              .lte("scheduled_at", todayEnd);
            if (effectiveProfileId) q = q.eq("leads.counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            let q = supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("stage", "new_lead" as any).is("first_contact_at", null);
            if (effectiveProfileId) q = q.eq("counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            if (isCounsellor || counsellorFilter !== "all") return Promise.resolve({ count: 0 });
            return supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("stage", "new_lead" as any).is("counsellor_id", null);
          })(),
          (() => {
            let q = (supabase.from("visits_unclosed_today" as any) as any)
              .select("visit_id", { count: "exact", head: true });
            if (effectiveProfileId) q = q.eq("counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            let q = (supabase.from("visits_needing_confirmation" as any) as any)
              .select("visit_id", { count: "exact", head: true });
            if (effectiveProfileId) q = q.eq("counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            let q = (supabase.from("post_visit_pending_followups" as any) as any)
              .select("visit_id", { count: "exact", head: true });
            if (effectiveProfileId) q = q.eq("counsellor_id", effectiveProfileId);
            return q;
          })(),
          (() => {
            let q = (supabase.from("ai_call_records" as any) as any)
              .select("id, leads!inner(counsellor_id)", { count: "exact", head: true })
              .eq("needs_followup", true)
              .is("followup_done_at", null);
            if (effectiveProfileId) q = q.eq("leads.counsellor_id", effectiveProfileId);
            return q;
          })(),
          // Missed Callbacks — inbound call_logs the candidate placed that no
          // human picked up. Scoped to the counsellor's own leads when a
          // counsellor scope is active; org-wide otherwise.
          (() => {
            let q = supabase.from("call_logs")
              .select(effectiveProfileId ? "id, leads!inner(counsellor_id)" : "id", { count: "exact", head: true })
              .eq("direction", "inbound")
              .eq("disposition", "missed");
            if (effectiveProfileId) q = q.eq("leads.counsellor_id", effectiveProfileId);
            return q;
          })(),
          // Hot leads: AI-elevated priority_interested. Counsellor-scoped only —
          // the team-wide count is too noisy for the action bar.
          (() => {
            if (!effectiveProfileId) return Promise.resolve({ count: 0 });
            return supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("stage", "priority_interested" as any)
              .eq("counsellor_id", effectiveProfileId);
          })(),
          // WhatsApp unread: direct indexed head-count on whatsapp_messages
          // (partial index idx_wa_messages_unread) scoped to this counsellor's
          // leads. The whatsapp_conversations view recomputes DISTINCT ON + 3
          // LATERAL count scans over all 56K+ messages on every call (~3s mean)
          // because filters can't be pushed into its set-returning function;
          // this answers in milliseconds. Mirrors NotificationPanel.fetchUnreplied.
          // Counsellor-scoped only; admins have a dedicated inbox.
          (() => {
            if (!effectiveProfileId) return Promise.resolve({ count: 0 });
            return supabase.from("whatsapp_messages")
              .select("id, leads!inner(counsellor_id)", { count: "exact", head: true })
              .eq("direction", "inbound")
              .eq("is_read", false)
              .eq("leads.counsellor_id", effectiveProfileId);
          })(),
          // Reclaim soon: leads that the SLA cron will unassign in <=30 min if
          // no contact is made. Counsellor-scoped; uses RPC for the per-source
          // SLA window math (see fn_count_leads_reclaim_soon).
          (() => {
            if (!effectiveProfileId) return Promise.resolve({ data: 0 });
            return (supabase as any).rpc("fn_count_leads_reclaim_soon", {
              p_counsellor_id: effectiveProfileId,
              p_within_min: 30,
            });
          })(),
        ];

        const settled = await Promise.allSettled(queries);
        const labels = ["overdue","today","fresh","unassigned","unclosed","confirm","post_visit","ai_needs_followup","missed_callbacks","hot","wa_unread","reclaim_soon"];
        const pick = (i: number) => {
          const r = settled[i];
          if (r.status === "fulfilled") {
            const v = r.value as any;
            if (v?.error) {
              console.warn(`[GlobalActionBar] ${labels[i]} query error:`, v.error.message || v.error);
              return { count: 0 };
            }
            return v;
          }
          console.warn(`[GlobalActionBar] ${labels[i]} query rejected:`, r.reason);
          return { count: 0 };
        };
        const overdueRes   = pick(0);
        const todayRes     = pick(1);
        const freshRes     = pick(2);
        const unassignedRes = pick(3);
        const unclosedRes  = pick(4);
        const confirmRes   = pick(5);
        const postVisitRes = pick(6);
        const aiNeedsFollowupRes = pick(7);
        const missedCallbacksRes = pick(8);
        const hotRes       = pick(9);
        const waRes        = pick(10);
        const reclaimRes   = pick(11);

        const result: ActionItem[] = [];

        const c = (r: any) => r?.count || 0;
        // WhatsApp is now a direct head-count on whatsapp_messages → use .count.
        const waUnread = c(waRes);
        // RPC returns the integer directly in .data, not .count.
        const reclaimSoon = typeof reclaimRes?.data === "number" ? reclaimRes.data : 0;

        if (c(missedCallbacksRes) > 0) result.push({
          key: "missed_callbacks", label: "Missed Callbacks", count: c(missedCallbacksRes),
          icon: PhoneMissed, color: "text-white bg-red-600 border-red-700 animate-pulse",
          url: "/call-log",
        });
        if (c(aiNeedsFollowupRes) > 0) result.push({
          key: "ai_needs_followup", label: "AI Needs Follow-up", count: c(aiNeedsFollowupRes),
          icon: PhoneMissed, color: "text-white bg-rose-600 border-rose-700 animate-pulse",
          url: "/missed-calls",
        });
        // Reclaim Soon — highest urgency after missed callbacks. Pulses so the
        // counsellor can't miss it. Clicks straight to the dialer where the
        // leads at risk are already in the queue with their own per-row badge.
        if (reclaimSoon > 0) result.push({
          key: "reclaim_soon", label: "Reclaim in <30m", count: reclaimSoon,
          icon: Timer, color: "text-white bg-red-600 border-red-700 animate-pulse",
          url: "/cloud-dialer",
        });
        if (c(unassignedRes) > 0) result.push({
          key: "unassigned", label: "Unassigned", count: c(unassignedRes),
          icon: Inbox, color: "text-white bg-orange-500 border-orange-600 animate-pulse",
          url: "/lead-buckets",
        });
        // Hot Leads — AI-elevated priority_interested. Counsellor-scoped.
        if (c(hotRes) > 0) result.push({
          key: "hot", label: "Hot Leads", count: c(hotRes),
          icon: Flame, color: "text-violet-700 bg-violet-50 border-violet-200",
          url: "/cloud-dialer",
        });
        if (c(overdueRes) > 0) result.push({
          key: "overdue", label: "Overdue Follow-ups", count: c(overdueRes),
          icon: AlertTriangle, color: "text-red-600 bg-red-50 border-red-200",
          url: "/pending-followups?tab=overdue",
        });
        if (c(todayRes) > 0) result.push({
          key: "today", label: "Today's Follow-ups", count: c(todayRes),
          icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200",
          url: "/pending-followups?tab=today",
        });
        if (c(freshRes) > 0) result.push({
          key: "fresh", label: "Fresh Leads", count: c(freshRes),
          icon: Sparkles, color: "text-orange-600 bg-orange-50 border-orange-200",
          url: "/fresh-leads",
        });
        if (c(postVisitRes) > 0) result.push({
          key: "post_visit", label: "Post-Visit", count: c(postVisitRes),
          icon: Phone, color: "text-amber-600 bg-amber-50 border-amber-200",
          url: "/pending-followups?tab=post_visit",
        });
        if (c(unclosedRes) > 0) result.push({
          key: "unclosed", label: "Visits to Close", count: c(unclosedRes),
          icon: MapPin, color: "text-red-600 bg-red-50 border-red-200",
          url: "/pending-followups?tab=unclosed_visits",
        });
        if (c(confirmRes) > 0) result.push({
          key: "confirm", label: "Visit Confirmations", count: c(confirmRes),
          icon: CalendarCheck, color: "text-purple-600 bg-purple-50 border-purple-200",
          url: "/pending-followups?tab=visit_confirm",
        });
        // WhatsApp unread — last in the strip since it's a softer signal than
        // the others (a message can wait a few hours; a missed call or
        // reclaim-risk can't).
        if (waUnread > 0) result.push({
          key: "wa_unread", label: "WhatsApp Unread", count: waUnread,
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
