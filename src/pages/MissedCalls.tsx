/**
 * Missed Calls — counsellor follow-up queue for inbound calls received
 * outside business hours.
 *
 * The voice-agent flags ai_call_records with needs_followup=true when an
 * inbound lands at a time no counsellor was on duty. The AI agent picks
 * up the live call so the lead doesn't get a dead line, but a human
 * needs to call back the next business morning. This page is that queue.
 *
 * Sort order: oldest first (FIFO — caller who waited longest gets called
 * back first). Click-to-call uses the existing manual-call edge function
 * so the dialer flow + recording + activity logging is consistent.
 */

import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, PhoneMissed, CheckCircle2, ExternalLink, Clock, MessageSquare, RefreshCw, User, UserPlus, X } from "lucide-react";
import { SelectField } from "@/components/ui/state-fields";
import { Checkbox } from "@/components/ui/checkbox";
import { recordCallDisposition } from "@/lib/callDisposition";
import { type CallDispositionData, type DialogCallStatus } from "@/components/admissions/CallDispositionDialog";

const CallDispositionDialog = lazy(() =>
  import("@/components/admissions/CallDispositionDialog").then(m => ({ default: m.CallDispositionDialog }))
);

interface MissedCall {
  id: string;
  lead_id: string;
  call_uuid: string;
  created_at: string;
  followup_reason: string | null;
  summary: string | null;
  disposition: string | null;
  duration_seconds: number | null;
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  lead_counsellor_id: string | null;
  counsellor_name: string;
  course_name: string;
  lead_source: string | null;
  jd_category: string | null;
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true,
    day: "2-digit", month: "short",
  });
}

