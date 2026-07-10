// PostVisitQueue — pending post-visit follow-ups (lead_followups where
// visit_id IS NOT NULL). Complete or reschedule inline. Mirrors the
// PendingFollowups complete/reschedule writes (direct lead_followups updates).

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Clock, CheckCircle2, CalendarClock, ChevronRight, RefreshCw,
} from "lucide-react";

interface FollowupRow {
  id: string;
  lead_id: string;
  scheduled_at: string;
  notes: string | null;
  lead_name: string;
  lead_phone: string;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

interface Props {
  refreshKey?: number;
  onChanged?: () => void;
}

export function PostVisitQueue({ refreshKey, onChanged }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_followups")
      .select(`id, lead_id, scheduled_at, notes, leads!inner(name, phone)`)
      .not("visit_id", "is", null)
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .limit(200);
    setLoading(false);
    if (error) return;
    setRows((data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      scheduled_at: r.scheduled_at,
      notes: r.notes,
      lead_name: r.leads?.name ?? "—",
      lead_phone: r.leads?.phone ?? "",
    })));
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  const complete = async (r: FollowupRow) => {
    setBusyId(r.id);
    const { error } = await (supabase.from("lead_followups") as any)
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", r.id);
    setBusyId(null);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Follow-up completed", description: r.lead_name });
    fetchRows(); onChanged?.();
  };

  const saveReschedule = async (r: FollowupRow) => {
    if (!rescheduleAt) return;
    setBusyId(r.id);
    const { error } = await (supabase.from("lead_followups") as any)
      .update({ scheduled_at: new Date(rescheduleAt).toISOString() })
      .eq("id", r.id);
    setBusyId(null);
    if (error) { toast({ title: "Reschedule failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Rescheduled", description: r.lead_name });
    setRescheduleId(null); setRescheduleAt("");
    fetchRows(); onChanged?.();
  };

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" /> Post-visit follow-ups ({rows.length})
        </h2>
        <button onClick={fetchRows} className="text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No pending post-visit follow-ups.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <Link to={`/admissions/${r.lead_id}`} className="font-medium text-foreground hover:underline truncate">
                    {r.lead_name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" />{fmtDateTime(r.scheduled_at)}</span>
                    {r.lead_phone && <span>{r.lead_phone}</span>}
                    {r.notes && <span className="italic truncate max-w-[280px]">{r.notes}</span>}
                  </div>
                  {rescheduleId === r.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="datetime-local"
                        value={rescheduleAt}
                        onChange={(e) => setRescheduleAt(e.target.value)}
                        className="h-8 w-56"
                      />
                      <Button size="sm" onClick={() => saveReschedule(r)} disabled={busyId === r.id || !rescheduleAt}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRescheduleId(null); setRescheduleAt(""); }}>Cancel</Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => complete(r)} disabled={busyId === r.id}>
                    {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Done
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { setRescheduleId(r.id); setRescheduleAt(""); }}>
                    <CalendarClock className="h-3.5 w-3.5" /> Reschedule
                  </Button>
                  <Link to={`/admissions/${r.lead_id}`} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
