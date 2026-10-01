// Employee self-service for performance — the block embedded in My HR.
//
// Resolves the signed-in user's employee_profile implicitly: MyHr renders this
// without props, and a person's own goals/reviews are keyed on that profile, not
// on their auth user. A user with no employee_profiles row is told so plainly
// rather than shown an empty screen.
//
// Reviews are read-only here. A submitted review can be acknowledged through the
// RPC (which enforces that only the employee — or HR — may do it); nothing in
// this panel edits a rating.
//
// Peer feedback goes straight into performance_feedback with the author's user
// id, so anonymity is a display concern handled by the reader's RLS policy, not
// something the client can fake.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/state-fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, ClipboardCheck, MessageSquarePlus, Star, Check } from "lucide-react";
import {
  clampProgress,
  goalProgressLabel,
  ratingLabel,
  type GoalStatus,
  type PerformanceGoal,
  type ReviewStatus,
  type FeedbackRelationship,
} from "@/lib/performance";

interface Me { id: string; display_name: string | null }

interface EmployeeLite {
  id: string;
  user_id: string | null;
  display_name: string | null;
}

interface ReviewRow {
  id: string;
  status: ReviewStatus;
  overall_rating: number | null;
  strengths: string | null;
  improvements: string | null;
  comments: string | null;
  submitted_at: string | null;
  acknowledged_at: string | null;
  reviewer_user_id: string | null;
  performance_cycles: { name: string } | null;
}

const REVIEW_STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: "bg-pastel-yellow text-foreground/80",
  in_progress: "bg-pastel-blue text-foreground/80",
  submitted: "bg-pastel-green text-foreground/80",
  acknowledged: "bg-pastel-purple text-foreground/80",
};

const GOAL_STATUS_STYLE: Record<GoalStatus, string> = {
  active: "bg-pastel-blue text-foreground/80",
  achieved: "bg-pastel-green text-foreground/80",
  missed: "bg-pastel-red text-foreground/80",
  cancelled: "bg-muted text-muted-foreground",
};

const emptyGoalDraft = { title: "", target: "", weight: "", due_date: "" };

