import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { Phone, Volume2, Loader2, PhoneMissed, Clock, PhoneIncoming } from "lucide-react";

interface ActiveCall {
  id: string;
  call_uuid: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  counsellor_name: string;
  call_type: "manual" | "inbound";
  status: "calling" | "connected" | "disposing";
  student_connected_at: string | null;
  disposition: string | null;
  created_at: string;
  elapsed: number;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  counsellor_call: "Follow Up",
  application_in_progress: "App In Progress",
  visit_scheduled: "Visit Scheduled",
  application_fee_paid: "Fee Paid",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-orange-100 text-orange-700",
  counsellor_call: "bg-blue-100 text-blue-700",
  application_in_progress: "bg-violet-100 text-violet-700",
  visit_scheduled: "bg-emerald-100 text-emerald-700",
  application_fee_paid: "bg-cyan-100 text-cyan-700",
};

const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

export function LiveCallBar() {
  const { user, role } = useAuth();
  const isTeamLeader = useIsTeamLeader();
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<number | null>(null);

  // Admins/TLs see all calls; counsellors see only their own inbound calls
  const isAdmin = role === "super_admin" || role === "admission_head" || role === "campus_admin" || isTeamLeader;
  const canView = isAdmin || role === "counsellor";

  useEffect(() => {
    if (!canView) return;

    const fetchActiveCalls = async () => {
      // Get manual + inbound calls with status=initiated (created in last 30 min)
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      let query = supabase
        .from("ai_call_records" as any)
        .select("id, call_uuid, lead_id, student_connected_at, disposition, created_at, caller_user_id, call_type")
        .eq("status", "initiated")
        .in("call_type", ["manual", "inbound"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false });

      // Counsellors only see their own calls (inbound routed to them)
      if (!isAdmin && user?.id) {
        query = query.eq("caller_user_id", user.id);
      }

      const { data: records } = await query;

      if (!records?.length) {
        setCalls([]);
        return;
      }

      // Filter out calls that already have a terminal sibling record
      // (bridge-hangup may INSERT a second record instead of PATCH the existing one)
      const uuids = records.map((r: any) => r.call_uuid).filter(Boolean);
      const { data: terminal } = await supabase
        .from("ai_call_records" as any)
        .select("call_uuid")
        .in("call_uuid", uuids)
        .neq("status", "initiated");
      const doneUuids = new Set((terminal || []).map((t: any) => t.call_uuid));
      const activeRecords = records.filter((r: any) => !doneUuids.has(r.call_uuid));

      if (!activeRecords.length) {
        setCalls([]);
        return;
      }

      // Batch fetch lead details
      const leadIds = [...new Set(activeRecords.map((r: any) => r.lead_id))];
      const { data: leads } = await supabase
        .from("leads")
        .select("id, name, phone, stage")
        .in("id", leadIds);
      const leadMap: Record<string, any> = {};
      (leads || []).forEach((l: any) => { leadMap[l.id] = l; });

      // Batch fetch counsellor names
      const userIds = [...new Set(activeRecords.map((r: any) => r.caller_user_id).filter(Boolean))];
      const profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        (profiles || []).forEach((p: any) => { profileMap[p.user_id] = p.display_name || "Unknown"; });
      }

      const mapped: ActiveCall[] = activeRecords.map((r: any) => {
        const lead = leadMap[r.lead_id] || {};
        const callStatus = r.student_connected_at ? "connected" : r.disposition ? "disposing" : "calling";
        return {
          id: r.id,
          call_uuid: r.call_uuid,
          lead_id: r.lead_id,
          lead_name: lead.name || "Unknown",
          lead_phone: lead.phone || "",
          lead_stage: lead.stage || "",
          counsellor_name: profileMap[r.caller_user_id] || "Unknown",
          call_type: r.call_type || "manual",
          status: callStatus,
          student_connected_at: r.student_connected_at,
          disposition: r.disposition,
          created_at: r.created_at,
          elapsed: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000),
        };
      });

      setCalls(mapped);
    };

    fetchActiveCalls();
    const interval = setInterval(fetchActiveCalls, 5000);
    return () => clearInterval(interval);
  }, [canView]);

  // Tick every second to update elapsed times
  useEffect(() => {
    if (calls.length === 0) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [calls.length]);

  const hasInbound = calls.some(c => c.call_type === "inbound");

  if (!canView || calls.length === 0) return null;

  return (
    <div className={`border-b border-border px-5 py-1.5 ${
      hasInbound ? "bg-amber-50/50 dark:bg-amber-950/10" : "bg-emerald-50/50 dark:bg-emerald-950/10"
    }`}>
      <div className="flex items-center gap-4 overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative">
            {hasInbound ? <PhoneIncoming className="h-3.5 w-3.5 text-amber-600" /> : <Phone className="h-3.5 w-3.5 text-emerald-600" />}
            <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse ${hasInbound ? "bg-amber-500" : "bg-emerald-500"}`} />
          </div>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${hasInbound ? "text-amber-700" : "text-emerald-700"}`}>
            Live {calls.length === 1 ? "Call" : `${calls.length} Calls`}
          </span>
        </div>

        <div className="h-4 w-px bg-emerald-200 shrink-0" />

        {calls.map(call => {
          const elapsed = Math.floor((now - new Date(call.created_at).getTime()) / 1000);
          const isInbound = call.call_type === "inbound";
          return (
            <a key={call.id} href={`/admissions/${call.lead_id}`} target="_blank" rel="noreferrer"
              className={`flex items-center gap-2.5 shrink-0 rounded-lg px-2.5 py-1 transition-colors group ${
                isInbound ? "hover:bg-amber-100/50 dark:hover:bg-amber-900/20 ring-1 ring-amber-300" : "hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20"
              }`}>
              {/* Status icon */}
              {isInbound && call.status === "calling" && <PhoneIncoming className="h-3 w-3 animate-bounce text-amber-600 shrink-0" />}
              {!isInbound && call.status === "calling" && <Loader2 className="h-3 w-3 animate-spin text-cyan-600 shrink-0" />}
              {call.status === "connected" && <Volume2 className="h-3 w-3 text-emerald-600 animate-pulse shrink-0" />}
              {call.status === "disposing" && <PhoneMissed className="h-3 w-3 text-amber-600 shrink-0" />}

              {/* Direction badge for inbound */}
              {isInbound && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded shrink-0">IN</span>}

              {/* Counsellor */}
              <span className="text-[11px] font-semibold text-foreground">{isInbound ? call.lead_name : call.counsellor_name.split(" ")[0]}</span>

              {/* Arrow */}
              <span className="text-[10px] text-muted-foreground/50">{isInbound ? "→" : "→"}</span>

              {/* Lead / Counsellor */}
              <span className="text-[11px] text-foreground group-hover:text-primary transition-colors">{isInbound ? call.counsellor_name.split(" ")[0] : call.lead_name}</span>

              {/* Stage badge */}
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${STAGE_COLORS[call.lead_stage] || "bg-gray-100 text-gray-600"}`}>
                {STAGE_LABELS[call.lead_stage] || call.lead_stage || "—"}
              </span>

              {/* Status label */}
              <span className={`text-[10px] font-medium ${
                isInbound && call.status === "calling" ? "text-amber-600" :
                call.status === "calling" ? "text-cyan-600" :
                call.status === "connected" ? "text-emerald-600" :
                "text-amber-600"
              }`}>
                {isInbound && call.status === "calling" ? "Incoming" : call.status === "calling" ? "Calling" : call.status === "connected" ? "On Call" : "Ending"}
              </span>

              {/* Timer */}
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />{formatTime(elapsed)}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
