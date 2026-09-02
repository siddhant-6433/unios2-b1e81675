// Finance-only audit trail for credit applications and fee reallocations —
// reads fee_ledger_reallocation_audit (RLS-gated to finance roles).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { feeTermLabel, type FeeStructureMetadata } from "@/lib/feeTermLabels";

interface AuditRow {
  id: string;
  action: "apply_credit" | "transfer" | "unapply_to_credit";
  from_fee_code: string | null;
  from_term: string | null;
  to_fee_code: string | null;
  to_term: string | null;
  amount: number;
  reason: string | null;
  actor_role: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studentId: string;
  /** Period wording from the programme's active fee structure — D.AOTT's
   *  year_N terms are semesters. Threaded from StudentFeePanel, which has
   *  already resolved it, so each dialog need not re-query. */
  feeMeta?: FeeStructureMetadata;
}

const ACTION_LABEL: Record<string, string> = {
  apply_credit: "Applied Credit",
  transfer: "Transfer",
  unapply_to_credit: "Unapplied to Credit",
};

const headLabel = (code: string | null, term: string | null, feeMeta?: FeeStructureMetadata) =>
  code ? `${code}${term ? ` — ${feeTermLabel(term, feeMeta)}` : ""}` : "Credit";

export function FeeLedgerAuditDialog({ open, onOpenChange, studentId, feeMeta }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("fee_ledger_reallocation_audit" as any)
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data as any) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, studentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Reallocation History
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <OrbLoader state="solving" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 text-destructive px-3 py-2 text-xs">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No credit or transfer activity for this student yet.
          </p>
        )}

        {!loading && !error && rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Action</th>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-2 py-2 font-medium">To</th>
                <th className="px-2 py-2 font-medium text-right">Amount</th>
                <th className="px-2 py-2 font-medium">Reason</th>
                <th className="px-2 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN")}</td>
                  <td className="px-2 py-2">
                    <Badge variant="outline" className="text-[10px] font-normal">{ACTION_LABEL[r.action] || r.action}</Badge>
                  </td>
                  <td className="px-2 py-2 text-foreground">{headLabel(r.from_fee_code, r.from_term, feeMeta)}</td>
                  <td className="px-2 py-2 text-foreground">{headLabel(r.to_fee_code, r.to_term, feeMeta)}</td>
                  <td className="px-2 py-2 text-right font-medium text-foreground">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                  <td className="px-2 py-2 text-muted-foreground italic">{r.reason || "—"}</td>
                  <td className="px-2 py-2 text-muted-foreground capitalize">{r.actor_role?.replace(/_/g, " ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
