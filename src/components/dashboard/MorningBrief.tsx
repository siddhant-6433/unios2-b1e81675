import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sunrise, Flame, AlarmClock, CalendarCheck, MapPin, FileText,
  IndianRupee, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";

interface BriefLead {
  id: string;
  name: string;
  phone: string;
  stage?: string;
  minutes_waiting?: number;
}

interface BriefFollowup {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  scheduled_at: string;
  type: string;
  overdue: boolean;
}

interface BriefVisit {
  id: string;
  lead_id: string;
  name: string;
  phone: string;
  visit_date: string;
  status: string;
}

interface YesterdayKpis {
  kpi_date: string;
  fresh_calls: number;
  followup_calls: number;
  whatsapp_followups: number;
  meaningful_calls: number;
  visits_conducted: number;
  applications_submitted: number;
  tokens_collected: number;
  composite_pct: number | null;
}

interface Brief {
  hot_leads: BriefLead[];
  sla_breaches: BriefLead[];
  followups: BriefFollowup[];
  overdue_followup_count: number;
  visits_today: BriefVisit[];
  post_visit_pending: number;
  applications: BriefLead[];
  closest_to_money: BriefLead[];
  yesterday_kpis: YesterdayKpis | null;
}

const briefRpc = supabase as unknown as {
  rpc: (fn: "counsellor_morning_brief") => Promise<{ data: Brief | null; error: { message: string } | null }>;
};

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function LeadLine({ lead, note }: { lead: BriefLead; note?: string }) {
  return (
    <Link
      to={`/admissions/${lead.id}`}
      className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors"
    >
      <span className="text-xs font-medium text-foreground truncate">{lead.name}</span>
      <span className="text-[11px] text-muted-foreground whitespace-nowrap ml-2">{note ?? lead.phone}</span>
    </Link>
  );
}

function Section({
  icon: Icon, title, count, tone, children,
}: {
  icon: typeof Flame;
  title: string;
  count: number;
  tone: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{count}</Badge>
      </div>
      {children}
    </div>
  );
}

export function MorningBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    briefRpc.rpc("counsellor_morning_brief").then(({ data, error }) => {
      if (cancelled) return;
      if (error) console.error("Morning brief error:", error.message);
      setBrief(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card className="rounded-2xl border-border/40">
        <CardContent className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing your morning brief…
        </CardContent>
      </Card>
    );
  }
  if (!brief) return null;

  const totalActions =
    brief.hot_leads.length + brief.sla_breaches.length + brief.followups.length +
    brief.visits_today.length + brief.applications.length + brief.closest_to_money.length +
    brief.post_visit_pending;
  const k = brief.yesterday_kpis;

  return (
    <Card className="rounded-2xl border-amber-200/60 bg-gradient-to-br from-amber-50/60 to-orange-50/30">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
              <Sunrise className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Morning Brief</h3>
              <p className="text-[11px] text-muted-foreground">
                {totalActions === 0
                  ? "All clear — go create some new opportunities today."
                  : `${totalActions} things that will move the needle today`}
              </p>
            </div>
          </div>
          <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Section icon={AlarmClock} title="Respond now (SLA)" count={brief.sla_breaches.length} tone="text-destructive">
              {brief.sla_breaches.map(l => (
                <LeadLine key={l.id} lead={l} note={`waiting ${Math.round(l.minutes_waiting ?? 0)}m`} />
              ))}
            </Section>

            <Section icon={Flame} title="Hot leads" count={brief.hot_leads.length} tone="text-orange-500">
              {brief.hot_leads.map(l => <LeadLine key={l.id} lead={l} />)}
            </Section>

            <Section icon={IndianRupee} title="Closest to money" count={brief.closest_to_money.length} tone="text-emerald-600">
              {brief.closest_to_money.map(l => (
                <LeadLine key={l.id} lead={l} note={l.stage?.replaceAll("_", " ")} />
              ))}
            </Section>

            <Section icon={CalendarCheck} title="Follow-ups" count={brief.followups.length} tone="text-blue-600">
              {brief.followups.map(f => (
                <LeadLine
                  key={f.id}
                  lead={{ id: f.lead_id, name: f.name, phone: f.phone }}
                  note={f.overdue ? "overdue" : timeOf(f.scheduled_at)}
                />
              ))}
              {brief.overdue_followup_count > brief.followups.length && (
                <p className="px-2 text-[11px] text-muted-foreground">
                  +{brief.overdue_followup_count - brief.followups.filter(f => f.overdue).length} more overdue
                </p>
              )}
            </Section>

            <Section icon={MapPin} title="Visits today" count={brief.visits_today.length} tone="text-violet-600">
              {brief.visits_today.map(v => (
                <LeadLine key={v.id} lead={{ id: v.lead_id, name: v.name, phone: v.phone }} note={timeOf(v.visit_date)} />
              ))}
              {brief.post_visit_pending > 0 && (
                <p className="px-2 text-[11px] text-amber-700">
                  {brief.post_visit_pending} recent {brief.post_visit_pending === 1 ? "visit needs" : "visits need"} a follow-up
                </p>
              )}
            </Section>

            <Section icon={FileText} title="Applications in flight" count={brief.applications.length} tone="text-sky-600">
              {brief.applications.map(l => (
                <LeadLine key={l.id} lead={l} note={l.stage?.replaceAll("_", " ")} />
              ))}
            </Section>
          </div>
        )}

        {expanded && k && (
          <div className="mt-4 border-t border-border/40 pt-3">
            <p className="text-[11px] text-muted-foreground">
              Yesterday: {k.fresh_calls} fresh + {k.followup_calls} follow-up calls · {k.whatsapp_followups} WhatsApps ·{" "}
              {k.meaningful_calls} meaningful · {k.visits_conducted} visits · {k.applications_submitted} applications ·{" "}
              {k.tokens_collected} tokens
              {k.composite_pct != null && <> · KPI score <span className="font-semibold">{k.composite_pct}%</span></>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
