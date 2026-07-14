import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Trophy, Flame, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useActionCenter, type ActionLead } from "@/hooks/useActionCenter";
import { ActionBucketSection } from "./ActionBucketSection";
import { CallDispositionDialog } from "./CallDispositionDialog";
import { recordCallDisposition } from "@/lib/callDisposition";

// Compact leaderboard widget for Action Center
function LeaderboardWidget() {
  const { profile } = useAuth();
  const [leaders, setLeaders] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<any>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      const { data } = await supabase.rpc("get_counsellor_leaderboard" as any);
      if (!data) return;
      const sorted = (data as any[]).sort((a, b) => b.weekly_score - a.weekly_score);
      setLeaders(sorted.slice(0, 5));

      if (profile?.id) {
        const idx = sorted.findIndex((s: any) => s.counsellor_id === profile.id);
        if (idx >= 0) {
          setMyRank(idx + 1);
          setMyScore(sorted[idx]);
        }
      }
    };

    fetchLeaderboard();

    // Listen for score updates
    if (!profile?.id) return;
    const channel = supabase
      .channel("leaderboard-widget")
      .on("postgres_changes" as any, {
        event: "INSERT",
        schema: "public",
        table: "counsellor_score_events",
      }, fetchLeaderboard)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  if (leaders.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-warning/5/50 dark:bg-warning/90/10 border-b border-border/40">
        <Trophy className="h-4 w-4 text-warning" />
        <span className="text-sm font-semibold text-foreground">Weekly Leaderboard</span>
        {myRank && myScore && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Your rank:</span>
            <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${
              myRank <= 3 ? "bg-warning/10 text-warning-foreground" : "bg-muted text-foreground"
            }`}>
              #{myRank}
            </span>
            {myScore.daily_score !== 0 && (
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                myScore.daily_score > 0 ? "bg-success/10 dark:bg-success/80/30 text-success dark:text-success/60" : "bg-destructive/10 dark:bg-destructive/80/30 text-destructive dark:text-destructive/60"
              }`}>
                Today: {myScore.daily_score > 0 ? `+${myScore.daily_score}` : myScore.daily_score}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              All: {myScore.total_score}
            </span>
          </div>
        )}
      </div>
      <div className="divide-y divide-border/40">
        {leaders.map((s: any, i: number) => {
          const isMe = s.counsellor_id === profile?.id;
          return (
            <div key={s.counsellor_id} className={`flex items-center gap-3 px-4 py-2 ${isMe ? "bg-primary/5" : ""}`}>
              <span className="w-6 text-center shrink-0">
                {i === 0 ? <Trophy className="h-3.5 w-3.5 text-warning mx-auto" /> :
                 i === 1 ? <Trophy className="h-3.5 w-3.5 text-gray-400 mx-auto" /> :
                 i === 2 ? <Trophy className="h-3.5 w-3.5 text-warning-foreground mx-auto" /> :
                 <span className="text-[10px] text-muted-foreground">{i + 1}</span>}
              </span>
              <span className={`flex-1 text-xs truncate ${isMe ? "font-bold text-foreground" : "text-foreground"}`}>
                {s.counsellor_name || "Unknown"}
                {isMe && <span className="text-[9px] text-primary ml-1">(You)</span>}
              </span>
              {s.daily_score !== 0 && (
                <span className={`text-[9px] font-bold ${s.daily_score > 0 ? "text-success" : "text-destructive"}`}>
                  {s.daily_score > 0 ? `+${s.daily_score}` : s.daily_score}
                </span>
              )}
              <span className={`text-xs font-bold ${
                s.total_score > 0 ? "text-primary" : s.total_score < 0 ? "text-destructive" : "text-muted-foreground"
              }`}>
                {s.total_score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type ActionBucketKey = "overdue" | "new_leads" | "today_followups" | "today_visits" | "post_visit" | "stalled" | "upcoming";

interface ActionCenterViewProps {
  counsellorFilter?: string;
  counsellorOptions?: { id: string; name: string }[];
  canFilterByCounsellor?: boolean;
  onCounsellorFilterChange?: (id: string) => void;
  onViewAll?: (bucket: ActionBucketKey, leadIds: string[]) => void;
}

export function ActionCenterView({
  counsellorFilter,
  counsellorOptions = [],
  canFilterByCounsellor = false,
  onViewAll,
  onCounsellorFilterChange,
}: ActionCenterViewProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const scopedId = counsellorFilter === "all" ? undefined : counsellorFilter;
  const { data, loading, refetch } = useActionCenter(scopedId);

  // Disposition dialog state retained for the legacy onSubmit handler used by
  // a few buckets that still surface it inline (e.g. visit-completion follow
  // up). Action buttons no longer open it directly — they navigate to the
  // lead's detail page with ?action=call so a real Cloud Call is placed.
  const [callLead, setCallLead] = useState<ActionLead | null>(null);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);

  // Fetch campuses only when the legacy inline disposition dialog opens.
  useEffect(() => {
    if (!callLead || campuses.length > 0) return;
    (async () => {
      const { data } = await supabase.from("campuses").select("id, name").order("name");
      setCampuses(data || []);
    })();
  }, [callLead, campuses.length]);

  // Navigate to the lead's detail page with ?action=call. LeadDetail's
  // useEffect picks that up and triggers a real Cloud Call (Plivo bridges
  // the counsellor's phone to the lead). The disposition dialog auto-opens
  // 3s after the call connects so the result is logged. This replaces the
  // previous in-place disposition dialog which let staff log "not answered"
  // entries without ever placing a call.
  const handleCall = (lead: ActionLead) => {
    navigate(`/admissions/${lead.lead_id}?action=call`);
  };

  const handleCallSubmit = async (dispositionData: any) => {
    if (!callLead || !profile?.id) return;

    const { data: { user: authUser } } = await supabase.auth.getUser();
    await recordCallDisposition({
      supabase,
      leadId: callLead.lead_id,
      lead: { name: callLead.name, phone: callLead.phone, stage: callLead.stage },
      userId: authUser?.id || null,
      profileId: profile.id,
      courseName: callLead.course_name,
      data: dispositionData,
      loggedFromLabel: "action center",
      callSource: "manual_log",
    });

    // Schedule visit if requested
    if (dispositionData.visit?.visit_date) {
      await supabase.from("campus_visits").insert({
        lead_id: callLead.lead_id,
        campus_id: dispositionData.visit.campus_id,
        scheduled_by: (await supabase.auth.getUser()).data.user?.id,
        visit_date: dispositionData.visit.visit_date,
        status: "scheduled",
      });
    }

    toast({ title: "Call logged", description: `Disposition: ${dispositionData.disposition.replace(/_/g, " ")}` });
    setCallLead(null);
    refetch();
  };

  const handleCompleteVisit = async (lead: ActionLead) => {
    if (!lead.visit_id) return;
    const { error } = await supabase
      .from("campus_visits")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", lead.visit_id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Visit completed" });
      refetch();
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const counts = {
    overdue: data.overdueFollowups.length,
    newLeads: data.newLeads.length,
    today: data.todayFollowups.length,
    visits: data.todayVisits.length,
    postVisit: data.postVisitPending.length,
    stalled: data.stalledApps.length,
    upcoming: data.upcomingWeek.length,
  };

  const totalActions = counts.overdue + counts.newLeads + counts.today + counts.visits + counts.postVisit + counts.stalled;

  return (
    <div className="space-y-4">
      {/* Admin counsellor filter */}
      {canFilterByCounsellor && counsellorOptions.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground">Counsellor:</label>
          <select
            value={counsellorFilter || "all"}
            onChange={(e) => onCounsellorFilterChange?.(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="all">All Counsellors</option>
            {counsellorOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {totalActions === 0 ? (
          <span className="text-sm font-medium text-success dark:text-success">All caught up! No pending actions.</span>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground mr-1">{totalActions} pending actions:</span>
            {counts.overdue > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 dark:bg-destructive/80/30 px-2.5 py-1 text-xs font-semibold text-destructive dark:text-destructive/60">
                {counts.overdue} Overdue
              </span>
            )}
            {counts.newLeads > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 dark:bg-warning/80/30 px-2.5 py-1 text-xs font-semibold text-warning-foreground dark:text-warning/60">
                {counts.newLeads} Untouched
              </span>
            )}
            {counts.today > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info/10 dark:bg-info/80/30 px-2.5 py-1 text-xs font-semibold text-info-foreground dark:text-info/60">
                {counts.today} Today
              </span>
            )}
            {counts.visits > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 dark:bg-primary/80/30 px-2.5 py-1 text-xs font-semibold text-primary dark:text-primary/50">
                {counts.visits} Visits
              </span>
            )}
            {counts.postVisit > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 dark:bg-warning/80/30 px-2.5 py-1 text-xs font-semibold text-warning-foreground dark:text-warning/70">
                {counts.postVisit} Post-Visit
              </span>
            )}
            {counts.stalled > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/30 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                {counts.stalled} Stalled
              </span>
            )}
          </>
        )}
      </div>

      {/* Leaderboard widget */}
      <LeaderboardWidget />

      {/* Urgent buckets — 2x2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ActionBucketSection
          title="Overdue Follow-ups"
          icon="🔴"
          color="border-destructive/25"
          headerBg="bg-destructive/5 dark:bg-destructive/90/20"
          variant="overdue"
          leads={data.overdueFollowups}
          storageKey="overdue"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("overdue", data.overdueFollowups.map(l => l.lead_id))}
        />

        <ActionBucketSection
          title="New Leads to Contact"
          icon="🟠"
          color="border-warning/30"
          headerBg="bg-warning/5 dark:bg-warning/90/20"
          variant="new_lead"
          leads={data.newLeads}
          storageKey="new_leads"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("new_leads", data.newLeads.map(l => l.lead_id))}
        />

        <ActionBucketSection
          title="Today's Follow-ups"
          icon="🔵"
          color="border-info/30"
          headerBg="bg-info/5 dark:bg-info/90/20"
          variant="today_followup"
          leads={data.todayFollowups}
          storageKey="today_followups"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("today_followups", data.todayFollowups.map(l => l.lead_id))}
        />

        <ActionBucketSection
          title="Today's Visits"
          icon="🟣"
          color="border-primary/30"
          headerBg="bg-primary/5 dark:bg-primary/90/20"
          variant="today_visit"
          leads={data.todayVisits}
          storageKey="today_visits"
          onCall={handleCall}
          onCompleteVisit={handleCompleteVisit}
          onViewAll={() => onViewAll?.("today_visits", data.todayVisits.map(l => l.lead_id))}
        />
      </div>

      {/* Secondary buckets — 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ActionBucketSection
          title="Post-Visit Pending"
          icon="🟡"
          color="border-warning/30"
          headerBg="bg-warning/5 dark:bg-warning/90/20"
          variant="post_visit"
          leads={data.postVisitPending}
          storageKey="post_visit"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("post_visit", data.postVisitPending.map(l => l.lead_id))}
        />

        <ActionBucketSection
          title="Stalled Applications"
          icon="🟢"
          color="border-teal-400"
          headerBg="bg-teal-50 dark:bg-teal-950/20"
          variant="stalled"
          leads={data.stalledApps}
          storageKey="stalled"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("stalled", data.stalledApps.map(l => l.lead_id))}
        />

        <ActionBucketSection
          title="Upcoming This Week"
          icon="⚪"
          color="border-gray-300"
          headerBg="bg-gray-50 dark:bg-gray-900/30"
          variant="upcoming"
          leads={data.upcomingWeek}
          defaultCollapsed={true}
          storageKey="upcoming"
          onCall={handleCall}
          onViewAll={() => onViewAll?.("upcoming", data.upcomingWeek.map(l => l.lead_id))}
        />
      </div>

      {/* Call Disposition Dialog */}
      <CallDispositionDialog
        open={!!callLead}
        onOpenChange={(open) => { if (!open) setCallLead(null); }}
        leadName={callLead?.name || ""}
        leadPhone={callLead?.phone || ""}
        campuses={campuses}
        onSubmit={handleCallSubmit}
        leadSource={callLead?.source || null}
      />
    </div>
  );
}
