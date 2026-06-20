import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Phone, Loader2, CheckCircle2, Clock, AlertTriangle, MessageSquareWarning,
  MessageSquare, Footprints, FileCheck2, FileEdit, Search, Snowflake,
  ExternalLink, KeyboardIcon, X, PhoneOff, XCircle, PhoneMissed, PhoneCall,
  ListPlus, BookmarkPlus,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { CahetRegisterDialog, type CahetRegisterTarget } from "@/components/leads/CahetRegisterDialog";
import {
  effectiveCahetDeadline,
  effectiveCahetDeadlineLabel,
} from "@/lib/deadlineRollover";

// Mirrors CloudDialer.CONNECTED_DISPOSITIONS — kept in sync deliberately so
// counsellors see the same options. If you add/rename a disposition there,
// update here too.
const DISPOSITIONS: { value: string; label: string; tone: string; icon: any; primary?: boolean }[] = [
  { value: "interested",     label: "Interested",     icon: CheckCircle2, tone: "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600", primary: true },
  { value: "call_back",      label: "Call Back",      icon: Clock,        tone: "bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300" },
  { value: "not_answered",   label: "Not Answered",   icon: PhoneMissed,  tone: "bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300" },
  { value: "not_interested", label: "Not Interested", icon: XCircle,      tone: "bg-red-100 hover:bg-red-200 text-red-800 border-red-300" },
  { value: "ineligible",     label: "Ineligible",     icon: AlertTriangle,tone: "bg-purple-100 hover:bg-purple-200 text-purple-800 border-purple-300" },
];

type CallStatus = "idle" | "calling" | "connected" | "ended" | "saving";

interface ActiveCall {
  lead: QueueRow;
  status: CallStatus;
  startTime: number | null;
  callUuid: string | null;
  preDisposition: string | null;
}

type Bucket =
  | "paid_application"
  | "partial_application"
  | "unreplied_whatsapp"
  | "priority_interested"
  | "engaged_whatsapp"
  | "past_visit"
  | "in_followup"
  | "overdue_followup"
  | "fresh_cold";

interface QueueRow {
  lead_id: string;
  lead_name: string;
  phone: string;
  course_name: string | null;
  counsellor_id: string | null;
  counsellor_name: string | null;
  stage: string | null;
  bucket: Bucket;
  score: number;
  last_touch_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  next_followup_at: string | null;
  visit_date: string | null;
  application_status: string | null;
  application_id: string | null;
}

interface Stats {
  own_count: number;
  own_today: number;
  team_count: number;
  team_today: number;
  pool_total: number;
  pool_remaining: number;
  deadline_at: string;
}

