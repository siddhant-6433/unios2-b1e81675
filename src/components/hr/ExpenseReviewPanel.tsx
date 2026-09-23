// HR Expenses — the approver's inbox.
//
// Every claim raised by an employee lands here as 'submitted'. An approver can
// approve, reject (with a reason) or mark an approved claim reimbursed. The three
// actions are database RPCs, not table writes, so the decision, its audit row and
// the employee's notification all happen in one transaction.
//
// Rows come from the expense_claims_inbox view, which already joins the category
// name and the employee's name/number — no N+1 profile lookups from the client.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, BadgeCheck, Receipt, Inbox, Loader2 } from "lucide-react";
import {
  REVIEW_FILTERS, formatInr, statusBadge, statusLabel, summarizeClaims,
  type ExpenseClaimInboxRow, type ReviewFilter,
} from "@/lib/expenses";

const FILTER_LABEL: Record<ReviewFilter, string> = {
  all: "All",
  submitted: "Pending",
  approved: "Approved",
  reimbursed: "Reimbursed",
  rejected: "Rejected",
};

export function ExpenseReviewPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canApprove = can("hr", "expenses_approve");

  const [rows, setRows] = useState<ExpenseClaimInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewFilter>("submitted");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseClaimInboxRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const all: ExpenseClaimInboxRow[] = [];
    // The view has no hard row cap; page through it rather than trusting a limit.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await (supabase.from("expense_claims_inbox" as any) as any)
        .select(
          "id, employee_profile_id, submitted_by, title, amount, currency, expense_date, description, receipt_url, status, decision_note, decided_at, reimbursed_at, payroll_cycle_id, created_at, updated_at, category_name, category_code, employee_name, employee_number, employee_user_id",
        )
        .order("created_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        toast({ title: "Could not load expense claims", description: error.message, variant: "destructive" });
        break;
      }
      if (!data?.length) break;
      all.push(...(data as ExpenseClaimInboxRow[]));
      if (data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const summary = useMemo(() => summarizeClaims(rows), [rows]);
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "submitted").length, [rows]);

  const decide = async (row: ExpenseClaimInboxRow, approve: boolean, note: string | null) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("decide_expense_claim" as any, {
      _claim_id: row.id,
      _approve: approve,
      _note: note,
    });
    setBusyId(null);
    if (error) {
      toast({ title: approve ? "Could not approve" : "Could not reject", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: approve ? "Claim approved" : "Claim rejected" });
    await fetchRows();
  };

  const reimburse = async (row: ExpenseClaimInboxRow) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("mark_expense_reimbursed" as any, {
      _claim_id: row.id,
      _payroll_cycle_id: null,
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not mark reimbursed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Marked reimbursed" });
    await fetchRows();
  };

  const submitReject = async () => {
    if (!rejecting) return;
    const row = rejecting;
    setRejecting(null);
    await decide(row, false, rejectNote.trim() || null);
    setRejectNote("");
  };

  const cards = [
    { label: "Total claims", value: summary.total, tone: "text-foreground" },
    { label: "Awaiting decision", value: summary.pending, tone: "text-amber-600" },
    { label: "Approved", value: summary.approved, tone: "text-emerald-600" },
    { label: "Reimbursed", value: summary.reimbursed, tone: "text-blue-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-card card-shadow p-4">
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-semibold mt-1 ${c.tone}`}>₹{formatInr(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-input bg-card p-1">
        {REVIEW_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_LABEL[f]}
            {f === "submitted" && pendingCount > 0 && (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader />
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filter === "submitted" ? "No claims awaiting a decision." : "No expense claims here yet."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                {canApprove && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.employee_name || "Unnamed"}</div>
                    {r.employee_number && (
                      <div className="text-xs text-muted-foreground">{r.employee_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="font-medium text-foreground truncate">{r.title}</div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground truncate">{r.description}</div>
                    )}
                    {r.decision_note && r.status === "rejected" && (
                      <div className="text-xs text-muted-foreground mt-0.5">Note: {r.decision_note}</div>
                    )}
                    {r.receipt_url && (
                      <a
                        href={r.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Receipt className="h-3 w-3" /> Receipt
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.category_name || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.expense_date}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">₹{formatInr(r.amount)}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize ${statusBadge(r.status)}`}>{statusLabel(r.status)}</Badge>
                  </td>
                  {canApprove && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "submitted" && (
                          <>
                            <button
                              onClick={() => decide(r, true, null)}
                              disabled={busyId === r.id}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
                            </button>
                            <button
                              onClick={() => { setRejecting(r); setRejectNote(""); }}
                              disabled={busyId === r.id}
                              className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <button
                            onClick={() => reimburse(r)}
                            disabled={busyId === r.id}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />} Mark reimbursed
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject expense claim</DialogTitle>
            <DialogDescription>
              {rejecting ? `${rejecting.employee_name || "Employee"} · ${rejecting.title} · ₹${formatInr(rejecting.amount)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Why is this being rejected? The employee will see this."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={submitReject} disabled={busyId === rejecting?.id}>
              Reject claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
