// SendPaymentLinkDialog — create a custom-amount payment link for a lead or
// student and (optionally) send it to the candidate over WhatsApp/email.
//
// The amount is server-authoritative: the create-payment-link edge fn stores
// it and, when Razorpay is configured, mints a hosted Razorpay Payment Link.
// Surfaced from LeadDetail QuickActions, staff StudentFeePanel, and the
// consultant portal (AcademicPartnerPortal).

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { FeeHeadAllocationField, type FeeAllocation } from "./FeeHeadAllocationField";
import { Loader2, LinkIcon, Copy, Check } from "lucide-react";

type Purpose = "pre_admission_token" | "fee_due" | "custom";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId?: string | null;
  studentId?: string | null;
  /** Pre-fills the amount (e.g. current due) when opened from a fee panel. */
  defaultAmount?: number | null;
  /** Defaults the purpose. Pre-application surfaces should pass 'pre_admission_token'. */
  defaultPurpose?: Purpose;
  /**
   * A breakup already chosen elsewhere — the rows ticked in the fee table.
   * Each entry carries fee_ledger_id, so paying the link settles those exact
   * rows. Shown read-only; the picker is skipped.
   */
  defaultAllocations?: FeeAllocation[] | null;
  onCreated?: () => void;
}

// Two modes, deliberately. "Collect Fee" shows the whole fee structure with
// waivers applied and lets the cashier trim it; "Token Fee" is a free amount for
// candidates who have no ledger yet. The legacy 'custom' purpose is still
// accepted by the edge function but is no longer offered here — it was
// indistinguishable from a token fee in practice.
const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: "fee_due", label: "Collect Fee (from the fee structure)" },
  { value: "pre_admission_token", label: "Token Fee (prior to admission)" },
];

const CHANNEL_OPTIONS = [
  { value: "none", label: "Don't send — just create the link" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "both", label: "WhatsApp + Email" },
];

