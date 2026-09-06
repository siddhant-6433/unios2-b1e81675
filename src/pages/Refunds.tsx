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
import { CheckCircle, XCircle, IndianRupee, Building2, Wallet, Copy } from "lucide-react";

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

export default function Refunds() {
  const { role, hasPermission } = useAuth();
  const { toast } = useToast();
  const canRefund = hasPermission("finance:refund") || ["super_admin", "accountant"].includes(role || "");

  const [filter, setFilter] = useState("draft");
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

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

  const handleMarkPaid = async (r: RefundRow) => {
    setActing(r.id);
    const { error } = await (supabase.rpc as any)("mark_fee_refund_paid", { _refund_id: r.id });
    if (error) toast({ title: "Mark paid failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Refund marked paid" }); fetchAll(); }
    setActing(null);
  };

  // Zoho has no API to set a vendor's bank account, so give finance a one-click
  // copy to paste into Zoho → Vendor → Add Bank Account.
  const copyBank = async (r: RefundRow) => {
    const lines = [
      r.bank_account_name && `Account Holder: ${r.bank_account_name}`,
      r.bank_account_number && `Account Number: ${r.bank_account_number}`,
      r.bank_ifsc && `IFSC: ${r.bank_ifsc}`,
      r.bank_name && `Bank: ${r.bank_name}`,
      r.bank_upi && `UPI: ${r.bank_upi}`,
    ].filter(Boolean).join("\n");
    if (!lines) { toast({ title: "No bank details on this refund" }); return; }
    try {
      await navigator.clipboard.writeText(lines);
      toast({ title: "Bank details copied", description: "Paste into Zoho → Vendor → Add Bank Account." });
    } catch {
      toast({ title: "Copy failed", description: lines, variant: "destructive" });
    }
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Refunds</h1>
          <p className="text-sm text-muted-foreground mt-1">Approve, pay out, and sync student fee refunds to Zoho</p>
        </div>
        <div className="flex items-center gap-2">
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
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Timeline</th>
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
                        {r.paid_at && <div>Paid {new Date(r.paid_at).toLocaleDateString("en-IN")}</div>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          {r.bank_account_number && (
                            <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-xs" title="Copy payee bank details for Zoho" onClick={() => copyBank(r)}>
                              <Copy className="h-3 w-3" /> Bank
                            </Button>
                          )}
                          {r.status === "draft" && (
                            <>
                              <Button size="sm" className="gap-1 h-7 text-xs bg-info hover:bg-info/60" disabled={acting === r.id} onClick={() => handleApprove(r)}>
                                {acting === r.id ? <ButtonOrb state="composing" onFilled /> : <CheckCircle className="h-3 w-3" />} Approve
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={acting === r.id} onClick={() => handleReject(r)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                          {r.status === "approved" && (
                            <>
                              <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90" disabled={acting === r.id} onClick={() => handleMarkPaid(r)}>
                                {acting === r.id ? <ButtonOrb state="composing" onFilled /> : <CheckCircle className="h-3 w-3" />} Mark Paid
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={acting === r.id} onClick={() => handleReject(r)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                              {!r.zoho_bill_id && (
                                <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === r.id} onClick={() => handleZoho(r, "create_bill")}>
                                  {syncing === r.id ? <ButtonOrb state="composing" /> : <Building2 className="h-3 w-3" />} Zoho: Create Bill
                                </Button>
                              )}
                            </>
                          )}
                          {r.status === "paid" && !r.zoho_payment_id && r.zoho_bill_id && (
                            <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" disabled={syncing === r.id} onClick={() => handleZoho(r, "record_payment")}>
                              {syncing === r.id ? <ButtonOrb state="composing" /> : <Wallet className="h-3 w-3" />} Zoho: Record Payment
                            </Button>
                          )}
                          {r.status === "paid" && r.zoho_payment_id && (
                            <span className="text-[10px] text-muted-foreground">Zoho settled</span>
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
    </div>
  );
}
