import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sparkles, Loader2, ChevronDown, ExternalLink, GraduationCap, Phone, Check, X } from "lucide-react";

// voice_knowledge_gaps may not have generated TS types yet — cast via `supabase as any`.
interface Gap {
  id: string;
  call_id: string | null;
  lead_id: string | null;
  course_id: string | null;
  question_text: string;
  ai_answer_given: string | null;
  transcript_snippet: string | null;
  created_at: string;
}

interface LearnedExample {
  id: string;
  query_text: string;
  reply_text: string;
  status: string;
  created_at: string;
}

interface CallRecord {
  id: string;
  created_at: string;
  disposition: string | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  lead_id: string | null;
  leads: { name: string | null; course_id: string | null } | null;
}

interface MinedExample {
  id: string;
  query_text: string;
  reply_text: string;
  language: string | null;
  status: string;
  created_at: string;
  lead_id: string | null;
  leads: { name: string | null } | null;
  courses: { name: string | null } | null;
}

interface Stats {
  active: number;
  needsReview: number;
  pendingGaps: number;
  last7: number;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

const fmtDuration = (s: number | null) => {
  if (!s && s !== 0) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// Transcripts come in two formats:
//   - "[Lead]: ..." / "[Agent]: ..." — interleaved dialogue written by the
//     post-call analysis pipeline (the common case in prod)
//   - "Caller: ..." / "AI: ..."      — raw voice-agent format (fallback
//     when the analysis pipeline hasn't run)
type Turn = { speaker: "caller" | "ai"; text: string };
const parseTurns = (transcript: string): Turn[] =>
  transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): Turn | null => {
      if (/^\[?(lead|caller)\]?:/i.test(l)) {
        return { speaker: "caller", text: l.replace(/^\[?(lead|caller)\]?:\s*/i, "") };
      }
      if (/^\[?(agent|ai)\]?:/i.test(l)) {
        return { speaker: "ai", text: l.replace(/^\[?(agent|ai)\]?:\s*/i, "") };
      }
      return null;
    })
    .filter((t): t is Turn => t !== null);

