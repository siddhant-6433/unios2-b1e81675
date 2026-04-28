import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone, PhoneOff, Pause, Play, SkipForward, Clock,
  Loader2, CheckCircle, XCircle, PhoneMissed, Users, BarChart3,
  Calendar, AlertCircle, Volume2,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface QueueLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_name: string;
  campus_name: string;
  counsellor_name: string; // bucket label in smart queue
  attempt_count: number;
  // Course details for script
  course_fee?: string;
  course_eligibility?: string;
  course_duration?: string;
  course_entrance?: string;
  course_highlights?: string;
}

interface CallState {
  status: "idle" | "calling" | "connected" | "ended" | "auto-disposed";
  startTime: number | null;
  elapsed: number;
  disposition: string | null;
  autoDisposition: boolean;
}

interface DialerStats {
  connected: number;
  busy: number;
  noAnswer: number;
  voicemail: number;
  interested: number;
  totalTalkTime: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CONNECTED_DISPOSITIONS = [
  { value: "interested", label: "Interested", icon: CheckCircle, color: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-50" },
  { value: "not_interested", label: "Not Interested", icon: XCircle, color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-50" },
  { value: "call_back", label: "Call Back", icon: Clock, color: "bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-50" },
  { value: "ineligible", label: "Ineligible", icon: AlertCircle, color: "bg-purple-100 text-purple-700 border-purple-300 hover:bg-purple-50" },
];

const FOLLOWUP_GAPS = [4, 8, 48]; // hours: 4h, 8h, 2 days

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", counsellor_call: "Follow Up", application_in_progress: "App In Progress",
  visit_scheduled: "Visit Scheduled", application_fee_paid: "Fee Paid",
};

// ── Component ───────────────────────────────────────────────────────────────

export default function CloudDialer() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isCounsellor = role === "counsellor";

  // Queue
  const [queue, setQueue] = useState<QueueLead[]>([]);
  const [queueBuckets, setQueueBuckets] = useState<{key:string; label:string; color:string; count:number}[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queueSource, setQueueSource] = useState<"smart" | "followups" | "fresh" | "all">("smart");

  // Dialer state
  const [dialerActive, setDialerActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseTime, setPauseTime] = useState(0);
  const [callState, setCallState] = useState<CallState>({ status: "idle", startTime: null, elapsed: 0, disposition: null, autoDisposition: false });
  const [autoNextTimer, setAutoNextTimer] = useState(0);
  const [followupDate, setFollowupDate] = useState("");
  const [followupTime, setFollowupTime] = useState("");
  const [stats, setStats] = useState<DialerStats>({ connected: 0, busy: 0, noAnswer: 0, voicemail: 0, interested: 0, totalTalkTime: 0 });

  const callTimerRef = useRef<number | null>(null);
  const autoNextRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<number | null>(null);

  const currentLead = queue[currentIdx] || null;

  // ── Load queue ────────────────────────────────────────────────────────────

  const loadQueue = useCallback(async () => {
    setLoading(true);

    // Get counsellor's profile ID for scoped queries (counsellors only)
    let counsellorId: string | null = null;
    if (isCounsellor) {
      const { data: myProfile } = await supabase
        .from("profiles").select("id").eq("user_id", user?.id || "").single();
      counsellorId = myProfile?.id || null;
    }

    let allLeads: { id: string; name: string; phone: string; bucket: string }[] = [];
    const buckets: {key:string; label:string; color:string; count:number}[] = [];

    if (queueSource === "smart" || queueSource === "followups") {
      const now = new Date();
      const todayStart = now.toISOString().slice(0, 10);
      const todayEnd = todayStart + "T23:59:59";

      // Build queries — scoped to counsellor if counsellor role, unscoped for admin
      let q1 = supabase.from("post_visit_pending_followups" as any).select("lead_id, lead_name, lead_phone").order("visit_date" as any, { ascending: true }).limit(50);
      let q2 = supabase.from("lead_visits" as any).select("lead_id, leads:lead_id(name, phone)").eq("status", "scheduled").gte("visit_date", todayStart).order("visit_date", { ascending: true }).limit(50);
      let q3 = supabase.from("overdue_followups" as any).select("lead_id, lead_name, lead_phone").order("scheduled_at" as any, { ascending: true }).limit(50);
      let q4 = supabase.from("lead_followups").select("lead_id, leads!inner(id, name, phone, counsellor_id)").eq("status", "pending").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd).order("scheduled_at", { ascending: true }).limit(50);
      let q5 = supabase.from("leads").select("id, name, phone").eq("stage", "new_lead").is("first_contact_at", null).not("phone", "is", null).order("created_at", { ascending: true }).limit(50);

      if (counsellorId) {
        q1 = q1.eq("counsellor_id", counsellorId);
        q3 = q3.eq("counsellor_id", counsellorId);
        q4 = supabase.from("lead_followups").select("lead_id, leads!inner(id, name, phone, counsellor_id)").eq("status", "pending").eq("leads.counsellor_id", counsellorId).gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd).order("scheduled_at", { ascending: true }).limit(50);
        q5 = q5.eq("counsellor_id", counsellorId);
      }

      const [r1, r2, r3, r4, r5] = await Promise.all([q1, q2, q3, q4, q5]);

      const seen = new Set<string>();
      const add = (items: {id:string;name:string;phone:string}[], bucket: string) => {
        items.forEach(l => { if (!seen.has(l.id) && l.phone) { seen.add(l.id); allLeads.push({ ...l, bucket }); } });
      };

      const postVisit = (r1.data || []).map((r: any) => ({ id: r.lead_id, name: r.lead_name, phone: r.lead_phone }));
      const visitConf = (r2.data || []).map((r: any) => ({ id: r.lead_id, name: (r.leads as any)?.name || "", phone: (r.leads as any)?.phone || "" })).filter((l: any) => l.phone);
      const overdue = (r3.data || []).map((r: any) => ({ id: r.lead_id, name: r.lead_name, phone: r.lead_phone }));
      const todayFu = (r4.data || []).map((r: any) => ({ id: r.lead_id, name: (r.leads as any)?.name || "", phone: (r.leads as any)?.phone || "" }));
      const newLeads = (r5.data || []).map((r: any) => ({ id: r.id, name: r.name, phone: r.phone }));

      add(postVisit, "Post-Visit");
      add(visitConf, "Visit Confirm");
      add(overdue, "Overdue");
      add(todayFu, "Today");
      add(newLeads, "New Lead");

      if (postVisit.length) buckets.push({ key: "post_visit", label: "Post-Visit", color: "bg-amber-500", count: postVisit.length });
      if (visitConf.length) buckets.push({ key: "visit_confirm", label: "Visit Confirm", color: "bg-violet-500", count: visitConf.length });
      if (overdue.length) buckets.push({ key: "overdue", label: "Overdue", color: "bg-red-500", count: overdue.length });
      if (todayFu.length) buckets.push({ key: "today", label: "Today", color: "bg-blue-500", count: todayFu.length });
      if (newLeads.length) buckets.push({ key: "new", label: "New Leads", color: "bg-orange-500", count: newLeads.length });

    } else if (queueSource === "fresh") {
      let fq = supabase.from("leads").select("id, name, phone").eq("stage", "new_lead").not("phone", "is", null).order("created_at", { ascending: true }).limit(100);
      if (counsellorId) fq = fq.eq("counsellor_id", counsellorId);
      const { data } = await fq;
      allLeads = (data || []).filter((l: any) => l.phone).map((l: any) => ({ id: l.id, name: l.name, phone: l.phone, bucket: "New Lead" }));
      buckets.push({ key: "new", label: "New Leads", color: "bg-orange-500", count: allLeads.length });
    } else {
      let aq = supabase.from("leads").select("id, name, phone, stage").in("stage", ["new_lead", "counsellor_call", "application_in_progress"]).not("phone", "is", null).order("created_at", { ascending: true }).limit(100);
      if (counsellorId) aq = aq.eq("counsellor_id", counsellorId);
      const { data } = await aq;
      allLeads = (data || []).filter((l: any) => l.phone).map((l: any) => ({ id: l.id, name: l.name, phone: l.phone, bucket: STAGE_LABELS[l.stage] || l.stage }));
      buckets.push({ key: "all", label: "All Pipeline", color: "bg-gray-500", count: allLeads.length });
    }

    // Get full lead details + attempt counts
    const leadIds = allLeads.map(l => l.id);
    const detailMap: Record<string, any> = {};
    const attemptMap: Record<string, number> = {};

    if (leadIds.length > 0) {
      // Batch fetch lead details with course info for script
      for (let i = 0; i < leadIds.length; i += 50) {
        const batch = leadIds.slice(i, i + 50);
        const { data } = await supabase.from("leads")
          .select("id, name, phone, stage, source, courses:course_id(name, fee_per_year, eligibility, entrance_exam, duration_years, highlights, career_options), campuses:campus_id(name)")
          .in("id", batch);
        (data || []).forEach((l: any) => { detailMap[l.id] = l; });
      }

      const { data: calls } = await supabase.from("ai_call_records")
        .select("lead_id").in("lead_id", leadIds).eq("call_type", "manual");
      (calls || []).forEach((c: any) => { attemptMap[c.lead_id] = (attemptMap[c.lead_id] || 0) + 1; });
    }

    const mapped: QueueLead[] = allLeads.map(l => {
      const d = detailMap[l.id] || {};
      const c = d.courses || {};
      return {
        id: l.id, name: d.name || l.name || "Unknown", phone: d.phone || l.phone || "",
        stage: d.stage || "", source: d.source || "",
        course_name: c.name || "—", campus_name: d.campuses?.name || "—",
        counsellor_name: l.bucket, attempt_count: attemptMap[l.id] || 0,
        course_fee: c.fee_per_year ? `₹${Number(c.fee_per_year).toLocaleString("en-IN")}/year` : undefined,
        course_eligibility: c.eligibility || undefined,
        course_duration: c.duration_years ? `${c.duration_years} year${c.duration_years > 1 ? "s" : ""}` : undefined,
        course_entrance: c.entrance_exam || undefined,
        course_highlights: Array.isArray(c.highlights) ? c.highlights.join(" | ") : c.highlights || undefined,
      };
    }).filter(l => l.phone);

    setQueue(mapped);
    setQueueBuckets(buckets);
    setCurrentIdx(0);
    setLoading(false);
  }, [queueSource, user?.id]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // ── Call timer ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (callState.status === "calling" || callState.status === "connected") {
      callTimerRef.current = window.setInterval(() => {
        setCallState(prev => ({ ...prev, elapsed: prev.startTime ? Math.floor((Date.now() - prev.startTime) / 1000) : 0 }));
      }, 1000);
    } else {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    }
    return () => { if (callTimerRef.current) clearInterval(callTimerRef.current); };
  }, [callState.status]);

  // ── Pause timer ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (paused) {
      const start = Date.now();
      pauseTimerRef.current = window.setInterval(() => {
        setPauseTime(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (pauseTimerRef.current) { clearInterval(pauseTimerRef.current); pauseTimerRef.current = null; }
      setPauseTime(0);
    }
    return () => { if (pauseTimerRef.current) clearInterval(pauseTimerRef.current); };
  }, [paused]);

  // ── Auto-next countdown ───────────────────────────────────────────────────

  useEffect(() => {
    if (autoNextTimer > 0 && !paused) {
      autoNextRef.current = window.setTimeout(() => {
        setAutoNextTimer(prev => prev - 1);
      }, 1000);
    } else if (autoNextTimer === 0 && callState.status === "auto-disposed" && dialerActive && !paused) {
      // Timer expired, move to next
      moveToNext();
    }
    return () => { if (autoNextRef.current) clearTimeout(autoNextRef.current); };
  }, [autoNextTimer, paused, callState.status, dialerActive]);

  // ── Place call ────────────────────────────────────────────────────────────

  const placeCall = async () => {
    if (!currentLead || !user?.id) return;
    setCallState({ status: "calling", startTime: Date.now(), elapsed: 0, disposition: null, autoDisposition: false });

    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: currentLead.id, caller_user_id: user.id },
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      });

      if (error || data?.error) {
        const msg = data?.error || error?.message || "Call failed";
        toast({ title: "Call Failed", description: msg, variant: "destructive" });
        setCallState(prev => ({ ...prev, status: "ended", disposition: "failed" }));
        return;
      }

      setCallState(prev => ({ ...prev, status: "connected" }));
      toast({ title: "Calling...", description: data?.message || "Pick up your phone" });
    } catch (e: any) {
      toast({ title: "Call Failed", description: e.message, variant: "destructive" });
      setCallState(prev => ({ ...prev, status: "ended", disposition: "failed" }));
    }
  };

  // ── Handle call end (counsellor marks disposition) ────────────────────────

  const markDisposition = async (disposition: string) => {
    if (!currentLead) return;

    // Log to call_logs
    await supabase.from("call_logs" as any).insert({
      lead_id: currentLead.id,
      disposition,
      duration_seconds: callState.elapsed,
      notes: `Cloud Dialer: ${disposition.replace("_", " ")}`,
      direction: "outbound",
      user_id: user?.id,
      called_at: new Date().toISOString(),
    });

    // Update lead stage based on disposition
    if (disposition === "interested") {
      await supabase.from("leads").update({ stage: "counsellor_call" as any }).eq("id", currentLead.id);
    } else if (disposition === "not_interested") {
      await supabase.from("leads").update({ stage: "not_interested" as any }).eq("id", currentLead.id);
    }

    setStats(prev => ({
      ...prev,
      connected: prev.connected + 1,
      interested: disposition === "interested" ? prev.interested + 1 : prev.interested,
      totalTalkTime: prev.totalTalkTime + callState.elapsed,
    }));

    setCallState(prev => ({ ...prev, status: "auto-disposed", disposition, autoDisposition: false }));
    showFollowupAndAutoNext(disposition);
  };

  // ── Auto-disposition (unanswered/busy/voicemail from Plivo) ───────────────

  const handleAutoDisposition = (disposition: string) => {
    const statsKey = disposition === "busy" ? "busy" : disposition === "voicemail" ? "voicemail" : "noAnswer";
    setStats(prev => ({ ...prev, [statsKey]: prev[statsKey] + 1 }));
    setCallState(prev => ({ ...prev, status: "auto-disposed", disposition, autoDisposition: true }));
    showFollowupAndAutoNext(disposition);
  };

  // ── Show followup and start auto-next timer ───────────────────────────────

  const showFollowupAndAutoNext = (disposition: string) => {
    if (!currentLead) return;
    const attempt = currentLead.attempt_count + 1;
    const gapIdx = Math.min(attempt - 1, FOLLOWUP_GAPS.length - 1);
    const gapHours = FOLLOWUP_GAPS[gapIdx];

    const followup = new Date(Date.now() + gapHours * 3600000);
    setFollowupDate(followup.toISOString().split("T")[0]);
    const hh = followup.getHours().toString().padStart(2, "0");
    const mm = followup.getMinutes().toString().padStart(2, "0");
    setFollowupTime(`${hh}:${mm}`);

    // Start 15s countdown for auto-disposition cases, 0 for manual
    if (["busy", "not_answered", "voicemail", "cancelled"].includes(disposition)) {
      setAutoNextTimer(15);
    } else {
      setAutoNextTimer(0); // manual disposition — no auto-next, counsellor clicks Next
    }
  };

  // ── Confirm followup and move to next ─────────────────────────────────────

  const moveToNext = async () => {
    // Save followup if there's a date
    if (currentLead && followupDate && callState.disposition !== "not_interested") {
      const scheduledAt = new Date(`${followupDate}T${followupTime || "10:00"}:00`);
      await supabase.from("lead_followups").insert({
        lead_id: currentLead.id,
        scheduled_at: scheduledAt.toISOString(),
        type: "call",
        notes: `Cloud Dialer: followup after ${callState.disposition?.replace("_", " ")} (attempt ${currentLead.attempt_count + 1})`,
        status: "pending",
      });
    }

    setAutoNextTimer(0);
    setCallState({ status: "idle", startTime: null, elapsed: 0, disposition: null, autoDisposition: false });

    if (currentIdx < queue.length - 1) {
      setCurrentIdx(prev => prev + 1);
      // Auto-place next call if dialer is active and not paused
      if (dialerActive && !paused) {
        setTimeout(() => placeCall(), 1000);
      }
    } else {
      setDialerActive(false);
      toast({ title: "Queue Complete", description: "All leads in queue have been called." });
    }
  };

  const skipLead = () => {
    setCallState({ status: "idle", startTime: null, elapsed: 0, disposition: null, autoDisposition: false });
    setAutoNextTimer(0);
    if (currentIdx < queue.length - 1) {
      setCurrentIdx(prev => prev + 1);
    }
  };

  // ── Start/Stop dialer ─────────────────────────────────────────────────────

  const startDialer = () => {
    setDialerActive(true);
    setPaused(false);
    setStats({ connected: 0, busy: 0, noAnswer: 0, voicemail: 0, interested: 0, totalTalkTime: 0 });
    placeCall();
  };

  const stopDialer = () => {
    setDialerActive(false);
    setPaused(false);
    setCallState({ status: "idle", startTime: null, elapsed: 0, disposition: null, autoDisposition: false });
    setAutoNextTimer(0);
  };

  // ── Format helpers ────────────────────────────────────────────────────────

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const formatGap = (h: number) => h >= 24 ? `${Math.floor(h / 24)}d` : `${h}h`;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100"><Phone className="h-4 w-4 text-cyan-700" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Cloud Dialer</h1>
            <p className="text-[11px] text-muted-foreground">{queue.length} leads in queue</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Queue source */}
          <select value={queueSource} onChange={e => { setQueueSource(e.target.value as any); }} disabled={dialerActive}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm disabled:opacity-50">
            <option value="smart">Smart Queue (Priority)</option>
            <option value="followups">All Follow-ups</option>
            <option value="fresh">Fresh Leads Only</option>
            <option value="all">All Pipeline</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadQueue} disabled={dialerActive}><Users className="h-3.5 w-3.5 mr-1.5" />Refresh</Button>

          {dialerActive ? (
            <>
              {paused ? (
                <Button size="sm" onClick={() => setPaused(false)} className="bg-emerald-600 hover:bg-emerald-700">
                  <Play className="h-3.5 w-3.5 mr-1.5" />Resume {pauseTime > 0 && `(${formatTime(pauseTime)})`}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setPaused(true)}>
                  <Pause className="h-3.5 w-3.5 mr-1.5" />Pause
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={stopDialer}>
                <PhoneOff className="h-3.5 w-3.5 mr-1.5" />Stop
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={startDialer} disabled={queue.length === 0} className="bg-cyan-600 hover:bg-cyan-700">
              <Phone className="h-3.5 w-3.5 mr-1.5" />Start Dialer
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Queue */}
        <div className="w-72 border-r border-border bg-muted/20 flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Call Queue</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{currentIdx + 1} of {queue.length}</p>
            {queueBuckets.length > 1 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {queueBuckets.map(b => (
                  <span key={b.key} className="inline-flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${b.color}`} />{b.label}: {b.count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {queue.map((lead, idx) => (
              <div key={lead.id}
                className={`px-4 py-2.5 border-b border-border/40 cursor-pointer transition-colors ${
                  idx === currentIdx ? "bg-cyan-50 dark:bg-cyan-950/20 border-l-2 border-l-cyan-500" :
                  idx < currentIdx ? "opacity-50" : "hover:bg-muted/50"
                }`}
                onClick={() => !dialerActive && setCurrentIdx(idx)}
              >
                <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                <p className="text-[10px] text-muted-foreground">{lead.course_name} · {lead.phone.slice(-4)}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge className="text-[9px] border-0 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30">{lead.counsellor_name}</Badge>
                  {lead.attempt_count > 0 && <Badge className="text-[9px] border-0 bg-amber-100 text-amber-700">{lead.attempt_count}x</Badge>}
                  {idx < currentIdx && <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />}
                </div>
              </div>
            ))}
            {queue.length === 0 && (
              <div className="px-4 py-12 text-center text-muted-foreground">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No leads in queue</p>
                <p className="text-[10px] mt-1">Try a different queue source</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Current lead + dialer */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {currentLead ? (
            <div className="p-5 space-y-4 w-full">
              {/* Lead info + Script side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Lead info */}
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center shrink-0">
                          <span className="text-base font-bold text-cyan-700">{currentLead.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-foreground leading-tight">{currentLead.name}</h2>
                          <p className="text-xs text-muted-foreground">{currentLead.phone}</p>
                        </div>
                      </div>
                      <a href={`/admissions/${currentLead.id}`} target="_blank" rel="noreferrer"
                        className="text-[10px] text-primary hover:underline shrink-0">Open Lead →</a>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Course</span>
                        <p className="font-medium text-foreground">{currentLead.course_name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Campus</span>
                        <p className="font-medium text-foreground">{currentLead.campus_name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Stage</span>
                        <p className="font-medium text-foreground">{STAGE_LABELS[currentLead.stage] || currentLead.stage}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Source</span>
                        <p className="font-medium text-foreground capitalize">{currentLead.source}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Bucket</span>
                        <p className="font-medium text-foreground">{currentLead.counsellor_name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Attempts</span>
                        <p className={`font-medium ${currentLead.attempt_count > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                          {currentLead.attempt_count > 0 ? `${currentLead.attempt_count} previous` : "First call"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Counsellor Script / Course Info */}
                <Card className="border-border/60 shadow-none bg-blue-50/30 dark:bg-blue-950/10">
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">📋 Counsellor Script</p>
                    {currentLead.course_name !== "—" ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between items-start">
                          <span className="text-muted-foreground shrink-0 w-20">Course</span>
                          <span className="font-semibold text-foreground text-right">{currentLead.course_name}</span>
                        </div>
                        {currentLead.course_fee && (
                          <div className="flex justify-between items-start">
                            <span className="text-muted-foreground shrink-0 w-20">Fee</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 text-right">{currentLead.course_fee}</span>
                          </div>
                        )}
                        {currentLead.course_duration && (
                          <div className="flex justify-between items-start">
                            <span className="text-muted-foreground shrink-0 w-20">Duration</span>
                            <span className="font-medium text-foreground text-right">{currentLead.course_duration}</span>
                          </div>
                        )}
                        {currentLead.course_eligibility && (
                          <div className="flex justify-between items-start">
                            <span className="text-muted-foreground shrink-0 w-20">Eligibility</span>
                            <span className="font-medium text-foreground text-right leading-relaxed">{currentLead.course_eligibility}</span>
                          </div>
                        )}
                        {currentLead.course_entrance && (
                          <div className="flex justify-between items-start">
                            <span className="text-muted-foreground shrink-0 w-20">Entrance</span>
                            <span className="font-medium text-foreground text-right">{currentLead.course_entrance}</span>
                          </div>
                        )}
                        {currentLead.course_highlights && (
                          <div className="pt-1.5 border-t border-blue-200/50">
                            <span className="text-muted-foreground text-[10px]">Highlights</span>
                            <p className="font-medium text-foreground leading-relaxed mt-0.5">{currentLead.course_highlights}</p>
                          </div>
                        )}

                        <div className="pt-2 border-t border-blue-200/50 space-y-1.5">
                          <p className="text-[10px] font-semibold text-blue-600">Talking Points:</p>
                          <p className="text-muted-foreground leading-relaxed">
                            "Hello {currentLead.name.split(" ")[0]}, this is [Your Name] from NIMT. I'm calling regarding your interest in {currentLead.course_name}.
                            {currentLead.course_fee ? ` The annual fee is ${currentLead.course_fee}.` : ""}
                            {" "}Would you like to know more about the course or schedule a campus visit?"
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground space-y-1.5">
                        <p>No course selected for this lead.</p>
                        <p className="leading-relaxed">
                          "Hello {currentLead.name.split(" ")[0]}, this is [Your Name] from NIMT Educational Institutions.
                          I'm calling regarding your enquiry. What course are you interested in?"
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Call status */}
              <Card className={`border-2 shadow-none ${
                callState.status === "connected" ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-950/20" :
                callState.status === "calling" ? "border-cyan-300 bg-cyan-50/50 dark:border-cyan-600 dark:bg-cyan-950/20" :
                callState.status === "auto-disposed" ? "border-amber-300 bg-amber-50/50 dark:border-amber-600 dark:bg-amber-950/20" :
                "border-border"
              }`}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {callState.status === "calling" && <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />}
                      {callState.status === "connected" && <Volume2 className="h-5 w-5 text-emerald-600 animate-pulse" />}
                      {callState.status === "auto-disposed" && <CheckCircle className="h-5 w-5 text-amber-600" />}
                      {callState.status === "idle" && <Phone className="h-5 w-5 text-muted-foreground" />}
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {callState.status === "idle" && "Ready to call"}
                          {callState.status === "calling" && "Calling your phone..."}
                          {callState.status === "connected" && "Connected"}
                          {callState.status === "ended" && "Call ended"}
                          {callState.status === "auto-disposed" && `${callState.disposition?.replace("_", " ").toUpperCase()}`}
                        </p>
                        {callState.status !== "idle" && (
                          <p className="text-xs text-muted-foreground">{formatTime(callState.elapsed)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {callState.status === "idle" && !dialerActive && (
                        <Button size="sm" onClick={placeCall} className="bg-cyan-600 hover:bg-cyan-700">
                          <Phone className="h-3.5 w-3.5 mr-1.5" />Call Now
                        </Button>
                      )}
                      {callState.status === "idle" && (
                        <Button size="sm" variant="ghost" onClick={skipLead}>
                          <SkipForward className="h-3.5 w-3.5 mr-1.5" />Skip
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Call timer bar */}
                  {(callState.status === "calling" || callState.status === "connected") && (
                    <div className="mt-3 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${callState.status === "connected" ? "bg-emerald-500" : "bg-cyan-500"}`}
                        style={{ width: `${Math.min(100, (callState.elapsed / 300) * 100)}%` }} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Disposition (for connected calls) */}
              {callState.status === "connected" && (
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Mark Disposition</p>
                    <div className="grid grid-cols-2 gap-2">
                      {CONNECTED_DISPOSITIONS.map(d => (
                        <button key={d.value} onClick={() => markDisposition(d.value)}
                          className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${d.color}`}>
                          <d.icon className="h-4 w-4" />
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Auto-disposition + followup */}
              {callState.status === "auto-disposed" && (
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {callState.autoDisposition ? "Auto-marked" : "Disposition saved"}: {callState.disposition?.replace("_", " ")}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Attempt {currentLead.attempt_count + 1} · Next gap: {formatGap(FOLLOWUP_GAPS[Math.min(currentLead.attempt_count, FOLLOWUP_GAPS.length - 1)])}
                        </p>
                      </div>
                      {autoNextTimer > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="relative w-10 h-10">
                            <svg className="w-10 h-10 -rotate-90">
                              <circle cx="20" cy="20" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                              <circle cx="20" cy="20" r="16" fill="none" stroke="#06b6d4" strokeWidth="3"
                                strokeDasharray={`${(autoNextTimer / 15) * 100.5} 100.5`} strokeLinecap="round" />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">{autoNextTimer}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Followup edit */}
                    {callState.disposition !== "not_interested" && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                        <input type="date" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
                          className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm flex-1" />
                        <input type="time" value={followupTime} onChange={e => setFollowupTime(e.target.value)}
                          className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm w-28" />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={moveToNext} className="bg-cyan-600 hover:bg-cyan-700 flex-1">
                        <SkipForward className="h-3.5 w-3.5 mr-1.5" />
                        {currentIdx < queue.length - 1 ? "Next Call" : "Finish"}
                      </Button>
                      {autoNextTimer > 0 && (
                        <Button size="sm" variant="outline" onClick={() => setAutoNextTimer(0)}>Stop Timer</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Phone className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a lead or start the dialer</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom stats bar */}
      {dialerActive && (
        <div className="px-6 py-2.5 border-t border-border bg-card flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-semibold text-foreground">Session Stats</span></div>
          <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-emerald-500" />{stats.connected} connected</div>
          <div className="flex items-center gap-1.5"><PhoneMissed className="h-3 w-3 text-amber-500" />{stats.noAnswer} no answer</div>
          <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-orange-500" />{stats.busy} busy</div>
          <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-cyan-500" />{stats.interested} interested</div>
          <div className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-muted-foreground" />Talk time: {formatTime(stats.totalTalkTime)}</div>
          {paused && <Badge className="text-[9px] border-0 bg-amber-100 text-amber-700 animate-pulse">PAUSED {formatTime(pauseTime)}</Badge>}
        </div>
      )}
    </div>
  );
}
