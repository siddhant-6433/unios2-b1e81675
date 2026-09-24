// HR Expenses — the approver's inbox and the Zoho / reimbursement queue.
//
// A claim moves through two stages: the reporting manager (L1) approves, then a
// super admin (L2) gives final approval. Each decision is a database RPC, not a
// table write, so the state move, its audit row and the employee's notification
// all happen in one transaction. Once finally approved it is pushed to Zoho Books
// as a vendor bill, then marked reimbursed (payroll, Zoho payment, or bank).
//
// Rows come from the expense_claims_inbox view, which already joins the category
// name, the employee's name/number, and a proof_count — no N+1 lookups from the
// client. Attachments are fetched lazily when the proof viewer opens.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  BadgeCheck, Ban, Check, FileText, Image as ImageIcon, Inbox, Loader2, Paperclip,
  RefreshCw, Send, X, AlertTriangle,
} from "lucide-react";
import {
  REIMBURSEMENT_MODES,
  REVIEW_QUEUES,
  canL1,
  canL2,
  canReimburse,
  canSendToZoho,
  formatInr,
  needsCorrection,
  reimbursementLabel,
  reviewStage,
  statusBadge,
  statusLabel,
  summarizeClaims,
  type ExpenseAttachment,
  type ExpenseClaimInboxRow,
  type ReimbursementMode,
  type ReviewAction,
  type ReviewQueue,
} from "@/lib/expenses";

const INBOX_COLUMNS =
  "id, employee_profile_id, submitted_by, title, amount, currency, expense_date, description, receipt_url, status, decision_note, decided_at, reimbursed_at, payroll_cycle_id, created_at, updated_at, submitted_at, l1_reviewer, l1_status, l1_at, l1_note, l2_reviewer, l2_status, l2_at, l2_note, correction_note, correction_at, rejection_reason, rejected_at, zoho_bill_id, zoho_bill_number, zoho_synced_at, zoho_sync_error, reimbursement_mode, proof_count, category_name, category_code, employee_name, employee_number, employee_user_id";

const QUEUE_LABEL: Record<ReviewQueue, string> = {
  with_me: "With me",
  final: "Final approval",
  zoho: "Sent to Zoho",
  reimbursed: "Reimbursed",
  rejected: "Rejected",
  all: "All",
};

interface ZohoCandidate {
  contact_id?: string;
  contact_name?: string;
  [key: string]: unknown;
}

interface ZohoSyncResult {
  ok?: boolean;
  zoho_bill_id?: string;
  zoho_bill_number?: string;
  zoho_payment_id?: string;
  error?: string;
  needs_vendor_choice?: boolean;
  candidates?: ZohoCandidate[];
}

const shortDate = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const proofTotal = (row: ExpenseClaimInboxRow): number => {
  const count = Number(row.proof_count || 0);
  if (count > 0) return count;
  return row.receipt_url ? 1 : 0;
};

const isImage = (a: ExpenseAttachment) =>
  (a.mime_type || "").startsWith("image/") ||
  /\.(png|jpe?g|gif|webp|heic)$/i.test(a.file_name || a.file_url || "");

