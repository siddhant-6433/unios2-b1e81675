// HR performance management — cycles, reviews and goals.
//
// One screen for the HR side of appraisals: create a cycle, open a review per
// employee with a reviewer, and watch goals. Ratings and commentary are written
// back through submit_performance_review so the RPC's permission check and the
// submitted_at stamp are the single source of truth, not this UI.
//
// Write actions are gated on hr:performance_manage. Everyone with hr:view can
// read the lists, so a principal can see progress without being able to change it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/state-fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarRange,
  ClipboardList,
  Target,
  Plus,
  Star,
  BarChart3,
} from "lucide-react";
import {
  goalProgressLabel,
  overallSummary,
  type CycleStatus,
  type GoalStatus,
  type ReviewStatus,
} from "@/lib/performance";

interface Employee {
  id: string;
  user_id: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  employee_number: string | null;
}

interface CycleRow {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: CycleStatus;
  description: string | null;
}

interface ReviewRow {
  id: string;
  cycle_id: string;
  employee_profile_id: string;
  reviewer_user_id: string | null;
  status: ReviewStatus;
  overall_rating: number | null;
  strengths: string | null;
  improvements: string | null;
  comments: string | null;
  submitted_at: string | null;
  employee_profiles: { display_name: string | null; employee_number: string | null } | null;
  performance_cycles: { name: string } | null;
}

interface GoalRow {
  id: string;
  employee_profile_id: string;
  cycle_id: string | null;
  title: string;
  weight: number | null;
  target: string | null;
  progress: number;
  status: GoalStatus;
  due_date: string | null;
  employee_profiles: { display_name: string | null } | null;
}

const CYCLE_STATUS_STYLE: Record<CycleStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-pastel-green text-foreground/80",
  closed: "bg-pastel-blue text-foreground/80",
};

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

const employeeName = (e?: Pick<Employee, "display_name" | "first_name" | "last_name" | "employee_number"> | null) =>
  e?.display_name
  || [e?.first_name, e?.last_name].filter(Boolean).join(" ")
  || e?.employee_number
  || "Unnamed";

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const emptyCycleDraft = { name: "", period_start: "", period_end: "", description: "", status: "draft" as CycleStatus };

