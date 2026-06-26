import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock, AlertTriangle, CalendarCheck, Phone, MapPin, Loader2, Search,
  ChevronLeft, ChevronRight, ExternalLink, X, Check, CalendarClock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CahetPendingBadge } from "@/components/leads/CahetPendingBadge";
import { UpdeledPendingBadge } from "@/components/leads/UpdeledPendingBadge";
import {
  CallDispositionDialog,
  type CallDispositionData,
  type DialogCallStatus,
} from "@/components/admissions/CallDispositionDialog";
import { recordCallDisposition } from "@/lib/callDisposition";
import { useCampuses } from "@/hooks/useAdmissionsData";
import { leadTransitionStagePatch, resolveLeadTransitionCommand } from "@/lib/leadTransitions";

type Tab = "overdue" | "today" | "upcoming" | "visit_confirm" | "unclosed_visits" | "post_visit";

const TABS: { key: Tab; label: string; icon: any; description: string }[] = [
  { key: "overdue", label: "Overdue", icon: AlertTriangle, description: "Follow-up calls that were scheduled but not completed — these leads are waiting for contact." },
  { key: "today", label: "Today", icon: Clock, description: "Follow-ups scheduled for today — call these leads before end of day." },
  { key: "upcoming", label: "Upcoming", icon: CalendarCheck, description: "Follow-ups scheduled for the next 7 days — plan your calls ahead." },
  { key: "visit_confirm", label: "Visit Confirmations", icon: MapPin, description: "Visits scheduled for today or tomorrow — call each lead to confirm they are coming." },
  { key: "unclosed_visits", label: "Unclosed Visits", icon: AlertTriangle, description: "Visits that happened but were never marked completed or no-show — close these to avoid score penalties." },
  { key: "post_visit", label: "Post-Visit", icon: Phone, description: "Completed visits with no follow-up call logged — call to collect feedback and push towards admission." },
];

interface FollowupItem {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  counsellor_name: string;
  counsellor_id: string | null;
  type: string;
  scheduled_at: string;
  notes: string | null;
  days_overdue?: number;
  days_since_visit?: number;
  campus_name?: string;
  urgency?: string;
}

interface InlineCallState {
  item: FollowupItem;
  rowIndex: number;
  courseName: string | null;
  leadSource: string | null;
  personRole: string | null;
  jdKeyword: string | null;
}

const PAGE_SIZE = 50;

