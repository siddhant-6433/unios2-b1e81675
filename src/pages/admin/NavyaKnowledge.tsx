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
import { Sparkles, Loader2, ChevronDown, ExternalLink, GraduationCap } from "lucide-react";

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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function NavyaKnowledge() {
  const { toast } = useToast();
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [learned, setLearned] = useState<LearnedExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [gapRes, learnedRes] = await Promise.all([
      (supabase as any)
        .from("voice_knowledge_gaps")
        .select("id, call_id, lead_id, course_id, question_text, ai_answer_given, transcript_snippet, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("admissions_ai_reply_examples")
        .select("id, query_text, reply_text, status, created_at")
        .eq("source_channel", "voice")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (gapRes.error) toast({ title: "Couldn't load questions", description: gapRes.error.message, variant: "destructive" });
    setGaps(gapRes.data ?? []);
    setLearned(learnedRes.data ?? []);
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

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Pending questions{gaps.length > 0 && ` (${gaps.length})`}
          </TabsTrigger>
          <TabsTrigger value="learned" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Learned answers
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
      </Tabs>
    </div>
  );
}
