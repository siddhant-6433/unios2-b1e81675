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
  Calendar, AlertCircle, Volume2, Pencil, Check, X, Search,
  FileText, PhoneIncoming,
} from "lucide-react";
import { CourseInfoPanel } from "@/components/leads/CourseInfoPanel";

// ── Types ───────────────────────────────────────────────────────────────────

interface QueueLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_id: string | null;
  course_name: string;
  campus_name: string;
  bucket: string; // bucket label in smart queue
  attempt_count: number;
  course_fee?: string;
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
  { value: "cancelled", label: "Cancelled", icon: PhoneOff, color: "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-50" },
  { value: "not_answered", label: "Not Answered", icon: PhoneMissed, color: "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-50" },
];

const FOLLOWUP_GAPS = [4, 8, 48]; // hours: 4h, 8h, 2 days
const MAX_AUTO_ATTEMPTS = 4; // after 4 unanswered attempts → mark inactive

const FOLLOWUP_TIME_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];

const FUTURE_SESSIONS = ["2026-27 (Current)", "2027-28", "2028-29"];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", counsellor_call: "Follow Up", application_in_progress: "App In Progress",
  visit_scheduled: "Visit Scheduled", application_fee_paid: "Fee Paid",
};

const formatFollowupDate = (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yy = d.getFullYear().toString().slice(-2);
  return `${days[d.getDay()]}, ${dd}/${mm}/${yy}`;
};

const formatSlotLabel = (slot: string) => {
  const [h] = slot.split(":");
  const hr = parseInt(h);
  return hr >= 12 ? `${hr === 12 ? 12 : hr - 12} PM` : `${hr} AM`;
};

// ── Course-specific script helpers ──────────────────────────────────────────

const getCourseScript = (courseName: string): string => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm") || c.includes("anm"))
    return " We have our own 500-bed hospital on campus for clinical training. Students get paid internships of ₹10,000/month. Our nursing graduates are placed in top hospitals across India and abroad.";
  if (c.includes("bpt") || c.includes("physiotherapy"))
    return " Our BPT program includes hands-on clinical training at our campus hospital. Students get paid internships of ₹10,000/month and excellent placement opportunities in hospitals and sports medicine.";
  if (c.includes("pharma") || c.includes("b.pharm") || c.includes("d.pharm"))
    return " Our pharmacy program is PCI approved with modern labs and industry tie-ups. Students get placed in pharma companies, hospitals, and research labs. We also have a D.Pharm to B.Pharm lateral entry pathway.";
  if (c.includes("mba") || c.includes("pgdm"))
    return " Our MBA program is AICTE approved and NIRF ranked. We have 1,200+ recruiters with packages up to ₹18.75 LPA. The program includes industry internships and live projects.";
  if (c.includes("bba") || c.includes("bca") || c.includes("bcom"))
    return " This program gives you a strong foundation for management careers. Our graduates go on to top MBA programs or get placed directly. Industry visits and internships are part of the curriculum.";
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return " Our law program is BCI approved with moot court facilities and legal aid clinics. Students participate in national moot court competitions and get placed at top law firms and corporate legal teams.";
  if (c.includes("b.tech") || c.includes("btech") || c.includes("engineering") || c.includes("mtech"))
    return " Our engineering program is AKTU affiliated and AICTE approved. We have modern labs, a dedicated placement cell, and tie-ups with top tech companies.";
  if (c.includes("education") || c.includes("b.ed") || c.includes("bed") || c.includes("d.el.ed"))
    return " Our education program is NCTE recognised. Graduates are eligible for government teaching positions and CTET/UPTET exams. We include school internship experience.";
  return " It's a well-established program with strong placement support, experienced faculty, and modern infrastructure.";
};

const getCourseHighlights = (courseName: string): string[] => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm") || c.includes("anm") || c.includes("bpt") || c.includes("physiotherapy"))
    return ["Own 500-bed hospital for clinical training", "Paid internships: ₹10K/month", "INC/UP Medical Faculty approved"];
  if (c.includes("pharma") || c.includes("b.pharm") || c.includes("d.pharm"))
    return ["PCI approved with modern labs", "Pharma industry tie-ups for placements", "Lateral entry pathway available"];
  if (c.includes("mba") || c.includes("pgdm") || c.includes("bba") || c.includes("bca") || c.includes("bcom"))
    return ["NIRF ranked management institution", "₹18.75 LPA highest package", "Industry internships + live projects"];
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return ["BCI approved with moot court facilities", "National moot court competitions", "Legal aid clinic on campus"];
  if (c.includes("b.tech") || c.includes("btech") || c.includes("engineering") || c.includes("mtech"))
    return ["AKTU affiliated, AICTE approved", "Modern labs + dedicated placement cell", "Tech company tie-ups"];
  if (c.includes("education") || c.includes("b.ed") || c.includes("bed") || c.includes("d.el.ed"))
    return ["NCTE recognised", "Eligible for govt teaching + CTET/UPTET", "School internship included"];
  return [];
};

