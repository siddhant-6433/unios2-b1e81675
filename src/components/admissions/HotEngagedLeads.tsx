import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  profileId?: string;
  isSuperAdmin?: boolean;
  isTeamLeader?: boolean;
}

interface HotLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  engagement_score: number;
  lead_score: number;
  last_engaged_at: string;
  counsellor_id: string | null;
  course_name: string | null;
  counsellor_name: string | null;
  campus_name: string | null;
  last_event_type: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function engagementColor(score: number): string {
  if (score >= 80) return "bg-red-500";
  if (score >= 50) return "bg-orange-400";
  if (score >= 30) return "bg-amber-400";
  return "bg-amber-300";
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New", counsellor_call: "Follow Up", ai_called: "AI Called",
  visit_scheduled: "Visit", interview: "Interview", offer_sent: "Offer",
  token_paid: "Token Paid", pre_admitted: "Pre-Admit", admitted: "Admitted",
  application_in_progress: "App In Progress", application_submitted: "App Submitted",
  deferred: "Deferred",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage.replace(/_/g, " ");
}

function stageColor(stage: string): string {
  if (stage === "admitted" || stage === "pre_admitted" || stage === "token_paid") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (stage === "visit_scheduled" || stage === "interview") return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
  if (stage === "counsellor_call" || stage === "ai_called") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  if (stage === "new_lead") return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

const EVENT_LABELS: Record<string, string> = {
  page_view: "Visited website",
  chat_open: "Opened chat",
  chat_message: "Sent chat message",
  navya_click: "Talked to Navya",
  whatsapp_click: "Clicked WhatsApp",
  email_open: "Opened email",
  form_start: "Started form",
  apply_click: "Clicked Apply",
  whatsapp_reply: "Replied on WhatsApp",
};

function activityTag(eventType: string | null): string {
  if (eventType && EVENT_LABELS[eventType]) return EVENT_LABELS[eventType];
  return "Active on site";
}

export function HotEngagedLeads({ profileId, isSuperAdmin, isTeamLeader }: Props) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<HotLead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    let query = supabase
      .from("hot_engaged_leads" as any)
      .select("*")
      .order("last_engaged_at", { ascending: false })
      .limit(10);

    // Non-admin counsellors see only their assigned leads
    if (!isSuperAdmin && !isTeamLeader && profileId) {
      query = query.eq("counsellor_id" as any, profileId);
    }

    const { data } = await query;
    setLeads((data as HotLead[] | null) || []);
    setLoading(false);
  }, [profileId, isSuperAdmin, isTeamLeader]);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return (
    <Card className="rounded-xl border border-orange-200 dark:border-orange-800/40 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 shadow-sm">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
        </div>
        <h3 className="text-sm font-semibold text-orange-900 dark:text-orange-300">
          Hot Leads &mdash; Recently Active
        </h3>
      </div>

      <CardContent className="px-4 pb-4 pt-1">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-orange-100/50 dark:bg-orange-900/10" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No recently active leads
          </p>
        ) : (
          <div className="space-y-1.5">
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => navigate(`/admissions/${lead.id}`)}
                className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-orange-100/60 dark:hover:bg-orange-900/20"
              >
                {/* Flame intensity */}
                <div className="relative flex-shrink-0">
                  <Flame
                    className={`h-4 w-4 ${
                      lead.engagement_score >= 80
                        ? "text-red-500"
                        : lead.engagement_score >= 50
                        ? "text-orange-500"
                        : "text-amber-400"
                    }`}
                  />
                </div>

                {/* Name + course + activity tag */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground group-hover:underline">
                      {lead.name}
                    </span>
                    {lead.course_name && (
                      <Badge
                        variant="secondary"
                        className="flex-shrink-0 border-0 bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 text-[9px] px-1.5 py-0"
                      >
                        {lead.course_name}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {activityTag(lead.last_event_type)}
                    </span>
                    <Badge className={`border-0 text-[9px] px-1.5 py-0 ${stageColor(lead.stage)}`}>
                      {stageLabel(lead.stage)}
                    </Badge>
                  </div>
                </div>

                {/* Engagement bar + time */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {timeAgo(lead.last_engaged_at)}
                  </span>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-orange-200/60 dark:bg-orange-900/30">
                      <div
                        className={`h-full rounded-full transition-all ${engagementColor(lead.engagement_score)}`}
                        style={{ width: `${Math.min(lead.engagement_score, 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums font-medium text-muted-foreground">
                      {lead.engagement_score}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
