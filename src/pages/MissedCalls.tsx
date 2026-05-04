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

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Phone, PhoneMissed, CheckCircle2, Loader2, ExternalLink,
  Clock, MessageSquare, RefreshCw,
} from "lucide-react";

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
  course_name: string;
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
  const [loading, setLoading] = useState(true);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const isCounsellor = role === "counsellor";
  const canViewAll = role === "super_admin" || role === "admission_head" || role === "campus_admin" || role === "principal";

  const refresh = async () => {
    setLoading(true);
    // Pull pending follow-ups, oldest first
    const { data: rows } = await supabase
      .from("ai_call_records" as any)
      .select("id, lead_id, call_uuid, created_at, followup_reason, summary, disposition, duration_seconds")
      .eq("needs_followup", true)
      .is("followup_done_at", null)
      .order("created_at", { ascending: true })
      .limit(200);

    const list = (rows as any[] | null) || [];
    if (!list.length) { setCalls([]); setLoading(false); return; }

    // Batch lead details
    const leadIds = [...new Set(list.map(r => r.lead_id).filter(Boolean))];
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, phone, stage, counsellor_id, courses:course_id(name)")
      .in("id", leadIds);
    const leadMap: Record<string, any> = {};
    (leads || []).forEach((l: any) => { leadMap[l.id] = l; });

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
        course_name: (lead.courses as any)?.name || "",
      };
    });

    // Counsellor scoping: only their own assigned leads
    if (isCounsellor && profile?.id) {
      mapped = mapped.filter(c => c.lead_counsellor_id === profile.id);
    }

    setCalls(mapped);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [profile?.id]);

  const placeCallback = async (mc: MissedCall) => {
    if (!user?.id) return;
    setCallingId(mc.id);
    const { error, data } = await supabase.functions.invoke("manual-call", {
      body: { lead_id: mc.lead_id, caller_user_id: user.id },
    });
    setCallingId(null);
    if (error || (data as any)?.error) {
      toast({
        title: "Couldn't start call",
        description: (data as any)?.error || error?.message || "Try again",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Calling…", description: `Connecting you to ${mc.lead_name}` });
  };

  const markDone = async (mc: MissedCall) => {
    if (!profile?.id) return;
    setResolvingId(mc.id);
    const { error } = await supabase
      .from("ai_call_records" as any)
      .update({ followup_done_at: new Date().toISOString(), followup_done_by: profile.id })
      .eq("id", mc.id);
    setResolvingId(null);
    if (error) {
      toast({ title: "Couldn't mark done", description: error.message, variant: "destructive" });
      return;
    }
    setCalls(prev => prev.filter(c => c.id !== mc.id));
  };

  return (
    <div className="p-5 space-y-4 animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PhoneMissed className="h-6 w-6 text-amber-600" />Missed Calls
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Inbound calls received outside business hours (9 AM–8 PM IST, Mon-Sat).
            The AI agent picked up — call these leads back today as top priority.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />Refresh
        </Button>
      </div>

      {/* Summary banner */}
      {!loading && calls.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-3">
          <PhoneMissed className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {calls.length} pending callback{calls.length === 1 ? "" : "s"}
              {isCounsellor ? " assigned to you" : canViewAll ? " across the team" : ""}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-200/80">
              Sorted oldest first — the lead waiting longest is at the top.
            </p>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : calls.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
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
              <Card key={mc.id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
                    {/* Lead identity */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => navigate(`/admissions/${mc.lead_id}`)}
                          className="text-base font-semibold text-foreground hover:text-primary truncate inline-flex items-center gap-1"
                        >
                          {mc.lead_name}<ExternalLink className="h-3 w-3" />
                        </button>
                        <Badge variant="outline" className="text-[10px] font-mono shrink-0">{mc.lead_phone}</Badge>
                        {mc.lead_stage && (
                          <Badge variant="outline" className="text-[10px] shrink-0 bg-blue-50 text-blue-700 border-blue-200">
                            {mc.lead_stage}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />Called {formatTime(created)} · {relativeTime(created)}
                        </span>
                        {mc.course_name && <span>· {mc.course_name}</span>}
                      </div>
                      {mc.followup_reason && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 italic">
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
                        onClick={() => placeCallback(mc)}
                        disabled={callingId === mc.id || !mc.lead_phone || mc.lead_phone === "—"}
                        className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                      >
                        {callingId === mc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
                        Call back
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markDone(mc)}
                        disabled={resolvingId === mc.id}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {resolvingId === mc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Mark done
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