export function PerformancePanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const { user } = useAuth();
  const canManage = can("hr", "performance_manage");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [cycleDraft, setCycleDraft] = useState(emptyCycleDraft);
  const [reviewDraft, setReviewDraft] = useState({ cycle_id: "", employee_profile_id: "", reviewer_user_id: "" });

  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [reviewForm, setReviewForm] = useState({ rating: "", strengths: "", improvements: "", comments: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [c, r, g, e] = await Promise.all([
      (supabase.from("performance_cycles" as any) as any)
        .select("id, name, period_start, period_end, status, description")
        .order("period_start", { ascending: false }),
      (supabase.from("performance_reviews" as any) as any)
        .select("id, cycle_id, employee_profile_id, reviewer_user_id, status, overall_rating, strengths, improvements, comments, submitted_at, employee_profiles(display_name, employee_number), performance_cycles(name)")
        .order("created_at", { ascending: false })
        .limit(500),
      (supabase.from("performance_goals" as any) as any)
        .select("id, employee_profile_id, cycle_id, title, weight, target, progress, status, due_date, employee_profiles(display_name)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("employee_profiles")
        .select("id, user_id, display_name, first_name, last_name, employee_number")
        .order("display_name")
        .limit(1000),
    ]);

    setCycles((c.data as CycleRow[]) ?? []);
    setReviews((r.data as unknown as ReviewRow[]) ?? []);
    setGoals((g.data as unknown as GoalRow[]) ?? []);
    setEmployees((e.data as Employee[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const nameForUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const emp of employees) if (emp.user_id) map.set(emp.user_id, employeeName(emp));
    return map;
  }, [employees]);

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: `${employeeName(e)}${e.employee_number ? ` · ${e.employee_number}` : ""}`,
  }));
  const reviewerOptions = employees
    .filter((e) => e.user_id)
    .map((e) => ({ value: e.user_id as string, label: employeeName(e) }));
  const cycleOptions = cycles.map((c) => ({ value: c.id, label: c.name }));

  const summary = useMemo(() => overallSummary(reviews), [reviews]);

  const createCycle = async () => {
    if (!cycleDraft.name.trim() || !cycleDraft.period_start || !cycleDraft.period_end) {
      toast({ title: "Name and period are required", variant: "destructive" });
      return;
    }
    if (cycleDraft.period_end < cycleDraft.period_start) {
      toast({ title: "The period end comes before its start", variant: "destructive" });
      return;
    }
    setBusy("cycle");
    const { error } = await (supabase.from("performance_cycles" as any) as any).insert({
      name: cycleDraft.name.trim(),
      period_start: cycleDraft.period_start,
      period_end: cycleDraft.period_end,
      description: cycleDraft.description.trim() || null,
      status: cycleDraft.status,
      created_by: user?.id ?? null,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not create the cycle", description: error.message, variant: "destructive" });
      return;
    }
    setCycleDraft(emptyCycleDraft);
    await load();
    toast({ title: "Cycle created" });
  };

  const setCycleStatus = async (cycle: CycleRow, status: CycleStatus) => {
    setBusy(cycle.id);
    const { error } = await (supabase.from("performance_cycles" as any) as any)
      .update({ status }).eq("id", cycle.id);
    setBusy(null);
    if (error) {
      toast({ title: "Could not update the cycle", description: error.message, variant: "destructive" });
      return;
    }
    setCycles((prev) => prev.map((c) => (c.id === cycle.id ? { ...c, status } : c)));
  };

  const createReview = async () => {
    if (!reviewDraft.cycle_id || !reviewDraft.employee_profile_id) {
      toast({ title: "Pick a cycle and an employee", variant: "destructive" });
      return;
    }
    setBusy("review");
    const { error } = await (supabase.from("performance_reviews" as any) as any).insert({
      cycle_id: reviewDraft.cycle_id,
      employee_profile_id: reviewDraft.employee_profile_id,
      reviewer_user_id: reviewDraft.reviewer_user_id || null,
      status: "pending",
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not open the review", description: error.message, variant: "destructive" });
      return;
    }
    setReviewDraft({ cycle_id: "", employee_profile_id: "", reviewer_user_id: "" });
    await load();
    toast({ title: "Review opened" });
  };

  const openReview = (review: ReviewRow) => {
    setEditing(review);
    setReviewForm({
      rating: review.overall_rating == null ? "" : String(review.overall_rating),
      strengths: review.strengths ?? "",
      improvements: review.improvements ?? "",
      comments: review.comments ?? "",
    });
  };

  const submitReview = async () => {
    if (!editing) return;
    setBusy("submit");
    const { error } = await (supabase as any).rpc("submit_performance_review", {
      _review_id: editing.id,
      _rating: reviewForm.rating ? Number(reviewForm.rating) : null,
      _strengths: reviewForm.strengths.trim() || null,
      _improvements: reviewForm.improvements.trim() || null,
      _comments: reviewForm.comments.trim() || null,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Could not submit the review", description: error.message, variant: "destructive" });
      return;
    }
    setEditing(null);
    await load();
    toast({ title: "Review submitted" });
  };

  if (loading) return <PageLoader />;

  return (
    <Tabs defaultValue="cycles" className="space-y-6">
      <TabsList className="bg-muted/50 border border-border rounded-xl p-1 h-auto">
        {[
          ["cycles", "Cycles", CalendarRange],
          ["reviews", "Reviews", ClipboardList],
          ["goals", "Goals", Target],
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

      {/* ── Cycles ─────────────────────────────────────────────────────── */}
      <TabsContent value="cycles" className="space-y-5">
        {canManage && (
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <DraftField label="Cycle name">
                <input
                  value={cycleDraft.name}
                  onChange={(e) => setCycleDraft({ ...cycleDraft, name: e.target.value })}
                  placeholder="FY27 Annual Review"
                  className="w-52 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </DraftField>
              <DraftField label="Starts">
                <input
                  type="date"
                  value={cycleDraft.period_start}
                  onChange={(e) => setCycleDraft({ ...cycleDraft, period_start: e.target.value })}
                  className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </DraftField>
              <DraftField label="Ends">
                <input
                  type="date"
                  value={cycleDraft.period_end}
                  min={cycleDraft.period_start || undefined}
                  onChange={(e) => setCycleDraft({ ...cycleDraft, period_end: e.target.value })}
                  className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </DraftField>
              <DraftField label="Status">
                <SelectField
                  value={cycleDraft.status}
                  onValueChange={(v) => setCycleDraft({ ...cycleDraft, status: v as CycleStatus })}
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "active", label: "Active" },
                    { value: "closed", label: "Closed" },
                  ]}
                  allowEmpty={false}
                  ariaLabel="Cycle status"
                  triggerClassName="h-8 text-xs"
                />
              </DraftField>
              <DraftField label="Description">
                <input
                  value={cycleDraft.description}
                  onChange={(e) => setCycleDraft({ ...cycleDraft, description: e.target.value })}
                  placeholder="Optional"
                  className="w-64 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </DraftField>
              <Button size="sm" className="h-8 text-xs" onClick={createCycle} disabled={busy === "cycle"}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New cycle
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cycle</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</th>
              </tr>
            </thead>
            <tbody>
              {cycles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    No review cycles yet.
                  </td>
                </tr>
              ) : cycles.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.period_start)} → {fmtDate(c.period_end)}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <SelectField
                        value={c.status}
                        onValueChange={(v) => setCycleStatus(c, v as CycleStatus)}
                        options={[
                          { value: "draft", label: "Draft" },
                          { value: "active", label: "Active" },
                          { value: "closed", label: "Closed" },
                        ]}
                        allowEmpty={false}
                        ariaLabel={`Status for ${c.name}`}
                        triggerClassName="h-7 w-28 text-xs"
                      />
                    ) : (
                      <Badge className={`text-[10px] border-0 capitalize ${CYCLE_STATUS_STYLE[c.status]}`}>{c.status}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[320px] truncate">{c.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {/* ── Reviews ────────────────────────────────────────────────────── */}
      <TabsContent value="reviews" className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Reviews", value: summary.total },
            { label: "Completed", value: `${summary.completed} (${summary.percent}%)` },
            { label: "Awaiting acknowledgement", value: summary.submitted },
            { label: "Average rating", value: summary.averageRating == null ? "—" : `${summary.averageRating} / 5` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-card card-shadow p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold text-foreground mt-1 flex items-center gap-1.5">
                {s.label === "Average rating" && <Star className="h-4 w-4 text-pastel-orange" />}
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <DraftField label="Cycle">
              <SelectField
                value={reviewDraft.cycle_id}
                onValueChange={(v) => setReviewDraft({ ...reviewDraft, cycle_id: v })}
                options={cycleOptions}
                placeholder="Pick a cycle"
                allowEmpty={false}
                ariaLabel="Review cycle"
                triggerClassName="h-8 text-xs w-48"
              />
            </DraftField>
            <DraftField label="Employee">
              <SelectField
                value={reviewDraft.employee_profile_id}
                onValueChange={(v) => setReviewDraft({ ...reviewDraft, employee_profile_id: v })}
                options={employeeOptions}
                placeholder="Pick an employee"
                allowEmpty={false}
                ariaLabel="Review employee"
                triggerClassName="h-8 text-xs w-56"
              />
            </DraftField>
            <DraftField label="Reviewer">
              <SelectField
                value={reviewDraft.reviewer_user_id}
                onValueChange={(v) => setReviewDraft({ ...reviewDraft, reviewer_user_id: v })}
                options={reviewerOptions}
                placeholder="Select reviewer (optional)"
                ariaLabel="Review reviewer"
                triggerClassName="h-8 text-xs w-56"
              />
            </DraftField>
            <Button size="sm" className="h-8 text-xs" onClick={createReview} disabled={busy === "review"}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Open review
            </Button>
          </div>
        )}

        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cycle</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reviewer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rating</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No reviews opened yet.
                  </td>
                </tr>
              ) : reviews.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.employee_profiles?.display_name || "Unnamed"}</div>
                    {r.employee_profiles?.employee_number && (
                      <div className="text-xs text-muted-foreground">{r.employee_profiles.employee_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.performance_cycles?.name || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.reviewer_user_id ? nameForUser.get(r.reviewer_user_id) || "—" : "Unassigned"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border-0 capitalize ${REVIEW_STATUS_STYLE[r.status]}`}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {r.overall_rating == null ? "—" : `${Number(r.overall_rating)} / 5`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openReview(r)}>
                      {canManage ? "View / edit" : "View"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {/* ── Goals ──────────────────────────────────────────────────────── */}
      <TabsContent value="goals" className="space-y-5">
        <div className="rounded-xl bg-card card-shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goal</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Target</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due</th>
              </tr>
            </thead>
            <tbody>
              {goals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No goals set yet.
                  </td>
                </tr>
              ) : goals.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{g.employee_profiles?.display_name || "Unnamed"}</td>
                  <td className="px-4 py-3 text-foreground">
                    {g.title}
                    {g.weight != null && <span className="text-xs text-muted-foreground"> · {Number(g.weight)}% weight</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate">{g.target || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, Number(g.progress)))}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{goalProgressLabel(g)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border-0 capitalize ${GOAL_STATUS_STYLE[g.status]}`}>{g.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(g.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Review — {editing?.employee_profiles?.display_name || "Unnamed"}
            </DialogTitle>
            <DialogDescription>
              {editing?.performance_cycles?.name || "Cycle"} · submitted reviews are what the employee acknowledges.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <DraftField label="Overall rating (1–5)">
              <SelectField
                value={reviewForm.rating}
                onValueChange={(v) => setReviewForm({ ...reviewForm, rating: v })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))}
                placeholder="Not rated"
                disabled={!canManage}
                ariaLabel="Overall rating"
                triggerClassName="h-9 text-sm"
              />
            </DraftField>
            <DraftField label="Strengths">
              <textarea
                value={reviewForm.strengths}
                onChange={(e) => setReviewForm({ ...reviewForm, strengths: e.target.value })}
                rows={3}
                disabled={!canManage}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20 disabled:opacity-60"
              />
            </DraftField>
            <DraftField label="Improvements">
              <textarea
                value={reviewForm.improvements}
                onChange={(e) => setReviewForm({ ...reviewForm, improvements: e.target.value })}
                rows={3}
                disabled={!canManage}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20 disabled:opacity-60"
              />
            </DraftField>
            <DraftField label="Comments">
              <textarea
                value={reviewForm.comments}
                onChange={(e) => setReviewForm({ ...reviewForm, comments: e.target.value })}
                rows={3}
                disabled={!canManage}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring/20 disabled:opacity-60"
              />
            </DraftField>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            {canManage && (
              <Button size="sm" onClick={submitReview} disabled={busy === "submit"}>
                Submit review
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

const DraftField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    {children}
  </div>
);

export default PerformancePanel;