export function SendPaymentLinkDialog({
  open, onOpenChange, leadId, studentId, defaultAmount, defaultPurpose,
  defaultAllocations, onCreated,
}: Props) {
  const { toast } = useToast();
  const initialPurpose: Purpose =
    defaultPurpose === "custom" ? "pre_admission_token"
      : defaultPurpose || (studentId ? "fee_due" : "pre_admission_token");
  const [purpose, setPurpose] = useState<Purpose>(initialPurpose);
  const collectingFee = purpose === "fee_due";
  const [amount, setAmount] = useState<string>(defaultAmount ? String(defaultAmount) : "");
  const [allocations, setAllocations] = useState<FeeAllocation[]>([]);
  const [note, setNote] = useState<string>("");
  const [expiryDays, setExpiryDays] = useState<string>("7");
  const [channel, setChannel] = useState<string>("whatsapp");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const seeded = !!(defaultAllocations && defaultAllocations.length > 0);
  const usingBreakup = allocations.length > 0;
  const breakupTotal = Math.round(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100;

  // Re-seed each time the dialog opens for a different set of ticked rows.
  useEffect(() => {
    if (!open || !seeded) return;
    setPurpose("fee_due");
    setAllocations(defaultAllocations!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seeded, defaultAllocations]);

  const reset = () => {
    setPurpose(defaultPurpose || (studentId ? "fee_due" : "pre_admission_token"));
    setAmount(defaultAmount ? String(defaultAmount) : "");
    setAllocations([]);
    setNote("");
    setExpiryDays("7");
    setChannel("whatsapp");
    setCreatedUrl(null);
    setCopied(false);
  };

  const handleSubmit = async () => {
    // With a breakup, the total IS the amount; otherwise use the entered amount.
    const amt = usingBreakup ? breakupTotal : parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (usingBreakup && allocations.some((a) => !a.fee_code_id || a.amount <= 0)) {
      toast({ title: "Complete the breakup", description: "Every head needs a fee head and a positive amount.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-payment-link", {
      body: {
        purpose,
        lead_id: leadId || undefined,
        student_id: studentId || undefined,
        amount: amt,
        allocations: usingBreakup ? allocations : undefined,
        note: note.trim() || undefined,
        expires_days: parseInt(expiryDays, 10) || 7,
        send_channel: channel,
      },
    });
    setSubmitting(false);

    if (error || data?.error) {
      const ctx = (error as { context?: { text?: () => Promise<string> } })?.context;
      const text = await ctx?.text?.().catch(() => "");
      let msg = data?.error || error?.message || "Could not create the link";
      try { msg = JSON.parse(text || "{}").error || msg; } catch { /* keep */ }
      toast({ title: "Payment link failed", description: msg, variant: "destructive" });
      return;
    }

    setCreatedUrl(data.pay_url);
    toast({
      title: "Payment link created",
      description: channel === "none" ? "Copy the link to share it." : "Link created and sent to the candidate.",
    });
    onCreated?.();
  };

  const copyUrl = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the link manually.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-primary" />
            Send Payment Link
          </DialogTitle>
        </DialogHeader>

        {!createdUrl && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-semibold">How to use</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li><b>Collect Fee</b> — every outstanding head, waivers applied; untick or edit any head</li>
              <li><b>Token Fee</b> — a free amount for candidates with no fee structure yet</li>
              <li>Set link expiry (default 7 days)</li>
              <li>Choose to send via WhatsApp, Email, or just copy the link</li>
              <li>Click "Create Link" — the candidate receives a payment page</li>
            </ol>
          </div>
        )}

        {createdUrl ? (
          <div className="min-w-0 space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Payment link ready:</p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <span className="flex-1 truncate text-xs text-foreground">{createdUrl}</span>
              <button onClick={copyUrl} className="text-muted-foreground hover:text-foreground" title="Copy">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-3 py-2">
            <SelectField
              value={purpose}
              onValueChange={(v) => {
                setPurpose(v as Purpose);
                if (v !== "fee_due") setAllocations([]);
              }}
              options={PURPOSE_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
              label="Purpose"
              allowEmpty={false}
            />
            <FieldShell label="Amount (₹)">
              <Input
                type="number" min="1" step="1" inputMode="numeric"
                value={usingBreakup ? String(breakupTotal) : amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                disabled={usingBreakup}
                autoFocus
              />
              {usingBreakup && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Total is set by the fee heads below — untick a head or edit its amount to change it.
                </p>
              )}
            </FieldShell>
            {/* Collect Fee lists the whole structure pre-ticked; Token Fee is a
                free amount with no breakup at all. */}
            {collectingFee && seeded && (
              <div className="min-w-0 space-y-1.5 rounded-xl border border-border/60 p-3">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Link covers {allocations.length} head{allocations.length === 1 ? "" : "s"}
                </p>
                {allocations.map((a, i) => (
                  <div key={a.fee_ledger_id || `${a.fee_code_id}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{a.label}</span>
                    <span className="shrink-0 font-medium text-foreground">
                      ₹{Number(a.amount).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border/60 pt-2 text-xs font-semibold text-foreground">
                  <span>Total</span>
                  <span>₹{breakupTotal.toLocaleString("en-IN")}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Paying this link settles exactly these rows. Change it by re-ticking the fee table.
                </p>
              </div>
            )}

            {collectingFee && !seeded && (
              <FeeHeadAllocationField
                open={open}
                studentId={studentId}
                leadId={leadId}
                value={allocations}
                onChange={setAllocations}
                variant="all"
              />
            )}
            <FieldShell label="Link valid for (days)">
              <Input
                type="number" min="1" max="90" step="1"
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
              />
            </FieldShell>
            <SelectField
              value={channel}
              onValueChange={setChannel}
              options={CHANNEL_OPTIONS}
              label="Send via"
              allowEmpty={false}
            />
            <TextAreaField
              value={note}
              onValueChange={setNote}
              label="Note (optional)"
              placeholder="Shown to the candidate on the payment page"
            />
          </div>
        )}

        <DialogFooter>
          {createdUrl ? (
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {submitting ? "Creating…" : "Create Link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
