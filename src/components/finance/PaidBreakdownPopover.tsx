// Breakup behind the Paid cell of a fee row: which payments settled this head,
// when, under which receipt, and the receipt PDF.
//
// Reads fee_ledger_payments — the link rows written when a payment is applied
// to a head. Those links can be missing while fee_ledger.paid_amount is still
// correct: the edge-function provisioning path credits the ledger without
// always writing one. So when the links don't add up to paid_amount we say so
// rather than rendering a breakup that quietly understates what was paid.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, Loader2, FileText } from "lucide-react";

interface Props {
  /** fee_ledger row id */
  feeLedgerId: string;
  /** fee_ledger.paid_amount — the authoritative total for this head */
  paidAmount: number;
}

interface PaidLine {
  amount: number;
  payment_date: string | null;
  receipt_no: string | null;
  receipt_url: string | null;
  payment_mode: string | null;
  transaction_ref: string | null;
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

export function PaidBreakdownPopover({ feeLedgerId, paidAmount }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<PaidLine[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("fee_ledger_payments")
        .select("amount, lead_payments:lead_payment_id(payment_date, receipt_no, receipt_url, payment_mode, transaction_ref)")
        .eq("fee_ledger_id", feeLedgerId);
      if (cancelled) return;
      setLines(
        ((data || []) as any[])
          .map((row) => ({
            amount: Number(row.amount || 0),
            payment_date: row.lead_payments?.payment_date ?? null,
            receipt_no: row.lead_payments?.receipt_no ?? null,
            receipt_url: row.lead_payments?.receipt_url ?? null,
            payment_mode: row.lead_payments?.payment_mode ?? null,
            transaction_ref: row.lead_payments?.transaction_ref ?? null,
          }))
          .sort((a, b) => (a.payment_date || "").localeCompare(b.payment_date || "")),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, feeLedgerId]);

  const linked = lines.reduce((s, l) => s + l.amount, 0);
  const unlinked = Math.round((paidAmount - linked) * 100) / 100;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-primary focus-visible:text-primary"
          title="Payment breakup for this head"
          aria-label="Payment breakup for this head"
          onMouseEnter={() => setOpen(true)}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-foreground">Paid {money(paidAmount)}</p>
          {lines.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {lines.length} payment{lines.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {!loading && lines.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-input">
            {lines.map((line, i) => (
              <div key={`${line.receipt_no || "r"}-${i}`} className="space-y-0.5 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{shortDate(line.payment_date)}</span>
                  <span className="text-xs font-semibold tabular-nums text-foreground">{money(line.amount)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-muted-foreground">
                    {line.receipt_no ? `Receipt ${line.receipt_no}` : "No receipt no."}
                    {line.payment_mode ? ` · ${line.payment_mode}` : ""}
                  </span>
                  {line.receipt_url ? (
                    <a
                      href={line.receipt_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3" /> PDF
                    </a>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">No PDF</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Honest about the gap instead of showing a short breakup as if complete. */}
        {!loading && unlinked > 0.009 && (
          <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-[10px] text-muted-foreground">
            {money(unlinked)} of this head has no payment record linked to it — credited to the
            ledger without a receipt link. Check the student's payments list.
          </p>
        )}

        {!loading && lines.length === 0 && unlinked <= 0.009 && (
          <p className="py-2 text-[11px] text-muted-foreground">No payments recorded against this head.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