const getCourseNudges = (courseName: string): string[] => {
  const c = courseName.toLowerCase();
  if (c.includes("nursing") || c.includes("gnm") || c.includes("anm") || c.includes("bpt") || c.includes("physiotherapy"))
    return ["Paid internship: ₹10K/month", "Own hospital for clinical training", "International placement opportunities"];
  if (c.includes("pharma") || c.includes("b.pharm") || c.includes("d.pharm"))
    return ["Modern pharma labs on campus", "Industry placement tie-ups", "D.Pharm → B.Pharm lateral entry"];
  if (c.includes("mba") || c.includes("pgdm"))
    return ["₹18.75 LPA highest package", "1,200+ recruiters on campus", "Industry internship included"];
  if (c.includes("bba") || c.includes("bca") || c.includes("bcom"))
    return ["Strong foundation for MBA/MCA", "Industry visits + internships", "Direct placement support"];
  if (c.includes("law") || c.includes("llb") || c.includes("ballb"))
    return ["Moot court + legal aid clinic", "National competition participation", "Law firm placement support"];
  if (c.includes("b.tech") || c.includes("btech") || c.includes("engineering") || c.includes("mtech"))
    return ["Modern engineering labs", "Campus placement drives", "Tech company internships"];
  if (c.includes("education") || c.includes("b.ed") || c.includes("bed") || c.includes("d.el.ed"))
    return ["Govt teaching eligibility", "CTET/UPTET preparation support", "School internship experience"];
  return ["Strong placement support", "Experienced faculty"];
};

// ── Component ───────────────────────────────────────────────────────────────

