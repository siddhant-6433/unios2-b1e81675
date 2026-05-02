import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, Play, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface StudentDraft {
  id: string;
  display_name: string | null;
  campus_name: string | null;
  course_name: string | null;
  step: number;
  updated_at: string;
  created_by: string;
}

interface Props {
  /** Bumped from the parent whenever drafts may have changed. */
  refreshKey?: number;
  onResume: (draftId: string) => void;
  /** Roles that should see ALL drafts (not just their own). */
  adminRoles?: string[];
}

const STEP_LABELS = ["Student Details", "Parent / Guardian", "Programme & Session"];

export function StudentDraftsPanel({ refreshKey, onResume, adminRoles = ["super_admin", "campus_admin", "principal", "admission_head"] }: Props) {
  const { user, role } = useAuth();
  const [drafts, setDrafts] = useState<StudentDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const isAdmin = role && adminRoles.includes(role);

  const fetchDrafts = async () => {
    if (!user?.id) return;
    setLoading(true);
    let query = supabase.from("student_drafts")
      .select("id, display_name, campus_name, course_name, step, updated_at, created_by")
      .is("completed_at", null)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (!isAdmin) query = query.eq("created_by", user.id);
    const { data } = await query;
    setDrafts(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchDrafts(); }, [user?.id, refreshKey]);

  const deleteDraft = async (id: string) => {
    setDeletingId(id);
    const { error } = await supabase.from("student_drafts").delete().eq("id", id);
    setDeletingId(null);
    if (!error) setDrafts(prev => prev.filter(d => d.id !== id));
  };

  if (drafts.length === 0 && !loading) return null;

  return (
    <Card className="border-amber-200/70 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/20">
      <CardContent className="p-3">
        <button
          className="w-full flex items-center justify-between gap-2"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-amber-600" />
            <span className="font-medium text-foreground">
              {drafts.length} unfinished {drafts.length === 1 ? "draft" : "drafts"}
              {isAdmin && drafts.length > 0 && <span className="text-muted-foreground font-normal"> (all users)</span>}
            </span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {expanded && (
          <div className="mt-3 space-y-1.5">
            {drafts.map(d => {
              const updated = new Date(d.updated_at);
              const ago = relativeTime(updated);
              const isOwn = d.created_by === user?.id;
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-lg bg-card border border-border/60 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {d.display_name || "(unnamed)"}
                      </span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        Step {d.step + 1}/{STEP_LABELS.length} · {STEP_LABELS[d.step] || "?"}
                      </Badge>
                      {isAdmin && !isOwn && (
                        <Badge variant="outline" className="text-[10px] shrink-0 border-blue-200 text-blue-700">other user</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {[d.course_name, d.campus_name].filter(Boolean).join(" · ") || "no programme yet"} · saved {ago}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-7 text-xs"
                    onClick={() => onResume(d.id)}
                    disabled={!isOwn /* admins can view but not resume — would write under their identity */}
                    title={isOwn ? "Resume this draft" : "Only the creator can resume"}
                  >
                    <Play className="h-3 w-3" /> Resume
                  </Button>
                  {isOwn && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteDraft(d.id)}
                      disabled={deletingId === d.id}
                      title="Delete draft"
                    >
                      {deletingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
