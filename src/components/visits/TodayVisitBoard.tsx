// TodayVisitBoard — today's and upcoming visits for the Visit Center, with
// inline Check-in / Complete / No-show actions. Reads campus_visits directly
// (staff RLS allows manage); writes go through the visit_check_in RPC and a
// direct no-show status update (which fires the existing no-show follow-up
// trigger). Completion opens VisitCompleteDialog.

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VisitCompleteDialog } from "./VisitCompleteDialog";
import {
  Loader2, Calendar, MapPin, UserCheck, CheckCircle2, XCircle,
  Footprints, ChevronRight, RefreshCw,
} from "lucide-react";

interface VisitRow {
  id: string;
  lead_id: string;
  visit_date: string;
  status: string;
  visit_type: string | null;
  checked_in_at: string | null;
  purpose: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  confirmed: "bg-teal-100 text-teal-700",
  completed: "bg-emerald-100 text-emerald-700",
  no_show: "bg-rose-100 text-rose-700",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

interface Props {
  campusId?: string;
  refreshKey?: number;
  onChanged?: () => void;
}

export function TodayVisitBoard({ campusId, refreshKey, onChanged }: Props) {
  const { toast } = useToast();
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [completeVisit, setCompleteVisit] = useState<VisitRow | null>(null);

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    // From start of today onward — the operational "what's ahead" board.
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(Date.now() + 14 * 86400_000);
    let q = supabase
      .from("campus_visits")
      .select(`
        id, lead_id, visit_date, status, visit_type, checked_in_at, purpose,
        leads!inner(name, phone),
        campuses(name)
      `)
      .gte("visit_date", start.toISOString())
      .lte("visit_date", end.toISOString())
      .in("status", ["scheduled", "confirmed"])
      .order("visit_date", { ascending: true });
    if (campusId) q = q.eq("campus_id", campusId);

    const { data, error } = await q;
    setLoading(false);
    if (error) return;
    setVisits((data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      visit_date: r.visit_date,
      status: r.status,
      visit_type: r.visit_type,
      checked_in_at: r.checked_in_at,
      purpose: r.purpose,
      lead_name: r.leads?.name ?? "—",
      lead_phone: r.leads?.phone ?? "",
      campus_name: r.campuses?.name ?? "—",
    })));
  }, [campusId]);

  useEffect(() => { fetchVisits(); }, [fetchVisits, refreshKey]);

  const checkIn = async (v: VisitRow) => {
    setBusyId(v.id);
    const { error } = await supabase.rpc("visit_check_in" as any, { _visit_id: v.id });
    setBusyId(null);
    if (error) { toast({ title: "Check-in failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Checked in", description: v.lead_name });
    fetchVisits(); onChanged?.();
  };

  const markNoShow = async (v: VisitRow) => {
    setBusyId(v.id);
    const { error } = await (supabase.from("campus_visits") as any)
      .update({ status: "no_show" }).eq("id", v.id);
    setBusyId(null);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Marked no-show", description: "Auto follow-up scheduled." });
    fetchVisits(); onChanged?.();
  };

  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-primary" /> Today &amp; upcoming ({visits.length})
        </h2>
        <button onClick={fetchVisits} className="text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {visits.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No upcoming visits. Record a walk-in to get started.
        </p>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <div key={v.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/admissions/${v.lead_id}`} className="font-medium text-foreground hover:underline truncate">
                      {v.lead_name}
                    </Link>
                    {v.visit_type === "walk_in" && (
                      <Badge className="border-0 bg-purple-100 text-purple-700 text-[10px] gap-1"><Footprints className="h-2.5 w-2.5" /> Walk-in</Badge>
                    )}
                    <Badge className={`border-0 text-[10px] ${STATUS_BADGE[v.status] || ""}`}>{v.status}</Badge>
                    {v.checked_in_at && (
                      <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px]">Checked in</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtTime(v.visit_date)}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{v.campus_name}</span>
                    {v.lead_phone && <span>{v.lead_phone}</span>}
                    {v.purpose && <span className="italic">{v.purpose}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {!v.checked_in_at && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => checkIn(v)} disabled={busyId === v.id}>
                      {busyId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                      Check in
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCompleteVisit(v)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-600" onClick={() => markNoShow(v)} disabled={busyId === v.id}>
                    <XCircle className="h-3.5 w-3.5" /> No-show
                  </Button>
                  <Link to={`/admissions/${v.lead_id}`} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <VisitCompleteDialog
        open={!!completeVisit}
        onOpenChange={(open) => !open && setCompleteVisit(null)}
        visitId={completeVisit?.id ?? null}
        leadName={completeVisit?.lead_name}
        onCompleted={() => { setCompleteVisit(null); fetchVisits(); onChanged?.(); }}
      />
    </div>
  );
}
