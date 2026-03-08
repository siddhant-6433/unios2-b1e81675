import { useState } from "react";
import { mockLeads, admissionStages, type AdmissionStage } from "@/data/mockData";
import { Phone, Mail, ChevronRight, Plus, Search, Filter } from "lucide-react";

const stageColors: Record<AdmissionStage, string> = {
  "New Lead": "bg-stage-new",
  "AI Called": "bg-pastel-purple",
  "Counsellor Call": "bg-pastel-blue",
  "Visit Scheduled": "bg-stage-visit",
  "Interview": "bg-stage-interview",
  "Offer Sent": "bg-pastel-mint",
  "Token Paid": "bg-stage-paid",
  "Pre-Admitted": "bg-pastel-green",
  "Admitted": "bg-pastel-green",
  "Rejected": "bg-stage-rejected",
};

const Admissions = () => {
  const [view, setView] = useState<"pipeline" | "list">("pipeline");
  const [search, setSearch] = useState("");

  const filtered = mockLeads.filter(
    (l) => l.name.toLowerCase().includes(search.toLowerCase()) || l.course.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admissions</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage leads, applications & admissions pipeline.</p>
        </div>
        <button className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          Add Lead
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors">
          <Filter className="h-4 w-4" />
          Filter
        </button>
        <div className="flex rounded-xl border border-input bg-card p-0.5">
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
        /* Pipeline View */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {admissionStages.map((stage) => {
            const stageLeads = filtered.filter((l) => l.stage === stage);
            return (
              <div key={stage} className="min-w-[260px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${stageColors[stage]}`} />
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{stage}</h3>
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stageLeads.map((lead) => (
                    <div key={lead.id} className="rounded-xl bg-card p-4 card-shadow cursor-pointer hover:card-shadow-md transition-all group">
                      <div className="flex items-start justify-between">
                        <h4 className="text-sm font-semibold text-foreground">{lead.name}</h4>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-xs text-primary font-medium mt-1">{lead.course}</p>
                      <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone.slice(-4)}</span>
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email.split("@")[0]}</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${stageColors[lead.stage]} text-foreground/70`}>
                          {lead.source}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{lead.counsellor}</span>
                      </div>
                    </div>
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      No leads
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{lead.name}</div>
                    <div className="text-xs text-muted-foreground">{lead.email}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{lead.course}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-md px-2.5 py-1 text-xs font-medium ${stageColors[lead.stage]} text-foreground/80`}>
                      {lead.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.counsellor}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.source}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.createdDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Admissions;
