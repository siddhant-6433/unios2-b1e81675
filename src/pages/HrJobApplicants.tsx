import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  UserPlus, Loader2, MessageSquare, ExternalLink, Sparkles,
  Briefcase, CheckCircle2, XCircle, Clock, Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type Status = "all" | "new" | "reviewing" | "shortlisted" | "interview" | "rejected" | "hired" | "withdrawn";

interface JobApplicantRow {
  id: string;
  lead_id: string;
  status: string;
  name: string | null;
  phone: string | null;
  desired_role: string | null;
  experience_years: number | null;
  resume_url: string | null;
  classification_source: string;
  ai_intent: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  created_at: string;
  email: string | null;
  lead_source: string | null;
  last_message_preview: string | null;
  inbound_message_count: number | null;
}

const STATUS_TABS: { key: Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "interview", label: "Interview" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
];

const STATUS_BADGE: Record<string, string> = {
  new: "bg-pastel-blue text-foreground/80",
  reviewing: "bg-pastel-yellow text-foreground/80",
  shortlisted: "bg-pastel-purple text-foreground/80",
  interview: "bg-pastel-orange text-foreground/80",
  hired: "bg-pastel-green text-foreground/80",
  rejected: "bg-pastel-red text-foreground/80",
  withdrawn: "bg-muted text-muted-foreground",
};

function formatExp(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return "<1 yr";
  return `${v} yr${v >= 2 ? "s" : ""}`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const HrJobApplicants = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<Status>("new");
  const [items, setItems] = useState<JobApplicantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<JobApplicantRow | null>(null);
  const [activeNotes, setActiveNotes] = useState("");
  const [activeRole, setActiveRole] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, [tab]);

  async function fetchAll() {
    setLoading(true);

    let query = supabase
      .from("job_applicants_inbox" as any)
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (tab !== "all") query = query.eq("status", tab);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      setItems((data as any[]) || []);
    }

    // Counts per status
    const { data: countRows } = await supabase
      .from("job_applicants" as any)
      .select("status");
    const c: Record<string, number> = { all: 0 };
    for (const r of (countRows as any[]) || []) {
      c.all = (c.all || 0) + 1;
      c[r.status] = (c[r.status] || 0) + 1;
    }
    setCounts(c);

    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(r =>
      (r.name || "").toLowerCase().includes(q)
      || (r.phone || "").toLowerCase().includes(q)
      || (r.desired_role || "").toLowerCase().includes(q)
      || (r.last_message_preview || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  function openDetail(row: JobApplicantRow) {
    setActive(row);
    setActiveNotes("");
    setActiveRole(row.desired_role || "");
  }

  async function updateStatus(id: string, status: string) {
    setSaving(true);
    const { error } = await supabase
      .from("job_applicants" as any)
      .update({ status })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Updated", description: `Status changed to ${status}` });
    setActive(null);
    fetchAll();
  }

  async function saveDetails() {
    if (!active) return;
    setSaving(true);
    const patch: any = {};
    if (activeRole && activeRole !== (active.desired_role || "")) patch.desired_role = activeRole;
    if (activeNotes) {
      patch.notes = activeNotes;
    }
    if (Object.keys(patch).length === 0) { setSaving(false); return; }

    const { error } = await supabase
      .from("job_applicants" as any)
      .update(patch)
      .eq("id", active.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    fetchAll();
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6" /> Job Applicants
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            People who reached out about employment via WhatsApp — auto-categorized and routed here.
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
              tab === t.key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {t.label}
            {counts[t.key] != null && (
              <span className={`ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                tab === t.key ? "bg-background/20 text-background" : "bg-muted-foreground/15 text-muted-foreground"
              }`}>{counts[t.key]}</span>
            )}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, role..."
            className="h-8 w-[260px] rounded-md border border-border bg-background pl-8 pr-3 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      {/* List */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No applicants in this view.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Applicant</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Exp</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Last message</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Received</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(r)}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{r.name || "—"}</span>
                        <span className="text-[11px] text-muted-foreground font-mono">{r.phone || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{r.desired_role || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-foreground/80">{formatExp(r.experience_years)}</td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <p className="truncate text-foreground/80" title={r.last_message_preview || ""}>
                        {r.last_message_preview || <span className="text-muted-foreground">—</span>}
                      </p>
                      {r.inbound_message_count != null && r.inbound_message_count > 1 && (
                        <span className="text-[10px] text-muted-foreground">{r.inbound_message_count} messages</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.classification_source === "llm" ? (
                        <Badge className="bg-pastel-purple text-foreground/80 border-0 text-[10px]" title={r.ai_reasoning || ""}>
                          <Sparkles className="h-2.5 w-2.5 mr-1" /> AI
                          {r.ai_confidence != null && ` ${(r.ai_confidence * 100).toFixed(0)}%`}
                        </Badge>
                      ) : r.classification_source === "regex" ? (
                        <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">Auto</Badge>
                      ) : r.classification_source === "manual" ? (
                        <Badge className="bg-pastel-blue text-foreground/80 border-0 text-[10px]">Manual</Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">{r.classification_source}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(r.last_message_at || r.created_at)}</td>
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_BADGE[r.status] || "bg-muted text-muted-foreground"} border-0 text-[10px] capitalize`}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/whatsapp-inbox?phone=${encodeURIComponent(r.phone || "")}`); }}
                        className="text-muted-foreground hover:text-foreground"
                        title="Open conversation"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-2xl">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" /> {active.name || active.phone || "Applicant"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Phone</label><p className="font-mono">{active.phone || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</label><p>{active.email || "—"}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">First contact</label><p>{formatDate(active.first_message_at)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Last message</label><p>{formatDate(active.last_message_at)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Experience</label><p>{formatExp(active.experience_years)}</p></div>
                  <div><label className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</label><p className="capitalize">{active.status}</p></div>
                </div>

                {active.ai_reasoning && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Sparkles className="h-3 w-3" /> Why we routed this here
                    </p>
                    <p className="text-foreground/90 italic">{active.ai_reasoning}</p>
                    {active.ai_confidence != null && (
                      <p className="text-[10px] text-muted-foreground mt-1">Model confidence: {(active.ai_confidence * 100).toFixed(0)}%</p>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Last message</label>
                  <p className="rounded-md bg-muted/30 px-3 py-2 mt-1">{active.last_message_preview || "—"}</p>
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Desired role</label>
                  <input
                    value={activeRole}
                    onChange={e => setActiveRole(e.target.value)}
                    placeholder="e.g. Faculty - Nursing"
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</label>
                  <Textarea
                    value={activeNotes}
                    onChange={e => setActiveNotes(e.target.value)}
                    placeholder="Add notes from screening..."
                    className="mt-1"
                    rows={3}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => updateStatus(active.id, "reviewing")} disabled={saving}>
                    <Clock className="h-3.5 w-3.5 mr-1" /> Mark reviewing
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus(active.id, "shortlisted")} disabled={saving}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Shortlist
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus(active.id, "rejected")} disabled={saving}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/whatsapp-inbox?phone=${encodeURIComponent(active.phone || "")}`}>
                      <MessageSquare className="h-3.5 w-3.5 mr-1" /> Open chat
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/admissions/${active.lead_id}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> View lead record
                    </Link>
                  </Button>
                  <div className="ml-auto">
                    <Button size="sm" onClick={saveDetails} disabled={saving || (!activeNotes && activeRole === (active.desired_role || ""))}>
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HrJobApplicants;