export function MyPerformancePanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [goals, setGoals] = useState<PerformanceGoal[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [directory, setDirectory] = useState<EmployeeLite[]>([]);
  const [goalDrafts, setGoalDrafts] = useState<Record<string, { progress: string; status: GoalStatus }>>({});

  const [goalDraft, setGoalDraft] = useState(emptyGoalDraft);
  const [feedbackDraft, setFeedbackDraft] = useState({
    employee_profile_id: "",
    relationship: "peer" as FeedbackRelationship,
    rating: "",
    comments: "",
    is_anonymous: true,
  });

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    const { data: profile } = await supabase
      .from("employee_profiles")
      .select("id, display_name")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const mine = (profile as Me) ?? null;
    setMe(mine);

    const [g, r, people] = await Promise.all([
      mine
        ? (supabase.from("performance_goals" as any) as any)
            .select("id, employee_profile_id, cycle_id, title, description, weight, target, progress, status, due_date")
            .eq("employee_profile_id", mine.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      mine
        ? (supabase.from("performance_reviews" as any) as any)
            .select("id, status, overall_rating, strengths, improvements, comments, submitted_at, acknowledged_at, reviewer_user_id, performance_cycles(name)")
            .eq("employee_profile_id", mine.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("employee_profiles")
        .select("id, user_id, display_name")
        .order("display_name")
        .limit(1000),
    ]);

    const goalRows = (g.data as PerformanceGoal[]) ?? [];
    setGoals(goalRows);
    setGoalDrafts(Object.fromEntries(
      goalRows.map((goal) => [goal.id, { progress: String(goal.progress ?? 0), status: goal.status }]),
    ));
    setReviews((r.data as unknown as ReviewRow[]) ?? []);
    setDirectory((people.data as EmployeeLite[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // Names include the signed-in user: a self-review still has a reviewer to name.
  const reviewerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of directory) if (p.user_id) map.set(p.user_id, p.display_name || "Colleague");
    return map;
  }, [directory]);

  const colleagueOptions = directory
    .filter((p) => p.id !== me?.id)
    .map((p) => ({ value: p.id, label: p.display_name || "Unnamed" }));

  const addGoal = async () => {
    if (!me) return;
    if (!goalDraft.title.trim()) {
      toast({ title: "Give the goal a title", variant: "destructive" });
      return;
    }
    setBusy("goal");
    const { error } = await (supabase.from("performance_goals" as any) as any).insert({
      employee_profile_id: me.id,
      title: goalDraft.title.trim(),
      target: goalDraft.target.trim() || null,
      weight: goalDraft.weight ? Number(goalDraft.weight) : null,
      due_date: goalDraft.due_date || null,
      progress: 0,
      status: "active",
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not add the goal", description: error.message, variant: "destructive" });
      return;
    }
    setGoalDraft(emptyGoalDraft);
    await load();
    toast({ title: "Goal added" });
  };

  const saveGoal = async (goal: PerformanceGoal) => {
    const draft = goalDrafts[goal.id];
    if (!draft) return;
    setBusy(goal.id);
    const { error } = await (supabase.from("performance_goals" as any) as any)
      .update({ progress: clampProgress(Number(draft.progress)), status: draft.status })
      .eq("id", goal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Could not update the goal", description: error.message, variant: "destructive" });
      return;
    }
    setGoals((prev) => prev.map((g) =>
      g.id === goal.id ? { ...g, progress: clampProgress(Number(draft.progress)), status: draft.status } : g));
    toast({ title: "Goal updated" });
  };

  const acknowledge = async (review: ReviewRow) => {
    setBusy(review.id);
    const { error } = await (supabase as any).rpc("acknowledge_performance_review", { _review_id: review.id });
    setBusy(null);
    if (error) {
      toast({ title: "Could not acknowledge", description: error.message, variant: "destructive" });
      return;
    }
    await load();
    toast({ title: "Review acknowledged" });
  };

  const giveFeedback = async () => {
    if (!user?.id) return;
    if (!feedbackDraft.employee_profile_id) {
      toast({ title: "Pick a colleague", variant: "destructive" });
      return;
    }
    if (!feedbackDraft.comments.trim()) {
      toast({ title: "Add a comment", variant: "destructive" });
      return;
    }
    setBusy("feedback");
    const { error } = await (supabase.from("performance_feedback" as any) as any).insert({
      employee_profile_id: feedbackDraft.employee_profile_id,
      reviewer_user_id: user.id,
      relationship: feedbackDraft.relationship,
      rating: feedbackDraft.rating ? Number(feedbackDraft.rating) : null,
      comments: feedbackDraft.comments.trim(),
      is_anonymous: feedbackDraft.is_anonymous,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not send feedback", description: error.message, variant: "destructive" });
      return;
    }
    setFeedbackDraft({ employee_profile_id: "", relationship: "peer", rating: "", comments: "", is_anonymous: true });
    toast({ title: "Feedback sent", description: feedbackDraft.is_anonymous ? "Shared anonymously." : "Shared with your name." });
  };

  if (loading) return <PageLoader />;

  if (!me) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">No employee profile linked</p>
        <p className="text-xs text-muted-foreground mt-1">
          Performance goals and reviews appear once HR links your account to an employee record.
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="goals" className="space-y-5">
      <TabsList className="bg-muted/50 border border-border rounded-xl p-1 h-auto">
        {[
          ["goals", "My Goals", Target],
          ["reviews", "My Reviews", ClipboardCheck],
          ["feedback", "Peer Feedback", MessageSquarePlus],
        ].map(([value, label, Icon]) => (
          <TabsTrigger
            key={value as string}
            value={value as string}
            className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Icon className="h-3.5 w-3.5 mr-1" /> {label as string}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* ── My goals ───────────────────────────────────────────────────── */}
      <TabsContent value="goals" className="space-y-4">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
          <Field label="Goal">
            <input
              value={goalDraft.title}
              onChange={(e) => setGoalDraft({ ...goalDraft, title: e.target.value })}
              placeholder="What will you achieve?"
              className="w-56 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
            />
          </Field>
          <Field label="Target">
            <input
              value={goalDraft.target}
              onChange={(e) => setGoalDraft({ ...goalDraft, target: e.target.value })}
              placeholder="Optional"
              className="w-40 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
            />
          </Field>
          <Field label="Weight %">
            <input
              type="number"
              min={0}
              max={100}
              value={goalDraft.weight}
              onChange={(e) => setGoalDraft({ ...goalDraft, weight: e.target.value })}
              className="w-20 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
            />
          </Field>
          <Field label="Due">
            <input
              type="date"
              value={goalDraft.due_date}
              onChange={(e) => setGoalDraft({ ...goalDraft, due_date: e.target.value })}
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
            />
          </Field>
          <Button size="sm" className="h-8 text-xs" onClick={addGoal} disabled={busy === "goal"}>
            Add goal
          </Button>
        </div>

        {goals.length === 0 ? (
          <Empty icon={Target} text="No goals yet — add one above." />
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => {
              const draft = goalDrafts[goal.id] ?? { progress: String(goal.progress ?? 0), status: goal.status };
              return (
                <div key={goal.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{goal.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {goal.target || "No target"} · {goalProgressLabel(goal)}
                        {goal.due_date ? ` · due ${goal.due_date}` : ""}
                      </p>
                    </div>
                    <Badge className={`text-[10px] border-0 capitalize ${GOAL_STATUS_STYLE[goal.status]}`}>{goal.status}</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="Progress %">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.progress}
                        onChange={(e) => setGoalDrafts({ ...goalDrafts, [goal.id]: { ...draft, progress: e.target.value } })}
                        className="w-24 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                      />
                    </Field>
                    <Field label="Status">
                      <SelectField
                        value={draft.status}
                        onValueChange={(v) => setGoalDrafts({ ...goalDrafts, [goal.id]: { ...draft, status: v as GoalStatus } })}
                        options={[
                          { value: "active", label: "Active" },
                          { value: "achieved", label: "Achieved" },
                          { value: "missed", label: "Missed" },
                          { value: "cancelled", label: "Cancelled" },
                        ]}
                        allowEmpty={false}
                        ariaLabel="Goal status"
                        triggerClassName="h-8 text-xs w-32"
                      />
                    </Field>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveGoal(goal)} disabled={busy === goal.id}>
                      Save
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* ── My reviews ─────────────────────────────────────────────────── */}
      <TabsContent value="reviews" className="space-y-4">
        {reviews.length === 0 ? (
          <Empty icon={ClipboardCheck} text="No reviews yet." />
        ) : reviews.map((review) => {
          const open = review.status === "submitted" || review.status === "acknowledged";
          return (
            <div key={review.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{review.performance_cycles?.name || "Review"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {review.reviewer_user_id ? `Reviewed by ${reviewerNames.get(review.reviewer_user_id) || "a colleague"}` : "Reviewer unassigned"}
                    {review.overall_rating != null && (
                      <span className="inline-flex items-center gap-1 ml-2">
                        <Star className="h-3 w-3 text-pastel-orange" />
                        {Number(review.overall_rating)} / 5 · {ratingLabel(review.overall_rating)}
                      </span>
                    )}
                  </p>
                </div>
                <Badge className={`text-[10px] border-0 capitalize ${REVIEW_STATUS_STYLE[review.status]}`}>
                  {review.status.replace(/_/g, " ")}
                </Badge>
              </div>

              {open && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <ReviewNote label="Strengths" text={review.strengths} />
                  <ReviewNote label="Improvements" text={review.improvements} />
                  <ReviewNote label="Comments" text={review.comments} />
                </div>
              )}

              {review.status === "submitted" && (
                <Button size="sm" className="h-8 text-xs mt-3" onClick={() => acknowledge(review)} disabled={busy === review.id}>
                  <Check className="h-3.5 w-3.5 mr-1" /> Acknowledge
                </Button>
              )}
              {review.status === "acknowledged" && review.acknowledged_at && (
                <p className="text-[11px] text-muted-foreground mt-3">
                  Acknowledged on {new Date(review.acknowledged_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          );
        })}
      </TabsContent>

      {/* ── Peer feedback ──────────────────────────────────────────────── */}
      <TabsContent value="feedback" className="space-y-4">
        <div className="rounded-xl border border-border p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Share feedback about a colleague. HR can always read feedback; your name is shown to them
            only if you choose not to stay anonymous.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Colleague">
              <SelectField
                value={feedbackDraft.employee_profile_id}
                onValueChange={(v) => setFeedbackDraft({ ...feedbackDraft, employee_profile_id: v })}
                options={colleagueOptions}
                placeholder="Pick a colleague"
                allowEmpty={false}
                ariaLabel="Feedback colleague"
                triggerClassName="h-8 text-xs w-52"
              />
            </Field>
            <Field label="Relationship">
              <SelectField
                value={feedbackDraft.relationship}
                onValueChange={(v) => setFeedbackDraft({ ...feedbackDraft, relationship: v as FeedbackRelationship })}
                options={[
                  { value: "peer", label: "Peer" },
                  { value: "manager", label: "Manager" },
                  { value: "report", label: "Report" },
                  { value: "self", label: "Self" },
                  { value: "external", label: "External" },
                ]}
                allowEmpty={false}
                ariaLabel="Feedback relationship"
                triggerClassName="h-8 text-xs w-32"
              />
            </Field>
            <Field label="Rating (optional)">
              <SelectField
                value={feedbackDraft.rating}
                onValueChange={(v) => setFeedbackDraft({ ...feedbackDraft, rating: v })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))}
                placeholder="No rating"
                ariaLabel="Feedback rating"
                triggerClassName="h-8 text-xs w-28"
              />
            </Field>
          </div>
          <textarea
            value={feedbackDraft.comments}
            onChange={(e) => setFeedbackDraft({ ...feedbackDraft, comments: e.target.value })}
            rows={3}
            placeholder="What would you like them to know?"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={feedbackDraft.is_anonymous}
                onChange={(e) => setFeedbackDraft({ ...feedbackDraft, is_anonymous: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-input"
              />
              Send anonymously
            </label>
            <Button size="sm" className="h-8 text-xs" onClick={giveFeedback} disabled={busy === "feedback"}>
              Send feedback
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    {children}
  </div>
);

const ReviewNote = ({ label, text }: { label: string; text: string | null }) => (
  <div className="rounded-lg bg-muted/30 p-3">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{text || "—"}</p>
  </div>
);

const Empty = ({ icon: Icon, text }: { icon: typeof Target; text: string }) => (
  <div className="rounded-xl bg-card card-shadow p-12 text-center">
    <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

export default MyPerformancePanel;
