import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/contexts/PermissionContext";
import { useToast } from "@/hooks/use-toast";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { FileText, Check, Send, X } from "lucide-react";

// Report card sign-off. Mirrors the IB workflow (src/pages/ib/ReportCards.tsx,
// ib_report_cards.status) which already models subject-teacher-submits ->
// nodal-reviews -> published.
//
// The class teacher is the nodal teacher for a section: they see every subject
// for their own class and sign the card off. Publishing is the coordinator's.

type Status = "draft" | "class_teacher_review" | "coordinator_review" | "published";

const FLOW: Status[] = ["draft", "class_teacher_review", "coordinator_review", "published"];

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  class_teacher_review: "With class teacher",
  coordinator_review: "With coordinator",
  published: "Published",
};

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  class_teacher_review: "bg-warning/15 text-warning",
  coordinator_review: "bg-info/15 text-info",
  published: "bg-success/15 text-success",
};

interface ReportCard {
  id: string;
  student_id: string;
  term: string | null;
  status: Status;
  percentage: number | null;
  grade: string | null;
  result_status: string | null;
  class_teacher_comment: string | null;
  coordinator_comment: string | null;
  signed_off_at: string | null;
  published_at: string | null;
}

const ReportCards = () => {
  const { user } = useAuth();
  const canSignOff = usePermission("report_cards", "sign_off");
  const canPublish = usePermission("marks", "publish");
  const { toast } = useToast();

  const [cards, setCards] = useState<ReportCard[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [comment, setComment] = useState<Record<string, string>>({});

  useEffect(() => { void load(); }, [user?.id]);

  const load = async () => {
    setLoading(true);
    // RLS decides what comes back: rc_class_teacher_read for your own class,
    // rc_inst_staff_read for institution staff.
    const { data, error } = await supabase
      .from("report_cards")
      .select("id, student_id, term, status, percentage, grade, result_status, class_teacher_comment, coordinator_comment, signed_off_at, published_at")
      .order("term", { nullsFirst: false });

    if (error) {
      toast({ title: "Could not load report cards", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (data as ReportCard[]) || [];
    setCards(rows);

    const ids = Array.from(new Set(rows.map(r => r.student_id)));
    if (ids.length) {
      const { data: studs } = await supabase
        .from("students").select("id, name, admission_no").in("id", ids);
      setNames(Object.fromEntries(
        ((studs as { id: string; name: string; admission_no: string | null }[]) || [])
          .map(s => [s.id, `${s.name}${s.admission_no ? ` (${s.admission_no})` : ""}`])));
    }
    setLoading(false);
  };

  // Who may move a card out of its current state.
  const nextFor = (c: ReportCard): { to: Status; label: string; icon: typeof Check } | null => {
    if (c.status === "class_teacher_review" && canSignOff) {
      return { to: "coordinator_review", label: "Sign off", icon: Check };
    }
    if (c.status === "coordinator_review" && canPublish) {
      return { to: "published", label: "Publish", icon: Send };
    }
    if (c.status === "draft" && (canSignOff || canPublish)) {
      return { to: "class_teacher_review", label: "Send for sign-off", icon: Send };
    }
    return null;
  };

  const advance = async (c: ReportCard, to: Status) => {
    setBusy(c.id);
    const patch: Record<string, unknown> = { status: to };
    if (to === "coordinator_review") {
      patch.signed_off_by = user?.id ?? null;
      patch.signed_off_at = new Date().toISOString();
      if (comment[c.id]?.trim()) patch.class_teacher_comment = comment[c.id].trim();
    }
    if (to === "published") patch.published_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("report_cards")
      .update(patch as never)
      .eq("id", c.id)
      .select("id");
    setBusy(null);

    // An RLS-filtered update reports success with zero rows — do not tell the
    // user it was signed off when nothing changed.
    if (error || !data?.length) {
      toast({
        title: "Not saved",
        description: error?.message || "You do not have permission to move this report card.",
        variant: "destructive",
      });
      return;
    }
    setCards(prev => prev.map(r => (r.id === c.id ? { ...r, ...patch } as ReportCard : r)));
    toast({ title: to === "published" ? "Published" : "Moved to " + STATUS_LABEL[to] });
  };

  const reject = async (c: ReportCard) => {
    setBusy(c.id);
    const { data, error } = await supabase
      .from("report_cards").update({ status: "draft" }).eq("id", c.id).select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({ title: "Not saved", description: error?.message || "Not permitted.", variant: "destructive" });
      return;
    }
    setCards(prev => prev.map(r => (r.id === c.id ? { ...r, status: "draft" } : r)));
  };

  const visible = useMemo(
    () => (filter === "all" ? cards : cards.filter(c => c.status === filter)),
    [cards, filter],
  );

  const counts = useMemo(() => {
    const m = {} as Record<Status, number>;
    for (const s of FLOW) m[s] = cards.filter(c => c.status === s).length;
    return m;
  }, [cards]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Report Cards</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {canSignOff ? "Sign off your class's report cards" : "Review and publish report cards"}
          </p>
        </div>
        <div className="flex rounded-lg border border-input overflow-hidden text-xs">
          {(["all", ...FLOW] as const).map(f => (
            <button key={f} onClick={() => setFilter(f as Status | "all")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"
              }`}>
              {f === "all" ? `All (${cards.length})` : `${STATUS_LABEL[f as Status]} (${counts[f as Status] ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nothing here</p>
          <p className="text-xs text-muted-foreground mt-1">
            Report cards appear once marks have been entered and a card generated for the term.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Student</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Term</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Result</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Status</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Comment</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground border-b border-border">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(c => {
                const next = nextFor(c);
                return (
                  <tr key={c.id} className="hover:bg-muted/20 align-top">
                    <td className="px-3 py-2 border-b border-border/30 text-foreground">
                      {names[c.student_id] || c.student_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 border-b border-border/30 text-muted-foreground">{c.term || "—"}</td>
                    <td className="px-3 py-2 border-b border-border/30 text-muted-foreground">
                      {c.percentage != null ? `${c.percentage}%` : "—"}
                      {c.grade ? ` · ${c.grade}` : ""}
                    </td>
                    <td className="px-3 py-2 border-b border-border/30">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b border-border/30">
                      {c.status === "class_teacher_review" && canSignOff ? (
                        <input
                          value={comment[c.id] ?? c.class_teacher_comment ?? ""}
                          onChange={e => setComment({ ...comment, [c.id]: e.target.value })}
                          placeholder="Class teacher remark"
                          className="w-48 rounded-lg border border-input bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring/20"
                        />
                      ) : (
                        <span className="text-muted-foreground">{c.class_teacher_comment || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b border-border/30 text-right whitespace-nowrap">
                      {next && (
                        <Button size="sm" className="h-7 text-[11px]" disabled={busy === c.id}
                          onClick={() => advance(c, next.to)}>
                          <next.icon className="h-3 w-3 mr-1" /> {next.label}
                        </Button>
                      )}
                      {c.status !== "draft" && c.status !== "published" && canPublish && (
                        <button onClick={() => reject(c)} disabled={busy === c.id}
                          title="Send back to draft"
                          className="ml-2 text-muted-foreground/50 hover:text-destructive transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReportCards;
