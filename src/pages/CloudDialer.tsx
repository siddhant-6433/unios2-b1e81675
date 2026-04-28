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
  counsellor_name: string;
  attempt_count: number;
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
  const { user } = useAuth();
  const { toast } = useToast();

  // Queue
  const [queue, setQueue] = useState<QueueLead[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queueSource, setQueueSource] = useState<"followups" | "fresh" | "all">("followups");

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
    let leads: any[] = [];

    if (queueSource === "followups") {
      // Pending followups for this counsellor
      const { data } = await supabase
        .from("lead_followups")
        .select("lead_id, leads:lead_id(id, name, phone, stage, source, courses:course_id(name), campuses:campus_id(name))")
        .eq("status", "pending")
        .eq("type", "call")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(100);
      leads = (data || []).map((f: any) => f.leads).filter(Boolean);
    } else if (queueSource === "fresh") {
      // Fresh leads not yet called
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, stage, source, courses:course_id(name), campuses:campus_id(name)")
        .eq("stage", "new_lead")
        .not("phone", "is", null)
        .order("created_at", { ascending: true })
        .limit(100);
      leads = data || [];
    } else {
      // All leads in pipeline
      const { data } = await supabase
        .from("leads")
        .select("id, name, phone, stage, source, courses:course_id(name), campuses:campus_id(name)")
        .in("stage", ["new_lead", "counsellor_call", "application_in_progress"])
        .not("phone", "is", null)
        .order("created_at", { ascending: true })
        .limit(100);
      leads = data || [];
    }

    // Get attempt counts
    const leadIds = leads.map((l: any) => l.id);
    const attemptMap: Record<string, number> = {};
    if (leadIds.length > 0) {
      const { data: calls } = await supabase
        .from("ai_call_records")
        .select("lead_id")
        .in("lead_id", leadIds)
        .eq("call_type", "manual");
      (calls || []).forEach((c: any) => { attemptMap[c.lead_id] = (attemptMap[c.lead_id] || 0) + 1; });
    }

    const mapped: QueueLead[] = leads.map((l: any) => ({
      id: l.id, name: l.name || "Unknown", phone: l.phone || "",
      stage: l.stage || "", source: l.source || "",
      course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
      counsellor_name: "", attempt_count: attemptMap[l.id] || 0,
    })).filter(l => l.phone);

    setQueue(mapped);
    setCurrentIdx(0);
    setLoading(false);
  }, [queueSource]);

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
            <option value="followups">Pending Follow-ups</option>
            <option value="fresh">Fresh Leads</option>
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
                  <Badge className="text-[9px] border-0 bg-muted text-muted-foreground">{STAGE_LABELS[lead.stage] || lead.stage}</Badge>
                  {lead.attempt_count > 0 && <Badge className="text-[9px] border-0 bg-amber-100 text-amber-700">{lead.attempt_count} calls</Badge>}
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
            <div className="p-6 space-y-5 max-w-2xl mx-auto w-full">
              {/* Lead info card */}
              <Card className="border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center shrink-0">
                      <span className="text-lg font-bold text-cyan-700">{currentLead.name[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold text-foreground">{currentLead.name}</h2>
                      <p className="text-sm text-muted-foreground">{currentLead.phone}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge className="text-[10px] border-0 bg-muted">{currentLead.course_name}</Badge>
                        <Badge className="text-[10px] border-0 bg-muted">{currentLead.campus_name}</Badge>
                        <Badge className="text-[10px] border-0 bg-muted capitalize">{currentLead.source}</Badge>
                        <Badge className={`text-[10px] border-0 ${currentLead.attempt_count > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {currentLead.attempt_count > 0 ? `${currentLead.attempt_count} prev calls` : "First call"}
                        </Badge>
                      </div>
                    </div>
                    <a href={`/admissions/${currentLead.id}`} target="_blank" rel="noreferrer"
                      className="text-xs text-primary hover:underline shrink-0">Open Lead →</a>
                  </div>
                </CardContent>
              </Card>

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
