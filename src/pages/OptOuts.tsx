// Opt-outs / Do Not Contact — lists leads with stage='dnc' (RLS-scoped),
// enriches with the most recent lead_activities row that flipped them to
// dnc (source/prior stage), and lets staff re-subscribe via the same
// transition helper LeadDetail's unmarkDnc() uses.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Users, CalendarClock, RotateCcw } from "lucide-react";
import { STAGE_LABELS } from "@/lib/leadStages";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";

const PAGE_SIZE = 25;

interface DncRow {
  id: string;
  name: string | null;
  phone: string | null;
  optedOutAt: string | null;
  source: string | null;
  priorStage: string | null;
}

const stageLabel = (stage: string | null) => (stage ? STAGE_LABELS[stage] || stage : "—");

function Metric({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function OptOuts() {
  const { toast } = useToast();

  const [rows, setRows] = useState<DncRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [last7, setLast7] = useState(0);
  const [last30, setLast30] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [resubscribingId, setResubscribingId] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    const now = Date.now();
    const cutoff7 = new Date(now - 7 * 86400000).toISOString();
    const cutoff30 = new Date(now - 30 * 86400000).toISOString();
    const [totalRes, last7Res, last30Res] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "dnc"),
      supabase.from("lead_activities").select("id", { count: "exact", head: true }).eq("new_stage", "dnc").gte("created_at", cutoff7),
      supabase.from("lead_activities").select("id", { count: "exact", head: true }).eq("new_stage", "dnc").gte("created_at", cutoff30),
    ]);
    setTotalCount(totalRes.count || 0);
    setLast7(last7Res.count || 0);
    setLast30(last30Res.count || 0);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("leads")
      .select("id,name,phone,stage", { count: "exact" })
      .eq("stage", "dnc");
    const q = search.trim();
    if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
    const from = page * PAGE_SIZE;
    const { data: leadRows, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      toast({ title: "Couldn't load opt-outs", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    setTotal(count || 0);
    const ids = (leadRows || []).map((r) => r.id);
    let activityByLead = new Map<string, { old_stage: string | null; created_at: string; description: string | null }>();
    if (ids.length) {
      const { data: activities } = await supabase
        .from("lead_activities")
        .select("lead_id,old_stage,created_at,description")
        .eq("new_stage", "dnc")
        .in("lead_id", ids)
        .order("created_at", { ascending: false });
      // Keep the FIRST (i.e. latest, given the desc order) row per lead_id.
      for (const a of activities || []) {
        if (!activityByLead.has(a.lead_id)) {
          activityByLead.set(a.lead_id, { old_stage: a.old_stage, created_at: a.created_at, description: a.description });
        }
      }
    }

    setRows(
      (leadRows || []).map((l) => {
        const a = activityByLead.get(l.id);
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          optedOutAt: a?.created_at ?? null,
          source: a?.description ?? null,
          priorStage: a?.old_stage ?? null,
        };
      }),
    );
    setLoading(false);
  }, [search, page, toast]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const resubscribe = async (leadId: string) => {
    setResubscribingId(leadId);
    try {
      const transition = resolveLeadTransitionCommand({ currentStage: "dnc", command: "restoreFromDnc" });
      await applyResolvedLeadTransition(supabase as any, { leadId, transition });
      toast({ title: "Re-subscribed", description: "Lead restored to New Lead." });
      await Promise.all([loadRows(), loadCounts()]);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setResubscribingId(null);
    }
  };

  const from = page * PAGE_SIZE;
  const to = Math.min(from + rows.length, total);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Opt-outs / Do Not Contact</h1>
        <p className="text-sm text-muted-foreground">
          Leads who opted out of WhatsApp / calls. Re-subscribe to resume outreach.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric title="Total opted-out" value={totalCount.toLocaleString("en-IN")} icon={Users} />
        <Metric title="Last 7 days" value={last7.toLocaleString("en-IN")} icon={CalendarClock} />
        <Metric title="Last 30 days" value={last30.toLocaleString("en-IN")} icon={CalendarClock} />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone"
              className="pl-8"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No opted-out leads</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Opted-out on</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Was</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name || "—"}</TableCell>
                      <TableCell>{r.phone || "—"}</TableCell>
                      <TableCell>{r.optedOutAt ? new Date(r.optedOutAt).toLocaleDateString("en-IN") : "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate" title={r.source || undefined}>
                        {r.source || "—"}
                      </TableCell>
                      <TableCell>{stageLabel(r.priorStage)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resubscribingId === r.id}
                          onClick={() => resubscribe(r.id)}
                        >
                          <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          {resubscribingId === r.id ? "Re-subscribing…" : "Re-subscribe"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                <span>{total === 0 ? "0" : `${from + 1}–${to}`} of {total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
