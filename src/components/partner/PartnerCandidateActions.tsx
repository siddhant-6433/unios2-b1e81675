import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Receipt, IndianRupee, LogIn, FileText, Copy, MessageCircle, PhoneCall } from "lucide-react";

const fmt = (n: number | string | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export type FeeReceipt = {
  id: string;
  lead_id: string;
  type: string;
  amount: number | null;
  concession_amount: number | null;
  payment_mode: string | null;
  transaction_ref: string | null;
  receipt_no: string | null;
  receipt_url: string | null;
  status: string;
  payment_date: string | null;
  created_at: string;
};

export function PartnerReceiptsTable({
  receipts,
  maxHeightClass = "max-h-[55vh]",
}: {
  receipts: FeeReceipt[];
  maxHeightClass?: string;
}) {
  return (
    <div className={`${maxHeightClass} overflow-auto rounded-lg border border-border`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr className="border-b">
            <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Receipt No.</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Type</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
            <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Mode</th>
            <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Amount</th>
            <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="px-4 py-3 font-mono text-xs">{r.receipt_no || "—"}</td>
              <td className="px-4 py-3 capitalize">{(r.type || "").replace(/_/g, " ") || "—"}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{(r.payment_date || r.created_at) ? new Date(r.payment_date || r.created_at).toLocaleDateString("en-IN") : "-"}</td>
              <td className="px-4 py-3 text-xs capitalize">{(r.payment_mode || "").replace(/_/g, " ") || "—"}</td>
              <td className="px-4 py-3 text-right font-medium">{fmt(r.amount)}</td>
              <td className="px-4 py-3 text-center">
                {r.receipt_url ? (
                  <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" /> View
                  </a>
                ) : <span className="text-xs text-muted-foreground">Not generated yet</span>}
              </td>
            </tr>
          ))}
          {receipts.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No fee receipts recorded yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PartnerCandidateActions({
  variant = "buttons",
  onCall,
  callBusy,
  callDisabled,
  onReceipts,
  onPayLink,
  onLoginLink,
  loginLinkDisabled,
  className,
}: {
  variant?: "buttons" | "links";
  onCall?: () => void;
  callBusy?: boolean;
  callDisabled?: boolean;
  onReceipts?: () => void;
  onPayLink?: () => void;
  onLoginLink?: () => void;
  loginLinkDisabled?: boolean;
  className?: string;
}) {
  if (variant === "links") {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className || ""}`}>
        {onCall && (
          <button type="button" onClick={onCall} disabled={callBusy || callDisabled} className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
            {callBusy ? <ButtonOrb state="working" /> : <PhoneCall className="h-3 w-3" />} Call
          </button>
        )}
        {onReceipts && (
          <button type="button" onClick={onReceipts} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Receipt className="h-3 w-3" /> Receipts
          </button>
        )}
        {onPayLink && (
          <button type="button" onClick={onPayLink} className="inline-flex items-center gap-1 text-primary hover:underline">
            <IndianRupee className="h-3 w-3" /> Payment Link
          </button>
        )}
        {onLoginLink && (
          loginLinkDisabled ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground cursor-not-allowed">
              <LogIn className="h-3 w-3" /> Login Link
            </span>
          ) : (
            <button type="button" onClick={onLoginLink} className="inline-flex items-center gap-1 text-primary hover:underline">
              <LogIn className="h-3 w-3" /> Login Link
            </button>
          )
        )}
      </div>
    );
  }

  // nowrap: the four actions read as one control strip; wrapping split
  // "Login Link" onto its own line and doubled every row's height. The
  // tables scroll horizontally instead.
  return (
    <div className={`flex flex-nowrap items-center gap-2 ${className || ""}`}>
      {onCall && (
        <Button size="sm" variant="outline" className="gap-2" onClick={onCall} disabled={callBusy || callDisabled}>
          {callBusy ? <ButtonOrb state="working" /> : <PhoneCall className="h-3.5 w-3.5" />}
          Call
        </Button>
      )}
      {onReceipts && (
        <Button size="sm" variant="outline" className="gap-2" onClick={onReceipts}>
          <Receipt className="h-3.5 w-3.5" />
          Receipts
        </Button>
      )}
      {onPayLink && (
        <Button size="sm" variant="outline" className="gap-2" onClick={onPayLink}>
          <IndianRupee className="h-3.5 w-3.5" />
          Payment Link
        </Button>
      )}
      {onLoginLink && (
        <Button size="sm" variant="outline" className="gap-2" disabled={loginLinkDisabled} onClick={onLoginLink}>
          <LogIn className="h-3.5 w-3.5" />
          Login Link
        </Button>
      )}
    </div>
  );
}

// ponytail: this duplicates the generate/send login-link flow in
// src/components/finance/StudentFeePanel.tsx:325-360. Left that one alone —
// its UI is split across a header button (L451) and a separate banner
// (L525), so lifting it into this shared dialog would mean restructuring
// the cashier layout for no functional gain. Partner portal gets its own
// dialog shell instead, reusing the same RPCs.
export function StudentLoginLinkDialog({
  studentId,
  studentName,
  open,
  onOpenChange,
}: {
  studentId: string;
  studentName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [issuing, setIssuing] = useState(false);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<{ tokenId: string; url: string; phone: string | null; sent: boolean } | null>(null);

  // Reset so reopening for a different student doesn't show a stale link.
  useEffect(() => {
    if (!open) setLink(null);
  }, [open]);

  const handleGenerate = async () => {
    setIssuing(true);
    const { data, error } = await (supabase.rpc as any)("issue_student_login_link", {
      _student_id: studentId,
    });
    setIssuing(false);
    if (error) {
      toast({ title: "Could not create the login link", description: error.message, variant: "destructive" });
      return;
    }
    setLink({ tokenId: data?.token_id, url: data?.url, phone: data?.phone || null, sent: false });
  };

  // Sending is a second, deliberate click — the partner may just want to
  // read the URL out to the candidate, not message them.
  const handleSend = async () => {
    if (!link) return;
    setSending(true);
    const { data, error } = await (supabase.rpc as any)("send_student_login_link", {
      _token_id: link.tokenId,
    });
    setSending(false);
    if (error) {
      toast({ title: "Could not send the link", description: error.message, variant: "destructive" });
      return;
    }
    if (data?.sent === false) {
      toast({ title: "Not sent", description: data?.reason || "WhatsApp delivery is not configured.", variant: "destructive" });
      return;
    }
    setLink({ ...link, sent: true });
    toast({ title: "Sent on WhatsApp", description: `Delivered to ${link.phone}.` });
  };

  // ponytail: generation is an explicit click, never an on-open side effect.
  // issue_student_login_link expires any live unclaimed token for the student,
  // so auto-minting here would silently kill a link a cashier just handed out.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Login Link{studentName ? ` — ${studentName}` : ""}</DialogTitle>
          <DialogDescription>Signs the student straight in — no OTP — and expires in 7 days.</DialogDescription>
        </DialogHeader>

        {!link ? (
          <Button size="sm" onClick={handleGenerate} disabled={issuing} className="gap-1.5 w-fit">
            {issuing ? <ButtonOrb state="working" /> : <LogIn className="h-3.5 w-3.5" />}
            Generate link
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2">
            <LogIn className="h-3.5 w-3.5 shrink-0 text-success" />
            <code className="min-w-0 flex-1 truncate text-[11px] text-foreground">{link.url}</code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(link.url);
                toast({ title: "Link copied" });
              }}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Copy link"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {link.sent ? (
              <span className="shrink-0 text-[11px] font-medium text-success">Sent to {link.phone}</span>
            ) : link.phone ? (
              <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5" onClick={handleSend} disabled={sending}>
                {sending ? <ButtonOrb state="working" /> : <MessageCircle className="h-3.5 w-3.5" />}
                Send on WhatsApp to {link.phone}
              </Button>
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground">No phone on file</span>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
