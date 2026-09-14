import { PageLoader } from "@/components/ui/page-loader";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Footprints, MapPin, RefreshCw, ChevronRight } from "lucide-react";
import { formatWalkInWhen } from "@/lib/walkInHistory";

interface WalkInRow {
  id: string;
  lead_id: string;
  visit_date: string;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  purpose: string | null;
  feedback: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
  campus_code: string;
}

interface Props {
  campusId?: string;
  refreshKey?: number;
}

export function WalkInsBoard({ campusId, refreshKey }: Props) {
  const [rows, setRows] = useState<WalkInRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    let q = supabase
      .from("campus_visits")
      .select(`
        id, lead_id, visit_date, status, checked_in_at, checked_out_at, purpose, feedback,
        leads!inner(name, phone),
        campuses(name, code)
      `)
      .eq("visit_type", "walk_in")
      .gte("visit_date", start.toISOString())
      .order("visit_date", { ascending: false });
    if (campusId) q = q.eq("campus_id", campusId);

    const { data, error } = await q;
    setLoading(false);
    if (error) return;
    setRows((data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      visit_date: r.visit_date,
      status: r.status,
      checked_in_at: r.checked_in_at,
      checked_out_at: r.checked_out_at,
      purpose: r.purpose,
      feedback: r.feedback,
      lead_name: r.leads?.name ?? "—",
      lead_phone: r.leads?.phone ?? "",
      campus_name: r.campuses?.name ?? "—",
      campus_code: r.campuses?.code ?? "",
    })));
  }, [campusId]);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Footprints className="h-4 w-4 text-primary" /> Walk-ins ({rows.length})
        </h2>
        <button onClick={fetchRows} className="text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Recorded at the desk and previous walk-ins logged later, last 30 days.</p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No walk-ins in the last 30 days.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => {
            const live = !!v.checked_in_at && !v.checked_out_at;
            const comments = v.feedback || v.purpose;
            return (
              <div key={v.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/admissions/${v.lead_id}`} className="font-medium text-foreground hover:underline truncate">
                        {v.lead_name}
                      </Link>
                      {live ? (
                        <Badge className="border-0 bg-success/10 text-success text-[10px]">On campus</Badge>
                      ) : (
                        <Badge className="border-0 bg-muted text-muted-foreground text-[10px]">
                          {v.status === "completed" ? "Completed" : v.status}
                        </Badge>
                      )}
                      {v.campus_code && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold">{v.campus_code}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{formatWalkInWhen(v.checked_in_at || v.visit_date)}</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{v.campus_name}</span>
                      {v.lead_phone && <span>{v.lead_phone}</span>}
                    </div>
                    {comments && <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{comments}</p>}
                  </div>
                  <Link to={`/admissions/${v.lead_id}`} className="text-muted-foreground hover:text-foreground shrink-0">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
