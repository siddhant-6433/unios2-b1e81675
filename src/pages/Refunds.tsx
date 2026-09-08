import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BankCopyPopover } from "@/components/bank/BankCopyPopover";
import { CheckCircle, XCircle, IndianRupee, Building2, Wallet, Upload, Copy } from "lucide-react";

type RefundRow = {
  id: string;
  student_id: string;
  total_amount: number;
  reason: string;
  status: "draft" | "approved" | "paid" | "rejected";
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  bank_upi: string | null;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  payment_mode: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  payment_proof_url: string | null;
  zoho_bill_id: string | null;
  zoho_bill_number: string | null;
  zoho_payment_id: string | null;
  zoho_synced_at: string | null;
  zoho_sync_error: string | null;
  students: { name: string; admission_no: string } | null;
};

const STATUS: Record<string, { label: string; color: string }> = {
  draft:    { label: "Draft",    color: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", color: "bg-info/10 text-info-foreground" },
  paid:     { label: "Paid",     color: "bg-success/10 text-success" },
  rejected: { label: "Rejected", color: "bg-destructive/10 text-destructive" },
};

const FILTERS: { value: string; label: string }[] = [
  { value: "all",      label: "All" },
  { value: "draft",    label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "paid",     label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

const PAYMENT_MODES = ["bank_transfer", "upi", "cheque", "cash", "other"] as const;
const MODE_LABEL: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "proof";

function refundPaidDate(r: RefundRow) {
  const raw = r.payment_date || r.paid_at;
  return raw ? new Date(raw).toLocaleDateString("en-IN") : "";
}

/** WhatsApp-ready proof line the accountant can paste to the candidate. */
function refundUtrShareText(r: RefundRow) {
  const amount = `₹${Number(r.total_amount).toLocaleString("en-IN")}`;
  const date = refundPaidDate(r);
  return `Refund of ${amount} has been processed${date ? ` on ${date}` : ""}. UTR: ${r.payment_reference}.`;
}

export default function Refunds({ embedded = false }: { embedded?: boolean }) {
  const { role, hasPermission } = useAuth();
  const { toast } = useToast();
  const canRefund = hasPermission("finance:refund") || ["super_admin", "accountant"].includes(role || "");
  const canApprove = role === "super_admin";
  const canPay = canRefund;

  const [filter, setFilter] = useState("approved");
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<RefundRow | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("fee_refunds")
      .select("*, students(name, admission_no)")
      .order("created_at", { ascending: false });
    setRows((data as RefundRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (canRefund) fetchAll(); }, [canRefund]);

  const filtered = useMemo(
    () => filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );

  const handleApprove = async (r: RefundRow) => {
    setActing(r.id);
    const { error } = await (supabase.rpc as any)("approve_fee_refund", { _refund_id: r.id });
    if (error) toast({ title: "Approve failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Refund approved" }); fetchAll(); }
    setActing(null);
  };

  const handleReject = async (r: RefundRow) => {
    if (!window.confirm("Reject this refund?")) return;
    setActing(r.id);
    const { error } = await (supabase.rpc as any)("reject_fee_refund", { _refund_id: r.id });
    if (error) toast({ title: "Reject failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Refund rejected" }); fetchAll(); }
    setActing(null);
  };

  const handleZoho = async (r: RefundRow, action: "create_bill" | "record_payment") => {
    setSyncing(r.id);
    const { data, error } = await supabase.functions.invoke("zoho-refund-sync", { body: { action, refund_id: r.id } });
    setSyncing(null);
    const res = data as { error?: string } | null;
    const errMsg = error?.message || res?.error;
    if (errMsg) { toast({ title: "Zoho sync failed", description: errMsg, variant: "destructive" }); return; }
    toast({ title: action === "create_bill" ? "Bill created in Zoho" : "Payment recorded in Zoho" });
    fetchAll();
  };

  if (!canRefund) return <Navigate to="/forbidden" replace />;
  if (loading) return <PageLoader />;

  const totalForFilter = filtered.reduce((s, r) => s + Number(r.total_amount), 0);

  return (
    <div className={embedded ? "space-y-4" : "space-y-6 animate-fade-in"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Refunds</h1>
          <p className="text-sm text-muted-foreground mt-1">Approve, pay out, and record bank transaction details</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {embedded && (
          <p className="text-sm text-muted-foreground">
            {canApprove ? "Approve drafts, then record the bank payout." : "Record payouts that have already been made and attach the UTR / proof."}
          </p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFilter(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-4 flex items-center gap-6">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total ({FILTERS.find(f => f.value === filter)?.label})</p>
            <p className="text-2xl font-bold flex items-center gap-1"><IndianRupee className="h-5 w-5" />{totalForFilter.toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Refunds</p>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No refunds in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Student</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Reason</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Payment</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-foreground">{r.students?.name || "—"}</span>
                        <span className="block text-[10px] text-muted-foreground">{r.students?.admission_no || ""}</span>
                      </td>
                      <td className="px-3 py-3 max-w-[280px] truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</td>
                      <td className="px-3 py-3 text-right font-semibold">₹{Number(r.total_amount).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <Badge className={`border-0 text-[10px] font-semibold ${STATUS[r.status].color}`}>{STATUS[r.status].label}</Badge>
                          {r.zoho_bill_id && (
                            <Badge className="border-0 bg-primary/10 text-primary text-[9px] gap-0.5" title={r.zoho_synced_at ? `Synced ${new Date(r.zoho_synced_at).toLocaleString("en-IN")}` : ""}>
                              <Building2 className="h-2.5 w-2.5" />Zoho {r.zoho_bill_number || "✓"}
                            </Badge>
                          )}
                          {r.zoho_sync_error && <span className="text-[9px] text-destructive" title={r.zoho_sync_error}>Zoho error</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-muted-foreground">
                        <div>Created {new Date(r.created_at).toLocaleDateString("en-IN")}</div>
                        {r.approved_at && <div>Approved {new Date(r.approved_at).toLocaleDateString("en-IN")}</div>}
                        {r.paid_at && <div>Paid {refundPaidDate(r)}</div>}
                        {r.status === "paid" && (
                          r.payment_reference
                            ? <RefundUtrShare refund={r} />
                            : <div className="text-[10px] text-amber-700 dark:text-amber-400">No UTR — add details to share with the candidate</div>
                        )}
                        {r.payment_mode && <div>{MODE_LABEL[r.payment_mode] || r.payment_mode}</div>}
                        {r.payment_proof_url && (
                          <a href={r.payment_proof_url} target="_blank" rel="noopener" className="text-primary hover:underline">Proof</a>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center gap-1 justify-center flex-wrap">
                          <BankCopyPopover bank={{
                            accountName: r.bank_account_name, accountNumber: r.bank_account_number,
                            ifsc: r.bank_ifsc, bankName: r.bank_name, upi: r.bank_upi,
                          }} />
                          {r.status === "draft" && (
                            <>
                              {canApprove && (
                                <Button size="sm" className="gap-1 h-7 text-xs bg-info hover:bg-info/60" disabled={acting === r.id} onClick={() => handleApprove(r)}>
                                  {acting === r.id ? <ButtonOrb state="composing" onFilled /> : <CheckCircle className="h-3 w-3" />} Approve
                                </Button>
                              )}
                              {canApprove && (
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={acting === r.id} onClick={() => handleReject(r)}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              )}
                              {!canApprove && (
                                <span className="text-[10px] text-muted-foreground">Awaiting super admin approval</span>
                              )}
                            </>
                          )}
                          {r.status === "approved" && canPay && (
                            <>
                              <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90" onClick={() => setPayTarget(r)}>
                                <CheckCircle className="h-3 w-3" /> Mark Paid
                              </Button>
                              {canApprove && (
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={acting === r.id} onClick={() => handleReject(r)}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === r.id} onClick={() => handleZoho(r, "create_bill")} title={r.zoho_bill_id ? "Re-sync bill + vendor in Zoho" : "Create the bill in Zoho"}>
                                {syncing === r.id ? <ButtonOrb state="composing" /> : <Building2 className="h-3 w-3" />} {r.zoho_bill_id ? "Zoho: Resync" : "Zoho: Create Bill"}
                              </Button>
                            </>
                          )}
                          {r.status === "paid" && (
                            <>
                              {r.payment_reference && <RefundUtrShare refund={r} asButton />}
                              {canPay && (
                                <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setPayTarget(r)}>
                                  <Upload className="h-3 w-3" /> {r.payment_reference || r.payment_proof_url ? "Update details" : "Add details"}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === r.id} onClick={() => handleZoho(r, "create_bill")} title={r.zoho_bill_id ? "Re-sync bill + vendor in Zoho" : "Create the bill in Zoho"}>
                                {syncing === r.id ? <ButtonOrb state="composing" /> : <Building2 className="h-3 w-3" />} {r.zoho_bill_id ? "Zoho: Resync" : "Zoho: Create Bill"}
                              </Button>
                              {r.zoho_bill_id && !r.zoho_payment_id && (
                                <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === r.id} onClick={() => handleZoho(r, "record_payment")}>
                                  {syncing === r.id ? <ButtonOrb state="composing" /> : <Wallet className="h-3 w-3" />} Zoho: Record Payment
                                </Button>
                              )}
                              {r.zoho_payment_id && (
                                <span className="text-[10px] text-muted-foreground">Zoho settled</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {payTarget && (
        <RefundMarkPaidDialog
          refund={payTarget}
          onClose={() => setPayTarget(null)}
          onDone={() => { setPayTarget(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

function RefundUtrShare({ refund, asButton = false }: { refund: RefundRow; asButton?: boolean }) {
  const { toast } = useToast();
  const utr = refund.payment_reference || "";
  const copy = async () => {
    const text = refundUtrShareText(refund);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "UTR copied", description: "Share this with the candidate as proof the refund was processed." });
    } catch {
      toast({ title: "Copy failed", description: utr, variant: "destructive" });
    }
  };
  if (asButton) {
    return (
      <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={copy} title="Copy UTR to share with the candidate">
        <Copy className="h-3 w-3" /> Copy UTR
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-success hover:bg-success/20"
      title="Copy UTR to share with the candidate"
    >
      <Copy className="h-3 w-3 shrink-0" />
      <span className="truncate">UTR {utr}</span>
    </button>
  );
}

function RefundMarkPaidDialog({
  refund,
  onClose,
  onDone,
}: {
  refund: RefundRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const alreadyPaid = refund.status === "paid";
  const [mode, setMode] = useState(refund.payment_mode || "bank_transfer");
  const [reference, setReference] = useState(refund.payment_reference || "");
  const [date, setDate] = useState(refund.payment_date || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  const submit = async () => {
    if (!reference.trim()) {
      toast({ title: "Transaction reference is required", description: "Enter the UTR / UPI / cheque number so the payout can be reconciled.", variant: "destructive" });
      return;
    }
    setSaving(true);
    let proofUrl: string | null = refund.payment_proof_url;
    if (proof) {
      const ext = proof.name.split(".").pop() || "bin";
      const path = `refunds/${refund.student_id}/payment-${refund.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, proof, { contentType: proof.type || undefined, upsert: false });
      if (upErr) {
        toast({ title: "Proof upload failed", description: upErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      const { data: pub } = supabase.storage.from("application-documents").getPublicUrl(path);
      proofUrl = pub?.publicUrl || path;
    }
    const { error } = await (supabase.rpc as any)("mark_fee_refund_paid", {
      _refund_id: refund.id,
      _payment_mode: mode,
      _payment_reference: reference.trim(),
      _payment_date: date || null,
      _proof_url: proofUrl,
      _note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: alreadyPaid ? "Couldn't update details" : "Couldn't mark paid", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: alreadyPaid ? "Payment details updated" : "Refund marked paid" });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{alreadyPaid ? "Update payment details" : "Mark refund paid"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
            <div className="font-medium text-foreground">{refund.students?.name || "Student"}</div>
            <div className="text-muted-foreground">₹{Number(refund.total_amount).toLocaleString("en-IN")} · {refund.students?.admission_no || ""}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
                {PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Reference / UTR / Cheque no. *</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="e.g. UTR 402931..." />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Payment proof {refund.payment_proof_url ? "(replace)" : ""}
            </label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setProof(e.target.files?.[0] || null)}
              className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground"
            />
            {refund.payment_proof_url && !proof && (
              <a href={refund.payment_proof_url} target="_blank" rel="noopener" className="mt-1 inline-block text-[11px] text-primary hover:underline">
                Current proof
              </a>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving} className="gap-1.5">
              {saving ? <ButtonOrb state="solving" onFilled /> : alreadyPaid ? <Upload className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
              {alreadyPaid ? "Save details" : "Mark paid"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