export default function MissedCalls() {
  const { user, role, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [calls, setCalls] = useState<MissedCall[]>([]);
  const [allCalls, setAllCalls] = useState<MissedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [counsellorFilter, setCounsellorFilter] = useState("all");
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);

  // Bulk assignment (admins only — mirrors LeadBuckets' claim_leads flow).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignCounsellorId, setAssignCounsellorId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [allCounsellors, setAllCounsellors] = useState<{ id: string; name: string }[]>([]);

  // Inline call+disposition state (mirrors LeadDetail's flow so we don't
  // shove the counsellor off to a different page just to log the call).
  const [activeMc, setActiveMc] = useState<MissedCall | null>(null);
  const [activeCallUuid, setActiveCallUuid] = useState<string | null>(null);
  const [callingNow, setCallingNow] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [dispositionStatus, setDispositionStatus] = useState<DialogCallStatus | undefined>(undefined);
  const [dispositionEnded, setDispositionEnded] = useState(false);

  const isCounsellor = role === "counsellor";
  const canViewAll = role === "super_admin" || role === "admission_head" || role === "campus_admin" || role === "principal";

  const refresh = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("ai_call_records" as any)
      .select("id, lead_id, call_uuid, created_at, followup_reason, summary, disposition, duration_seconds")
      .eq("needs_followup", true)
      .is("followup_done_at", null)
      .order("created_at", { ascending: true })
      .limit(200);

    const list = (rows as any[] | null) || [];
    if (!list.length) { setCalls([]); setAllCalls([]); setLoading(false); return; }

    // Batch lead details
    const leadIds = [...new Set(list.map(r => r.lead_id).filter(Boolean))];
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, phone, stage, counsellor_id, source, jd_category, courses:course_id(name)")
      .in("id", leadIds);
    const leadMap: Record<string, any> = {};
    (leads || []).forEach((l: any) => { leadMap[l.id] = l; });

    // Fetch counsellor names for all unique counsellor_ids
    const counsellorIds = [...new Set((leads || []).map((l: any) => l.counsellor_id).filter(Boolean))];
    const counsellorMap: Record<string, string> = {};
    if (counsellorIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", counsellorIds);
      (profs || []).forEach((p: any) => { counsellorMap[p.id] = p.display_name || "Unknown"; });
    }

    // Build counsellor filter options from active counsellors in this list
    if (canViewAll) {
      const opts = counsellorIds
        .map(id => ({ id, name: counsellorMap[id] || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCounsellorOptions(opts);
    }

    let mapped: MissedCall[] = list.map((r: any) => {
      const lead = leadMap[r.lead_id] || {};
      return {
        id: r.id,
        lead_id: r.lead_id,
        call_uuid: r.call_uuid,
        created_at: r.created_at,
        followup_reason: r.followup_reason,
        summary: r.summary,
        disposition: r.disposition,
        duration_seconds: r.duration_seconds,
        lead_name: lead.name || "Unknown",
        lead_phone: lead.phone || "—",
        lead_stage: lead.stage || "",
        lead_counsellor_id: lead.counsellor_id || null,
        counsellor_name: lead.counsellor_id ? (counsellorMap[lead.counsellor_id] || "Unknown") : "Unassigned",
        course_name: (lead.courses as any)?.name || "",
        lead_source: lead.source || null,
        jd_category: lead.jd_category || null,
      };
    });

    // Counsellor scoping: only their own assigned leads
    if (isCounsellor && profile?.id) {
      mapped = mapped.filter(c => c.lead_counsellor_id === profile.id);
    }

    setAllCalls(mapped);
    setCalls(mapped);
    setLoading(false);
  };

  // Apply counsellor filter client-side. "unassigned" matches rows whose
  // lead has no counsellor yet — useful for admins triaging the backlog
  // and bulk-assigning to a team member.
  useEffect(() => {
    if (counsellorFilter === "all") {
      setCalls(allCalls);
    } else if (counsellorFilter === "unassigned") {
      setCalls(allCalls.filter(c => !c.lead_counsellor_id));
    } else {
      setCalls(allCalls.filter(c => c.lead_counsellor_id === counsellorFilter));
    }
    // Clear any selection that filters out so the action bar count never lies.
    setSelectedIds(prev => {
      const visible = new Set(
        (counsellorFilter === "all"
          ? allCalls
          : counsellorFilter === "unassigned"
            ? allCalls.filter(c => !c.lead_counsellor_id)
            : allCalls.filter(c => c.lead_counsellor_id === counsellorFilter)
        ).map(c => c.id)
      );
      const next = new Set<string>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next;
    });
  }, [counsellorFilter, allCalls]);

  useEffect(() => { refresh(); }, [profile?.id]);

  // Load the full counsellor list once for admins so the bulk-assign
  // dropdown has every active counsellor — not just the ones who happen
  // to have missed-calls in the current list (the in-list filter dropdown
  // is built from `counsellorOptions` which is the narrower set).
  useEffect(() => {
    if (!canViewAll) return;
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["counsellor", "admission_head"]);
      if (!roles?.length) { setAllCounsellors([]); return; }
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, login_disabled")
        .in("user_id", userIds);
      const active = (profs || [])
        .filter((p: any) => !p.login_disabled)
        .map((p: any) => ({ id: p.id, name: p.display_name || "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAllCounsellors(active);
    })();
  }, [canViewAll]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === calls.length && calls.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(calls.map(c => c.id)));
    }
  };

  const bulkAssign = async () => {
    if (!assignCounsellorId || selectedIds.size === 0) return;
    const leadIds = Array.from(
      new Set(
        calls
          .filter(c => selectedIds.has(c.id))
          .map(c => c.lead_id)
          .filter(Boolean)
      )
    );
    if (leadIds.length === 0) return;
    setAssigning(true);
    // claim_leads is SECURITY DEFINER and silently skips already-claimed
    // leads — returning {assigned_count, failed_count}. Same RPC used by
    // /lead-buckets so admins don't have two assignment paths to learn.
    const { data, error } = await supabase.rpc("claim_leads" as any, {
      _lead_ids: leadIds,
      _assign_to: assignCounsellorId,
    });
    setAssigning(false);
    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    const assignedCount = result?.assigned_count ?? leadIds.length;
    const failedCount = result?.failed_count ?? 0;
    toast({
      title: assignedCount > 0 ? "Leads assigned" : "No leads assigned",
      description: assignedCount === 0
        ? "These leads may already be assigned to another counsellor."
        : failedCount > 0
          ? `${assignedCount} assigned, ${failedCount} already claimed.`
          : `${assignedCount} lead${assignedCount > 1 ? "s" : ""} assigned successfully.`,
      variant: assignedCount === 0 ? "destructive" : "default",
    });
    setSelectedIds(new Set());
    setAssignCounsellorId("");
    refresh();
  };

  // Trigger the Plivo cloud call inline and open the disposition dialog
  // for *this* missed-call row. Same UX as the lead page's Cloud Call
  // button — counsellor never has to leave /missed-calls.
  const triggerCloudCall = async (mc: MissedCall) => {
    if (!user?.id || callingNow) return;
    setActiveMc(mc);
    setActiveCallUuid(null);
    setDispositionStatus("calling");
    setDispositionEnded(false);
    setShowDialog(true);
    setCallingNow(true);
    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: mc.lead_id, caller_user_id: user.id },
      });
      if (error || (data as any)?.error) {
        let detail = (data as any)?.error || error?.message || "Try again";
        try {
          const ctx = (error as any)?.context as Response | undefined;
          if (ctx) {
            const raw = await ctx.text().catch(() => "");
            try { detail = JSON.parse(raw)?.error || raw || detail; } catch { detail = raw || detail; }
          }
        } catch { /* ignore */ }
        toast({ title: "Couldn't start call", description: detail, variant: "destructive" });
        setShowDialog(false);
        setActiveMc(null);
        return;
      }
      setActiveCallUuid((data as any)?.call_id || null);
      toast({
        title: "Calling you",
        description: (data as any)?.message || "Pick up your phone to connect to the lead.",
      });
    } catch (e: any) {
      toast({ title: "Couldn't start call", description: e?.message || "Try again", variant: "destructive" });
      setShowDialog(false);
      setActiveMc(null);
    } finally {
      setCallingNow(false);
    }
  };

  // Poll ai_call_records for the live call status (same state machine as
  // LeadDetail — connected / no_answer / busy / failed). Drives the
  // disposition dialog's auto-flow so the picker swaps from "waiting for
  // pickup" → full picker as soon as Plivo says the bridge is up.
  useEffect(() => {
    if (!activeCallUuid || !showDialog) return;
    if (dispositionEnded) return;
    if (dispositionStatus && dispositionStatus !== "calling") return;
    let cancelled = false;
    const tick = async () => {
      const { data } = await (supabase as any)
        .from("ai_call_records")
        .select("status, duration_seconds, student_connected_at")
        .eq("call_uuid", activeCallUuid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const s = String(data.status || "").toLowerCase();
      const dur = data.duration_seconds || 0;
      const wasAnswered = !!data.student_connected_at
        || s === "in-progress" || s === "in_progress" || s === "answered"
        || (s === "completed" && dur > 5);
      if (s === "completed" && wasAnswered) {
        setDispositionStatus("connected");
        setDispositionEnded(true);
        return;
      }
      if (wasAnswered) { setDispositionStatus("connected"); return; }
      if (s === "no_answer" || s === "no-answer" || s === "cancel") setDispositionStatus("no_answer");
      else if (s === "busy") setDispositionStatus("busy");
      else if (s === "failed") setDispositionStatus("failed");
      else if (s === "completed") setDispositionStatus("no_answer");
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeCallUuid, showDialog, dispositionStatus, dispositionEnded]);

  // Reset call state whenever the dialog closes so the next call is clean.
  useEffect(() => {
    if (!showDialog) {
      setDispositionStatus(undefined);
      setDispositionEnded(false);
      setActiveCallUuid(null);
      setActiveMc(null);
    }
  }, [showDialog]);

  // On disposition submit: run the shared pipeline (call_logs, activity,
  // auto-stage, WhatsApp, follow-up) then resolve this missed-call. The
  // missed-call closes *only* when a disposition is saved — not when the
  // call is merely placed.
  const onDispositionSubmit = async (data: CallDispositionData) => {
    if (!activeMc) return;
    await recordCallDisposition({
      supabase,
      leadId: activeMc.lead_id,
      lead: { name: activeMc.lead_name, phone: activeMc.lead_phone, stage: activeMc.lead_stage },
      userId: user?.id || null,
      profileId: profile?.id || null,
      courseName: activeMc.course_name || null,
      data,
      loggedFromLabel: "missed calls",
    });
    // Mark the missed-call as resolved.
    if (profile?.id) {
      const { error } = await supabase
        .from("ai_call_records" as any)
        .update({ followup_done_at: new Date().toISOString(), followup_done_by: profile.id })
        .eq("id", activeMc.id);
      if (error) console.error("Failed to clear missed-call after disposition:", error);
    }
    toast({ title: "Call logged", description: "Missed-call cleared from the queue." });
    setCalls(prev => prev.filter(c => c.id !== activeMc.id));
    setAllCalls(prev => prev.filter(c => c.id !== activeMc.id));
    setShowDialog(false);
  };

  return (
    <div className="p-5 space-y-4 animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PhoneMissed className="h-6 w-6 text-warning-foreground" />Missed Calls
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Inbound calls received outside business hours (9 AM–8 PM IST, Mon-Sat).
            The AI agent picked up — call these leads back today as top priority.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canViewAll && (counsellorOptions.length > 0 || allCalls.some(c => !c.lead_counsellor_id)) && (
            <SelectField
              value={counsellorFilter}
              onValueChange={setCounsellorFilter}
              options={[
                { value: "all", label: "All Counsellors" },
                ...(allCalls.some(c => !c.lead_counsellor_id) ? [{ value: "unassigned", label: "Unassigned" }] : []),
                ...counsellorOptions.map(c => ({ value: c.id, label: c.name })),
              ]}
              hideLabel
              placeholder="All Counsellors"
            />
          )}
          <Button size="sm" variant="outline" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
      </div>

      {/* Summary banner */}
      {!loading && calls.length > 0 && (
        <div className="rounded-xl border border-warning/20 bg-warning/5/50 dark:bg-warning/90/20 px-4 py-3 flex items-start gap-3">
          {canViewAll ? (
            <div className="mt-0.5">
              <Checkbox
                checked={selectedIds.size > 0 && selectedIds.size === calls.length}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all visible callbacks"
              />
            </div>
          ) : (
            <PhoneMissed className="h-5 w-5 text-warning-foreground shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning-foreground dark:text-warning/30">
              {calls.length} pending callback{calls.length === 1 ? "" : "s"}
              {isCounsellor ? " assigned to you" : canViewAll ? " across the team" : ""}
            </p>
            <p className="text-[11px] text-warning-foreground dark:text-warning/40/80">
              Sorted oldest first — the lead waiting longest is at the top.
              Tap <span className="font-semibold">Cloud Call</span> to place a Plivo call right here. The disposition picker opens
              automatically when the call connects — the entry is cleared from the queue only after you save a disposition.
              {canViewAll && (
                <> Tick rows to bulk-assign their leads to a counsellor.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-12 flex items-center justify-center">
          <OrbLoader state="connecting" />
        </div>
      ) : calls.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No pending callbacks</p>
            <p className="text-xs text-muted-foreground mt-1">
              When inbound calls land outside business hours, they'll show up here for you to follow up.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {calls.map((mc) => {
            const created = new Date(mc.created_at);
            return (
              <Card
                key={mc.id}
                className={`hover:bg-muted/20 transition-colors ${
                  selectedIds.has(mc.id) ? "ring-2 ring-cyan-400 border-cyan-300" : ""
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
                    {canViewAll && (
                      <div className="pt-1 shrink-0">
                        <Checkbox
                          checked={selectedIds.has(mc.id)}
                          onCheckedChange={() => toggleSelect(mc.id)}
                          aria-label={`Select ${mc.lead_name}`}
                        />
                      </div>
                    )}
                    {/* Lead identity */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => navigate(`/admissions/${mc.lead_id}`)}
                          className="text-base font-semibold text-foreground hover:text-primary truncate inline-flex items-center gap-1"
                        >
                          {mc.lead_name}<ExternalLink className="h-3 w-3" />
                        </button>
                        <a
                          href={`tel:${mc.lead_phone}`}
                          className="text-sm font-mono font-semibold text-success hover:underline shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {mc.lead_phone}
                        </a>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 dark:bg-warning/80/40 text-warning-foreground dark:text-warning/30 px-2 py-0.5 text-xs font-semibold">
                          <Clock className="h-3.5 w-3.5" />Missed at {formatTime(created)}
                        </span>
                        <span className="text-xs text-muted-foreground">({relativeTime(created)})</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        {mc.course_name && <span>{mc.course_name}</span>}
                        {canViewAll && (
                          <span className="inline-flex items-center gap-1 text-primary dark:text-primary/60 font-medium">
                            <User className="h-3 w-3" />{mc.counsellor_name}
                          </span>
                        )}
                      </div>
                      {mc.followup_reason && (
                        <p className="text-[11px] text-warning-foreground dark:text-warning/70 mt-1 italic">
                          {mc.followup_reason}
                        </p>
                      )}
                      {mc.summary && (
                        <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 border border-border/60">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5 flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />AI conversation summary
                          </p>
                          <p className="text-[12px] text-foreground leading-snug">{mc.summary}</p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col items-stretch gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => triggerCloudCall(mc)}
                        disabled={
                          !mc.lead_phone || mc.lead_phone === "—" ||
                          (callingNow && activeMc?.id === mc.id)
                        }
                        title="Places a Plivo Cloud Call to this lead and opens the disposition picker right here. The missed-call entry clears only after you save a disposition."
                        className="bg-cyan-600 hover:bg-cyan-700 text-white gap-1.5"
                      >
                        {callingNow && activeMc?.id === mc.id
                          ? <ButtonOrb state="working" onFilled />
                          : <Phone className="h-3.5 w-3.5" />}
                        Cloud Call
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sticky bulk-assign bar — admins only, shows once at least one row
          is ticked. Anchored to the bottom of the viewport so it stays
          reachable while scrolling a long queue. */}
      {canViewAll && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(720px,calc(100vw-2rem))]">
          <div className="rounded-2xl border border-border bg-card shadow-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center justify-center h-7 min-w-7 rounded-full bg-cyan-600 text-white text-xs font-bold px-2">
                {selectedIds.size}
              </span>
              <span className="text-sm font-medium text-foreground">
                selected
              </span>
            </div>
            <div className="h-5 w-px bg-border shrink-0" />
            <select
              value={assignCounsellorId}
              onChange={e => setAssignCounsellorId(e.target.value)}
              disabled={assigning}
              className="flex-1 min-w-[160px] rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20 disabled:opacity-50"
            >
              <option value="">Assign to counsellor…</option>
              {allCounsellors.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={bulkAssign}
              disabled={assigning || !assignCounsellorId}
              className="gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {assigning ? <ButtonOrb state="working" onFilled /> : <UserPlus className="h-3.5 w-3.5" />}
              Assign
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSelectedIds(new Set()); setAssignCounsellorId(""); }}
              disabled={assigning}
              title="Clear selection"
              className="px-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {activeMc && (
        <Suspense fallback={null}>
          <CallDispositionDialog
            open={showDialog}
            onOpenChange={setShowDialog}
            leadName={activeMc.lead_name}
            leadPhone={activeMc.lead_phone}
            campuses={[]}
            onSubmit={onDispositionSubmit}
            callStatus={dispositionStatus}
            callEnded={dispositionEnded}
            onManualConnect={() => setDispositionStatus("connected")}
            onCancelCall={activeCallUuid ? async () => {
              // Hang up the live Plivo bridge without recording a call
              // disposition or call metric. The dialog closes either way so
              // the counsellor isn't trapped on a broken state.
              try {
                const { error } = await supabase.functions.invoke("manual-call-cancel", {
                  body: { call_id: activeCallUuid, caller_user_id: user?.id },
                });
                if (error) {
                  toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: "Call cancelled", description: "Both legs dropped." });
                }
              } catch (e: any) {
                toast({ title: "Cancel failed", description: e?.message || "Try again", variant: "destructive" });
              }
            } : undefined}
            courseName={activeMc.course_name || null}
            leadStage={activeMc.lead_stage || null}
            aiCallSummary={activeMc.summary}
            latestNote={activeMc.followup_reason}
            leadSource={activeMc.lead_source}
            jdKeyword={activeMc.jd_category}
          />
        </Suspense>
      )}
    </div>
  );
}
