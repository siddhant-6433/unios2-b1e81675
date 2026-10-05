import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Item = { lead_id: string; name: string; action: string; reason: string; destination: string | null };
type Preview = { cutoff: string; digest: string; items: Item[]; staff: { id: string; name: string }[] | null };
type Run = { id: string; status: string; cutoff: string; archive_list_id: string | null };
type Report = { mirai_balanced: boolean; run: Run; counts: Record<string, number>; assignments: { name: string; count: number }[]; exceptions: { lead_id: string; status: string; reason: string; detail: string | null }[] };

async function cleanupRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

export function LeadCleanupDialog({ onChanged }: { onChanged: () => void }) {
  const { role } = useAuth();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const pause = useRef(false);
  useEffect(() => () => { pause.current = true; }, []);

  async function loadRuns() {
    const { data, error: loadError } = await supabase.from("lead_cleanup_runs" as never).select("id,status,cutoff,archive_list_id").order("created_at", { ascending: false }).limit(20);
    if (loadError) throw loadError;
    setRuns(data as unknown as Run[]);
  }
  async function action(work: () => Promise<void>) {
    setError(""); setBusy(true);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String((e as { message?: string })?.message || e)); }
    finally { setBusy(false); }
  }
  async function readReport(id: string) {
    const next = await cleanupRpc<Report>("lead_cleanup_report", { _run_id: id });
    setReport(next); return next;
  }
  async function process(id: string, rollback = false) {
    pause.current = false;
    do {
      const result = await cleanupRpc<{ remaining: number }>(rollback ? "rollback_lead_cleanup" : "apply_lead_cleanup", { _run_id: id, _limit: 100 });
      await readReport(id);
      onChanged();
      if (result.remaining === 0) break;
    } while (!pause.current);
    await loadRuns();
  }
  if (role !== "super_admin") return null;
  const counts = preview?.items.reduce<Record<string, number>>((acc, item) => { acc[item.action] = (acc[item.action] || 0) + 1; return acc; }, {}) || {};
  const owners = new Map(preview?.staff?.map(p => [p.id, p.name]) || []);
  return <>
    <Button variant="outline" onClick={() => { setOpen(true); void action(loadRuns); }}>Archive old leads</Button>
    <Dialog open={open} onOpenChange={value => { if (!value) pause.current = true; setOpen(value); }}>
      <DialogContent aria-describedby={descriptionId} className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Archive old leads and reset ownership</DialogTitle><DialogDescription>Review the backlog before archiving or changing ownership.</DialogDescription></DialogHeader>
        <p id={descriptionId} className="text-sm text-muted-foreground">Applicants, students, admission and payment records stay unchanged. Ashish keeps nursing/GNM, Payal keeps engaged school prospects, and Reema/Harsh share Mirai. New leads stay in Lead Buckets. No messages are sent.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || runs.some(r => ["prepared", "applying", "rolling_back"].includes(r.status))} onClick={() => void action(async () => {
            const cutoff = preview?.cutoff || new Date().toISOString();
            setPreview(await cleanupRpc<Preview>("preview_lead_cleanup", { _cutoff: cutoff }));
            setReport(null); setPage(0); setConfirmed(false);
          })}>{busy ? "Working…" : preview ? "Refresh this preview" : "Build read-only preview"}</Button>
          {preview && <Button variant="outline" onClick={() => download(preview, "lead-cleanup-preview.json")}>Download preview</Button>}
          {busy && <Button variant="outline" onClick={() => { pause.current = true; }}>Pause after this batch</Button>}
        </div>
        {preview && !report && <>
          <p className="text-sm">Fixed cutoff: {new Date(preview.cutoff).toLocaleString()} · {Object.entries(counts).map(([key, n]) => `${key}: ${n}`).join(" · ")}</p>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-2">Lead</th><th>Action</th><th>Reason</th><th>Owner</th></tr></thead><tbody>
            {preview.items.slice(page * 50, (page + 1) * 50).map(item => <tr key={item.lead_id} className="border-t"><td className="p-2"><Link className="underline" target="_blank" to={`/admissions/${item.lead_id}`}>{item.name}</Link></td><td>{item.action}</td><td>{item.reason.replace(/_/g, " ")}</td><td>{item.destination ? owners.get(item.destination) : "Unchanged"}</td></tr>)}
          </tbody></table></div>
          <div className="flex gap-2"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={(page + 1) * 50 >= preview.items.length} onClick={() => setPage(page + 1)}>Next</Button></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed the preview and want to apply this cleanup.</label>
          <Button disabled={busy || !confirmed} onClick={() => void action(async () => {
            const id = await cleanupRpc<string>("prepare_lead_cleanup", { _cutoff: preview.cutoff, _expected_digest: preview.digest });
            await readReport(id); await loadRuns(); await process(id);
          })}>Apply reviewed cleanup</Button>
        </>}
        {report && <>
          <p className="text-sm">Cleanup: {report.run.status} · {Object.entries(report.counts).map(([key, n]) => `${key}: ${n}`).join(" · ")}</p>
          {report.run.status === "applied" && !report.mirai_balanced && <p role="alert" className="text-sm text-destructive">Mirai totals differ by more than one because records were skipped. Review the exceptions before rebalancing.</p>}
          <p className="text-sm">Assignments: {report.assignments.map(a => `${a.name}: ${a.count}`).join(" · ") || "None applied"}</p>
          {report.run.archive_list_id && <Link className="text-sm underline" to={`/lists?listId=${report.run.archive_list_id}`} onClick={() => setOpen(false)}>Open marketing archive list</Link>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => download(report, `lead-cleanup-${report.run.id}.json`)}>Download reconciliation report</Button>
            {["prepared", "applying"].includes(report.run.status) && <Button disabled={busy} onClick={() => void action(() => process(report.run.id))}>Resume cleanup</Button>}
            {report.run.status !== "rolled_back" && <Button variant="outline" disabled={busy} onClick={() => {
              if (window.confirm("Roll back this cleanup? Later staff activity and newly protected records will be reported as conflicts and left unchanged.")) void action(() => process(report.run.id, true));
            }}>{report.run.status === "rolling_back" ? "Resume rollback" : "Roll back cleanup"}</Button>}
          </div>
          {report.exceptions.length > 0 && <p className="text-sm text-muted-foreground">{report.exceptions.length} records need review or were skipped. Download the report for reasons and lead IDs.</p>}
        </>}
        {runs.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Recent cleanup runs</p>{runs.map(run => <Button key={run.id} variant="ghost" disabled={busy} onClick={() => void action(async () => { setPreview(null); await readReport(run.id); })}>{new Date(run.cutoff).toLocaleString()} · {run.status}</Button>)}</div>}
      </DialogContent>
    </Dialog>
  </>;
}
