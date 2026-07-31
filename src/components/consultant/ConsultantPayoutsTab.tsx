import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Printer, AlertTriangle } from "lucide-react";

type PayoutRow = {
  payout_id: string;
  consultant_id: string;
  consultant_name: string;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  bank_upi: string | null;
  candidate_name: string;
  admission_no: string | null;
  course_name: string | null;
  student_fee_paid: number;
  payout_amount: number;
  fee_paid_pct: number;
  status: string;
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string | null | undefined) =>
  String(s ?? "—").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Only unpaid payouts are payable. paid/cancelled are excluded from the sheet.
const PAYABLE = ["pending", "approved"];

export const ConsultantPayoutsTab = () => {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase.from("consultant_payout_sheet" as any) as any)
        .select("*")
        .in("status", PAYABLE)
        .order("consultant_name", { ascending: true });
      setRows((data || []) as PayoutRow[]);
      setLoading(false);
    })();
  }, []);

  // Group payable rows by consultant.
  const groups = useMemo(() => {
    const map = new Map<string, PayoutRow[]>();
    for (const r of rows) map.set(r.consultant_id, [...(map.get(r.consultant_id) || []), r]);
    return [...map.values()];
  }, [rows]);

  const grandTotal = rows.reduce((t, r) => t + Number(r.payout_amount), 0);

  const printSheet = () => {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const sections = groups.map(g => {
      const c = g[0];
      const subtotal = g.reduce((t, r) => t + Number(r.payout_amount), 0);
      const bank = c.bank_account_number
        ? `A/C Name: <b>${esc(c.bank_account_name)}</b> &nbsp; A/C No: <b>${esc(c.bank_account_number)}</b> &nbsp; IFSC: <b>${esc(c.bank_ifsc)}</b> &nbsp; Bank: <b>${esc(c.bank_name)}</b>${c.bank_upi ? ` &nbsp; UPI: <b>${esc(c.bank_upi)}</b>` : ""}`
        : `<span class="warn">⚠ No bank details on file — add them in the consultant's onboarding before paying.</span>`;
      const trs = g.map(r => `
        <tr>
          <td>${esc(r.candidate_name)}</td>
          <td>${esc(r.admission_no)}</td>
          <td>${esc(r.course_name)}</td>
          <td class="num">${inr(Number(r.student_fee_paid))} (${Number(r.fee_paid_pct)}%)</td>
          <td class="num">${inr(Number(r.payout_amount))}</td>
        </tr>`).join("");
      return `
        <div class="consultant">
          <h2>${esc(c.consultant_name)}</h2>
          <p class="bank">${bank}</p>
          <table>
            <thead><tr><th>Candidate</th><th>Admission No.</th><th>Course</th><th class="num">Fee Paid</th><th class="num">Payout</th></tr></thead>
            <tbody>${trs}</tbody>
            <tfoot><tr><td colspan="4">Subtotal — ${esc(c.consultant_name)}</td><td class="num">${inr(subtotal)}</td></tr></tfoot>
          </table>
        </div>`;
    }).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Consultant Payout Sheet</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 32px; font-size: 12px; }
        header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
        header h1 { font-size: 18px; margin: 0; }
        header .meta { font-size: 11px; color: #555; }
        .consultant { margin-bottom: 22px; page-break-inside: avoid; }
        .consultant h2 { font-size: 14px; margin: 0 0 2px; }
        .bank { font-size: 10.5px; color: #333; margin: 0 0 8px; }
        .warn { color: #b45309; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
        th { background: #f3f4f6; font-size: 10.5px; text-transform: uppercase; letter-spacing: .02em; }
        .num { text-align: right; white-space: nowrap; }
        tfoot td { font-weight: 700; background: #fafafa; }
        .grand { margin-top: 8px; text-align: right; font-size: 14px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; }
        .sign { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; color: #555; }
        @media print { body { margin: 12mm; } }
      </style></head><body>
      <header>
        <h1>Consultant Payout Sheet</h1>
        <div class="meta">Generated ${today} &nbsp;·&nbsp; ${groups.length} consultant(s) &nbsp;·&nbsp; ${rows.length} payout(s)</div>
      </header>
      ${sections || '<p>No payable payouts.</p>'}
      <div class="grand">Grand Total Payable: ${inr(grandTotal)}</div>
      <div class="sign"><span>Prepared by: ____________________</span><span>Approved by: ____________________</span><span>Accountant: ____________________</span></div>
      <script>window.onload = function(){ window.print(); }</script>
      </body></html>`;

    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-foreground font-medium">Payable payouts</p>
          <p className="text-xs text-muted-foreground">{rows.length} payout(s) across {groups.length} consultant(s) · Grand total {inr(grandTotal)}</p>
        </div>
        <Button onClick={printSheet} disabled={rows.length === 0} className="gap-2"><Printer className="h-4 w-4" />Print Payout Sheet</Button>
      </div>

      {groups.map(g => {
        const c = g[0];
        const subtotal = g.reduce((t, r) => t + Number(r.payout_amount), 0);
        const missingBank = !c.bank_account_number;
        return (
          <Card key={c.consultant_id} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{c.consultant_name}</h3>
                  {missingBank && (
                    <Badge className="gap-1 border-0 bg-warning/15 text-warning text-[10px]">
                      <AlertTriangle className="h-3 w-3" />No bank details
                    </Badge>
                  )}
                </div>
                <span className="text-sm font-medium tabular-nums">{inr(subtotal)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/40">
                      <th className="py-1.5 pr-3 font-medium">Candidate</th>
                      <th className="py-1.5 pr-3 font-medium">Admission No.</th>
                      <th className="py-1.5 pr-3 font-medium">Course</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Fee Paid</th>
                      <th className="py-1.5 font-medium text-right">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.map(r => (
                      <tr key={r.payout_id} className="border-b border-border/20 last:border-0">
                        <td className="py-1.5 pr-3 text-foreground">{r.candidate_name}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{r.admission_no || "—"}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{r.course_name || "—"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{inr(Number(r.student_fee_paid))} <span className="text-muted-foreground">({Number(r.fee_paid_pct)}%)</span></td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{inr(Number(r.payout_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {groups.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">No payable payouts. Payouts appear here once a consultant's lead pays fees.</div>
      )}
    </div>
  );
};
