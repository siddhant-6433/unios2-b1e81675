import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { mockLeads, admissionStages, type AdmissionStage, type LeadSource } from "@/data/mockData";
import {
  Phone, MessageSquare, ChevronRight, Plus, Search, Filter,
  Eye, Calendar, MoreHorizontal, Users, TrendingUp, ArrowUpRight,
  Bot, UserCheck, MapPin, FileText, CheckCircle, XCircle, Clock
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const stageColors: Record<AdmissionStage, string> = {
  "New Lead": "bg-pastel-blue text-foreground/70",
  "AI Called": "bg-pastel-purple text-foreground/70",
  "Counsellor Call": "bg-pastel-orange text-foreground/70",
  "Visit Scheduled": "bg-pastel-yellow text-foreground/70",
  "Interview": "bg-pastel-mint text-foreground/70",
  "Offer Sent": "bg-pastel-green text-foreground/70",
  "Token Paid": "bg-primary/15 text-primary",
  "Pre-Admitted": "bg-primary/20 text-primary",
  "Admitted": "bg-primary text-primary-foreground",
  "Rejected": "bg-pastel-red text-foreground/70",
};

const stageIcons: Record<AdmissionStage, typeof Users> = {
  "New Lead": Users,
  "AI Called": Bot,
  "Counsellor Call": Phone,
  "Visit Scheduled": MapPin,
  "Interview": UserCheck,
  "Offer Sent": FileText,
  "Token Paid": CheckCircle,
  "Pre-Admitted": Clock,
  "Admitted": CheckCircle,
  "Rejected": XCircle,
};

const sourceBadgeColors: Record<LeadSource, string> = {
  "Website": "bg-pastel-blue",
  "Meta Ads": "bg-pastel-purple",
  "Google Ads": "bg-pastel-green",
  "Shiksha": "bg-pastel-orange",
  "Walk-in": "bg-pastel-yellow",
  "Consultant": "bg-pastel-pink",
  "JustDial": "bg-pastel-mint",
  "Referral": "bg-pastel-red",
  "Education Fair": "bg-pastel-purple",
  "Other": "bg-muted",
};

const Admissions = () => {
  const [view, setView] = useState<"pipeline" | "list">("pipeline");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<AdmissionStage | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "all">("all");

  const filtered = mockLeads.filter((l) => {
    const matchesSearch = l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.course.toLowerCase().includes(search.toLowerCase()) ||
      l.campus.toLowerCase().includes(search.toLowerCase());
    const matchesStage = stageFilter === "all" || l.stage === stageFilter;
    const matchesSource = sourceFilter === "all" || l.source === sourceFilter;
    return matchesSearch && matchesStage && matchesSource;
  });

  /* ── Stats row ── */
  const totalLeads = mockLeads.length;
  const todayLeads = mockLeads.filter(l => l.createdDate === "2026-03-06").length;
  const preAdmitted = mockLeads.filter(l => ["Pre-Admitted", "Token Paid"].includes(l.stage)).length;
  const admitted = mockLeads.filter(l => l.stage === "Admitted").length;

  const stats = [
    { label: "Total Leads", value: totalLeads, sub: `+${todayLeads} today`, icon: Users, iconBg: "bg-pastel-blue" },
    { label: "AI Calls Today", value: 24, sub: "83% connect rate", icon: Bot, iconBg: "bg-pastel-purple" },
    { label: "Pre-Admitted", value: preAdmitted, sub: "Token paid", icon: Clock, iconBg: "bg-pastel-orange" },
    { label: "Admitted", value: admitted, sub: "25%+ fee paid", icon: CheckCircle, iconBg: "bg-pastel-green" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admissions CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage leads, applications & admissions pipeline</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Lead
        </Button>
      </div>

      {/* ── Stats ── */}
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

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads by name, course, campus..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option value="all">All Stages</option>
          {admissionStages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as any)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <option value="all">All Sources</option>
          {(["Website","Meta Ads","Google Ads","Shiksha","Walk-in","Consultant","JustDial","Referral","Education Fair"] as LeadSource[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="flex rounded-xl border border-input bg-card p-0.5 ml-auto">
          <button
            onClick={() => setView("pipeline")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Pipeline
          </button>
          <button
            onClick={() => setView("list")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            List
          </button>
        </div>
      </div>

      {view === "pipeline" ? (
        /* ── Pipeline View ── */
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
          {admissionStages.map((stage) => {
            const stageLeads = filtered.filter((l) => l.stage === stage);
            const StageIcon = stageIcons[stage];
            return (
              <div key={stage} className="min-w-[280px] max-w-[280px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <StageIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{stage}</h3>
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stageLeads.map((lead) => (
                    <Card key={lead.id} className="border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer group">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{lead.name}</h4>
                            <p className="text-xs text-primary font-medium mt-0.5">{lead.course}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{lead.campus}</p>
                        <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone.slice(-4)}</span>
                          {lead.applicationId && (
                            <span className="font-mono text-primary/70">{lead.applicationId}</span>
                          )}
                        </div>
                        {(lead.preAdmissionNo || lead.admissionNo) && (
                          <div className="mt-2">
                            {lead.preAdmissionNo && !lead.admissionNo && (
                              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">PAN: {lead.preAdmissionNo}</Badge>
                            )}
                            {lead.admissionNo && (
                              <Badge className="text-[10px] bg-primary text-primary-foreground">AN: {lead.admissionNo}</Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                          <Badge className={`text-[10px] font-medium border-0 ${sourceBadgeColors[lead.source]}`}>{lead.source}</Badge>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                              <Phone className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                              <MessageSquare className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{lead.counsellor}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                      No leads
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── List View ── */
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
                  <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{lead.name}</div>
                      <div className="text-xs text-muted-foreground">{lead.phone} · {lead.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{lead.course}</div>
                      <div className="text-xs text-muted-foreground">{lead.campus}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[11px] font-medium border-0 ${stageColors[lead.stage]}`}>
                        {lead.stage}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[11px] font-medium border-0 ${sourceBadgeColors[lead.source]}`}>
                        {lead.source}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{lead.counsellor}</td>
                    <td className="px-4 py-3">
                      {lead.applicationId && <div className="text-xs font-mono text-muted-foreground">{lead.applicationId}</div>}
                      {lead.preAdmissionNo && <div className="text-xs font-mono text-primary">{lead.preAdmissionNo}</div>}
                      {lead.admissionNo && <div className="text-xs font-mono font-semibold text-primary">{lead.admissionNo}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{lead.createdDate}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
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
