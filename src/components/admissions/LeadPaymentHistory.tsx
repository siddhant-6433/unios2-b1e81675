import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  application_fee: "Application Fee",
  token_fee: "Token Fee",
  registration_fee: "Registration Fee",
  other: "Other",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque / DD",
  online: "Online",
  gateway: "Gateway",
};

const STATUS_BADGE: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  refunded: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

interface Payment {
  id: string;
  type: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  receipt_no: string | null;
  status: string;
  payment_date: string;
  notes: string | null;
}

interface LeadPaymentHistoryProps {
  leadId: string;
  refreshKey?: number;
}

export function LeadPaymentHistory({ leadId, refreshKey }: LeadPaymentHistoryProps) {
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lead_payments" as any)
        .select("*")
        .eq("lead_id", leadId)
        .order("payment_date", { ascending: false });
      if (data) setPayments(data as any);
    })();
  }, [leadId, refreshKey]);

  if (payments.length === 0) return null;

  const total = payments
    .filter((p) => p.status === "confirmed")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payments</h3>
          <span className="text-sm font-bold text-primary flex items-center gap-0.5">
            <IndianRupee className="h-3 w-3" />
            {total.toLocaleString("en-IN")}
          </span>
        </div>

        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{TYPE_LABELS[p.type] || p.type}</span>
                  <Badge className={`text-[9px] font-semibold border-0 ${STATUS_BADGE[p.status] || "bg-muted"}`}>
                    {p.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{MODE_LABELS[p.payment_mode] || p.payment_mode}</span>
                  {p.transaction_ref && (
                    <span className="text-[10px] text-muted-foreground font-mono">Ref: {p.transaction_ref}</span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(p.payment_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>
              <span className="text-sm font-semibold text-foreground whitespace-nowrap flex items-center gap-0.5">
                <IndianRupee className="h-3 w-3" />
                {Number(p.amount).toLocaleString("en-IN")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