const PendingFollowups = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { role, user, profile } = useAuth();
  const isCounsellor = role === "counsellor";
  const profileId = profile?.id || null;
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) || "overdue");

  // Sync tab from URL when navigating from global bar
  useEffect(() => {
    const urlTab = searchParams.get("tab") as Tab;
    if (urlTab && TABS.some(t => t.key === urlTab)) setTab(urlTab);
  }, [searchParams]);
  const [items, setItems] = useState<FollowupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Record<Tab, number>>({ overdue: 0, today: 0, upcoming: 0, visit_confirm: 0, unclosed_visits: 0, post_visit: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  // Visit closure dialogs
  const [completeDialog, setCompleteDialog] = useState<{ visitId: string; leadId: string; leadName: string } | null>(null);
  const [noShowDialog, setNoShowDialog] = useState<{ visitId: string; leadId: string; leadName: string; campusId: string | null } | null>(null);
  const [rescheduleVisitDialog, setRescheduleVisitDialog] = useState<{ visitId: string; leadId: string; leadName: string } | null>(null);
  const [newVisitDate, setNewVisitDate] = useState("");
  const [visitFeedback, setVisitFeedback] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [followupAction, setFollowupAction] = useState<"followup" | "reschedule">("followup");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [cloudCallingId, setCloudCallingId] = useState<string | null>(null);
  const [inlineCall, setInlineCall] = useState<InlineCallState | null>(null);
  const [inlineCallUuid, setInlineCallUuid] = useState<string | null>(null);
  const [inlineCallStatus, setInlineCallStatus] = useState<DialogCallStatus | undefined>(undefined);
  const [inlineCallEnded, setInlineCallEnded] = useState(false);
  const [inlineCallStarting, setInlineCallStarting] = useState(false);
  const [lastInlineCall, setLastInlineCall] = useState<{ label: string; nextItem: FollowupItem | null } | null>(null);
  const { data: campuses = [] } = useCampuses();
  const { toast } = useToast();

  const invalidateAdmissionsFollowupSurfaces = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admissions-followup-counts"] });
    queryClient.invalidateQueries({ queryKey: ["admissions-overview"] });
  }, [queryClient]);

  // Fetch counsellor options for reassignment (admins only)
  useEffect(() => {
    if (isCounsellor) return;
    (async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("user_id", roleRows.map(r => r.user_id));
      if (profs) setCounsellorOptions(profs.map(p => ({ id: p.id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, [isCounsellor]);

  const fetchPayload = useCallback(async () => {
    // Counsellor scoping leans on profile.id; if it hasn't loaded yet the
    // RPC would correctly return no owned rows, but keeping the spinner short
    // avoids a confusing empty state during auth hydration.
    if (isCounsellor && !profileId) return;

    setLoading(true);

    const scopeId = isCounsellor
      ? profileId
      : (counsellorFilter !== "all" && counsellorFilter !== "unassigned" ? counsellorFilter : null);
    const scopeUnassigned = !isCounsellor && counsellorFilter === "unassigned";

    const { data, error } = await (supabase as any).rpc("pending_followups_payload", {
      p_tab: tab,
      p_scope_counsellor_id: scopeId,
      p_scope_unassigned: scopeUnassigned,
      p_page: page,
      p_page_size: PAGE_SIZE,
    });

    if (error) {
      console.error("Pending follow-ups fetch failed:", error);
      setItems([]);
      setLoading(false);
      return;
    }

    setCounts({
      overdue: data?.counts?.overdue || 0,
      today: data?.counts?.today || 0,
      upcoming: data?.counts?.upcoming || 0,
      visit_confirm: data?.counts?.visit_confirm || 0,
      unclosed_visits: data?.counts?.unclosed_visits || 0,
      post_visit: data?.counts?.post_visit || 0,
    });
    setItems(data?.items || []);
    setLoading(false);
  }, [tab, page, isCounsellor, profileId, counsellorFilter]);

  useEffect(() => { fetchPayload(); }, [fetchPayload]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [tab, counsellorFilter]);

  const filtered = search
    ? items.filter(r => {
        const q = search.toLowerCase();
        return r.lead_name.toLowerCase().includes(q) || r.lead_phone.includes(q) || (r.notes || "").toLowerCase().includes(q) || r.counsellor_name.toLowerCase().includes(q);
      })
    : items;

  useEffect(() => {
    if (!inlineCallUuid || !inlineCall || inlineCallEnded) return;
    if (inlineCallStatus && inlineCallStatus !== "calling" && inlineCallStatus !== "connected") return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const { data } = await (supabase as any)
        .from("ai_call_records")
        .select("status, duration_seconds, student_connected_at")
        .eq("call_uuid", inlineCallUuid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;

      const status = String(data.status || "").toLowerCase();
      const duration = data.duration_seconds || 0;
      const wasAnswered = !!data.student_connected_at
        || status === "in-progress"
        || status === "in_progress"
        || status === "answered"
        || (status === "completed" && duration > 5);

      if (status === "completed" && wasAnswered) {
        setInlineCallStatus("connected");
        setInlineCallEnded(true);
      } else if (wasAnswered) {
        setInlineCallStatus("connected");
      } else if (status === "counsellor_no_answer") {
        setInlineCallStatus("counsellor_no_answer");
      } else if (status === "no_answer" || status === "no-answer" || status === "cancel") {
        setInlineCallStatus("no_answer");
      } else if (status === "busy") {
        setInlineCallStatus("busy");
      } else if (status === "failed") {
        setInlineCallStatus("failed");
      } else if (status === "completed") {
        setInlineCallStatus("no_answer");
      }
    };

    tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [inlineCallUuid, inlineCall, inlineCallStatus, inlineCallEnded]);

  const resetInlineCall = () => {
    setInlineCall(null);
    setInlineCallUuid(null);
    setInlineCallStatus(undefined);
    setInlineCallEnded(false);
    setInlineCallStarting(false);
  };

  const startInlineCall = async (item: FollowupItem, rowIndex: number) => {
    setLastInlineCall(null);
    setInlineCall({ item, rowIndex, courseName: null, leadSource: null, personRole: null, jdKeyword: null });
    setInlineCallUuid(null);
    setInlineCallEnded(false);
    setInlineCallStatus("calling");
    setInlineCallStarting(true);

    try {
      void (async () => {
        const { data: leadContext } = await (supabase as any)
          .from("leads")
          .select("source, person_role, jd_category, course_id")
          .eq("id", item.lead_id)
          .maybeSingle();
        let courseName: string | null = null;
        if (leadContext?.course_id) {
          const { data: course } = await supabase
            .from("courses")
            .select("name")
            .eq("id", leadContext.course_id)
            .maybeSingle();
          courseName = course?.name || null;
        }
        setInlineCall(prev => {
          if (!prev || prev.item.lead_id !== item.lead_id) return prev;
          return {
            ...prev,
            courseName,
            leadSource: leadContext?.source || null,
            personRole: leadContext?.person_role || null,
            jdKeyword: leadContext?.jd_category || null,
          };
        });
      })();

      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: item.lead_id, caller_user_id: user?.id },
      });
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) {
            const raw = await ctx.text().catch(() => "");
            try { detail = JSON.parse(raw)?.error || raw; } catch { detail = raw || error.message; }
          }
        } catch {}
        toast({ title: "Call Failed", description: detail, variant: "destructive" });
        resetInlineCall();
      } else if (data?.error) {
        toast({ title: "Call Failed", description: data.error, variant: "destructive" });
        resetInlineCall();
      } else {
        toast({ title: "Calling You", description: data?.message || "Pick up your phone to connect to the student." });
        setInlineCallUuid(data?.call_id || null);
      }
    } catch (e: any) {
      toast({ title: "Call Failed", description: e.message, variant: "destructive" });
      resetInlineCall();
    } finally {
      setInlineCallStarting(false);
    }
  };

  const cancelInlineCall = async () => {
    if (!inlineCallUuid) return;
    try {
      const { error } = await supabase.functions.invoke("manual-call-cancel", {
        body: { call_id: inlineCallUuid, caller_user_id: user?.id },
      });
      if (error) {
        toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Call cancelled", description: "Both legs dropped." });
      }
    } catch (e: any) {
      toast({ title: "Cancel failed", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  const submitInlineDisposition = async (data: CallDispositionData) => {
    if (!inlineCall) return;
    const item = inlineCall.item;
    const nextItem = filtered[inlineCall.rowIndex + 1] || null;

    await recordCallDisposition({
      supabase,
      leadId: item.lead_id,
      lead: { name: item.lead_name, phone: item.lead_phone, stage: item.lead_stage },
      userId: user?.id || null,
      profileId,
      courseName: inlineCall.courseName,
      data,
      loggedFromLabel: "pending follow-ups",
      callUuid: inlineCallUuid,
      callSource: inlineCallUuid ? "cloud_dialer" : "manual_log",
    });

    const label = data.disposition.replace(/_/g, " ");
    toast({ title: "Call logged", description: label });
    setLastInlineCall({ label, nextItem });
    resetInlineCall();
    invalidateAdmissionsFollowupSurfaces();
    await fetchPayload();
  };

  const openCompleteDialog = (visitId: string, leadId: string, leadName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setVisitFeedback("");
    setFollowupDate(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16)); // default +2 days
    setCompleteDialog({ visitId, leadId, leadName });
  };

  const openNoShowDialog = (visitId: string, leadId: string, leadName: string, campusId: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setFollowupAction("followup");
    setFollowupDate(new Date(Date.now() + 86400000).toISOString().slice(0, 16)); // default tomorrow
    setRescheduleDate(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16)); // default +3 days
    setNoShowDialog({ visitId, leadId, leadName, campusId });
  };

  const handleCompleteVisit = async () => {
    if (!completeDialog || !followupDate) return;
    setSaving(true);
    await supabase.from("campus_visits" as any).update({ status: "completed", feedback: visitFeedback || null }).eq("id", completeDialog.visitId);
    await supabase.from("lead_activities").insert({
      lead_id: completeDialog.leadId, user_id: user?.id || null, type: "visit",
      description: `Campus visit completed${visitFeedback ? `: ${visitFeedback}` : ""}`,
    });
    // Create mandatory follow-up
    await supabase.from("lead_followups" as any).insert({
      lead_id: completeDialog.leadId, scheduled_at: new Date(followupDate).toISOString(),
      type: "call", notes: "Post-visit follow-up", status: "pending",
    });
    toast({ title: "Visit completed", description: `Follow-up scheduled for ${new Date(followupDate).toLocaleDateString("en-IN")}` });
    setSaving(false);
    setCompleteDialog(null);
    invalidateAdmissionsFollowupSurfaces();
    fetchPayload();
  };

  const handleNoShowVisit = async () => {
    if (!noShowDialog) return;
    if (followupAction === "followup" && !followupDate) return;
    if (followupAction === "reschedule" && !rescheduleDate) return;
    setSaving(true);
    // Mark no-show (trigger auto-creates followup, but we override with user's choice)
    await supabase.from("campus_visits" as any).update({ status: "no_show" }).eq("id", noShowDialog.visitId);
    await supabase.from("lead_activities").insert({
      lead_id: noShowDialog.leadId, user_id: user?.id || null, type: "visit",
      description: "Campus visit: student did not show up",
    });

    if (followupAction === "reschedule") {
      // Create rescheduled visit
      await supabase.from("campus_visits" as any).insert({
        lead_id: noShowDialog.leadId, campus_id: noShowDialog.campusId,
        visit_date: new Date(rescheduleDate).toISOString(), status: "scheduled",
        scheduled_by: user?.id || null,
      } as any);
      const transition = resolveLeadTransitionCommand({ currentStage: "visit_scheduled", command: "rescheduleVisit" });
      await supabase.from("leads").update(leadTransitionStagePatch(transition) as any).eq("id", noShowDialog.leadId);
      toast({ title: "No-show recorded", description: `Visit rescheduled for ${new Date(rescheduleDate).toLocaleDateString("en-IN")}` });
    } else {
      // The DB trigger already creates a followup, but let's ensure the user's date is used
      // Delete the auto-created one and insert with user's date
      await supabase.from("lead_followups" as any)
        .delete()
        .eq("lead_id", noShowDialog.leadId)
        .eq("status", "pending")
        .ilike("notes", "%Auto: No-show%");
      await supabase.from("lead_followups" as any).insert({
        lead_id: noShowDialog.leadId, scheduled_at: new Date(followupDate).toISOString(),
        type: "call", notes: "No-show follow-up — call to reschedule or close", status: "pending",
      });
      toast({ title: "No-show recorded", description: `Follow-up call scheduled for ${new Date(followupDate).toLocaleDateString("en-IN")}` });
    }
    setSaving(false);
    setNoShowDialog(null);
    invalidateAdmissionsFollowupSurfaces();
    fetchPayload();
  };

  const openRescheduleVisitDialog = (visitId: string, leadId: string, leadName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Default new date = +2 days, rounded to local datetime-local format
    setNewVisitDate(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
    setRescheduleVisitDialog({ visitId, leadId, leadName });
  };

  const handleRescheduleVisit = async () => {
    if (!rescheduleVisitDialog || !newVisitDate) return;
    setSaving(true);
    const newDateIso = new Date(newVisitDate).toISOString();
    // Update the existing visit row in place — keeps the same campus + scheduler.
    await supabase.from("campus_visits" as any)
      .update({ visit_date: newDateIso, status: "scheduled" })
      .eq("id", rescheduleVisitDialog.visitId);
    const transition = resolveLeadTransitionCommand({ currentStage: "visit_scheduled", command: "rescheduleVisit" });
    await supabase.from("leads").update(leadTransitionStagePatch(transition) as any).eq("id", rescheduleVisitDialog.leadId);
    await supabase.from("lead_activities").insert({
      lead_id: rescheduleVisitDialog.leadId, user_id: user?.id || null, type: "visit",
      description: `Visit rescheduled to ${new Date(newDateIso).toLocaleString("en-IN")}`,
    });
    toast({ title: "Visit rescheduled", description: `New date: ${new Date(newDateIso).toLocaleDateString("en-IN")}` });
    setSaving(false);
    setRescheduleVisitDialog(null);
    invalidateAdmissionsFollowupSurfaces();
    fetchPayload();
  };

  const handleCloudCall = async (leadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCloudCallingId(leadId);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: leadId, caller_user_id: currentUser?.id },
      });
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) { const raw = await ctx.text().catch(() => ""); try { detail = JSON.parse(raw)?.error || raw; } catch { detail = raw || error.message; } }
        } catch {}
        toast({ title: "Call Failed", description: detail, variant: "destructive" });
      } else if (data?.error) {
        toast({ title: "Call Failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Calling You", description: data?.message || "Pick up your phone to connect to the student." });
      }
    } catch (e: any) {
      toast({ title: "Call Failed", description: e.message, variant: "destructive" });
    }
    setCloudCallingId(null);
  };

  const toggleSelect = (leadId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.lead_id)));
    }
  };

  const handleReassign = async () => {
    if (!reassignTo || selected.size === 0) return;
    setReassigning(true);
    const leadIds = [...selected];
    const { error } = await supabase.from("leads").update({ counsellor_id: reassignTo } as any).in("id", leadIds);
    if (error) {
      console.error("Reassign failed:", error);
    } else {
      // Log activity for each lead
      const counsellorName = counsellorOptions.find(c => c.id === reassignTo)?.name || "Unknown";
      await supabase.from("lead_activities").insert(
        leadIds.map(lid => ({
          lead_id: lid,
          user_id: user?.id || null,
          type: "assignment",
          description: `Lead reassigned to ${counsellorName} (bulk from Pending Follow-ups)`,
        }))
      );
    }
    setSelected(new Set());
    setReassignTo("");
    setReassigning(false);
    fetchPayload();
  };

  const totalAll = counts.overdue + counts.today + counts.upcoming + counts.visit_confirm + counts.unclosed_visits + counts.post_visit;

  const fmtOverdue = (d: number) => d === 0 ? "Today" : d === 1 ? "1 day overdue" : `${d} days overdue`;
  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  const openLeadFromQueue = (leadId: string, rowIndex: number, startCall = false) => {
    navigate(`/admissions/${leadId}${startCall ? "?action=call" : ""}`, {
      state: {
        followupQueue: {
          ids: filtered.map(f => f.lead_id),
          index: rowIndex,
          tab,
          returnUrl: `/pending-followups?tab=${tab}`,
        },
      },
    });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Pending Follow-ups" : "Pending Follow-ups"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAll > 0 ? `${totalAll} items need attention` : "All caught up!"}
          </p>
        </div>
      </div>

      {/* Tab pills with counts */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => {
          const c = counts[t.key];
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "border border-input bg-card text-muted-foreground hover:bg-muted"
              }`}>
              <t.icon className="h-4 w-4" />
              {t.label}
              {c > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive ? "bg-primary-foreground/20 text-primary-foreground"
                    : t.key === "overdue" || t.key === "unclosed_visits" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                }`}>{c}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab description */}
      <p className="text-xs text-muted-foreground -mt-2">
        {TABS.find(t => t.key === tab)?.description}
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {!isCounsellor && (
          <select value={counsellorFilter} onChange={e => setCounsellorFilter(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="all">All Counsellors</option>
            <option value="unassigned">Unassigned</option>
            {counsellorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search name, phone, notes..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
      </div>

      {/* Bulk action bar */}
      {!isCounsellor && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/20 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">{selected.size} lead{selected.size > 1 ? "s" : ""} selected</span>
          <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="">Reassign to...</option>
            {counsellorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={handleReassign} disabled={!reassignTo || reassigning}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {reassigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Reassign
          </button>
          <button onClick={() => setSelected(new Set())}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {inlineCall && (
        <CallDispositionDialog
          inline
          open={!!inlineCall}
          onOpenChange={(open) => { if (!open) resetInlineCall(); }}
          leadName={inlineCall.item.lead_name}
          leadPhone={inlineCall.item.lead_phone}
          campuses={campuses}
          onSubmit={submitInlineDisposition}
          callStatus={inlineCallStatus}
          callEnded={inlineCallEnded}
          callStarting={inlineCallStarting && !inlineCallUuid && inlineCallStatus === "calling"}
          onManualConnect={inlineCallUuid ? () => setInlineCallStatus("connected") : undefined}
          onCancelCall={inlineCallUuid ? cancelInlineCall : undefined}
          onRetryCall={async () => {
            const current = inlineCall;
            resetInlineCall();
            if (current) await startInlineCall(current.item, current.rowIndex);
          }}
          leadStage={inlineCall.item.lead_stage}
          courseName={inlineCall.courseName}
          leadSource={inlineCall.leadSource}
          personRole={inlineCall.personRole}
          jdKeyword={inlineCall.jdKeyword}
          latestNote={inlineCall.item.notes}
        />
      )}

      {lastInlineCall && !inlineCall && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <Check className="h-4 w-4 shrink-0" />
          <span className="font-medium">Call logged: {lastInlineCall.label}</span>
          {lastInlineCall.nextItem ? (
            <Button
              size="sm"
              className="ml-auto h-8 gap-1.5"
              onClick={() => {
                const nextIndex = Math.max(0, filtered.findIndex(f => f.lead_id === lastInlineCall.nextItem?.lead_id));
                startInlineCall(lastInlineCall.nextItem!, nextIndex);
              }}
            >
              <Phone className="h-3.5 w-3.5" />
              Call next follow-up
            </Button>
          ) : (
            <span className="ml-auto text-xs text-emerald-700">No more leads visible in this tab.</span>
          )}
          <button
            onClick={() => setLastInlineCall(null)}
            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-950 transition-colors"
            aria-label="Dismiss call logged message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {!isCounsellor && (
                    <th className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer" />
                    </th>
                  )}
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    {tab === "overdue" || tab === "unclosed_visits" ? "Overdue" : tab === "post_visit" ? "Since Visit" : "Scheduled"}
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Stage</th>
                  {!isCounsellor && <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>}
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Campus</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Notes</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, rowIndex) => (
                  <tr key={r.id} className={`border-b border-border/40 hover:bg-muted/20 cursor-pointer ${selected.has(r.lead_id) ? "bg-primary/5" : ""}`}
                    onClick={() => openLeadFromQueue(r.lead_id, rowIndex)}>
                    {!isCounsellor && (
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.lead_id)}
                          onChange={() => toggleSelect(r.lead_id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                        {r.lead_name}
                        <span onClick={(e) => e.stopPropagation()}>
                          <CahetPendingBadge
                            leadId={r.lead_id}
                            leadName={r.lead_name}
                            phone={r.lead_phone}
                          />
                          <UpdeledPendingBadge
                            leadId={r.lead_id}
                            leadName={r.lead_name}
                            phone={r.lead_phone}
                          />
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-[10px] border-0 ${
                        r.type === "call" ? "bg-blue-100 text-blue-700"
                        : r.type === "visit_confirmation" ? "bg-purple-100 text-purple-700"
                        : r.type === "post_visit" ? "bg-amber-100 text-amber-700"
                        : "bg-muted text-muted-foreground"
                      }`}>{r.type.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {(tab === "overdue" || tab === "unclosed_visits") && r.days_overdue !== undefined ? (
                        <span className={`font-medium ${r.days_overdue > 2 ? "text-red-600" : "text-amber-600"}`}>
                          {fmtOverdue(r.days_overdue)}
                        </span>
                      ) : tab === "post_visit" && r.days_since_visit !== undefined ? (
                        <span className="font-medium text-amber-600">{r.days_since_visit}d ago</span>
                      ) : tab === "visit_confirm" && r.urgency ? (
                        <Badge className={`text-[10px] border-0 ${r.urgency === "same_day" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {r.urgency === "same_day" ? "Today" : "Tomorrow"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{fmtDate(r.scheduled_at)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">
                        {(r.lead_stage || "—").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    {!isCounsellor && <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.counsellor_name}</td>}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.campus_name || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{r.notes || "—"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {tab === "unclosed_visits" && (
                          <>
                            <button onClick={(e) => openCompleteDialog(r.id, r.lead_id, r.lead_name, e)}
                              className="rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-200 transition-colors"
                              title="Mark visit completed">Completed</button>
                            <button onClick={(e) => openNoShowDialog(r.id, r.lead_id, r.lead_name, null, e)}
                              className="rounded-lg bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-200 transition-colors"
                              title="Mark as no-show">No Show</button>
                            <button onClick={(e) => openRescheduleVisitDialog(r.id, r.lead_id, r.lead_name, e)}
                              className="rounded-lg bg-amber-100 p-1.5 text-amber-700 hover:bg-amber-200 transition-colors"
                              title="Reschedule visit"><CalendarClock className="h-3.5 w-3.5" /></button>
                            <button onClick={(e) => handleCloudCall(r.lead_id, e)}
                              disabled={cloudCallingId === r.lead_id}
                              className="rounded-lg bg-cyan-100 p-1.5 text-cyan-700 hover:bg-cyan-200 transition-colors disabled:opacity-60"
                              title="Cloud call lead">
                              {cloudCallingId === r.lead_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                        {(tab === "overdue" || tab === "today" || tab === "upcoming") && (
                          <button onClick={(e) => { e.stopPropagation(); startInlineCall(r, rowIndex); }}
                            className="rounded-lg bg-cyan-100 px-2.5 py-1 text-[10px] font-medium text-cyan-700 hover:bg-cyan-200 transition-colors"
                            title="Call and mark disposition inline">
                            Call
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); openLeadFromQueue(r.lead_id, rowIndex); }}
                          className="rounded-lg bg-muted p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                          title="Open lead with queue navigation">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isCounsellor ? 7 : 9} className="px-4 py-12 text-center text-muted-foreground">
                    <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{tab === "overdue" ? "No overdue follow-ups!" : "No pending items"}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {items.length >= PAGE_SIZE && (
        <div className="flex items-center justify-end gap-1.5">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-xs text-muted-foreground px-2">Page {page + 1}</span>
          <button onClick={() => setPage(page + 1)} disabled={items.length < PAGE_SIZE}
            className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
      {/* Visit Completed Dialog */}
      <Dialog open={!!completeDialog} onOpenChange={o => { if (!o) setCompleteDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Complete Visit: {completeDialog?.leadName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Visit Feedback (optional)</label>
              <textarea value={visitFeedback} onChange={e => setVisitFeedback(e.target.value)} rows={3}
                placeholder="How was the visit? Any observations..."
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Follow-up Date <span className="text-red-500">*</span></label>
              <input type="datetime-local" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <Button onClick={handleCompleteVisit} disabled={saving || !followupDate} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Mark Completed & Schedule Follow-up
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* No-Show Dialog */}
      <Dialog open={!!noShowDialog} onOpenChange={o => { if (!o) setNoShowDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>No-Show: {noShowDialog?.leadName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Student didn't show up. Choose next action:</p>
            <div className="flex gap-2">
              <button onClick={() => setFollowupAction("followup")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  followupAction === "followup" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"
                }`}>Schedule Follow-up Call</button>
              <button onClick={() => setFollowupAction("reschedule")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  followupAction === "reschedule" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"
                }`}>Reschedule Visit</button>
            </div>
            {followupAction === "followup" ? (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Follow-up Call Date <span className="text-red-500">*</span></label>
                <input type="datetime-local" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">New Visit Date <span className="text-red-500">*</span></label>
                <input type="datetime-local" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            )}
            <Button onClick={handleNoShowVisit} disabled={saving} variant="destructive" className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {followupAction === "followup" ? "Mark No-Show & Schedule Call" : "Mark No-Show & Reschedule Visit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reschedule Visit Dialog */}
      <Dialog open={!!rescheduleVisitDialog} onOpenChange={o => { if (!o) setRescheduleVisitDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule Visit: {rescheduleVisitDialog?.leadName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Pick a new date and time. The lead's stage moves back to "Visit Scheduled".</p>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">New Visit Date & Time <span className="text-red-500">*</span></label>
              <input type="datetime-local" value={newVisitDate} onChange={e => setNewVisitDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <Button onClick={handleRescheduleVisit} disabled={saving || !newVisitDate} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Reschedule Visit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PendingFollowups;
