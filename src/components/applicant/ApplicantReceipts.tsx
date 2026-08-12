import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText } from "lucide-react";

// Confirmed fee-receipt list for the applicant dashboard. Split out of
// TokenFeePanel so receipts show regardless of offer state — TokenFeePanel
// early-returns when a lead has no approved offer, which was hiding all
// token/course-fee receipts from candidates who had already paid.
type Payment = {
  id: string;
  receipt_no: string | null;
  type: string;
  amount: number;
  concession_amount: number;
  status: string;
  payment_date: string | null;
  created_at: string;
  receipt_url: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  application_fee: "Application / Registration Fee",
  token_fee: "Token / Admission Fee",
  pre_admission_token: "Token / Admission Fee",
  registration_fee: "Registration Fee",
  other: "Course Fee",
};

const fmtAmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
const fmtDt = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function ApplicantReceipts({ leadId }: { leadId: string | null }) {
  const [confirmed, setConfirmed] = useState<Payment[]>([]);

  useEffect(() => {
    if (!leadId) { setConfirmed([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any).rpc("get_applicant_payments", { _lead_id: leadId });
      if (cancelled) return;
      setConfirmed(((data as Payment[]) || []).filter(p => p.status === "confirmed"));
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  if (confirmed.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3.5 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Receipts</span>
          <span className="text-xs text-gray-400">{confirmed.length} receipt{confirmed.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div className="divide-y divide-gray-50">
        {confirmed.map(p => (
          <div key={p.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">
                  {TYPE_LABELS[p.type] || p.type}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {p.receipt_no && (
                  <span className="text-[11px] font-mono text-gray-400">#{p.receipt_no}</span>
                )}
                <span className="text-[11px] text-gray-400">{fmtDt(p.payment_date || p.created_at)}</span>
                {p.concession_amount > 0 && (
                  <span className="text-[11px] text-success">· {fmtAmt(p.concession_amount)} waiver applied</span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-bold text-gray-900">{fmtAmt(p.amount)}</p>
              {p.receipt_url ? (
                <a
                  href={p.receipt_url} target="_blank" rel="noopener"
                  className="text-[11px] text-info-foreground hover:underline"
                >
                  Receipt ↗
                </a>
              ) : (
                <span className="text-[11px] text-gray-400">Generating…</span>
              )}
            </div>
          </div>
        ))}

        <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-500">Total Confirmed</span>
          <span className="text-sm font-bold text-gray-900">
            {fmtAmt(confirmed.reduce((s, p) => s + Number(p.amount), 0))}
          </span>
        </div>
      </div>
    </div>
  );
}
