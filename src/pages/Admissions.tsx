import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Phone, MessageSquare, ChevronRight, Plus, Search, Filter,
  Eye, Calendar, MoreHorizontal, Users, TrendingUp, ArrowUpRight,
  Bot, UserCheck, MapPin, FileText, CheckCircle, XCircle, Clock, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddLeadDialog } from "@/components/admissions/AddLeadDialog";
import { BulkLeadImportDialog } from "@/components/admissions/BulkLeadImportDialog";

const STAGES = [
  "new_lead", "ai_called", "counsellor_call", "visit_scheduled",
  "interview", "offer_sent", "token_paid", "pre_admitted", "admitted", "rejected"
] as const;

type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const stageColors: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  ai_called: "bg-pastel-purple text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  interview: "bg-pastel-mint text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
  token_paid: "bg-primary/15 text-primary",
  pre_admitted: "bg-primary/20 text-primary",
  admitted: "bg-primary text-primary-foreground",
  rejected: "bg-pastel-red text-foreground/70",
};

const stageIcons: Record<string, typeof Users> = {
  new_lead: Users, ai_called: Bot, counsellor_call: Phone,
  visit_scheduled: MapPin, interview: UserCheck, offer_sent: FileText,
  token_paid: CheckCircle, pre_admitted: Clock, admitted: CheckCircle, rejected: XCircle,
};

const SOURCES = [
  "website", "meta_ads", "google_ads", "shiksha", "walk_in",
  "consultant", "justdial", "referral", "education_fair", "other"
] as const;

const sourceLabels: Record<string, string> = {
  website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads",
  shiksha: "Shiksha", walk_in: "Walk-in", consultant: "Consultant",
  justdial: "JustDial", referral: "Referral", education_fair: "Education Fair", other: "Other",
};

const sourceBadgeColors: Record<string, string> = {
  website: "bg-pastel-blue", meta_ads: "bg-pastel-purple", google_ads: "bg-pastel-green",
  shiksha: "bg-pastel-orange", walk_in: "bg-pastel-yellow", consultant: "bg-pastel-pink",
  justdial: "bg-pastel-mint", referral: "bg-pastel-red", education_fair: "bg-pastel-purple", other: "bg-muted",
};

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  source: string;
  created_at: string;
  application_id: string | null;
  pre_admission_no: string | null;
  admission_no: string | null;
  course_id: string | null;
  campus_id: string | null;
  counsellor_id: string | null;
  course_name?: string;
  campus_name?: string;
  counsellor_name?: string;
}

const Admissions = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<"pipeline" | "list">("pipeline");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchLeads(); }, []);

  const fetchLeads = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select(`*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)`)
      .order("created_at", { ascending: false })
      .limit(500);

    if (data) {
      setLeads(data.map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        counsellor_name: l.profiles?.display_name || "Unassigned",
      })));
    }
    setLoading(false);
  };

  const filtered = leads.filter((l) => {
    const matchesSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
      (l.course_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (l.campus_name || "").toLowerCase().includes(search.toLowerCase());
    const matchesStage = stageFilter === "all" || l.stage === stageFilter;
    const matchesSource = sourceFilter === "all" || l.source === sourceFilter;
    return matchesSearch && matchesStage && matchesSource;
  });

  const totalLeads = leads.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayLeads = leads.filter(l => l.created_at.slice(0, 10) === today).length;
  const preAdmitted = leads.filter(l => ["pre_admitted", "token_paid"].includes(l.stage)).length;
  const admitted = leads.filter(l => l.stage === "admitted").length;

  const stats = [
    { label: "Total Leads", value: totalLeads, sub: `+${todayLeads} today`, icon: Users, iconBg: "bg-pastel-blue" },
    { label: "Pre-Admitted", value: preAdmitted, sub: "Token paid", icon: Clock, iconBg: "bg-pastel-orange" },
    { label: "Admitted", value: admitted, sub: "25%+ fee paid", icon: CheckCircle, iconBg: "bg-pastel-green" },
    { label: "Conversion", value: totalLeads > 0 ? `${Math.round((admitted / totalLeads) * 100)}%` : "0%", sub: "Overall rate", icon: TrendingUp, iconBg: "bg-pastel-purple" },
  ];

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admissions CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage leads, applications & admissions pipeline</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" />Add Lead</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/60 shadow-none hover:shadow-sm transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-5 w-5 text-foreground/70" />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search leads by name, course, campus..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{sourceLabels[s]}</option>)}
        </select>
        <div className="flex rounded-xl border border-input bg-card p-0.5 ml-auto">
          <button onClick={() => setView("pipeline")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Pipeline
          </button>
          <button onClick={() => setView("list")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            List
          </button>
        </div>
      </div>

      {view === "pipeline" ? (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
          {STAGES.map((stage) => {
            const stageLeads = filtered.filter((l) => l.stage === stage);
            const StageIcon = stageIcons[stage];
            return (
              <div key={stage} className="min-w-[280px] max-w-[280px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <StageIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{STAGE_LABELS[stage]}</h3>
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stageLeads.map((lead) => (
                    <Card key={lead.id} onClick={() => navigate(`/admissions/${lead.id}`)} className="border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer group">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{lead.name}</h4>
                            <p className="text-xs text-primary font-medium mt-0.5">{lead.course_name}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{lead.campus_name}</p>
                        <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone.slice(-4)}</span>
                          {lead.application_id && <span className="font-mono text-primary/70">{lead.application_id}</span>}
                        </div>
                        {(lead.pre_admission_no || lead.admission_no) && (
                          <div className="mt-2">
                            {lead.pre_admission_no && !lead.admission_no && (
                              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">PAN: {lead.pre_admission_no}</Badge>
                            )}
                            {lead.admission_no && (
                              <Badge className="text-[10px] bg-primary text-primary-foreground">AN: {lead.admission_no}</Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                          <Badge className={`text-[10px] font-medium border-0 ${sourceBadgeColors[lead.source] || "bg-muted"}`}>{sourceLabels[lead.source] || lead.source}</Badge>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><Phone className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><MessageSquare className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{lead.counsellor_name}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-xs text-muted-foreground">No leads</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Campus</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">IDs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.id} onClick={() => navigate(`/admissions/${lead.id}`)} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{lead.name}</div>
                      <div className="text-xs text-muted-foreground">{lead.phone} · {lead.email || "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{lead.course_name}</div>
                      <div className="text-xs text-muted-foreground">{lead.campus_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[11px] font-medium border-0 ${stageColors[lead.stage] || "bg-muted"}`}>
                        {STAGE_LABELS[lead.stage] || lead.stage}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[11px] font-medium border-0 ${sourceBadgeColors[lead.source] || "bg-muted"}`}>
                        {sourceLabels[lead.source] || lead.source}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{lead.counsellor_name}</td>
                    <td className="px-4 py-3">
                      {lead.application_id && <div className="text-xs font-mono text-muted-foreground">{lead.application_id}</div>}
                      {lead.pre_admission_no && <div className="text-xs font-mono text-primary">{lead.pre_admission_no}</div>}
                      {lead.admission_no && <div className="text-xs font-mono font-semibold text-primary">{lead.admission_no}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><Phone className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Admissions;
