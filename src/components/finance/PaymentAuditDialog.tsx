// Super-admin-only audit-trail viewer for a single lead_payments row.
//
// Reads from `lead_payments_audit` (RLS-gated to super_admin) and verifies
// the per-payment SHA-256 chain via the verify_lead_payment_audit_chain
// RPC so the user can see at a glance whether anyone tampered with the
// audit table out-of-band.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldAlert, Plus, Pencil, Trash2 } from "lucide-react";

interface AuditRow {
  id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_at: string;
  changed_by_user_id: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  before_row: Record<string, unknown> | null;
  after_row: Record<string, unknown> | null;
  changed_fields: string[] | null;
  reason: string | null;
  prev_hash: string | null;
  row_hash: string;
}

interface VerifyRow {
  audit_id: string;
  ok: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  receiptNo?: string | null;
}

const SHOWN_FIELDS = new Set([
  "type", "amount", "payment_mode", "transaction_ref", "receipt_no",
  "receipt_url", "status", "payment_date", "notes", "concession_amount",
  "waiver_reason", "gateway", "recorded_by",
]);

const fmtTs = (ts: string) => new Date(ts).toLocaleString();
const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function PaymentAuditDialog({ open, onOpenChange, paymentId, receiptNo }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [verify, setVerify] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !paymentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const [{ data: audit, error: aErr }, { data: chk, error: vErr }] = await Promise.all([
        supabase
          .from("lead_payments_audit" as any)
          .select("*")
          .eq("lead_payment_id", paymentId)
          .order("changed_at", { ascending: true }),
        (supabase as any).rpc("verify_lead_payment_audit_chain", { _payment_id: paymentId }),
      ]);
      if (cancelled) return;
      if (aErr) setError(aErr.message);
      else setRows((audit as any) || []);
      if (!vErr && Array.isArray(chk)) {
        const m: Record<string, boolean> = {};
        (chk as VerifyRow[]).forEach(r => { m[r.audit_id] = !!r.ok; });
        setVerify(m);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, paymentId]);

  const allOk = useMemo(
    () => rows.length > 0 && rows.every(r => verify[r.id] !== false),
    [rows, verify],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Receipt history
            {receiptNo && <span className="text-xs font-mono text-muted-foreground">#{receiptNo}</span>}
            {rows.length > 0 && (
              allOk ? (
                <Badge className="ml-auto bg-success/10 text-success border-0 text-[10px] gap-1">
                  <ShieldCheck className="h-3 w-3" /> Chain intact
                </Badge>
              ) : (
                <Badge className="ml-auto bg-destructive/10 text-destructive border-0 text-[10px] gap-1">
                  <ShieldAlert className="h-3 w-3" /> Chain broken
                </Badge>
              )
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 text-destructive px-3 py-2 text-xs">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No audit entries for this receipt yet.
          </p>
        )}

        <ol className="space-y-3">
          {rows.map((r, i) => {
            const ok = verify[r.id] !== false;
            const ActionIcon = r.action === "INSERT" ? Plus : r.action === "UPDATE" ? Pencil : Trash2;
            const actionColor =
              r.action === "INSERT" ? "bg-info/10 text-info-foreground"
              : r.action === "UPDATE" ? "bg-warning/10 text-warning-foreground"
              : "bg-destructive/10 text-destructive";

            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-3 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${actionColor} border-0 gap-1`}>
                    <ActionIcon className="h-3 w-3" />{r.action}
                  </Badge>
                  <span className="text-muted-foreground">{fmtTs(r.changed_at)}</span>
                  <span className="text-foreground">
                    by{" "}
                    <span className="font-medium">
                      {r.changed_by_name || (r.changed_by_user_id ? "Unknown user" : "system / gateway")}
                    </span>
                    {r.changed_by_role && (
                      <span className="text-muted-foreground"> · {r.changed_by_role.replace("_", " ")}</span>
                    )}
                  </span>
                  {!ok && (
                    <Badge className="bg-destructive/10 text-destructive border-0 ml-auto gap-1">
                      <ShieldAlert className="h-3 w-3" /> hash mismatch
                    </Badge>
                  )}
                  {i === 0 && ok && (
                    <span className="ml-auto text-[10px] text-muted-foreground">first entry</span>
                  )}
                </div>

                {r.reason && (
                  <p className="mt-2 text-foreground italic">"{r.reason}"</p>
                )}

                {r.action === "UPDATE" && r.changed_fields && r.changed_fields.length > 0 && (
                  <table className="mt-2 w-full">
                    <thead>
                      <tr className="text-muted-foreground text-[10px] uppercase tracking-wide">
                        <th className="text-left font-medium pr-3 py-1">Field</th>
                        <th className="text-left font-medium pr-3 py-1">Before</th>
                        <th className="text-left font-medium py-1">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.changed_fields
                        .filter(f => SHOWN_FIELDS.has(f))
                        .map(f => (
                          <tr key={f} className="border-t border-border/50">
                            <td className="py-1 pr-3 font-mono text-[11px]">{f}</td>
                            <td className="py-1 pr-3 text-destructive">{fmtVal((r.before_row || {})[f])}</td>
                            <td className="py-1 text-success">{fmtVal((r.after_row || {})[f])}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}

                {r.action === "DELETE" && (
                  <p className="mt-2 text-muted-foreground">
                    Row deleted. Amount was{" "}
                    <span className="font-medium text-foreground">
                      ₹{fmtVal((r.before_row || {}).amount)}
                    </span>
                    .
                  </p>
                )}

                {r.action === "INSERT" && r.after_row && (
                  <p className="mt-2 text-muted-foreground">
                    Initial entry · {fmtVal((r.after_row || {}).type)} ·{" "}
                    ₹{fmtVal((r.after_row || {}).amount)} ·{" "}
                    {fmtVal((r.after_row || {}).payment_mode)}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
