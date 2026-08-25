import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info, Paperclip, ReceiptText, CheckCircle2, Clock, Plus } from "lucide-react";
import type { AbvmuClaim, useAbvmuDeposit } from "./useAbvmuDeposit";

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

type Abvmu = ReturnType<typeof useAbvmuDeposit>;

/**
 * Compact ABVMU challan / receipt controls for a lead — the single source of truth for
 * the "record challan", "view challan" and "record receipt (settle)" affordances. Renders
 * a slim one-line strip (an info symbol + small icon buttons); the challan-upload and
 * settle forms stay collapsed until their button is pressed. Shared by the standalone
 * AbvmuDepositPanel card and the Year-1 fee-head split in StudentFeePanel. Renders nothing
 * when the course has no deposit configured.
 */
export function AbvmuInlineControls({ abvmu }: { abvmu: Abvmu }) {
  const { depositAmount, loading, openClaim, rejected, settledClaim, canSettle, viewChallan } = abvmu;

  const [open, setOpen] = useState(false); // record-challan (submit) form
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settleOpen, setSettleOpen] = useState(false); // record-receipt (settle) form
  const [settleDate, setSettleDate] = useState("");
  const [settleRef, setSettleRef] = useState("");
  const [settleNotes, setSettleNotes] = useState("");
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  if (loading || depositAmount <= 0) return null;

  const doSubmit = async () => {
    if (!file) { setError("Choose a challan file (PDF or image) to upload."); return; }
    setSubmitting(true); setError(null);
    try {
      await abvmu.submitClaim({ file, challanNumber: challanNo, challanDate, notes });
      setOpen(false); setFile(null); setChallanNo(""); setChallanDate(""); setNotes("");
    } catch (e: any) {
      setError(e?.message || "Could not submit ABVMU deposit claim");
    } finally { setSubmitting(false); }
  };

  const doSettle = async (claim: AbvmuClaim) => {
    setSettling(true); setSettleError(null);
    try {
      await abvmu.settle(claim, { paymentDate: settleDate, paymentRef: settleRef, notes: settleNotes });
      setSettleOpen(false); setSettleRef(""); setSettleDate(""); setSettleNotes("");
    } catch (e: any) {
      setSettleError(e?.message || "Could not settle ABVMU deposit claim");
    } finally { setSettling(false); }
  };

  const infoPill = (icon: JSX.Element, tip: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center text-muted-foreground/80">{icon}</span>
      </TooltipTrigger>
      {/* Portal so the tip escapes the fee table's overflow-hidden container (else clipped). */}
      <TooltipPrimitive.Portal>
        <TooltipContent side="top" align="start" collisionPadding={12} className="max-w-xs text-xs">
          {tip}
        </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );

  const challanBtn = (claim: AbvmuClaim) =>
    claim.proof_path ? (
      <button
        type="button"
        onClick={() => viewChallan(claim.proof_path)}
        title={claim.proof_file_name || "View challan"}
        className="inline-flex items-center gap-1 text-info hover:underline"
      >
        <Paperclip className="h-3 w-3" /> Challan
      </button>
    ) : null;

  return (
    <div className="text-xs">
      {/* Slim one-line control strip. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {settledClaim && !openClaim && (
          <>
            {infoPill(
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
              `ABVMU deposit settled — receipt issued for ${fmt(settledClaim.amount)}.`,
            )}
            {challanBtn(settledClaim)}
          </>
        )}

        {openClaim?.status === "pending" && (
          <>
            {infoPill(
              <Clock className="h-3.5 w-3.5 text-warning" />,
              `Challan recorded${openClaim.challan_number ? ` (no. ${openClaim.challan_number})` : ""} — pending super-admin approval.`,
            )}
            {challanBtn(openClaim)}
          </>
        )}

        {openClaim?.status === "approved" && (
          <>
            {infoPill(
              <Info className="h-3.5 w-3.5 text-success" />,
              `Approved — ${fmt(openClaim.amount)} provisional credit against Year-1 tuition. No receipt yet; it is issued when the university remits the funds to the college.`,
            )}
            {challanBtn(openClaim)}
            {canSettle && !settleOpen && (
              <button
                type="button"
                onClick={() => setSettleOpen(true)}
                className="inline-flex items-center gap-1 text-info hover:underline"
              >
                <ReceiptText className="h-3 w-3" /> Record receipt
              </button>
            )}
          </>
        )}

        {!openClaim && !settledClaim && (
          <>
            {rejected && infoPill(
              <Info className="h-3.5 w-3.5 text-destructive" />,
              `Previous claim rejected${rejected.rejection_reason ? `: ${rejected.rejection_reason}` : ""}. You may record again.`,
            )}
            {!open && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1 text-info hover:underline"
              >
                <Plus className="h-3 w-3" /> Record ABVMU challan
              </button>
            )}
          </>
        )}
      </div>

      {/* Record-receipt (settle) form — collapsed until "Record receipt" is pressed. */}
      {settleOpen && openClaim?.status === "approved" && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-background/60 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            Issues a receipt for {fmt(openClaim.amount)} and applies it to the fee ledger.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Remittance date</label>
              <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Bank / UTR ref</label>
              <input value={settleRef} onChange={(e) => setSettleRef(e.target.value)}
                placeholder={openClaim.challan_number || "Optional"}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <input value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} placeholder="Notes (optional)"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
          {settleError && <p className="text-xs text-destructive">{settleError}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs gap-2" disabled={settling} onClick={() => doSettle(openClaim)}>
              {settling ? <><ButtonOrb state="composing" /> Recording…</> : "Confirm & issue receipt"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={settling} onClick={() => setSettleOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Record-challan (submit) form — collapsed until "Record ABVMU challan" is pressed. */}
      {open && !openClaim && !settledClaim && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-background/60 p-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Challan number</label>
              <input value={challanNo} onChange={(e) => setChallanNo(e.target.value)} placeholder="Optional"
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Payment date</label>
              <input type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm" />
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1">Challan / proof (PDF or image) *</label>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs gap-2" disabled={submitting || !file} onClick={doSubmit}>
              {submitting ? <><ButtonOrb state="composing" /> Submitting…</> : "Submit for approval"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={submitting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
