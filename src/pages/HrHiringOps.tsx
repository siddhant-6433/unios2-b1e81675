import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { UserPlus, MessageSquare, ExternalLink, Sparkles, Briefcase, CheckCircle2, XCircle, Clock, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { HiringPipeline } from "@/components/hr/HiringPipeline";
import { NotifyCandidateDialog, type NotifyPayload } from "@/components/hr/NotifyCandidateDialog";
import {
  stageOf, stageCounts, daysInStage, nextStages, STAGE_LABEL, STATUS_FOR_STAGE,
  type HiringStage,
} from "@/lib/hiringStages";

type Status = "all" | "new" | "reviewing" | "shortlisted" | "interview" | "rejected" | "hired" | "withdrawn";

interface TimelineRow {
  id: string;
  type: string;
  description: string;
  created_at: string;
}

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
  stage_changed_at?: string | null;
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

const HrHiringOps = () => {
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
  const [stage, setStage] = useState<HiringStage | null>(null);
  const [allRows, setAllRows] = useState<{ status: string | null }[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [pendingMove, setPendingMove] = useState<{ row: JobApplicantRow; next: HiringStage } | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);

    const query = supabase
      .from("job_applicants_inbox" as any)
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false });


    const { data, error } = await query;
    if (error) {
      console.error(error);
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
      setItems([]);
    } else {
      setItems((data as any[]) || []);
    }

    // The funnel must count every candidate, not just the visible tab — a stage
    // showing 0 because of the active filter is a lie about the pipeline.
    const { data: countRows } = await supabase
      .from("job_applicants" as any)
      .select("status");
    setAllRows((countRows as unknown as { status: string | null }[]) || []);
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

  const funnelCounts = useMemo(() => stageCounts(allRows), [allRows]);
  const visible = useMemo(
    () => (stage ? filtered.filter((r) => stageOf(r.status) === stage) : filtered),
    [filtered, stage],
  );

  function openDetail(row: JobApplicantRow) {
    setActive(row);
    setActiveNotes("");
    setActiveRole(row.desired_role || "");
    setTimeline([]);
    void loadTimeline(row.id);
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

    // A note is appended to the candidate's timeline, not written over
    // job_applicants.notes. The old version blanked the field on open and then
    // saved that blank back, so every save silently destroyed the previous
    // screening note.
    if (activeNotes.trim()) {
      const { error } = await supabase.from("job_applicant_activities").insert({
        applicant_id: active.id,
        user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        type: "note",
        description: activeNotes.trim(),
      });
      if (error) {
        setSaving(false);
        toast({ title: "Could not save the note", description: error.message, variant: "destructive" });
        return;
      }
    }

    if (activeRole && activeRole !== (active.desired_role || "")) {
      const { error } = await supabase
        .from("job_applicants" as any).update({ desired_role: activeRole }).eq("id", active.id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
    }

    setSaving(false);
    setActiveNotes("");
    toast({ title: "Saved" });
    void loadTimeline(active.id);
    fetchAll();
  }

  // Stages that have something to say get the dialog; the rest move silently.
  const NOTIFIABLE: HiringStage[] = ["sourced", "interview", "preboarding", "archived"];

  function moveToStage(row: JobApplicantRow, next: HiringStage) {
    if (NOTIFIABLE.includes(next)) {
      setPendingMove({ row, next });
      return;
    }
    void applyMove(row, next, null);
  }

  async function applyMove(row: JobApplicantRow, next: HiringStage, notify: NotifyPayload | null) {
    setSaving(true);
    const status = STATUS_FOR_STAGE[next];
    const { error } = await supabase
      .from("job_applicants" as any).update({ status }).eq("id", row.id);
    if (!error) {
      await supabase.from("job_applicant_activities").insert({
        applicant_id: row.id,
        user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        type: "stage",
        description: `Moved to ${STAGE_LABEL[next]}`,
      });
    }
    if (error) {
      setSaving(false);
      setPendingMove(null);
      toast({ title: "Could not move the candidate", description: error.message, variant: "destructive" });
      return;
    }

    if (notify && notify.channels.length) {
      const { data, error: notifyErr } = await supabase.functions.invoke("hiring-notify", {
        body: {
          applicant_id: row.id,
          stage: next,
          channels: notify.channels,
          venue_id: notify.venue_id,
          variables: notify.variables,
        },
      });
      const results = (data as { results?: Record<string, string> } | null)?.results ?? {};
      const summary = Object.entries(results).map(([k, v]) => `${k}: ${v}`).join(" · ");
      toast(
        notifyErr
          ? { title: `Moved to ${STAGE_LABEL[next]}, but nothing was sent`, description: notifyErr.message, variant: "destructive" }
          : { title: `Moved to ${STAGE_LABEL[next]}`, description: summary || "Nothing to send at this stage." },
      );
    } else {
      toast({ title: `Moved to ${STAGE_LABEL[next]}` });
    }

    setSaving(false);
    setPendingMove(null);
    setActive(null);
    fetchAll();
  }

  async function hire(row: JobApplicantRow) {
    if (!window.confirm(
      `Hire ${row.name || "this candidate"}? This creates their employee record — you can fill in the rest on their profile.`)) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("hire_job_applicant", {
      _applicant_id: row.id, _job_title: row.desired_role || undefined,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not hire", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Hired", description: "Employee record created." });
    setActive(null);
    fetchAll();
    if (data) navigate(`/employee/${data as string}`);
  }

  async function loadTimeline(applicantId: string) {
    const { data } = await supabase
      .from("job_applicant_activities")
      .select("id, type, description, created_at")
      .eq("applicant_id", applicantId)
      .order("created_at", { ascending: false });
    setTimeline((data as unknown as TimelineRow[]) || []);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6" /> Hiring Ops
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Candidates who reached out about employment — auto-categorised from WhatsApp and worked through the hiring funnel.
          </p>
        </div>
      </div>

      {/* Funnel — the stage strip replaces the old status tabs, which could not show
          Preboarding and gave no sense of shape. Clicking a stage filters the list. */}
      <HiringPipeline counts={funnelCounts} active={stage} onSelect={setStage} />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {stage ? STAGE_LABEL[stage] : "All candidates"}
        </h2>
        <span className="text-xs text-muted-foreground">{visible.length} shown</span>
        {stage && (
          <button onClick={() => setStage(null)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Clear
          </button>
        )}
        <div className="relative ml-auto">
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
              <OrbLoader state="searching" />
            </div>
          ) : visible.length === 0 ? (
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
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Days in stage</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
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
                    <td className="px-4 py-3 text-[12px]">
                      {(() => {
                        // Keka surfaces this because it is what exposes a stalled
                        // pipeline — a candidate sitting 262 days in Sourced.
                        const d = daysInStage(r.stage_changed_at ?? r.created_at);
                        if (d === null) return <span className="text-muted-foreground">—</span>;
                        return <span className={d > 30 ? "font-medium text-destructive" : "text-muted-foreground"}>{d}d</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_BADGE[r.status] || "bg-muted text-muted-foreground"} border-0 text-[10px]`}>
                        {STAGE_LABEL[stageOf(r.status)]}
                      </Badge>
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

                {timeline.length > 0 && (
                  <div>
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">History</label>
                    <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                      {timeline.map(t => (
                        <div key={t.id} className="text-[12px]">
                          <span className="text-muted-foreground">
                            {new Date(t.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>{" "}
                          <span className="text-foreground">{t.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Forward moves only, from the shared stage model — the old buttons
                    were a fixed set that could not reach Preboarding, and nothing in
                    the app could ever mark somebody hired. */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {nextStages(stageOf(active.status)).map(next => (
                    next === "hired" ? (
                      <Button key={next} size="sm" onClick={() => hire(active)} disabled={saving}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Hire
                      </Button>
                    ) : (
                      <Button key={next} size="sm" variant="outline" disabled={saving}
                        onClick={() => moveToStage(active, next)}>
                        {next === "archived"
                          ? <XCircle className="h-3.5 w-3.5 mr-1" />
                          : <Clock className="h-3.5 w-3.5 mr-1" />}
                        {next === "archived" ? "Archive" : `Move to ${STAGE_LABEL[next]}`}
                      </Button>
                    )
                  ))}
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
      <NotifyCandidateDialog
        open={pendingMove !== null}
        stage={pendingMove?.next ?? null}
        candidate={pendingMove ? {
          name: pendingMove.row.name,
          email: pendingMove.row.email,
          phone: pendingMove.row.phone,
        } : null}
        busy={saving}
        onCancel={() => setPendingMove(null)}
        onConfirm={(payload) => {
          if (pendingMove) void applyMove(pendingMove.row, pendingMove.next, payload);
        }}
      />

    </div>
  );
};

export default HrHiringOps;
