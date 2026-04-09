import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Wand2, Plus, HandCoins, Check, Clock, AlertTriangle, Trash2,
} from "lucide-react";
import { ConcessionDialog } from "./ConcessionDialog";

interface StudentFeePanelProps {
  student: any;
  onRefresh?: () => void;
}

const feeStatusBg: Record<string, string> = {
  paid: "bg-success/10 text-success",
  due: "bg-warning/10 text-warning",
  overdue: "bg-destructive/10 text-destructive",
};

export function StudentFeePanel({ student, onRefresh }: StudentFeePanelProps) {
  const { role, session } = useAuth();
  const { toast } = useToast();
  const [fees, setFees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [concessionOpen, setConcessionOpen] = useState(false);
  const [selectedFeeItems, setSelectedFeeItems] = useState<string[]>([]);

  const isFinanceRole = ["super_admin", "campus_admin", "principal", "accountant"].includes(role || "");
  const canProvision = isFinanceRole;
  const canRequestConcession = ["counsellor", "super_admin", "campus_admin", "accountant"].includes(role || "");

  useEffect(() => {
    if (student?.id) fetchFees();
  }, [student?.id]);

  const fetchFees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("fee_ledger")
      .select("*, fee_codes:fee_code_id(code, name, category)")
      .eq("student_id", student.id)
      .order("due_date");
    if (data) setFees(data);
    setLoading(false);
  };

  const handleProvision = async (force = false) => {
    setProvisioning(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-student-fees", {
        body: { student_id: student.id, force_reprovision: force },
      });

      if (error) {
        // FunctionsHttpError stores the parsed response body in .data
        const errBody = (error as any).data;
        let detail = error.message;
        if (errBody) {
          detail = typeof errBody === "string" ? errBody : errBody?.error || errBody?.message || JSON.stringify(errBody);
        }
        console.error("provision-student-fees error:", { error, errBody, data });
        toast({ title: "Provisioning failed", description: detail, variant: "destructive" });
      } else if (data?.error) {
        // Function returned 200 but with an error field
        toast({ title: "Provisioning failed", description: data.error, variant: "destructive" });
      } else {
        const result = data?.results?.[0];
        if (result?.status === "error") {
          toast({ title: "Provisioning failed", description: result.error, variant: "destructive" });
        } else {
          toast({ title: "Fees provisioned", description: `${result?.items_created || 0} fee items created` });
          fetchFees();
          onRefresh?.();
        }
      }
    } catch (e: any) {
      console.error("provision-student-fees exception:", e);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setProvisioning(false);
  };

  const handleRemoveUnpaid = async (feeId: string) => {
    const { error } = await supabase
      .from("fee_ledger")
      .delete()
      .eq("id", feeId)
      .eq("paid_amount", 0);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Removed" });
      fetchFees();
    }
  };

  const totalFee = fees.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const totalPaid = fees.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const totalConcession = fees.reduce((s, f) => s + Number(f.concession || 0), 0);
  const totalBalance = fees.reduce((s, f) => s + Number(f.balance || 0), 0);

  if (loading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Student profile badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="capitalize">{student.student_type?.replace("_", " ") || "Day Scholar"}</Badge>
        {student.transport_zone && (
          <Badge className="bg-pastel-yellow text-foreground/70 border-0">
            Transport: {student.transport_zone.replace("_", " ").replace("zone ", "Zone ")}
          </Badge>
        )}
        {student.hostel_type && (
          <Badge className="bg-pastel-mint text-foreground/70 border-0">
            Hostel: {student.hostel_type === "ac_central" ? "AC C Block" : student.hostel_type === "ac_individual" ? "AC B Block" : "Non-AC"}
          </Badge>
        )}
        {student.fee_structure_version && (
          <Badge className={student.fee_structure_version === "existing_parent" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-blue-100 text-blue-700 border-blue-200"}>
            {student.fee_structure_version === "existing_parent" ? "Existing Parent" : "New Admission"}
          </Badge>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {canProvision && (
          <>
            <Button size="sm" onClick={() => handleProvision(false)} disabled={provisioning} className="gap-1.5">
              {provisioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Auto-Assign Fees
            </Button>
            {fees.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => handleProvision(true)} disabled={provisioning} className="gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Re-provision (clear unpaid)
              </Button>
            )}
          </>
        )}
        {canRequestConcession && fees.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setConcessionOpen(true)} className="gap-1.5">
            <HandCoins className="h-3.5 w-3.5" /> Request Concession
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Fee" value={totalFee} color="bg-chart-5/10 text-chart-5" />
        <SummaryCard label="Paid" value={totalPaid} color="bg-success/10 text-success" />
        <SummaryCard label="Concession" value={totalConcession} color="bg-pastel-purple text-foreground/70" />
        <SummaryCard label="Balance" value={totalBalance} color={totalBalance > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"} />
      </div>

      {/* Fee table */}
      <div className="rounded-xl bg-card card-shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">Fee Code</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Term</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Total</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Concession</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Paid</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Balance</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Due Date</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              {isFinanceRole && <th className="px-4 py-3 font-medium text-muted-foreground w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {fees.length === 0 ? (
              <tr>
                <td colSpan={isFinanceRole ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                  No fee records found. {canProvision && "Click 'Auto-Assign Fees' to provision."}
                </td>
              </tr>
            ) : fees.map((f: any) => (
              <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-medium text-foreground">{f.fee_codes?.code || "—"}</span>
                  <span className="block text-[10px] text-muted-foreground">{f.fee_codes?.name}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{f.term}</td>
                <td className="px-4 py-3 text-right text-foreground">₹{Number(f.total_amount).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {Number(f.concession) > 0 ? `₹${Number(f.concession).toLocaleString("en-IN")}` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-foreground">₹{Number(f.paid_amount).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">₹{Number(f.balance || 0).toLocaleString("en-IN")}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {f.due_date ? new Date(f.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${feeStatusBg[f.status] || "bg-muted"}`}>
                    {f.status === "paid" && <Check className="h-3 w-3" />}
                    {f.status === "due" && <Clock className="h-3 w-3" />}
                    {f.status === "overdue" && <AlertTriangle className="h-3 w-3" />}
                    {f.status}
                  </span>
                </td>
                {isFinanceRole && (
                  <td className="px-4 py-3">
                    {Number(f.paid_amount) === 0 && (
                      <button
                        onClick={() => handleRemoveUnpaid(f.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove unpaid item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConcessionDialog
        open={concessionOpen}
        onOpenChange={setConcessionOpen}
        studentId={student.id}
        feeItems={fees}
        onSuccess={() => { fetchFees(); onRefresh?.(); }}
      />
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <span className="text-xs font-bold">₹</span>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">₹{value.toLocaleString("en-IN")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
