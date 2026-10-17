import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchCbseUnlockRequests, reviewCbsePaperUnlock, type CbseUnlockRequest } from "@/lib/cbseExamsClient";
import { AcademicPanel, academicInput } from "./AcademicFields";

/** Super-admin queue of teacher requests to unlock a locked marks paper. */
export function UnlockRequestsPanel({ disabled, onReviewed }: { disabled: boolean; onReviewed: () => void }) {
  const [rows, setRows] = useState<CbseUnlockRequest[]>([]);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await fetchCbseUnlockRequests(); if (r.error) setError(r.error); else setRows(r.data ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  const review = async (id: string, decision: "approved" | "rejected") => {
    const r = await reviewCbsePaperUnlock(id, decision, remarks[id] ?? "");
    if (r.error) { setError(r.error); return; }
    setError(null); await load(); onReviewed();
  };
  if (!rows.length && !error) return null;
  return <AcademicPanel title={`Unlock requests (${rows.length})`} description="Teachers asking to reopen a locked paper. Approving unlocks the paper and returns the assessment to marks entry.">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {rows.map(r => <div key={r.id} className="border rounded-lg p-3 space-y-2 text-sm">
      <p><span className="font-medium">{r.teacher}</span> · {r.exam_name} · {r.class_name}{r.section ? ` ${r.section}` : ""} · {r.paper_name}</p>
      <p className="text-muted-foreground">Reason: {r.reason}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label={`Remarks for ${r.paper_name}`} placeholder="Remarks (optional)" className={academicInput} value={remarks[r.id] ?? ""} onChange={e => setRemarks(m => ({ ...m, [r.id]: e.target.value }))} />
        <Button disabled={disabled} onClick={() => review(r.id, "approved")}>Approve & unlock</Button>
        <Button variant="outline" disabled={disabled} onClick={() => review(r.id, "rejected")}>Reject</Button>
      </div>
    </div>)}
  </AcademicPanel>;
}