export default function CloudDialer() {
  const { user, role, profile } = useAuth();
  const { toast } = useToast();
  const isCounsellor = role === "counsellor";
  const counsellorDisplayName = profile?.display_name || "Counsellor";

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
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("10:00");
  const [futureSession, setFutureSession] = useState("2027-28");
  const [stats, setStats] = useState<DialerStats>({ connected: 0, busy: 0, noAnswer: 0, voicemail: 0, interested: 0, totalTalkTime: 0 });

  // Call history for current lead
  const [callHistory, setCallHistory] = useState<{id:string; disposition:string|null; notes:string|null; called_at:string; duration_seconds:number|null; direction:string}[]>([]);
  // Incoming call lookup
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupResult, setLookupResult] = useState<{id:string; name:string; phone:string; course_name:string; stage:string}|null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  // Profile ID for activity logging
  const [profileId, setProfileId] = useState<string | null>(null);

  const callTimerRef = useRef<number | null>(null);
  const autoNextRef = useRef<number | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const preDispositionRef = useRef<string | null>(null);

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
      add(visitConf, "Visit Checkin");
      add(overdue, "Overdue");
      add(todayFu, "Today");
      add(newLeads, "New Lead");

      if (postVisit.length) buckets.push({ key: "post_visit", label: "Post-Visit", color: "bg-amber-500", count: postVisit.length });
      if (visitConf.length) buckets.push({ key: "visit_confirm", label: "Visit Checkin", color: "bg-violet-500", count: visitConf.length });
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
      // Batch fetch lead details
      for (let i = 0; i < leadIds.length; i += 50) {
        const batch = leadIds.slice(i, i + 50);
        const { data } = await supabase.from("leads")
          .select("id, name, phone, stage, source, course_id, courses:course_id(name, fee_per_year), campuses:campus_id(name)")
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
        course_id: d.course_id || null,
        course_name: c.name || "—", campus_name: d.campuses?.name || "—",
        bucket: l.bucket, attempt_count: attemptMap[l.id] || 0,
        course_fee: c.fee_per_year ? `₹${Number(c.fee_per_year).toLocaleString("en-IN")}/year` : undefined,
      };
    }).filter(l => l.phone);

    setQueue(mapped);
    setQueueBuckets(buckets);
    setCurrentIdx(0);
    setLoading(false);
  }, [queueSource, user?.id]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // ── Fetch profile ID for activity logging ────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("id").eq("user_id", user.id).single()
      .then(({ data }) => { if (data) setProfileId(data.id); });
  }, [user?.id]);

  // ── Fetch call history when current lead changes ─────────────────────────
  useEffect(() => {
    if (!currentLead) { setCallHistory([]); return; }
    supabase.from("call_logs" as any)
      .select("id, disposition, notes, called_at, duration_seconds, direction")
      .eq("lead_id", currentLead.id)
      .order("called_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setCallHistory(data || []));
  }, [currentLead?.id]);

  // ── Incoming call phone lookup ──────────────────────────────────────────
  const lookupByPhone = async () => {
    if (!lookupPhone.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    setLookupNotFound(false);
    const digits = lookupPhone.replace(/[^0-9]/g, "").slice(-10);
    const { data } = await supabase.from("leads")
      .select("id, name, phone, stage, courses:course_id(name)")
      .ilike("phone", `%${digits}`)
      .limit(1)
      .single();
    if (data) {
      setLookupResult({ id: data.id, name: data.name, phone: data.phone, course_name: (data.courses as any)?.name || "—", stage: data.stage });
    } else {
      setLookupNotFound(true);
    }
    setLookupLoading(false);
  };

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
  // Only counts down when autoNextTimer > 0. When it hits 0, moves to next.
  // Never auto-fires on initial 0 — must be set to >0 first by showFollowupAndAutoNext.

  const autoNextTriggered = useRef(false);

  useEffect(() => {
    if (autoNextTimer > 0) {
      autoNextTriggered.current = true; // timer was started
      autoNextRef.current = window.setTimeout(() => {
        setAutoNextTimer(prev => prev - 1);
      }, 1000);
    } else if (autoNextTimer === 0 && autoNextTriggered.current && !paused) {
      autoNextTriggered.current = false;
      if (callState.status === "auto-disposed") {
        // Timer ran down after disposition — move to next
        moveToNext();
      } else if (callState.status === "ended") {
        // 60s lapsed with no disposition — auto-mark as call_back
        markDisposition("call_back");
      }
    }
    return () => { if (autoNextRef.current) clearTimeout(autoNextRef.current); };
  }, [autoNextTimer, paused, callState.status]);

  // ── Place call ────────────────────────────────────────────────────────────

  const pollRef = useRef<number | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Inline editing
  const [queueSearch, setQueueSearch] = useState("");
  const [editing, setEditing] = useState<"name"|"course"|null>(null);
  const [editValue, setEditValue] = useState("");
  const [courseOptions, setCourseOptions] = useState<{id:string;name:string;campus:string}[]>([]);

  // Poll for call end — checks ai_call_records for our call_uuid
  const startPolling = (callId: string) => {
    callIdRef.current = callId;
    const poll = async () => {
      const { data } = await supabase
        .from("ai_call_records" as any)
        .select("status, duration_seconds, disposition, student_connected_at")
        .eq("call_uuid", callId)
        .maybeSingle();

      if (!data) return; // Record not created yet — keep polling

      // ── Phase: Still initiated (call in progress) ──
      if (data.status === "initiated") {
        if (data.student_connected_at && !data.disposition) {
          // Student answered! Transition to "connected" + show disposition buttons
          setCallState(prev => prev.status !== "connected"
            ? { ...prev, status: "connected" }
            : prev
          );
        } else if (data.disposition) {
          // Auto-disposed during ringing (busy/not_answered/cancelled)
          // Student never connected — stop polling, show auto-followup with 15s timer
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          handleAutoDisposition(data.disposition);
        }
        // else: still ringing/connecting — keep polling, stay in "calling" state
        return;
      }

      // ── Phase: Terminal status (call is over) ──
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

      const serverDur = data.duration_seconds || 0;
      const serverDisp = data.disposition;

      if (data.student_connected_at && !serverDisp) {
        // Was connected, now ended, no disposition — show disposition panel
        const preDispo = preDispositionRef.current;
        if (preDispo) {
          preDispositionRef.current = null;
          setCallState(prev => ({ ...prev, elapsed: serverDur }));
          await finalizeDisposition(preDispo, serverDur);
        } else {
          setCallState(prev => ({ ...prev, status: "ended", elapsed: serverDur }));
          setAutoNextTimer(60);
        }
        setStats(prev => ({ ...prev, connected: prev.connected + 1, totalTalkTime: prev.totalTalkTime + serverDur }));
      } else if (serverDisp) {
        // Auto-disposed (busy/not_answered/voicemail/cancelled)
        handleAutoDisposition(serverDisp);
      } else {
        // No student connection, no disposition — treat as cancelled
        handleAutoDisposition("cancelled");
      }
    };
    // Poll every 3 seconds
    pollRef.current = window.setInterval(poll, 3000);
  };

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Load course options for edit dropdown
  useEffect(() => {
    supabase.from("courses").select("id, name, departments!inner(institutions!inner(campuses!inner(name)))").eq("is_active", true).order("name")
      .then(({ data }) => {
        setCourseOptions((data || []).map((c: any) => ({
          id: c.id, name: c.name, campus: c.departments?.institutions?.campuses?.name || "",
        })));
      });
  }, []);

  const saveLeadEdit = async (field: "name" | "course", value: string) => {
    if (!currentLead) return;
    if (field === "name") {
      await supabase.from("leads").update({ name: value } as any).eq("id", currentLead.id);
      setQueue(prev => prev.map((l, i) => i === currentIdx ? { ...l, name: value } : l));
    } else if (field === "course") {
      const course = courseOptions.find(c => c.id === value);
      await supabase.from("leads").update({ course_id: value } as any).eq("id", currentLead.id);
      setQueue(prev => prev.map((l, i) => i === currentIdx ? { ...l, course_id: value, course_name: course?.name || "—", campus_name: course?.campus || "—" } : l));
    }
    setEditing(null);
    toast({ title: "Updated", description: `Lead ${field} updated.` });
  };

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

      // Stay in "calling" state — polling will transition to "connected" when student answers
      toast({ title: "Calling...", description: data?.message || "Pick up your phone" });

      // Start polling for call end using the internal call_id
      if (data?.call_id) {
        startPolling(data.call_id);
      }
    } catch (e: any) {
      toast({ title: "Call Failed", description: e.message, variant: "destructive" });
      setCallState(prev => ({ ...prev, status: "ended", disposition: "failed" }));
    }
  };

  // ── Pre-select disposition during connected call ─────────────────────────

  const preSelectDisposition = (disposition: string) => {
    preDispositionRef.current = disposition;
    setCallState(prev => ({ ...prev, disposition }));
    toast({ title: "Disposition saved", description: `Marked as "${disposition.replace("_", " ")}". Will finalize when call ends.` });
  };

  // ── Finalize a pre-selected disposition after call ends ─────────────────

  const finalizeDisposition = async (disposition: string, duration: number) => {
    if (!currentLead) return;

    await supabase.from("call_logs" as any).insert({
      lead_id: currentLead.id, disposition, duration_seconds: duration,
      notes: `Cloud Dialer: ${disposition.replace("_", " ")}`,
      direction: "outbound", user_id: user?.id, called_at: new Date().toISOString(),
    });

    // Mark pending followups as completed (clears overdue status)
    await supabase.from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", currentLead.id).eq("status", "pending");

    // Log activity
    const durStr = duration > 0 ? ` (${Math.floor(duration / 60)}m${duration % 60 ? ` ${duration % 60}s` : ""})` : "";
    await supabase.from("lead_activities").insert({
      lead_id: currentLead.id, user_id: profileId, type: "call",
      description: `Call: ${disposition.replace("_", " ")}${durStr} (via Cloud Dialer)`,
    });

    // Update first_contact_at if first call
    await supabase.from("leads").update({ first_contact_at: new Date().toISOString() } as any)
      .eq("id", currentLead.id).is("first_contact_at", null);

    if (disposition === "interested") {
      await supabase.from("leads").update({ stage: "counsellor_call" as any }).eq("id", currentLead.id);
    } else if (disposition === "not_interested") {
      await supabase.from("leads").update({ stage: "not_interested" as any }).eq("id", currentLead.id);
    }

    setStats(prev => ({
      ...prev,
      interested: disposition === "interested" ? prev.interested + 1 : prev.interested,
    }));

    setCallState(prev => ({ ...prev, status: "auto-disposed", disposition, autoDisposition: false }));
    showFollowupAndAutoNext(disposition, true);
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

    // Mark pending followups as completed (clears overdue status)
    await supabase.from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", currentLead.id).eq("status", "pending");

    // Log activity
    const durStr = callState.elapsed > 0 ? ` (${Math.floor(callState.elapsed / 60)}m${callState.elapsed % 60 ? ` ${callState.elapsed % 60}s` : ""})` : "";
    await supabase.from("lead_activities").insert({
      lead_id: currentLead.id, user_id: profileId, type: "call",
      description: `Call: ${disposition.replace("_", " ")}${durStr} (via Cloud Dialer)`,
    });

    // Update first_contact_at if first call
    await supabase.from("leads").update({ first_contact_at: new Date().toISOString() } as any)
      .eq("id", currentLead.id).is("first_contact_at", null);

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
    showFollowupAndAutoNext(disposition, false);
  };

  // ── Auto-disposition (unanswered/busy/voicemail from Plivo) ───────────────

  const handleAutoDisposition = (disposition: string) => {
    const statsKey = disposition === "busy" ? "busy" : disposition === "voicemail" ? "voicemail" : "noAnswer";
    setStats(prev => ({ ...prev, [statsKey]: prev[statsKey] + 1 }));
    setCallState(prev => ({ ...prev, status: "auto-disposed", disposition, autoDisposition: true }));
    showFollowupAndAutoNext(disposition);
  };

  // ── Show followup and start auto-next timer ───────────────────────────────

  const showFollowupAndAutoNext = (disposition: string, wasConnected = false) => {
    if (!currentLead) return;
    const attempt = currentLead.attempt_count + 1;
    const isAutoDisp = ["busy", "not_answered", "voicemail", "cancelled"].includes(disposition);

    // After MAX_AUTO_ATTEMPTS unanswered attempts → mark inactive, no followup
    if (isAutoDisp && attempt >= MAX_AUTO_ATTEMPTS) {
      supabase.from("leads").update({ stage: "inactive" as any }).eq("id", currentLead.id);
      setFollowupDate("");
      setFollowupTime("");
      setAutoNextTimer(10);
      toast({ title: "Marked Inactive", description: `${currentLead.name} — ${attempt} unanswered attempts. Removed from followups.` });
      return;
    }

    const gapIdx = Math.min(attempt - 1, FOLLOWUP_GAPS.length - 1);
    const gapHours = FOLLOWUP_GAPS[gapIdx];

    const followup = new Date(Date.now() + gapHours * 3600000);
    setFollowupDate(followup.toISOString().split("T")[0]);
    // Snap to nearest business hour slot
    const hr = followup.getHours();
    const snapped = hr < 9 ? "09:00" : hr >= 17 ? "17:00" : FOLLOWUP_TIME_SLOTS.find(s => parseInt(s) >= hr) || "10:00";
    setFollowupTime(snapped);

    // Reset visit/session state
    setVisitDate("");
    setVisitTime("10:00");
    setFutureSession("2027-28");

    if (isAutoDisp) {
      setAutoNextTimer(15); // 15s for auto-disposition
    } else if (wasConnected) {
      setAutoNextTimer(60); // 60s for connected calls (pre-selected during call)
    } else {
      setAutoNextTimer(60); // 60s for post-call dispositions
    }
  };

  // ── Confirm followup and move to next ─────────────────────────────────────

  const moveToNext = async () => {
    // Save followup if there's a date (skip for not_interested and inactive)
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

    // Save visit if interested + visit date set
    if (currentLead && callState.disposition === "interested" && visitDate) {
      const visitAt = new Date(`${visitDate}T${visitTime || "10:00"}:00`);
      await supabase.from("lead_visits" as any).insert({
        lead_id: currentLead.id,
        visit_date: visitAt.toISOString(),
        status: "scheduled",
        notes: `Scheduled via Cloud Dialer`,
      });
      await supabase.from("leads").update({ stage: "visit_scheduled" as any }).eq("id", currentLead.id);
    }

    // Save future session note for ineligible
    if (currentLead && callState.disposition === "ineligible" && futureSession) {
      await supabase.from("lead_notes").insert({
        lead_id: currentLead.id,
        content: `Ineligible for current session. Interested for ${futureSession}.`,
        user_id: user?.id,
      });
    }

    setAutoNextTimer(0);
    preDispositionRef.current = null;
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
          {/* Live call timer in header */}
          {(callState.status === "calling" || callState.status === "connected") && (
            <Badge className={`text-xs font-mono tabular-nums border-0 ${
              callState.status === "connected" ? "bg-emerald-100 text-emerald-700 animate-pulse" : "bg-cyan-100 text-cyan-700"
            }`}>
              {callState.status === "connected" ? <Volume2 className="h-3 w-3 mr-1" /> : <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {formatTime(callState.elapsed)}
            </Badge>
          )}
          {/* Incoming call phone lookup */}
          <div className="flex items-center gap-1 border border-input rounded-xl px-2 py-1 bg-background">
            <PhoneIncoming className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input type="text" value={lookupPhone} onChange={e => { setLookupPhone(e.target.value); setLookupNotFound(false); setLookupResult(null); }}
              placeholder="Incoming call? Enter phone..."
              onKeyDown={e => { if (e.key === "Enter") lookupByPhone(); }}
              className="w-36 text-xs bg-transparent outline-none placeholder:text-muted-foreground/60" />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={lookupByPhone} disabled={lookupLoading}>
              {lookupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Find"}
            </Button>
          </div>
          {lookupResult && (
            <a href={`/admissions/${lookupResult.id}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 text-xs">
              <span className="font-semibold text-emerald-700">{lookupResult.name}</span>
              <span className="text-muted-foreground">{lookupResult.course_name}</span>
              <span className="text-primary hover:underline">Open →</span>
            </a>
          )}
          {lookupNotFound && <span className="text-[10px] text-red-500">No lead found</span>}
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
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input type="text" value={queueSearch} onChange={e => setQueueSearch(e.target.value)}
                placeholder="Search name, phone, course..."
                className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1.5 text-xs placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {queue.map((lead, idx) => {
              if (queueSearch) {
                const q = queueSearch.toLowerCase();
                const matches = lead.name.toLowerCase().includes(q) || lead.phone.includes(q) || lead.course_name.toLowerCase().includes(q);
                if (!matches) return null;
              }
              return (
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
                  <Badge className={`text-[9px] border-0 ${
                    lead.bucket === "Post-Visit" ? "bg-amber-200 text-amber-800 animate-pulse" :
                    lead.bucket === "Visit Checkin" ? "bg-violet-100 text-violet-700" :
                    lead.bucket === "Overdue" ? "bg-red-100 text-red-700" :
                    lead.bucket === "Today" ? "bg-blue-100 text-blue-700" :
                    lead.bucket === "New Lead" ? "bg-orange-100 text-orange-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>{lead.bucket}</Badge>
                  {lead.attempt_count > 0 && <Badge className="text-[9px] border-0 bg-gray-100 text-gray-500">{lead.attempt_count}x</Badge>}
                  {idx < currentIdx && <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />}
                </div>
              </div>
              );
            })}
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentLead ? (
            <>
            {/* ── Fixed Call Bar at top (never scrolls) ──────────────── */}
            <div className="shrink-0 px-5 py-3 border-b border-border bg-card">
              {/* Call Bar — in fixed top section */}
              {callState.status !== "idle" ? (
                <div className={`rounded-xl border-2 p-4 space-y-3 ${
                  callState.status === "calling" ? "border-cyan-300 bg-cyan-50 dark:bg-cyan-950/20" :
                  callState.status === "connected" ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" :
                  callState.status === "ended" ? "border-primary/30 bg-primary/5" :
                  callState.status === "auto-disposed" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" :
                  "border-border bg-card"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {callState.status === "calling" && <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />}
                      {callState.status === "connected" && <Volume2 className="h-5 w-5 text-emerald-600 animate-pulse" />}
                      {callState.status === "ended" && <Phone className="h-5 w-5 text-primary" />}
                      {callState.status === "auto-disposed" && <AlertCircle className="h-5 w-5 text-amber-600" />}
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {callState.status === "calling" && "Calling..."}
                          {callState.status === "connected" && "On Call — Student Connected"}
                          {callState.status === "ended" && "Call Ended"}
                          {callState.status === "auto-disposed" && (callState.disposition?.replace("_", " ").toUpperCase())}
                        </p>
                        {callState.status === "calling" && (
                          <p className="text-[10px] text-cyan-600">Pick up your phone. Waiting for student to answer...</p>
                        )}
                        <p className="text-xs text-muted-foreground tabular-nums">{formatTime(callState.elapsed)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {callState.status === "calling" && (
                        <Button size="sm" variant="outline" onClick={() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } handleAutoDisposition("cancelled"); }}>
                          <PhoneOff className="h-3.5 w-3.5 mr-1.5" />Cancelled
                        </Button>
                      )}
                      {callState.status === "connected" && (
                        <Button size="sm" variant="destructive" onClick={() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } setCallState(prev => ({ ...prev, status: "ended" })); setAutoNextTimer(60); }}>
                          <PhoneOff className="h-3.5 w-3.5 mr-1.5" />End Call
                        </Button>
                      )}
                      {/* Show pre-selected disposition badge during call */}
                      {callState.status === "connected" && callState.disposition && (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />{callState.disposition.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {(callState.status === "calling" || callState.status === "connected") && (
                    <div className="h-1.5 bg-white/50 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${callState.status === "connected" ? "bg-emerald-500" : "bg-cyan-500"}`}
                        style={{ width: `${Math.min(100, (callState.elapsed / 300) * 100)}%` }} />
                    </div>
                  )}
                  {/* Disposition buttons: shown DURING connected call + after end */}
                  {(callState.status === "connected" || callState.status === "ended") && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold text-primary uppercase tracking-wide">
                          {callState.status === "connected" ? "Mark During Call" : "Mark Disposition"}
                        </p>
                        {callState.status === "ended" && autoNextTimer > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Auto: Call Back in</span>
                            <div className="relative w-9 h-9">
                              <svg className="w-9 h-9 -rotate-90">
                                <circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
                                <circle cx="18" cy="18" r="14" fill="none" stroke="#6366f1" strokeWidth="2.5"
                                  strokeDasharray={`${(autoNextTimer / 60) * 88} 88`} strokeLinecap="round" />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{autoNextTimer}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CONNECTED_DISPOSITIONS.map(d => (
                          <button key={d.value}
                            onClick={() => callState.status === "connected" ? preSelectDisposition(d.value) : markDisposition(d.value)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                              callState.status === "connected" && callState.disposition === d.value
                                ? "ring-2 ring-primary bg-primary/10 border-primary"
                                : d.color
                            }`}>
                            <d.icon className="h-3 w-3" />{d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {callState.status === "auto-disposed" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {callState.autoDisposition ? "Auto" : "Saved"}: <span className="font-semibold text-foreground">{callState.disposition?.replace("_"," ")}</span>
                          {" · "}Attempt {(currentLead?.attempt_count || 0) + 1}
                          {(currentLead?.attempt_count || 0) + 1 >= MAX_AUTO_ATTEMPTS && callState.autoDisposition && (
                            <span className="ml-2 text-red-600 font-semibold">→ Marked Inactive</span>
                          )}
                        </p>
                        {autoNextTimer > 0 && (
                          <div className="relative w-9 h-9">
                            <svg className="w-9 h-9 -rotate-90">
                              <circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
                              <circle cx="18" cy="18" r="14" fill="none" stroke="#06b6d4" strokeWidth="2.5"
                                strokeDasharray={`${(autoNextTimer / (callState.autoDisposition ? 15 : 60)) * 88} 88`} strokeLinecap="round" />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{autoNextTimer}</span>
                          </div>
                        )}
                      </div>

                      {/* Followup scheduling (not for not_interested or inactive) */}
                      {callState.disposition !== "not_interested" && followupDate && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs font-medium text-foreground">{formatFollowupDate(followupDate)}</span>
                            <input type="date" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
                              className="rounded-md border border-input bg-background px-2 py-1 text-[10px] w-28" />
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {FOLLOWUP_TIME_SLOTS.map(slot => (
                              <button key={slot} onClick={() => setFollowupTime(slot)}
                                className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                                  followupTime === slot ? "bg-cyan-100 text-cyan-700 border-cyan-300" : "bg-background text-muted-foreground border-input hover:bg-muted/50"
                                }`}>
                                {formatSlotLabel(slot)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Visit scheduling for "interested" */}
                      {callState.disposition === "interested" && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10 p-2.5 space-y-1.5">
                          <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Schedule Campus Visit</p>
                          <div className="flex items-center gap-2">
                            <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)}
                              min={new Date().toISOString().split("T")[0]}
                              className="rounded-md border border-input bg-background px-2 py-1 text-xs flex-1" />
                            <select value={visitTime} onChange={e => setVisitTime(e.target.value)}
                              className="rounded-md border border-input bg-background px-2 py-1 text-xs w-24">
                              {FOLLOWUP_TIME_SLOTS.map(slot => (
                                <option key={slot} value={slot}>{formatSlotLabel(slot)}</option>
                              ))}
                            </select>
                          </div>
                          {visitDate && <p className="text-[10px] text-emerald-600">Visit: {formatFollowupDate(visitDate)} at {formatSlotLabel(visitTime)}</p>}
                        </div>
                      )}

                      {/* Future session selector for "ineligible" */}
                      {callState.disposition === "ineligible" && (
                        <div className="rounded-lg border border-purple-200 bg-purple-50/50 dark:bg-purple-950/10 p-2.5 space-y-1.5">
                          <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide">Interested for Future Session?</p>
                          <div className="flex gap-1.5">
                            {FUTURE_SESSIONS.map(session => (
                              <button key={session} onClick={() => setFutureSession(session.split(" ")[0])}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                  futureSession === session.split(" ")[0]
                                    ? "bg-purple-100 text-purple-700 border-purple-300"
                                    : "bg-background text-muted-foreground border-input hover:bg-muted/50"
                                }`}>
                                {session}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={moveToNext} className="bg-cyan-600 hover:bg-cyan-700 flex-1 h-8 text-xs">
                          <SkipForward className="h-3 w-3 mr-1" />{currentIdx < queue.length - 1 ? "Next Call" : "Finish"}
                        </Button>
                        {autoNextTimer > 0 && (
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { autoNextTriggered.current = false; setAutoNextTimer(0); }}>Stop Timer</Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Phone className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">Ready to call</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!dialerActive && (
                      <Button size="sm" onClick={() => { setDialerActive(true); placeCall(); }} className="bg-cyan-600 hover:bg-cyan-700">
                        <Phone className="h-3.5 w-3.5 mr-1.5" />Call Now
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={skipLead}>
                      <SkipForward className="h-3.5 w-3.5 mr-1.5" />Skip
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Scrollable content: lead info + script ──────────────── */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Lead info */}
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center shrink-0">
                          <span className="text-base font-bold text-cyan-700">{currentLead.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          {editing === "name" ? (
                            <div className="flex items-center gap-1">
                              <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                                className="text-base font-bold text-foreground leading-tight border border-input rounded-md px-1.5 py-0.5 w-40 outline-none focus:ring-1 focus:ring-primary"
                                onKeyDown={e => { if (e.key === "Enter") saveLeadEdit("name", editValue); if (e.key === "Escape") setEditing(null); }} />
                              <button onClick={() => saveLeadEdit("name", editValue)} className="text-emerald-600 hover:text-emerald-700"><Check className="h-3.5 w-3.5" /></button>
                              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <h2 className="text-base font-bold text-foreground leading-tight flex items-center gap-1.5 group">
                              {currentLead.name}
                              <button onClick={() => { setEditing("name"); setEditValue(currentLead.name); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                            </h2>
                          )}
                          <p className="text-xs text-muted-foreground">{currentLead.phone}</p>
                        </div>
                      </div>
                      <a href={`/admissions/${currentLead.id}`} target="_blank" rel="noreferrer"
                        className="text-[10px] text-primary hover:underline shrink-0">Open Lead →</a>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Course & Campus</span>
                        {editing === "course" ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <select value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                              className="text-xs border border-input rounded-md px-1.5 py-1 flex-1 outline-none focus:ring-1 focus:ring-primary bg-background">
                              <option value="">Select course...</option>
                              {courseOptions.map(c => <option key={c.id} value={c.id}>{c.name} — {c.campus}</option>)}
                            </select>
                            <button onClick={() => saveLeadEdit("course", editValue)} className="text-emerald-600 hover:text-emerald-700"><Check className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ) : (
                          <p className="font-medium text-foreground flex items-center gap-1.5 group">
                            {currentLead.course_name} · {currentLead.campus_name}
                            <button onClick={() => { setEditing("course"); setEditValue(currentLead.course_id || ""); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"><Pencil className="h-3 w-3" /></button>
                          </p>
                        )}
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
                        <p className="font-medium text-foreground">{currentLead.bucket}</p>
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

                {/* Previous Call Notes */}
                {callHistory.length > 0 && (
                  <Card className="border-border/60 shadow-none">
                    <CardContent className="p-4">
                      <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <FileText className="h-3 w-3" />Previous Call Notes ({callHistory.length})
                      </p>
                      <div className="space-y-2 max-h-[180px] overflow-y-auto">
                        {callHistory.map(c => (
                          <div key={c.id} className="flex items-start gap-2 text-xs border-l-2 border-amber-200 pl-2.5 py-1">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge className={`text-[9px] border-0 shrink-0 ${
                                  c.disposition === "interested" ? "bg-emerald-100 text-emerald-700" :
                                  c.disposition === "not_interested" ? "bg-red-100 text-red-700" :
                                  c.disposition === "not_answered" ? "bg-amber-100 text-amber-700" :
                                  c.disposition === "busy" ? "bg-orange-100 text-orange-700" :
                                  "bg-gray-100 text-gray-600"
                                }`}>{c.disposition?.replace("_", " ") || "—"}</Badge>
                                <span className="text-muted-foreground text-[10px]">
                                  {new Date(c.called_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                  {" "}
                                  {new Date(c.called_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {c.duration_seconds && c.duration_seconds > 0 && (
                                  <span className="text-muted-foreground text-[10px]">({Math.floor(c.duration_seconds / 60)}m{c.duration_seconds % 60}s)</span>
                                )}
                                <Badge className="text-[9px] border-0 bg-gray-50 text-gray-500">{c.direction}</Badge>
                              </div>
                              {c.notes && <p className="text-muted-foreground mt-0.5 leading-snug">{c.notes}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Course Info Panel (same component as lead page) + Script */}
                <div className="space-y-3">
                  {currentLead.course_id && (
                    <Card className="border-border/60 shadow-none max-h-[300px] overflow-y-auto">
                      <CardContent className="p-3"><CourseInfoPanel courseId={currentLead.course_id} /></CardContent>
                    </Card>
                  )}
                </div>

              {/* Talking Points + NIMT Highlights + WhatsApp */}
              <Card className="border-border/60 shadow-none bg-blue-50/30 dark:bg-blue-950/10">
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">💬 Call Script</p>
                      <div className="text-muted-foreground leading-relaxed space-y-2">
                        <p className="italic">
                          "Hello, am I speaking with <b>{currentLead.name.split(" ")[0]}</b>?
                          This is {counsellorDisplayName} from NIMT Educational Institutions.
                          {currentLead.course_name !== "—"
                            ? <> I see you've enquired about <b>{currentLead.course_name}</b>. Can you confirm this is the course you're interested in?</>
                            : " I'm calling regarding your enquiry. Could you tell me which course you're interested in?"}
                          "
                        </p>
                        <p className="text-[9px] text-amber-600 font-semibold">⚠️ Confirm name and course before proceeding</p>
                        {currentLead.course_name !== "—" && (
                          <p className="italic">
                            "Great! Let me tell you about {currentLead.course_name} at our {currentLead.campus_name}.
                            {getCourseScript(currentLead.course_name)}"
                          </p>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground/60 mt-2">💡 Refer to the fee structure above for accurate fees</p>
                      <div className="mt-3">
                        <Button size="sm" variant="outline" className="text-[10px] h-7 gap-1"
                          onClick={() => window.open(`https://wa.me/${currentLead.phone.replace(/[^0-9]/g,"")}?text=${encodeURIComponent(`Hi ${currentLead.name.split(" ")[0]}, this is ${counsellorDisplayName} from NIMT. I tried calling you regarding ${currentLead.course_name !== "—" ? currentLead.course_name : "your enquiry"}. Would you like to discuss?`)}`, "_blank")}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                          WhatsApp Lead
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">🏛️ About NIMT</p>
                      <ul className="text-muted-foreground leading-relaxed space-y-1">
                        <li>• Est. 1987 — <b>37+ years</b> in education</li>
                        <li>• 5 campuses, 36+ programmes, 21 colleges</li>
                        <li>• AICTE, UGC, BCI, NCTE, INC, PCI approved</li>
                        <li>• Placements: <b>₹18.75 LPA highest</b>, ₹5.40 LPA avg</li>
                        <li>• 1,200+ recruiters: KPMG, Wipro, Deloitte, TCS</li>
                        <li>• 6 NIRF ranked institutions (2025)</li>
                        {getCourseHighlights(currentLead.course_name).map((h, i) => <li key={i}>• {h}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2">🎯 Nudge Checklist</p>
                      <ul className="text-muted-foreground leading-relaxed space-y-1">
                        {getCourseNudges(currentLead.course_name).map((n, i) => <li key={i}>☐ {n}</li>)}
                        <li>☐ Scholarships (merit/SC/ST/OBC/sports)</li>
                        <li>☐ Apply online: <b>apply.nimt.ac.in</b></li>
                        <li>☐ Invite for campus visit</li>
                        <li>☐ Hostel: 600+ beds, AC/non-AC</li>
                        <li>☐ Transport facility available</li>
                        <li>☐ Send WhatsApp with course details</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>


            </div>
            </>
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