export default function NavyaKnowledge() {
  const { toast } = useToast();
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [learned, setLearned] = useState<LearnedExample[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [mined, setMined] = useState<MinedExample[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [gapRes, learnedRes, callsRes, minedRes, activeCnt, needsReviewCnt, pendingCnt, last7Cnt] = await Promise.all([
      (supabase as any)
        .from("voice_knowledge_gaps")
        .select("id, call_id, lead_id, course_id, question_text, ai_answer_given, transcript_snippet, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("admissions_ai_reply_examples")
        .select("id, query_text, reply_text, status, created_at")
        .eq("source_channel", "voice")
        // needs_review rows live in the "Mined from counsellor calls" tab;
        // this tab is the audit trail of what Navya actually uses.
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as any)
        .from("ai_call_records")
        .select("id, created_at, disposition, duration_seconds, summary, transcript, recording_url, lead_id, leads(name, course_id)")
        .eq("call_type", "ai")
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(30),
      (supabase as any)
        .from("admissions_ai_reply_examples")
        .select("id, query_text, reply_text, language, status, created_at, lead_id, leads(name), courses:course_id(name)")
        .eq("status", "needs_review")
        .contains("tags", ["counsellor_call"])
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as any).from("admissions_ai_reply_examples").select("id", { count: "exact", head: true }).eq("status", "active"),
      (supabase as any).from("admissions_ai_reply_examples").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
      (supabase as any).from("voice_knowledge_gaps").select("id", { count: "exact", head: true }).eq("status", "pending"),
      (supabase as any).from("admissions_ai_reply_examples").select("id", { count: "exact", head: true }).gte("created_at", since7),
    ]);
    if (gapRes.error) toast({ title: "Couldn't load questions", description: gapRes.error.message, variant: "destructive" });
    setGaps(gapRes.data ?? []);
    setLearned(learnedRes.data ?? []);
    setCalls(callsRes.data ?? []);
    setMined(minedRes.data ?? []);
    setStats({
      active: activeCnt.count ?? 0,
      needsReview: needsReviewCnt.count ?? 0,
      pendingGaps: pendingCnt.count ?? 0,
      last7: last7Cnt.count ?? 0,
    });
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAndTeach = async (gap: Gap) => {
    const answer = (answers[gap.id] ?? "").trim();
    if (!answer) {
      toast({ title: "Write an answer first", variant: "destructive" });
      return;
    }
    setSavingId(gap.id);

    // answered_by = current user's profile id (matches pattern used across the app)
    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userData.user?.id)
      .single();

    const gapUpdate = await (supabase as any)
      .from("voice_knowledge_gaps")
      .update({
        status: "answered",
        admin_answer: answer,
        answered_by: profile?.id ?? null,
        answered_at: new Date().toISOString(),
      })
      .eq("id", gap.id);

    if (gapUpdate.error) {
      setSavingId(null);
      toast({ title: "Couldn't save", description: gapUpdate.error.message, variant: "destructive" });
      return;
    }

    const insert = await (supabase as any).from("admissions_ai_reply_examples").insert({
      source_channel: "voice",
      target_channels: ["whatsapp", "voice"],
      query_text: gap.question_text,
      reply_text: answer,
      language: "hinglish",
      status: "active",
      quality_score: 0.9,
      course_id: gap.course_id,
      lead_id: gap.lead_id,
    });

    setSavingId(null);
    if (insert.error) {
      toast({ title: "Saved, but teaching failed", description: insert.error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Navya learned this answer" });
    setAnswers((a) => {
      const next = { ...a };
      delete next[gap.id];
      return next;
    });
    load();
  };

  const dismiss = async (gap: Gap) => {
    setSavingId(gap.id);
    const { error } = await (supabase as any)
      .from("voice_knowledge_gaps")
      .update({ status: "dismissed" })
      .eq("id", gap.id);
    setSavingId(null);
    if (error) {
      toast({ title: "Couldn't dismiss", description: error.message, variant: "destructive" });
      return;
    }
    setGaps((g) => g.filter((x) => x.id !== gap.id));
  };

  const deactivate = async (ex: LearnedExample) => {
    const { error } = await (supabase as any)
      .from("admissions_ai_reply_examples")
      .update({ status: "rejected" })
      .eq("id", ex.id);
    if (error) {
      toast({ title: "Couldn't deactivate", description: error.message, variant: "destructive" });
      return;
    }
    setLearned((l) => l.map((x) => (x.id === ex.id ? { ...x, status: "rejected" } : x)));
  };

  const setMinedStatus = async (
    ids: string[],
    status: "active" | "rejected",
    editedReply?: string,
  ) => {
    const patch: Record<string, string> = { status };
    // Approving with an improved answer: save the edit and bump quality —
    // a human-reviewed answer outranks a raw mined one at retrieval time.
    if (editedReply !== undefined && editedReply.trim()) {
      patch.reply_text = editedReply.trim();
      (patch as Record<string, unknown>).quality_score = 0.9;
    }
    const { error } = await (supabase as any)
      .from("admissions_ai_reply_examples")
      .update(patch)
      .in("id", ids);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    setMined((m) => m.filter((x) => !ids.includes(x.id)));
    toast({ title: status === "active" ? "Approved — Navya will use this answer" : "Rejected" });
  };

  const bulkMined = (status: "active" | "rejected") => {
    if (mined.length === 0) return;
    const verb = status === "active" ? "Approve" : "Reject";
    if (!window.confirm(`${verb} all ${mined.length} shown answers?`)) return;
    setMinedStatus(mined.map((m) => m.id), status);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-pastel-purple p-2">
          <Sparkles className="h-5 w-5 text-foreground/70" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Navya Knowledge</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review questions Navya couldn't answer; your answers teach her.
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Active examples", value: stats.active },
            { label: "Needs review", value: stats.needsReview },
            { label: "Pending gaps", value: stats.pendingGaps },
            { label: "New (7 days)", value: stats.last7 },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Pending questions{gaps.length > 0 && ` (${gaps.length})`}
          </TabsTrigger>
          <TabsTrigger value="learned" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Learned answers
          </TabsTrigger>
          <TabsTrigger value="calls" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Call review
          </TabsTrigger>
          <TabsTrigger value="mined" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Mined from counsellor calls{mined.length > 0 && ` (${mined.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : gaps.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nothing pending. Navya is answering everything so far.
              </CardContent>
            </Card>
          ) : (
            gaps.map((gap) => (
              <Card key={gap.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-base font-semibold text-foreground">{gap.question_text}</p>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap mt-1">{fmtDate(gap.created_at)}</span>
                  </div>

                  {gap.ai_answer_given && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground/70">What Navya said: </span>
                      {gap.ai_answer_given}
                    </p>
                  )}

                  {gap.transcript_snippet && (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3.5 w-3.5" /> Transcript snippet
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 rounded-lg bg-muted/50 p-3 text-xs text-foreground/80 whitespace-pre-wrap">
                        {gap.transcript_snippet}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {gap.lead_id && (
                    <Link to={`/admissions/${gap.lead_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      View lead <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}

                  <div className="space-y-2 pt-1">
                    <Textarea
                      placeholder="Correct answer…"
                      value={answers[gap.id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [gap.id]: e.target.value }))}
                      rows={3}
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => saveAndTeach(gap)} disabled={savingId === gap.id}>
                        {savingId === gap.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        Save &amp; Teach
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dismiss(gap)} disabled={savingId === gap.id}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="learned" className="mt-4 space-y-3">
          {learned.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No answers taught from voice calls yet.
              </CardContent>
            </Card>
          ) : (
            learned.map((ex) => (
              <Card key={ex.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                      {ex.query_text}
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Badge variant={ex.status === "active" ? "default" : "secondary"}>{ex.status}</Badge>
                      <span className="text-[11px] text-muted-foreground">{fmtDate(ex.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground pl-6">{ex.reply_text}</p>
                  {ex.status === "active" && (
                    <div className="pl-6">
                      <Button size="sm" variant="ghost" onClick={() => deactivate(ex)}>
                        Deactivate
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="calls" className="mt-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : calls.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No AI calls with transcripts yet.
              </CardContent>
            </Card>
          ) : (
            calls.map((call) => <CallCard key={call.id} call={call} onCoached={load} />)
          )}
        </TabsContent>

        <TabsContent value="mined" className="mt-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : mined.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No mined answers yet. The miner runs on counsellor call recordings.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{mined.length} remaining</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => bulkMined("active")}>
                    <Check className="h-4 w-4" /> Approve all shown
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => bulkMined("rejected")}>
                    <X className="h-4 w-4" /> Reject all shown
                  </Button>
                </div>
              </div>
              {mined.map((ex) => (
                <MinedCard
                  key={ex.id}
                  ex={ex}
                  onDecide={(status, editedReply) => setMinedStatus([ex.id], status, editedReply)}
                />
              ))}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MinedCard({
  ex,
  onDecide,
}: {
  ex: MinedExample;
  onDecide: (status: "active" | "rejected", editedReply?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ex.reply_text);
  const edited = editing && draft.trim() !== ex.reply_text.trim();

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">{ex.query_text}</p>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {ex.language && <Badge variant="secondary">{ex.language}</Badge>}
            <span className="text-[11px] text-muted-foreground">{fmtDate(ex.created_at)}</span>
          </div>
        </div>
        {/* Context: which course/lead this answer came from — an answer
            without its context is unreviewable. */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {ex.courses?.name && <Badge variant="outline">{ex.courses.name}</Badge>}
          {ex.leads?.name && <span>Lead: {ex.leads.name}</span>}
          {ex.lead_id && (
            <a
              href={`/admissions/${ex.lead_id}`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              View lead & call history
            </a>
          )}
        </div>
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="text-sm"
          />
        ) : (
          <p className="text-sm text-muted-foreground">{ex.reply_text}</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={() => onDecide("active", edited ? draft : undefined)}>
            <Check className="h-4 w-4" /> {edited ? "Approve edited" : "Approve"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel edit" : "Edit & improve"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDecide("rejected")}>
            <X className="h-4 w-4" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CallCard({ call, onCoached }: { call: CallRecord; onCoached: () => void }) {
  const { toast } = useToast();
  const turns = call.transcript ? parseTurns(call.transcript) : [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const suggest = async (idx: number) => {
    const reply = (drafts[idx] ?? "").trim();
    if (!reply) {
      toast({ title: "Write a better answer first", variant: "destructive" });
      return;
    }
    // nearest preceding Caller line in file order; fallbacks per spec
    let query = call.summary || "General enquiry";
    for (let i = idx - 1; i >= 0; i--) {
      if (turns[i].speaker === "caller") {
        query = turns[i].text;
        break;
      }
    }
    setSavingIdx(idx);
    const { error } = await (supabase as any).from("admissions_ai_reply_examples").insert({
      query_text: query,
      reply_text: reply,
      source_channel: "voice",
      target_channels: ["whatsapp", "voice"],
      language: "hinglish",
      status: "active",
      quality_score: 0.9,
      tags: ["coached"],
      lead_id: call.lead_id,
      course_id: call.leads?.course_id ?? null,
    });
    setSavingIdx(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Navya will answer this way next time." });
    setOpenIdx(null);
    setDrafts((d) => {
      const next = { ...d };
      delete next[idx];
      return next;
    });
    onCoached();
  };

  return (
    <Card>
      <Collapsible>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              {call.leads?.name || "Unknown lead"}
              {call.lead_id && (
                <a
                  href={`/admissions/${call.lead_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-normal text-muted-foreground underline hover:text-foreground"
                >
                  View lead
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              {call.disposition && <Badge variant="secondary">{call.disposition}</Badge>}
              <span className="text-[11px] text-muted-foreground">{fmtDate(call.created_at)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Duration {fmtDuration(call.duration_seconds)}</p>
          {call.summary && <p className="text-sm text-muted-foreground">{call.summary}</p>}

          <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground pt-1">
            <ChevronDown className="h-3.5 w-3.5" /> Review call
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {call.recording_url && (
              <audio controls src={call.recording_url} className="w-full h-9" />
            )}
            <div className="space-y-2">
              {turns.map((turn, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Badge variant={turn.speaker === "ai" ? "default" : "secondary"} className="shrink-0">
                      {turn.speaker === "ai" ? "Navya" : "Student"}
                    </Badge>
                    <p className="text-sm text-foreground/90">{turn.text}</p>
                  </div>
                  {turn.speaker === "ai" && (
                    <div className="pl-2">
                      {openIdx === idx ? (
                        <div className="space-y-2">
                          <Textarea
                            placeholder="A better answer…"
                            value={drafts[idx] ?? ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                            rows={3}
                          />
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => suggest(idx)} disabled={savingIdx === idx}>
                              {savingIdx === idx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setOpenIdx(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpenIdx(idx)}>
                          Suggest better answer
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
