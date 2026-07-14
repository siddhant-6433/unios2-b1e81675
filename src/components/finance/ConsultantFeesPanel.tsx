import { PageLoader } from "@/components/ui/page-loader";
// ConsultantFeesPanel — the consultant portal "Fees" tab. Lists the
// consultant's linked students whose course+session is enabled in
// consultant_fee_management (via the consultant_fee_students RPC — no direct
// consultant RLS on students/fee_ledger). Per student:
//   - "Hide fee details from student login" toggle (consultant_set_fee_visibility)
//   - Pay now — gateway checkout as payer (student_fee context; server computes due)
//   - Send payment link — custom amount (Phase 1 machinery)

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SendPaymentLinkDialog } from "./SendPaymentLinkDialog";
import { openRazorpayCheckout, buildRazorpayReceipt } from "@/lib/razorpayCheckout";
import { Loader2, RefreshCw, IndianRupee, Link as LinkIcon, EyeOff } from "lucide-react";

interface FeeStudent {
  student_id: string;
  name: string;
  admission_no: string | null;
  course_name: string | null;
  session_name: string | null;
  due_total: number;
  paid_total: number;
  hidden: boolean;
  config_enabled: boolean;
}

export function ConsultantFeesPanel() {
  const { toast } = useToast();
  const [students, setStudents] = useState<FeeStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payLinkStudent, setPayLinkStudent] = useState<FeeStudent | null>(null);

  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("consultant_fee_students" as any);
    setLoading(false);
    if (error) {
      toast({ title: "Could not load fee students", description: error.message, variant: "destructive" });
      return;
    }
    setStudents(((data as unknown as FeeStudent[]) || []));
  }, [toast]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const toggleHidden = async (s: FeeStudent) => {
    setBusyId(s.student_id);
    const { error } = await supabase.rpc("consultant_set_fee_visibility" as any, {
      _student_id: s.student_id,
      _hidden: !s.hidden,
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not update visibility", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: !s.hidden ? "Fee details hidden from student login" : "Fee details visible to student again",
    });
    fetchStudents();
  };

  const payNow = async (s: FeeStudent) => {
    if (s.due_total <= 0) {
      toast({ title: "No outstanding dues", description: "This student has nothing due right now." });
      return;
    }
    setBusyId(s.student_id);
    try {
      await openRazorpayCheckout({
        amountPaise: Math.round(s.due_total * 100), // server recomputes for student_fee
        receipt: buildRazorpayReceipt("cons", s.student_id),
        context: "student_fee",
        description: `Fee payment for ${s.name}`,
        customerName: s.name,
        studentId: s.student_id,
        paymentScope: "due",
      });
      toast({ title: "Payment successful", description: `Dues settled for ${s.name}.` });
      fetchStudents();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment failed";
      if (!/cancelled/i.test(msg)) {
        toast({ title: "Payment failed", description: msg, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
        <EyeOff className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          Students in your enabled course + session appear here. Hiding fee details removes the fee
          structure from the student&rsquo;s login — they still see receipts, their due amount, and a Pay
          button. You can pay on their behalf or send a custom-amount payment link.
        </div>
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-sm font-semibold text-foreground">Fee-managed students ({students.length})</h3>
            <button onClick={fetchStudents} className="text-muted-foreground hover:text-foreground" title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {loading ? (
            <PageLoader />
          ) : students.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No students in an enabled course/session yet. Ask the admissions office to enable fee management for your courses.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Paid</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Due</th>
                  <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Hide from student</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.student_id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.admission_no || "—"}{s.course_name ? ` · ${s.course_name}` : ""}{s.session_name ? ` · ${s.session_name}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-success">{fmt(s.paid_total)}</td>
                    <td className="px-4 py-3 text-right">{fmt(s.due_total)}</td>
                    <td className="px-4 py-3 text-center">
                      <Switch
                        checked={s.hidden}
                        disabled={busyId === s.student_id || !s.config_enabled}
                        onCheckedChange={() => toggleHidden(s)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => payNow(s)} disabled={busyId === s.student_id}>
                          {busyId === s.student_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <IndianRupee className="h-3.5 w-3.5" />}
                          Pay now
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setPayLinkStudent(s)}>
                          <LinkIcon className="h-3.5 w-3.5" /> Send link
                        </Button>
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

      {payLinkStudent && (
        <SendPaymentLinkDialog
          open={!!payLinkStudent}
          onOpenChange={(open) => !open && setPayLinkStudent(null)}
          studentId={payLinkStudent.student_id}
          defaultAmount={payLinkStudent.due_total > 0 ? Math.round(payLinkStudent.due_total) : null}
          defaultPurpose="fee_due"
          onCreated={fetchStudents}
        />
      )}
    </div>
  );
}
