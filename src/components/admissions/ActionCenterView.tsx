import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useActionCenter, type ActionLead } from "@/hooks/useActionCenter";
import { ActionBucketSection } from "./ActionBucketSection";
import { CallDispositionDialog } from "./CallDispositionDialog";

interface ActionCenterViewProps {
  counsellorFilter?: string;
  counsellorOptions?: { id: string; name: string }[];
  canFilterByCounsellor?: boolean;
  onCounsellorFilterChange?: (id: string) => void;
}

export function ActionCenterView({
  counsellorFilter,
  counsellorOptions = [],
  canFilterByCounsellor = false,
  onCounsellorFilterChange,
}: ActionCenterViewProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const scopedId = counsellorFilter === "all" ? undefined : counsellorFilter;
  const { data, loading, refetch } = useActionCenter(scopedId);

  // Call disposition dialog state
  const [callLead, setCallLead] = useState<ActionLead | null>(null);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);

  // Fetch campuses for call disposition dialog
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campuses").select("id, name").order("name");
      setCampuses(data || []);
    })();
  }, []);

  const handleCall = (lead: ActionLead) => {
    setCallLead(lead);
  };

  const handleCallSubmit = async (dispositionData: any) => {
    if (!callLead || !profile?.id) return;

    // Insert call log
    await supabase.from("call_logs" as any).insert({
      lead_id: callLead.lead_id,
      user_id: (await supabase.auth.getUser()).data.user?.id,
      direction: "outbound",
      disposition: dispositionData.disposition,
      duration_seconds: dispositionData.duration_seconds,
      notes: dispositionData.notes,
    });

    // Mark pending followups as completed
    await supabase
      .from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("lead_id", callLead.lead_id)
      .eq("status", "pending");

    // Set first_contact_at if not set
    await supabase
      .from("leads")
      .update({ first_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", callLead.lead_id)
      .is("first_contact_at", null);

    // Update lead stage based on disposition
    if (["interested", "call_back", "not_answered", "voicemail", "busy"].includes(dispositionData.disposition)) {
      await supabase.from("leads").update({ stage: "counsellor_call", updated_at: new Date().toISOString() }).eq("id", callLead.lead_id).eq("stage", "new_lead");
    } else if (["not_interested", "do_not_contact"].includes(dispositionData.disposition)) {
      await supabase.from("leads").update({ stage: "not_interested", updated_at: new Date().toISOString() }).eq("id", callLead.lead_id);
    }

    // Schedule followup if requested
    if (dispositionData.schedule_followup && dispositionData.followup_date) {
      await supabase.from("lead_followups").insert({
        lead_id: callLead.lead_id,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        scheduled_at: dispositionData.followup_date,
        type: "call",
        status: "pending",
      });
    }

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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          <span className="text-sm font-medium text-green-600 dark:text-green-400">All caught up! No pending actions.</span>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground mr-1">{totalActions} pending actions:</span>
            {counts.overdue > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
                {counts.overdue} Overdue
              </span>
            )}
            {counts.newLeads > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-900/30 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:text-orange-300">
                {counts.newLeads} Untouched
              </span>
            )}
            {counts.today > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                {counts.today} Today
              </span>
            )}
            {counts.visits > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/30 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
                {counts.visits} Visits
              </span>
            )}
            {counts.postVisit > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
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

      {/* 7 Bucket sections */}
      <ActionBucketSection
        title="Overdue Follow-ups"
        icon="🔴"
        color="border-red-400"
        headerBg="bg-red-50 dark:bg-red-950/20"
        variant="overdue"
        leads={data.overdueFollowups}
        storageKey="overdue"
        onCall={handleCall}
      />

      <ActionBucketSection
        title="New Leads to Contact"
        icon="🟠"
        color="border-orange-400"
        headerBg="bg-orange-50 dark:bg-orange-950/20"
        variant="new_lead"
        leads={data.newLeads}
        storageKey="new_leads"
        onCall={handleCall}
      />

      <ActionBucketSection
        title="Today's Follow-ups"
        icon="🔵"
        color="border-blue-400"
        headerBg="bg-blue-50 dark:bg-blue-950/20"
        variant="today_followup"
        leads={data.todayFollowups}
        storageKey="today_followups"
        onCall={handleCall}
      />

      <ActionBucketSection
        title="Today's Visits"
        icon="🟣"
        color="border-violet-400"
        headerBg="bg-violet-50 dark:bg-violet-950/20"
        variant="today_visit"
        leads={data.todayVisits}
        storageKey="today_visits"
        onCall={handleCall}
        onCompleteVisit={handleCompleteVisit}
      />

      <ActionBucketSection
        title="Post-Visit Pending"
        icon="🟡"
        color="border-amber-400"
        headerBg="bg-amber-50 dark:bg-amber-950/20"
        variant="post_visit"
        leads={data.postVisitPending}
        storageKey="post_visit"
        onCall={handleCall}
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
      />

      {/* Call Disposition Dialog */}
      <CallDispositionDialog
        open={!!callLead}
        onOpenChange={(open) => { if (!open) setCallLead(null); }}
        leadName={callLead?.name || ""}
        leadPhone={callLead?.phone || ""}
        campuses={campuses}
        onSubmit={handleCallSubmit}
      />
    </div>
  );
}