// Compact disposition badge palette for the "already called this session"
// marker. Matches DISPOSITIONS by value but uses muted backgrounds so a
// long list of touched rows reads as visited-but-secondary, not as a
// loud color blast competing with the active queue.
const CALLED_BADGE: Record<string, { label: string; tone: string; icon: any }> = {
  interested:     { label: "Interested",     icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  call_back:      { label: "Call back",      icon: Clock,        tone: "bg-blue-100 text-blue-800 border-blue-300" },
  not_answered:   { label: "No answer",      icon: PhoneMissed,  tone: "bg-amber-100 text-amber-800 border-amber-300" },
  not_interested: { label: "Not interested", icon: XCircle,      tone: "bg-red-100 text-red-800 border-red-300" },
  ineligible:     { label: "Ineligible",     icon: AlertTriangle,tone: "bg-purple-100 text-purple-800 border-purple-300" },
  busy:           { label: "Busy",           icon: PhoneOff,     tone: "bg-orange-100 text-orange-800 border-orange-300" },
  voicemail:      { label: "Voicemail",      icon: PhoneMissed,  tone: "bg-amber-100 text-amber-800 border-amber-300" },
};

const BUCKET_META: Record<Bucket, { label: string; tone: string; icon: any }> = {
  paid_application:     { label: "Paid",              tone: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: FileCheck2 },
  partial_application:  { label: "Partial",           tone: "bg-teal-100 text-teal-800 border-teal-300",          icon: FileEdit },
  unreplied_whatsapp:   { label: "WA unreplied",      tone: "bg-rose-100 text-rose-800 border-rose-300",          icon: MessageSquareWarning },
  priority_interested:  { label: "Priority (AI)",     tone: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300", icon: AlertTriangle },
  engaged_whatsapp:     { label: "WA engaged",        tone: "bg-blue-100 text-blue-800 border-blue-300",          icon: MessageSquare },
  past_visit:           { label: "Past visit",        tone: "bg-amber-100 text-amber-800 border-amber-300",       icon: Footprints },
  in_followup:          { label: "Followup",          tone: "bg-slate-100 text-slate-700 border-slate-300",       icon: Clock },
  overdue_followup:     { label: "Overdue followup",  tone: "bg-orange-100 text-orange-800 border-orange-300",    icon: AlertTriangle },
  fresh_cold:           { label: "Fresh / cold",      tone: "bg-sky-50 text-sky-800 border-sky-200",              icon: Snowflake },
};

const BUCKET_FILTERS: { key: "all" | Bucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid_application", label: "Paid" },
  { key: "partial_application", label: "Partial" },
  { key: "unreplied_whatsapp", label: "WA unreplied" },
  { key: "priority_interested", label: "Priority" },
  { key: "engaged_whatsapp", label: "WA engaged" },
  { key: "past_visit", label: "Past visit" },
  { key: "overdue_followup", label: "Overdue" },
  { key: "in_followup", label: "Followup" },
  { key: "fresh_cold", label: "Fresh / cold" },
];

const TARGET_PER_COUNSELLOR = 15;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function daysRemaining(deadlineIso: string): number {
  const ms = new Date(deadlineIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

const CahetSprint = () => {
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const isCounsellor = role === "counsellor";
  const profileId = profile?.id || null;

  const [scope, setScope] = useState<"mine" | "all">(isCounsellor ? "mine" : "all");
  const [bucketFilter, setBucketFilter] = useState<"all" | Bucket>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registerFor, setRegisterFor] = useState<CahetRegisterTarget | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Leads dispositioned in this browser session, mapped to their disposition
  // value. Powers the muted/tick state so counsellors can see at a glance
  // which leads they've already touched in this sprint without losing the
  // ability to re-open them.
  const [calledThisSession, setCalledThisSession] = useState<Map<string, string>>(new Map());
  const markCalled = useCallback((leadId: string, disposition: string) => {
    setCalledThisSession(prev => {
      const next = new Map(prev);
      next.set(leadId, disposition);
      return next;
    });
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Brief visual emphasis when a lead is jumped to via the picker so the user
  // can see it land in the queue.
  const [flashLeadId, setFlashLeadId] = useState<string | null>(null);

  // ── Save-as-list dialog ─────────────────────────────────────────────────
  const [showSaveList, setShowSaveList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [savingList, setSavingList] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Active call state ───────────────────────────────────────────────────
  // Mirrors the CloudDialer state machine in miniature: place → poll → connect
  // → end → dispose. Kept local to this page so the sprint feels like a
  // single-surface dialer instead of a hand-off.
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callElapsed, setCallElapsed] = useState(0);
  const pollRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  // Cleanup polling if the user navigates away mid-call.
  useEffect(() => () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);
  // 1Hz tick to drive the elapsed timer on the call bar.
  useEffect(() => {
    if (!activeCall || (activeCall.status !== "calling" && activeCall.status !== "connected")) return;
    const t = window.setInterval(() => {
      if (activeCall.startTime) setCallElapsed(Math.floor((Date.now() - activeCall.startTime) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [activeCall?.status, activeCall?.startTime]);

  // ── Data ────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const counsellorParam = scope === "mine" ? profileId : null;
    const [queueRes, statsRes] = await Promise.all([
      supabase.rpc("cahet_sprint_queue", {
        p_counsellor_id: counsellorParam,
        p_limit: 1000,
      }),
      supabase.rpc("cahet_sprint_stats", { p_counsellor_id: profileId }),
    ]);
    if (queueRes.error) {
      toast({ title: "Couldn't load queue", description: queueRes.error.message, variant: "destructive" });
    } else {
      setRows((queueRes.data as QueueRow[]) || []);
    }
    if (!statsRes.error && statsRes.data) {
      const s = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
      setStats(s as Stats);
    }
    setLoading(false);
  }, [scope, profileId, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Filtering ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => !skipped.has(r.lead_id))
      .filter(r => bucketFilter === "all" || r.bucket === bucketFilter)
      .filter(r => !q || r.lead_name?.toLowerCase().includes(q) || r.phone?.includes(q) || r.course_name?.toLowerCase().includes(q));
  }, [rows, bucketFilter, search, skipped]);

  // Keep selection valid as the filtered list changes
  useEffect(() => {
    if (filtered.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !filtered.some(r => r.lead_id === selectedId)) {
      setSelectedId(filtered[0].lead_id);
    }
  }, [filtered, selectedId]);

  const selectedRow = filtered.find(r => r.lead_id === selectedId) || null;

  // ── Actions ─────────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollStartedAtRef.current = null;
  };

  // Persist actual call dispositions + side-effects to DB. Cancellation is not
  // a disposition and must never come through this path.
  const persistDisposition = useCallback(async (lead: QueueRow, disposition: string, durationSeconds: number, callUuid: string | null) => {
    const finalUuid = callUuid || (typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `manual-${Date.now()}`);
    const durStr = durationSeconds > 0 ? ` (${Math.floor(durationSeconds / 60)}m${durationSeconds % 60 ? ` ${durationSeconds % 60}s` : ""})` : "";

    await (supabase as any).rpc("record_cloud_call_log", {
      p_call_uuid:     finalUuid,
      p_lead_id:       lead.lead_id,
      p_user_id:       user?.id || null,
      p_disposition:   disposition,
      p_duration:      durationSeconds,
      p_notes:         `CAHET Sprint: ${disposition.replace("_", " ")}`,
      p_source:        "manual",
      p_recording_url: null,
      p_call_source:   "cloud_dialer",
    });

    // Best-effort side-effects — ignore errors so a disposition is never lost
    // because of a downstream write failing.
    await supabase.from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", lead.lead_id).eq("status", "pending");

    await supabase.from("lead_activities").insert({
      lead_id: lead.lead_id, user_id: profileId, type: "call",
      description: `Call: ${disposition.replace("_", " ")}${durStr} (via CAHET Sprint)`,
    });

    await supabase.from("leads").update({ first_contact_at: new Date().toISOString() } as any)
      .eq("id", lead.lead_id).is("first_contact_at", null);

    if (disposition === "interested") {
      await supabase.from("leads").update({ stage: "counsellor_call" as any }).eq("id", lead.lead_id);
    } else if (disposition === "not_interested") {
      await supabase.from("leads").update({ stage: "not_interested" as any }).eq("id", lead.lead_id);
    }
  }, [user?.id, profileId]);

  const markDisposition = useCallback(async (disposition: string) => {
    if (!activeCall) return;
    const lead = activeCall.lead;
    const callUuid = activeCall.callUuid;
    const durationSeconds = activeCall.startTime ? Math.floor((Date.now() - activeCall.startTime) / 1000) : 0;

    setActiveCall(prev => prev ? { ...prev, status: "saving" } : prev);
    stopPolling();

    try {
      await persistDisposition(lead, disposition, durationSeconds, callUuid);
    } catch (e: any) {
      toast({ title: "Couldn't save disposition", description: e?.message || "Try again", variant: "destructive" });
      setActiveCall(prev => prev ? { ...prev, status: "ended" } : prev);
      return;
    }

    toast({
      title: `Marked "${disposition.replace("_", " ")}"`,
      description: `${lead.lead_name}${durationSeconds > 0 ? ` · ${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s` : ""}`,
    });

    markCalled(lead.lead_id, disposition);
    setActiveCall(null);
    setCallElapsed(0);

    if (disposition === "interested") {
      setRegisterFor(lead);
    } else {
      const idx = filtered.findIndex(r => r.lead_id === lead.lead_id);
      if (idx >= 0 && idx + 1 < filtered.length) setSelectedId(filtered[idx + 1].lead_id);
    }
  }, [activeCall, persistDisposition, toast, filtered, markCalled]);

  // Pre-select while connected: store on activeCall + tell user it'll commit
  // when the call ends. Useful when student is still talking but counsellor
  // already knows the outcome.
  const preSelectDisposition = useCallback((disposition: string) => {
    if (!activeCall) return;
    setActiveCall(prev => prev ? { ...prev, preDisposition: disposition } : prev);
    toast({ title: "Disposition queued", description: `"${disposition.replace("_", " ")}" will save when the call ends.` });
  }, [activeCall, toast]);

  // Poll ai_call_records every 3s for state transitions. Logic copied from
  // CloudDialer.startPolling — same source of truth so the sprint and the
  // dialer behave consistently.
  const startPolling = useCallback((callUuid: string, lead: QueueRow) => {
    pollStartedAtRef.current = Date.now();
    const poll = async () => {
      const { data } = await supabase
        .from("ai_call_records" as any)
        .select("status, duration_seconds, disposition, student_connected_at")
        .eq("call_uuid", callUuid)
        .maybeSingle();

      if (!data) return; // record not yet written

      if (data.status === "initiated") {
        if (data.student_connected_at && !data.disposition) {
          // Student answered — flip to connected so disposition buttons appear.
          setActiveCall(prev => prev && prev.status !== "connected"
            ? { ...prev, status: "connected", startTime: prev.startTime || Date.now() }
            : prev);
        } else if (data.disposition) {
          // Auto-disposed before student picked up (busy / no answer).
          stopPolling();
          const dur = data.duration_seconds || 0;
          await persistDisposition(lead, data.disposition, dur, callUuid);
          markCalled(lead.lead_id, data.disposition);
          toast({ title: `Auto-disposed: ${data.disposition.replace("_", " ")}`, description: lead.lead_name });
          setActiveCall(null); setCallElapsed(0);
        } else {
          // Still ringing — stuck guard: 8 min cap matches CloudDialer.
          const elapsed = pollStartedAtRef.current ? Date.now() - pollStartedAtRef.current : 0;
          if (elapsed > 8 * 60 * 1000) {
            stopPolling();
            await persistDisposition(lead, "not_answered", 0, callUuid);
            markCalled(lead.lead_id, "not_answered");
            toast({ title: "Call timed out", description: "Marked not answered." });
            setActiveCall(null); setCallElapsed(0);
          }
        }
        return;
      }

      // Terminal status from Plivo bridge: stop polling, show disposition UI
      // (or commit pre-selected one).
      stopPolling();
      const serverDur = data.duration_seconds || 0;
      const serverDisp = data.disposition;

      if (data.student_connected_at && !serverDisp) {
        // Call ended, no auto-disposition. If counsellor pre-selected one
        // during the call, commit it now. Otherwise show disposition buttons.
        const pre = activeCall?.preDisposition || null;
        if (pre) {
          await persistDisposition(lead, pre, serverDur, callUuid);
          markCalled(lead.lead_id, pre);
          toast({ title: `Marked "${pre.replace("_", " ")}"`, description: `${lead.lead_name} · ${Math.floor(serverDur / 60)}m ${serverDur % 60}s` });
          if (pre === "interested") setRegisterFor(lead);
          setActiveCall(null); setCallElapsed(0);
        } else {
          setActiveCall(prev => prev ? { ...prev, status: "ended" } : prev);
          setCallElapsed(serverDur);
        }
      } else if (serverDisp) {
        await persistDisposition(lead, serverDisp, serverDur, callUuid);
        markCalled(lead.lead_id, serverDisp);
        toast({ title: `Auto-disposed: ${serverDisp.replace("_", " ")}`, description: lead.lead_name });
        setActiveCall(null); setCallElapsed(0);
      } else {
        // No connection, no disposition — student never picked up.
        // (Counsellor-cancel goes through cancelCall, not this path.)
        await persistDisposition(lead, "not_answered", 0, callUuid);
        markCalled(lead.lead_id, "not_answered");
        setActiveCall(null); setCallElapsed(0);
      }
    };
    pollRef.current = window.setInterval(poll, 3000);
  }, [activeCall?.preDisposition, persistDisposition, toast, markCalled]);

  const placeCall = useCallback(async (row: QueueRow) => {
    if (!user?.id) return;
    if (activeCall && activeCall.status !== "ended") {
      toast({ title: "Already on a call", description: "Finish the current call before starting another.", variant: "destructive" });
      return;
    }
    setActiveCall({ lead: row, status: "calling", startTime: Date.now(), callUuid: null, preDisposition: null });
    setCallElapsed(0);

    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: row.lead_id, caller_user_id: user.id },
      });
      if (error || data?.error) {
        toast({ title: "Call failed", description: data?.error || error?.message || "Try again", variant: "destructive" });
        setActiveCall(null);
        return;
      }
      toast({ title: "Calling you", description: "Pick up your phone to connect." });
      if (data?.call_id) {
        setActiveCall(prev => prev ? { ...prev, callUuid: data.call_id } : prev);
        startPolling(data.call_id, row);
      }
    } catch (e: any) {
      toast({ title: "Call failed", description: e.message, variant: "destructive" });
      setActiveCall(null);
    }
  }, [user?.id, activeCall, toast, startPolling]);

  // Save the currently filtered CAHET queue as a reusable lead_list so the
  // counsellor can target it from /lists with a bulk WhatsApp / email send.
  // Snapshot the lead IDs at click time — the queue rebuilds frequently, so
  // a list materialised "now" is more predictable than refetching at send.
  const handleSaveList = useCallback(async () => {
    const ids = filtered.map(r => r.lead_id);
    if (!ids.length) {
      toast({ title: "Nothing to save", description: "Filtered queue is empty.", variant: "destructive" });
      return;
    }
    const name = newListName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give the list a name first.", variant: "destructive" });
      return;
    }
    setSavingList(true);

    const filtersSnapshot = {
      page: "cahet_sprint",
      scope,
      bucket: bucketFilter,
      search: search || null,
    };

    const { data: list, error: listErr } = await supabase
      .from("lead_lists" as any)
      .insert({
        name,
        source: "filter",
        filters_snapshot: filtersSnapshot,
        description: `CAHET Sprint — ${BUCKET_FILTERS.find(b => b.key === bucketFilter)?.label || "filtered"} (${ids.length} leads)`,
      })
      .select("id")
      .single();

    if (listErr || !list) {
      toast({ title: "Could not create list", description: listErr?.message || "Unknown error", variant: "destructive" });
      setSavingList(false);
      return;
    }

    const listId = (list as any).id;
    const members = ids.map((lead_id) => ({ list_id: listId, lead_id }));
    let memberErrors = 0;
    for (let i = 0; i < members.length; i += 500) {
      const chunk = members.slice(i, i + 500);
      const { error: memErr } = await supabase.from("lead_list_members" as any).insert(chunk);
      if (memErr) { memberErrors++; console.error("List member insert failed:", memErr); }
    }

    setSavingList(false);
    setShowSaveList(false);
    setNewListName("");
    toast({
      title: "List saved",
      description: memberErrors > 0
        ? `"${name}" — some members failed to insert. Check console.`
        : `"${name}" — ${ids.length} leads. Send bulk WA / email from the Lists page.`,
    });
  }, [filtered, newListName, scope, bucketFilter, search, toast]);

  // Jump from the picker into the queue: clear any filters that would hide
  // the lead, scroll its row into view, and briefly flash it.
  const jumpToLead = useCallback((leadId: string) => {
    setPickerOpen(false);
    if (!rows.some(r => r.lead_id === leadId)) {
      // Lead is in the BPT/BMRIT pool but not in our current queue rows
      // (likely already registered, or scope=mine excluded it). Switch to
      // widest scope so it appears.
      if (scope === "mine") setScope("all");
    }
    if (skipped.has(leadId)) {
      setSkipped(prev => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
    setBucketFilter("all");
    setSearch("");
    setSelectedId(leadId);
    setFlashLeadId(leadId);
    // Wait a tick for the row to render, then scroll + clear the flash.
    setTimeout(() => {
      rowRefs.current[leadId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setFlashLeadId(prev => prev === leadId ? null : prev), 2000);
  }, [rows, scope, skipped]);

  const cancelCall = useCallback(async () => {
    if (!activeCall) return;
    stopPolling();
    if (activeCall.callUuid) {
      try {
        const { error } = await supabase.functions.invoke("manual-call-cancel", {
          body: { call_id: activeCall.callUuid, caller_user_id: user?.id },
        });
        if (error) {
          toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
        } else {
          toast({ title: "Call cancelled", description: "No disposition recorded and no call metrics changed." });
        }
      } catch (e: any) {
        toast({ title: "Cancel failed", description: e?.message || "Try again", variant: "destructive" });
      }
    }
    setActiveCall(null);
    setCallElapsed(0);
  }, [activeCall, toast, user?.id]);

  const skipRow = useCallback((leadId: string) => {
    setSkipped(prev => {
      const next = new Set(prev);
      next.add(leadId);
      return next;
    });
  }, []);

  const moveSelection = useCallback((direction: 1 | -1) => {
    if (filtered.length === 0) return;
    const idx = Math.max(0, filtered.findIndex(r => r.lead_id === selectedId));
    const nextIdx = (idx + direction + filtered.length) % filtered.length;
    setSelectedId(filtered[nextIdx].lead_id);
  }, [filtered, selectedId]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  // Shortcuts: navigate ↑↓ · Space to call (if idle) or dispose-interested
  // (if call is ended) · R to open register · S to skip · Esc to cancel call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (registerFor) return;
      const callActive = activeCall && (activeCall.status === "calling" || activeCall.status === "connected");
      if (e.key === "Escape" && callActive) { e.preventDefault(); cancelCall(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
      else if (e.key === " ") {
        e.preventDefault();
        if (activeCall?.status === "ended") markDisposition("interested");
        else if (selectedRow && !callActive) placeCall(selectedRow);
      }
      else if ((e.key === "r" || e.key === "R") && selectedRow) { e.preventDefault(); setRegisterFor(selectedRow); }
      else if ((e.key === "s" || e.key === "S") && selectedRow) { e.preventDefault(); skipRow(selectedRow.lead_id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRow, moveSelection, placeCall, skipRow, registerFor, activeCall, cancelCall, markDisposition]);

  // ── Render ──────────────────────────────────────────────────────────────
  const deadlineIso = stats ? effectiveCahetDeadline(stats.deadline_at) : null;
  const deadlineLabel = effectiveCahetDeadlineLabel();
  const days = deadlineIso ? daysRemaining(deadlineIso) : 0;
  const ownProgress = stats ? Math.min(100, Math.round((stats.own_count / TARGET_PER_COUNSELLOR) * 100)) : 0;

  return (
    <div className="space-y-4">
      {/* Sprint summary card */}
      <Card className="border-rose-300 bg-gradient-to-r from-rose-50 to-amber-50">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-rose-800 font-semibold">
                <AlertTriangle className="h-5 w-5" />
                CAHET Counselling Registration Sprint
              </div>
              <div className="text-sm text-rose-700/80 mt-0.5">
                Last date <strong>{deadlineLabel}</strong> ({days} {days === 1 ? "day" : "days"} left). Target: {TARGET_PER_COUNSELLOR}/counsellor.
              </div>
            </div>
            <div className="flex gap-6 items-center">
              {isCounsellor && stats && (
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">You</div>
                  <div className="text-2xl font-bold text-rose-900">
                    {stats.own_count}<span className="text-base text-muted-foreground">/{TARGET_PER_COUNSELLOR}</span>
                  </div>
                  <div className="h-1.5 w-32 bg-rose-100 rounded mt-1 overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${ownProgress}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">+{stats.own_today} today</div>
                </div>
              )}
              {stats && (
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Team</div>
                  <div className="text-2xl font-bold text-slate-900">{stats.team_count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">+{stats.team_today} today</div>
                </div>
              )}
              {stats && (
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Pool left</div>
                  <div className="text-2xl font-bold text-slate-900">{stats.pool_remaining}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">of {stats.pool_total} BPT/BMRIT</div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active call bar — appears whenever a call is in flight or pending disposition */}
      {activeCall && (
        <CallControlBar
          call={activeCall}
          elapsed={callElapsed}
          onCancel={cancelCall}
          onPreSelect={preSelectDisposition}
          onDispose={markDisposition}
          onRegister={() => setRegisterFor(activeCall.lead)}
        />
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Scope toggle is shown to counsellors too: the BPT/BMRIT pool is a
            shared sprint target, and many counsellors have few or zero pool
            leads assigned to them. Locking them to "My leads" left them staring
            at an empty queue with no way to reach the 400+ unworked pool. */}
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
          <Button size="sm" variant={scope === "all" ? "default" : "ghost"} onClick={() => setScope("all")}>{isCounsellor ? "Whole pool" : "All counsellors"}</Button>
          <Button size="sm" variant={scope === "mine" ? "default" : "ghost"} onClick={() => setScope("mine")}>My leads</Button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {BUCKET_FILTERS.map(f => (
            <Button
              key={f.key}
              size="sm"
              variant={bucketFilter === f.key ? "default" : "outline"}
              onClick={() => setBucketFilter(f.key)}
              className="h-7 text-xs"
            >
              {f.label}
              {f.key !== "all" && (
                <span className="ml-1 text-muted-foreground">
                  {rows.filter(r => r.bucket === f.key && !skipped.has(r.lead_id)).length}
                </span>
              )}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-violet-300 text-violet-700 hover:bg-violet-50"
            onClick={() => setShowSaveList(true)}
            disabled={filtered.length === 0}
            title="Save the currently filtered queue as a reusable list for bulk WhatsApp / email"
          >
            <BookmarkPlus className="h-3.5 w-3.5 mr-1" />
            Save as list ({filtered.length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-rose-300 text-rose-700 hover:bg-rose-50"
            onClick={() => setPickerOpen(true)}
            title="Find any BPT/BMRIT lead (even outside this filter)"
          >
            <ListPlus className="h-3.5 w-3.5 mr-1" />
            Add from bucket
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search name / phone"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 h-8 w-56 text-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground hidden md:flex items-center gap-1">
            <KeyboardIcon className="h-3.5 w-3.5" />
            <span>↑↓ navigate · Space call/interested · R register · S skip · Esc cancel</span>
          </div>
        </div>
      </div>

      {/* Queue list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
              Loading sprint queue…
            </div>
          ) : filtered.length === 0 ? (
            // Pool-aware empty state. The misleading "Nothing left" message used
            // to fire even when the shared pool still had hundreds of unworked
            // leads — it just meant none were assigned to this counsellor. When
            // that's the case, point them at the pool instead of implying the
            // sprint is done.
            scope === "mine" && (stats?.pool_remaining ?? 0) > 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                <Snowflake className="h-10 w-10 mx-auto text-sky-400 mb-2" />
                <div className="font-medium">No BPT/BMRIT leads assigned to you.</div>
                <div className="text-sm">
                  There {stats!.pool_remaining === 1 ? "is" : "are"} still <strong>{stats!.pool_remaining}</strong> unregistered lead{stats!.pool_remaining === 1 ? "" : "s"} in the shared pool.
                </div>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <Button size="sm" onClick={() => setScope("all")} className="bg-rose-600 hover:bg-rose-700 text-white">
                    Show whole pool
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                    <ListPlus className="h-3.5 w-3.5 mr-1" /> Add from bucket
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                <div className="font-medium">Nothing left in this view.</div>
                <div className="text-sm">Try changing the filter or scope, or register the next 15 from another bucket.</div>
              </div>
            )
          ) : (
            <div ref={listRef} className="divide-y">
              {filtered.map(r => {
                const meta = BUCKET_META[r.bucket];
                const Icon = meta.icon;
                const isSelected = r.lead_id === selectedId;
                const calledDisp = calledThisSession.get(r.lead_id) || null;
                const calledMeta = calledDisp ? CALLED_BADGE[calledDisp] : null;
                const CalledIcon = calledMeta?.icon;
                return (
                  <div
                    key={r.lead_id}
                    ref={(el) => { rowRefs.current[r.lead_id] = el; }}
                    onClick={() => setSelectedId(r.lead_id)}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors ${
                      flashLeadId === r.lead_id ? "bg-rose-200/70 border-l-2 border-rose-600"
                      : calledDisp ? "bg-slate-50/70 opacity-60 hover:opacity-100 border-l-2 border-slate-300"
                      : isSelected ? "bg-rose-50/60 border-l-2 border-rose-500"
                      : "border-l-2 border-transparent"
                    }`}
                  >
                    <div className="w-7 text-center text-xs text-muted-foreground tabular-nums">{r.score}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {calledMeta && CalledIcon && (
                          <Badge variant="outline" className={`text-[10px] gap-1 ${calledMeta.tone}`} title="Dispositioned this session">
                            <CalledIcon className="h-3 w-3" />
                            {calledMeta.label}
                          </Badge>
                        )}
                        <button
                          className={`font-medium text-sm hover:underline truncate text-left ${calledDisp ? "line-through decoration-slate-400/60 decoration-1" : ""}`}
                          onClick={(e) => { e.stopPropagation(); navigate(`/admissions/${r.lead_id}`); }}
                        >
                          {r.lead_name}
                        </button>
                        <Badge variant="outline" className={`text-[10px] gap-1 ${meta.tone}`}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                        {r.course_name && (
                          <span className="text-xs text-muted-foreground">{r.course_name}</span>
                        )}
                        {r.application_id && (
                          <span className="text-[10px] text-muted-foreground">#{r.application_id}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{r.phone}</span>
                        {r.counsellor_name && <span>· {r.counsellor_name}</span>}
                        <span>· last touch {timeAgo(r.last_touch_at)}</span>
                        {r.next_followup_at && (
                          <span>· next f/u {timeAgo(r.next_followup_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        title="Open lead"
                        onClick={(e) => { e.stopPropagation(); navigate(`/admissions/${r.lead_id}`); }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!!activeCall && activeCall.lead.lead_id !== r.lead_id}
                        onClick={(e) => { e.stopPropagation(); placeCall(r); }}
                      >
                        {activeCall?.lead.lead_id === r.lead_id && activeCall.status !== "ended" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Phone className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1 text-xs">Call</span>
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 bg-rose-600 hover:bg-rose-700 text-white"
                        onClick={(e) => { e.stopPropagation(); setRegisterFor(r); }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span className="ml-1 text-xs">Register</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-muted-foreground"
                        title="Skip in this session"
                        onClick={(e) => { e.stopPropagation(); skipRow(r.lead_id); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CahetLeadPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={jumpToLead}
        onRegisterDirect={(target) => { setPickerOpen(false); setRegisterFor(target); }}
      />

      <CahetRegisterDialog
        target={registerFor}
        onClose={() => setRegisterFor(null)}
        onSaved={() => {
          setRegisterFor(null);
          fetchAll();
        }}
      />

      {/* Save filtered queue as a reusable list */}
      <Dialog open={showSaveList} onOpenChange={(o) => { if (!savingList) setShowSaveList(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save filtered queue as a list</DialogTitle>
            <DialogDescription>
              Creates a reusable list of <strong>{filtered.length}</strong> lead{filtered.length === 1 ? "" : "s"} from the current CAHET Sprint view. Use it from the Lists page to send bulk WhatsApp or email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              autoFocus
              placeholder={`CAHET — ${BUCKET_FILTERS.find(b => b.key === bucketFilter)?.label || "filtered"} — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !savingList && newListName.trim()) handleSaveList(); }}
            />
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
              Filters: <span className="font-medium">{BUCKET_FILTERS.find(b => b.key === bucketFilter)?.label}</span>
              {scope === "mine" && <span> · my leads</span>}
              {search && <span> · search "{search}"</span>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveList(false)} disabled={savingList}>Cancel</Button>
            <Button onClick={handleSaveList} disabled={savingList || !newListName.trim() || !filtered.length}>
              {savingList ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <BookmarkPlus className="h-4 w-4 mr-1.5" />}
              Save list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ── Call control bar ──────────────────────────────────────────────────────
// Sticky-feeling bar at the top of the queue, with three visual states:
//   calling   — amber, "Calling your phone", Cancel button
//   connected — green pulse, live timer, full disposition row
//   ended     — slate, "Call ended — pick a disposition", full disposition row
// Saving state briefly disables buttons while the disposition is being written.

function CallControlBar({
  call, elapsed, onCancel, onPreSelect, onDispose, onRegister,
}: {
  call: ActiveCall;
  elapsed: number;
  onCancel: () => void;
  onPreSelect: (d: string) => void;
  onDispose: (d: string) => void;
  onRegister: () => void;
}) {
  const { lead, status, preDisposition } = call;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");

  const tone =
    status === "calling"   ? "border-amber-300 bg-amber-50" :
    status === "connected" ? "border-emerald-300 bg-emerald-50" :
    status === "ended"     ? "border-slate-300 bg-slate-50" :
                             "border-slate-200 bg-slate-50/70";

  return (
    <Card className={`${tone} border-2 transition-colors`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center ${
              status === "calling"   ? "bg-amber-200 text-amber-800" :
              status === "connected" ? "bg-emerald-200 text-emerald-800 animate-pulse" :
              status === "ended"     ? "bg-slate-200 text-slate-700" :
                                       "bg-slate-200 text-slate-600"
            }`}>
              {status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {status === "calling"   && <>Calling your phone — pick up to connect to <span className="text-amber-900">{lead.lead_name}</span></>}
                {status === "connected" && <>Connected with <span className="text-emerald-900">{lead.lead_name}</span></>}
                {status === "ended"     && <>Call ended with <span className="text-slate-900">{lead.lead_name}</span> — pick a disposition</>}
                {status === "saving"    && <>Saving disposition…</>}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {lead.course_name ? `${lead.course_name} · ` : ""}{lead.phone}
                {(status === "connected" || status === "ended") && (
                  <span className="ml-2 tabular-nums font-medium text-foreground">{mm}:{ss}</span>
                )}
                {preDisposition && status === "connected" && (
                  <span className="ml-2 text-emerald-700">· queued: {preDisposition.replace("_", " ")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Disposition buttons appear when connected (pre-select) or ended (commit) */}
          {(status === "connected" || status === "ended" || status === "saving") && (
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              {DISPOSITIONS.map(d => {
                const Icon = d.icon;
                const handler = status === "connected" ? onPreSelect : onDispose;
                const isQueued = status === "connected" && preDisposition === d.value;
                return (
                  <Button
                    key={d.value}
                    size="sm"
                    variant="outline"
                    disabled={status === "saving"}
                    className={`h-8 border ${d.tone} ${isQueued ? "ring-2 ring-emerald-500" : ""}`}
                    onClick={() => handler(d.value)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs font-medium">{d.label}</span>
                  </Button>
                );
              })}
              {status === "ended" && (
                <Button
                  size="sm"
                  className="h-8 bg-rose-600 hover:bg-rose-700 text-white"
                  onClick={onRegister}
                  title="Skip disposition and go straight to CAHET registration"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Register
                </Button>
              )}
            </div>
          )}

          {/* Cancel during calling/connected */}
          {(status === "calling" || status === "connected") && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={onCancel}
              title="Cancel call (Esc)"
            >
              <PhoneOff className="h-3.5 w-3.5 mr-1" />
              {status === "calling" ? "Cancel" : "Hang up"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Lead picker dialog ────────────────────────────────────────────────────
// Searchable picker over the full BPT/BMRIT pool (429 leads as of writing).
// Lets counsellors jump to a lead that's filtered out of the current view,
// or register one directly without touching the queue at all.

interface PickerRow {
  lead_id: string;
  lead_name: string;
  phone: string | null;
  course_name: string | null;
  registered: boolean;
}

function CahetLeadPicker({
  open, onClose, onPick, onRegisterDirect,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (leadId: string) => void;
  onRegisterDirect: (target: CahetRegisterTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus on open + reset state.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search — fires when query stabilizes, also runs once on open
  // with an empty query to show the first 25 leads (acts like a default list).
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("cahet_search_pool", {
        p_query: query.trim() || null,
        p_limit: 25,
      });
      if (!error) setResults((data as PickerRow[]) || []);
      setLoading(false);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add BPT / BMRIT lead to your sprint</DialogTitle>
          <DialogDescription>
            Search any lead in the CAHET pool by name or phone. Selecting one jumps the queue to it; already-registered leads can still be viewed but can't be re-registered.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type name or phone…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
          <div className="max-h-80 overflow-y-auto rounded border divide-y">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-1.5" />
                Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {query ? "No BPT / BMRIT leads match that search." : "Type to search the CAHET pool."}
              </div>
            ) : (
              results.map(r => (
                <div key={r.lead_id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate">{r.lead_name}</span>
                      {r.registered && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0">
                          <CheckCircle2 className="h-2.5 w-2.5" /> registered
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.phone || "no phone"}
                      {r.course_name ? ` · ${r.course_name}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onPick(r.lead_id)}
                  >
                    Jump to
                  </Button>
                  {!r.registered && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-rose-600 hover:bg-rose-700 text-white"
                      onClick={() => onRegisterDirect({
                        lead_id: r.lead_id,
                        lead_name: r.lead_name,
                        phone: r.phone,
                        course_name: r.course_name,
                      })}
                    >
                      Register
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CahetSprint;
