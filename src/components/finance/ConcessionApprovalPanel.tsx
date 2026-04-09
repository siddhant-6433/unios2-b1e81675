import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, Clock, HandCoins } from "lucide-react";

const statusBadge: Record<string, string> = {
  pending_principal: "bg-amber-100 text-amber-700",
  pending_super_admin: "bg-blue-100 text-blue-700",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

export function ConcessionApprovalPanel() {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const [concessions, setConcessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const isPrincipal = role === "principal";
  const isSuperAdmin = role === "super_admin";

  useEffect(() => { fetchConcessions(); }, []);

  const fetchConcessions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("concessions")
      .select(`
        *,
        students:student_id(name, admission_no, pre_admission_no),
        fee_ledger:fee_ledger_id(term, total_amount, fee_codes:fee_code_id(code, name)),
        requester:requested_by(display_name),
        approver:approved_by(display_name)
      `)
      .order("created_at", { ascending: false });
    if (data) setConcessions(data);
    setLoading(false);
  };

  const handleApprove = async (concession: any) => {
    setProcessing(concession.id);

    if (isPrincipal && concession.status === "pending_principal") {
      // Principal approves → move to pending_super_admin
      const { error } = await supabase
        .from("concessions")
        .update({
          status: "pending_super_admin",
          approved_by_principal: user?.id,
          principal_decision_at: new Date().toISOString(),
        } as any)
        .eq("id", concession.id);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Forwarded to super admin" });
        fetchConcessions();
      }
    } else if (isSuperAdmin && (concession.status === "pending_super_admin" || concession.status === "pending_principal")) {
      // Super admin final approval → update fee_ledger concession
      // Get profiles.id for approved_by FK
      let profileId: string | null = null;
      if (user?.id) {
        const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
        profileId = p?.id || null;
      }
      const { error } = await supabase
        .from("concessions")
        .update({
          status: "approved",
          approved_by: profileId,
          approved_by_super_admin: user?.id,
          super_admin_decision_at: new Date().toISOString(),
          // If skipping principal level
          ...(concession.status === "pending_principal" ? {
            approved_by_principal: user?.id,
            principal_decision_at: new Date().toISOString(),
          } : {}),
        } as any)
        .eq("id", concession.id);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        // Apply concession to fee_ledger
        if (concession.fee_ledger_id) {
          const feeItem = concession.fee_ledger;
          const totalAmount = Number(feeItem?.total_amount || 0);
          const concessionAmount = concession.type === "flat"
            ? Number(concession.value)
            : Math.round((totalAmount * Number(concession.value)) / 100);

          // Fetch current fee ledger to get paid_amount
          const { data: currentFee } = await supabase
            .from("fee_ledger")
            .select("paid_amount, total_amount")
            .eq("id", concession.fee_ledger_id)
            .single();

          if (currentFee) {
            // Only update concession — balance is auto-generated (total - concession - paid)
            await supabase
              .from("fee_ledger")
              .update({ concession: concessionAmount } as any)
              .eq("id", concession.fee_ledger_id);
          }
        }
        toast({ title: "Concession approved and applied" });
        fetchConcessions();
      }
    }

    setProcessing(null);
  };

  const handleReject = async (concessionId: string) => {
    setProcessing(concessionId);
    const { error } = await supabase
      .from("concessions")
      .update({
        status: "rejected",
        ...(isPrincipal ? {
          approved_by_principal: user?.id,
          principal_decision_at: new Date().toISOString(),
        } : {
          approved_by_super_admin: user?.id,
          super_admin_decision_at: new Date().toISOString(),
        }),
      } as any)
      .eq("id", concessionId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Concession rejected" });
      fetchConcessions();
    }
    setProcessing(null);
  };

  // Filter based on role
  const visible = concessions.filter(c => {
    if (isSuperAdmin) return true; // sees all
    if (isPrincipal) return c.status === "pending_principal" || c.status === "pending_super_admin" || c.status === "approved" || c.status === "rejected";
    return true;
  });

  const pending = visible.filter(c =>
    (isPrincipal && c.status === "pending_principal") ||
    (isSuperAdmin && (c.status === "pending_super_admin" || c.status === "pending_principal"))
  );

  if (loading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HandCoins className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Concession Requests</h3>
        </div>
        {pending.length > 0 && (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200">{pending.length} pending</Badge>
        )}
      </div>

      {visible.length === 0 ? (
        <Card className="border-border/60 shadow-none">
          <CardContent className="py-12 text-center text-muted-foreground">
            No concession requests found
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Term</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fee Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Concession</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requested By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c: any) => {
                  const canAct = (isPrincipal && c.status === "pending_principal") ||
                    (isSuperAdmin && (c.status === "pending_super_admin" || c.status === "pending_principal"));
                  const admNo = c.students?.admission_no || c.students?.pre_admission_no || "—";

                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{c.students?.name || "—"}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{admNo}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.fee_ledger?.fee_codes?.code || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.fee_ledger?.term || "—"}</td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {c.fee_ledger?.total_amount ? `₹${Number(c.fee_ledger.total_amount).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">
                          {c.type === "flat" ? `₹${Number(c.value).toLocaleString("en-IN")}` : `${c.value}%`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate" title={c.reason}>
                        {c.reason || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{c.requester?.display_name || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-[10px] font-medium border-0 capitalize ${statusBadge[c.status] || "bg-muted"}`}>
                          {c.status.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {canAct ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-success hover:text-success hover:bg-success/10"
                              disabled={processing === c.id}
                              onClick={() => handleApprove(c)}
                            >
                              {processing === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={processing === c.id}
                              onClick={() => handleReject(c.id)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