export function ExpenseReviewPanel() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const { user } = useAuth();

  const canApproveL1 = can("hr", "expenses_approve");
  const canApproveL2 = can("hr", "expenses_final_approve");
  const canPay = can("hr", "payroll_run") || canApproveL2;

  const [rows, setRows] = useState<ExpenseClaimInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<ReviewQueue>("with_me");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [correcting, setCorrecting] = useState<ExpenseClaimInboxRow | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [rejecting, setRejecting] = useState<ExpenseClaimInboxRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [vendorChoice, setVendorChoice] = useState<{ row: ExpenseClaimInboxRow; candidates: ZohoCandidate[] } | null>(null);

  const [reimbursing, setReimbursing] = useState<ExpenseClaimInboxRow | null>(null);
  const [reimburseMode, setReimburseMode] = useState<ReimbursementMode>("payroll");

  const [proofRow, setProofRow] = useState<ExpenseClaimInboxRow | null>(null);
  const [attachments, setAttachments] = useState<ExpenseAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const all: ExpenseClaimInboxRow[] = [];
    // The view has no hard row cap; page through it rather than trusting a limit.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("expense_claims_inbox" as never)
        .select(INBOX_COLUMNS)
        .order("created_at", { ascending: false })
        .range(from, from + 999);

      if (error) {
        toast({ title: "Could not load expense claims", description: error.message, variant: "destructive" });
        break;
      }
      if (!data?.length) break;
      all.push(...(data as unknown as ExpenseClaimInboxRow[]));
      if (data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const withMe = useMemo(
    () => rows.filter((r) => reviewStage(r, user?.id, { canApproveL1 }) === "l1"),
    [rows, user?.id, canApproveL1],
  );
  const finalQueue = useMemo(
    () => rows.filter((r) => r.status === "pending_superadmin"),
    [rows],
  );

  const visible = useMemo(() => {
    switch (queue) {
      case "with_me": return withMe;
      case "final": return finalQueue;
      case "zoho": return rows.filter((r) => r.status === "approved" || r.status === "synced_to_zoho");
      case "reimbursed": return rows.filter((r) => r.status === "reimbursed");
      case "rejected": return rows.filter((r) => r.status === "rejected" || r.status === "cancelled");
      default: return rows;
    }
  }, [queue, withMe, finalQueue, rows]);

  const summary = useMemo(() => summarizeClaims(rows), [rows]);

  const advanceRow = (id: string, patch: Partial<ExpenseClaimInboxRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const decide = async (row: ExpenseClaimInboxRow, action: ReviewAction, note: string | null) => {
    const stage = row.status === "pending_superadmin" ? "l2" : "l1";
    const fn = stage === "l2" ? "l2_decide_expense" : "l1_decide_expense";
    setBusyId(row.id);
    const { error } = await supabase.rpc(fn as never, {
      _claim_id: row.id,
      _action: action,
      _note: note,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not record the decision", description: error.message, variant: "destructive" });
      return;
    }
    const titles: Record<ReviewAction, string> = {
      approve: stage === "l2" ? "Final approval recorded" : "Sent for final approval",
      correction: "Sent for correction",
      reject: "Claim rejected",
    };
    toast({ title: titles[action] });
    await fetchRows();
  };

  const sendToZoho = async (row: ExpenseClaimInboxRow, opts: { vendorId?: string; forceCreate?: boolean } = {}) => {
    setSyncingId(row.id);
    const { data, error } = await supabase.functions.invoke("zoho-expense-bill-sync", {
      body: {
        claim_id: row.id,
        action: "create_bill",
        ...(opts.vendorId ? { vendor_id: opts.vendorId } : {}),
        ...(opts.forceCreate ? { force_create_vendor: true } : {}),
      },
    });
    setSyncingId(null);
    const result = (data as ZohoSyncResult | null) ?? null;

    if (result?.needs_vendor_choice) {
      setVendorChoice({ row, candidates: result.candidates ?? [] });
      return;
    }
    if (error || result?.error || !result?.ok) {
      const message = result?.error || error?.message || "Zoho did not accept the bill.";
      toast({ title: "Zoho sync failed", description: message, variant: "destructive" });
      await fetchRows();
      return;
    }
    setVendorChoice(null);
    toast({
      title: "Sent to Zoho",
      description: result.zoho_bill_number ? `Bill ${result.zoho_bill_number} created.` : undefined,
    });
    await fetchRows();
  };

  const markReimbursed = async () => {
    if (!reimbursing) return;
    const row = reimbursing;
    if (reimburseMode === "zoho" && !row.zoho_bill_id) {
      toast({ title: "No Zoho bill yet", description: "Send the claim to Zoho before recording a Zoho payment.", variant: "destructive" });
      return;
    }
    setBusyId(row.id);

    // A Zoho reimbursement must record the vendor payment first, so the books
    // and the claim agree before the status flips to reimbursed.
    if (reimburseMode === "zoho" && row.zoho_bill_id) {
      const { data, error } = await supabase.functions.invoke("zoho-expense-bill-sync", {
        body: { claim_id: row.id, action: "record_payment" },
      });
      const result = (data as ZohoSyncResult | null) ?? null;
      if (error || result?.error || !result?.ok) {
        setBusyId(null);
        toast({
          title: "Zoho payment failed",
          description: result?.error || error?.message || "Could not record the vendor payment.",
          variant: "destructive",
        });
        await fetchRows();
        return;
      }
    }

    const { error } = await supabase.rpc("mark_expense_reimbursed" as never, {
      _claim_id: row.id,
      _payroll_cycle_id: null,
      _mode: reimburseMode,
    } as never);
    setBusyId(null);
    if (error) {
      toast({ title: "Could not mark reimbursed", description: error.message, variant: "destructive" });
      await fetchRows();
      return;
    }
    setReimbursing(null);
    toast({ title: "Marked reimbursed", description: reimbursementLabel(reimburseMode) });
    await fetchRows();
  };

  const submitCorrection = async () => {
    if (!correcting) return;
    const row = correcting;
    const note = correctionNote.trim();
    if (!note) {
      toast({ title: "Add a note", description: "Tell the employee what to fix.", variant: "destructive" });
      return;
    }
    setCorrecting(null);
    setCorrectionNote("");
    await decide(row, "correction", note);
  };

  const submitReject = async () => {
    if (!rejecting) return;
    const row = rejecting;
    const reason = rejectReason.trim();
    if (!reason) {
      toast({ title: "Add a reason", description: "The employee will see why this was rejected.", variant: "destructive" });
      return;
    }
    setRejecting(null);
    setRejectReason("");
    await decide(row, "reject", reason);
  };

  const openProof = async (row: ExpenseClaimInboxRow) => {
    setProofRow(row);
    setAttachments([]);
    setAttachmentsLoading(true);
    const { data, error } = await supabase.from("expense_claim_attachments" as never)
      .select("id, claim_id, file_url, file_path, file_name, mime_type, file_size, uploaded_at")
      .eq("claim_id", row.id)
      .order("uploaded_at", { ascending: true });
    setAttachmentsLoading(false);
    if (error) {
      toast({ title: "Could not load proofs", description: error.message, variant: "destructive" });
      return;
    }
    setAttachments((data as unknown as ExpenseAttachment[]) ?? []);
  };

  const cards = [
    { label: "Total claims", value: summary.total, tone: "text-foreground" },
    { label: "Awaiting review", value: summary.pending, tone: "text-amber-600" },
    { label: "Approved", value: summary.approved, tone: "text-emerald-600" },
    { label: "Reimbursed", value: summary.reimbursed, tone: "text-blue-600" },
  ];

  const queueBadge = (q: ReviewQueue): number | null => {
    if (q === "with_me") return withMe.length;
    if (q === "final") return finalQueue.length;
    return null;
  };

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
        {REVIEW_QUEUES.map((q) => {
          const count = queueBadge(q);
          return (
            <button
              key={q}
              onClick={() => setQueue(q)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                queue === q ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {QUEUE_LABEL[q]}
              {count != null && count > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <PageLoader />
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-card card-shadow p-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {queue === "with_me" ? "No claims are waiting on you." : "No expense claims in this queue."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-card card-shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Proof</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const l1 = canL1(r, user?.id, canApproveL1);
                const l2 = canL2(r, canApproveL2);
                const zoho = canSendToZoho(r, canApproveL2);
                const pay = canReimburse(r, canPay);
                const busy = busyId === r.id || syncingId === r.id;
                const proofs = proofTotal(r);
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-foreground">{r.employee_name || "Unnamed"}</div>
                      {r.employee_number && (
                        <div className="text-xs text-muted-foreground">{r.employee_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[300px] align-top">
                      <div className="font-medium text-foreground truncate">{r.title}</div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground truncate">{r.description}</div>
                      )}
                      {needsCorrection(r) && r.correction_note && (
                        <div className="mt-1 text-xs text-amber-700">
                          <span className="font-medium">Correction:</span> {r.correction_note}
                        </div>
                      )}
                      {r.status === "rejected" && r.rejection_reason && (
                        <div className="mt-1 text-xs text-destructive">
                          <span className="font-medium">Reason:</span> {r.rejection_reason}
                        </div>
                      )}
                      {r.l1_note && r.status !== "changes_requested" && r.status !== "rejected" && (
                        <div className="text-xs text-muted-foreground truncate">L1: {r.l1_note}</div>
                      )}
                      {r.l2_note && <div className="text-xs text-muted-foreground truncate">L2: {r.l2_note}</div>}
                      {r.zoho_bill_number && (
                        <div className="mt-1">
                          <Badge className="bg-pastel-green text-foreground/80 border-0 text-[10px]">
                            Zoho {r.zoho_bill_number}
                          </Badge>
                        </div>
                      )}
                      {r.zoho_sync_error && (
                        <div className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="truncate">Zoho error: {r.zoho_sync_error}</span>
                        </div>
                      )}
                      {r.status === "reimbursed" && r.reimbursement_mode && (
                        <div className="text-xs text-muted-foreground truncate">
                          {reimbursementLabel(r.reimbursement_mode)}
                          {r.reimbursed_at ? ` · ${shortDate(r.reimbursed_at)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top">{r.category_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top">{r.expense_date}</td>
                    <td className="px-4 py-3 text-center align-top">
                      <button
                        onClick={() => openProof(r)}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        title="View proofs"
                      >
                        <Paperclip className="h-3 w-3" /> {proofs}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground align-top">₹{formatInr(r.amount)}</td>
                    <td className="px-4 py-3 align-top">
                      <Badge className={`capitalize ${statusBadge(r.status)}`}>{statusLabel(r.status)}</Badge>
                      {l2 && (
                        <div className="mt-1 text-[10px] font-medium text-amber-600">Needs final approval</div>
                      )}
                      {l1 && <div className="mt-1 text-[10px] font-medium text-amber-600">With you (L1)</div>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {(l1 || l2) && (
                          <>
                            <button
                              onClick={() => decide(r, "approve", null)}
                              disabled={busy}
                              className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => { setCorrecting(r); setCorrectionNote(""); }}
                              disabled={busy}
                              className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <Ban className="h-3 w-3" /> Send for correction
                            </button>
                            <button
                              onClick={() => { setRejecting(r); setRejectReason(""); }}
                              disabled={busy}
                              className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-muted disabled:opacity-50"
                            >
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {zoho && (
                          <button
                            onClick={() => sendToZoho(r)}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {r.zoho_sync_error
                              ? <RefreshCw className="h-3 w-3" />
                              : <Send className="h-3 w-3" />}
                            {r.zoho_sync_error ? "Retry sync" : "Send to Zoho"}
                          </button>
                        )}
                        {pay && (
                          <button
                            onClick={() => { setReimbursing(r); setReimburseMode("payroll"); }}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <BadgeCheck className="h-3 w-3" /> Mark reimbursed
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Send for correction */}
      <Dialog open={!!correcting} onOpenChange={(open) => { if (!open) setCorrecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send for correction</DialogTitle>
            <DialogDescription>
              {correcting ? `${correcting.employee_name || "Employee"} · ${correcting.title} · ₹${formatInr(correcting.amount)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={correctionNote}
            onChange={(e) => setCorrectionNote(e.target.value)}
            placeholder="What needs to be fixed? The employee will see this and resubmit."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCorrecting(null)}>Cancel</Button>
            <Button size="sm" onClick={submitCorrection} disabled={busyId === correcting?.id}>
              Send for correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject expense claim</DialogTitle>
            <DialogDescription>
              {rejecting ? `${rejecting.employee_name || "Employee"} · ${rejecting.title} · ₹${formatInr(rejecting.amount)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
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

      {/* Vendor choice — the edge function found existing Zoho vendors by phone */}
      <Dialog open={!!vendorChoice} onOpenChange={(open) => { if (!open) setVendorChoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Match the employee to a Zoho vendor</DialogTitle>
            <DialogDescription>
              {vendorChoice ? `More than one Zoho vendor matched ${vendorChoice.row.employee_name || "this employee"}. Pick the right one, or create a new vendor.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {(vendorChoice?.candidates ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No matching vendors found.</p>
            )}
            {(vendorChoice?.candidates ?? []).map((c, i) => (
              <button
                key={(c.contact_id as string) || i}
                onClick={() => vendorChoice && sendToZoho(vendorChoice.row, { vendorId: c.contact_id as string })}
                disabled={!!syncingId}
                className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium text-foreground">{c.contact_name || "Unnamed vendor"}</span>
                {typeof c.email === "string" && <span className="block text-xs text-muted-foreground">{c.email}</span>}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVendorChoice(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!!syncingId}
              onClick={() => vendorChoice && sendToZoho(vendorChoice.row, { forceCreate: true })}
            >
              Create new vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark reimbursed */}
      <Dialog open={!!reimbursing} onOpenChange={(open) => { if (!open) setReimbursing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark reimbursed</DialogTitle>
            <DialogDescription>
              {reimbursing ? `${reimbursing.employee_name || "Employee"} · ${reimbursing.title} · ₹${formatInr(reimbursing.amount)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reimbursement mode</p>
            {REIMBURSEMENT_MODES.map((mode) => {
              const disabled = mode === "zoho" && !reimbursing?.zoho_bill_id;
              return (
                <label
                  key={mode}
                  className={`flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm ${
                    disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"
                  } ${reimburseMode === mode ? "ring-1 ring-ring/30" : ""}`}
                >
                  <input
                    type="radio"
                    name="reimburse-mode"
                    checked={reimburseMode === mode}
                    disabled={disabled}
                    onChange={() => setReimburseMode(mode)}
                  />
                  <span className="text-foreground">{reimbursementLabel(mode)}</span>
                  {mode === "zoho" && !reimbursing?.zoho_bill_id && (
                    <span className="text-[11px] text-muted-foreground">no Zoho bill yet</span>
                  )}
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReimbursing(null)}>Cancel</Button>
            <Button size="sm" onClick={markReimbursed} disabled={busyId === reimbursing?.id}>
              {busyId === reimbursing?.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Mark reimbursed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proof viewer */}
      <Dialog open={!!proofRow} onOpenChange={(open) => { if (!open) setProofRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proof of expense</DialogTitle>
            <DialogDescription>
              {proofRow ? `${proofRow.title} · ₹${formatInr(proofRow.amount)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {attachmentsLoading ? (
            <div className="py-6"><PageLoader /></div>
          ) : attachments.length === 0 ? (
            proofRow?.receipt_url ? (
              <a
                href={proofRow.receipt_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="h-4 w-4" /> Open receipt
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No proofs attached.</p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-3 max-h-[380px] overflow-y-auto">
              {attachments.map((a) => (
                <a
                  key={a.id}
                  href={a.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-lg border border-border overflow-hidden hover:border-primary/40"
                >
                  {isImage(a) ? (
                    <img src={a.file_url} alt={a.file_name || "Proof"} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 w-full items-center justify-center bg-muted">
                      <FileText className="h-7 w-7 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground">
                    {isImage(a) ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    <span className="truncate">{a.file_name || "Proof"}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProofRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
