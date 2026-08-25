import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { ChevronRight, Landmark } from "lucide-react";
import { useAbvmuDeposit, type AbvmuClaim } from "./useAbvmuDeposit";

interface Props {
  leadId: string;
  /** Fired after a successful submit so the parent can refresh its own fee views. */
  onChanged?: () => void;
}

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Staff-facing ABVMU deposit challan panel — the backend counterpart of the
 * applicant card in TokenFeePanel.tsx. Self-fetches deposit amount + approved
 * credit (lead_fee_status) and existing claims (get_abvmu_deposit_claims), so
 * callers only pass a leadId. Renders nothing when the course has no
 * seat-reservation deposit configured.
 */
export function AbvmuDepositPanel({ leadId, onChanged }: Props) {
  const abvmu = useAbvmuDeposit(leadId, onChanged);
  const { depositAmount, approvedCredit, firstYearDue, loading, openClaim, rejected, settledClaim, canSettle, viewChallan } = abvmu;

  const [open, setOpen] = useState(false);
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cashier/finance settlement (record the receipt when ABVMU remits the funds).
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleDate, setSettleDate] = useState("");
  const [settleRef, setSettleRef] = useState("");
  const [settleNotes, setSettleNotes] = useState("");
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  const doSettle = async (claim: AbvmuClaim) => {
    setSettling(true);
    setSettleError(null);
    try {
      await abvmu.settle(claim, { paymentDate: settleDate, paymentRef: settleRef, notes: settleNotes });
      setSettleOpen(false);
      setSettleRef("");
      setSettleDate("");
      setSettleNotes("");
    } catch (e: any) {
      setSettleError(e?.message || "Could not settle ABVMU deposit claim");
    } finally {
      setSettling(false);
    }
  };

  const submit = async () => {
    if (!file) {
      setError("Choose a challan file (PDF or image) to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await abvmu.submitClaim({ file, challanNumber: challanNo, challanDate, notes });
      setOpen(false);
      setFile(null);
      setChallanNo("");
      setChallanDate("");
      setNotes("");
    } catch (e: any) {
      setError(e?.message || "Could not submit ABVMU deposit claim");
    } finally {
      setSubmitting(false);
    }
  };

  // Course has no seat-reservation deposit → nothing to show.
  if (loading || depositAmount <= 0) return null;

  return (
    <Card className="border-info/20 bg-info/5">
      <CardContent className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-info/10 transition-colors"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Landmark className="h-4 w-4 shrink-0 mt-0.5 text-info" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-info-foreground">
                Already paid ABVMU deposit ({fmt(depositAmount)})?
              </p>
              <p className="text-xs text-info-foreground/80 mt-0.5">
                Upload the ABVMU challan on the candidate's behalf. After super-admin approval,
                {" "}{fmt(depositAmount)} is reduced from the first-year due (receipt issued later
                when the university remits funds to the college).
              </p>
            </div>
          </div>
          {!openClaim && (
            <ChevronRight className={`h-4 w-4 text-info shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          )}
        </button>

        {openClaim && (
          <div className="border-t border-info/15 px-4 py-3 text-xs space-y-1.5">
            {openClaim.status === "pending" && (
              <p className="text-warning-foreground font-medium">
                Claim submitted · pending super-admin review
                {openClaim.challan_number ? ` · Challan ${openClaim.challan_number}` : ""}
              </p>
            )}
            {openClaim.status === "approved" && (
              <p className="text-success font-medium">
                Approved · {fmt(openClaim.amount)} provisionally reduced from year-1 due →
                {" "}first-year due now {fmt(firstYearDue)} (no receipt yet — remittance pending)
                {openClaim.challan_number ? ` · Challan ${openClaim.challan_number}` : ""}
              </p>
            )}
            {openClaim.proof_path && (
              <button
                type="button"
                onClick={() => viewChallan(openClaim.proof_path)}
                className="text-info underline underline-offset-2 hover:text-info/80"
              >
                View challan{openClaim.proof_file_name ? ` (${openClaim.proof_file_name})` : ""}
              </button>
            )}

            {/* Cashier/finance: record the receipt once ABVMU remits the funds. */}
            {openClaim.status === "approved" && canSettle && (
              <div className="pt-1.5">
                {!settleOpen ? (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSettleOpen(true)}>
                    Record receipt (funds received from ABVMU)
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-border bg-background/60 p-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Issues a receipt for {fmt(openClaim.amount)} and applies it to the fee ledger.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Remittance date</label>
                        <input
                          type="date"
                          value={settleDate}
                          onChange={(e) => setSettleDate(e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-muted-foreground mb-1">Bank / UTR ref</label>
                        <input
                          value={settleRef}
                          onChange={(e) => setSettleRef(e.target.value)}
                          placeholder={openClaim.challan_number || "Optional"}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <input
                      value={settleNotes}
                      onChange={(e) => setSettleNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
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
              </div>
            )}
          </div>
        )}

        {settledClaim && !openClaim && (
          <div className="border-t border-success/15 px-4 py-2.5 text-xs text-success space-y-1.5">
            <p className="font-medium">ABVMU deposit settled · receipt issued for {fmt(settledClaim.amount)}</p>
            {settledClaim.proof_path && (
              <button
                type="button"
                onClick={() => viewChallan(settledClaim.proof_path)}
                className="text-info underline underline-offset-2 hover:text-info/80"
              >
                View challan{settledClaim.proof_file_name ? ` (${settledClaim.proof_file_name})` : ""}
              </button>
            )}
          </div>
        )}

        {approvedCredit > 0 && (
          <div className="border-t border-success/15 px-4 py-2.5 text-xs text-success">
            ABVMU deposit credit of {fmt(approvedCredit)} is applied to the course due.
            Official receipt generates when the university remits this amount to the college.
          </div>
        )}

        {open && !openClaim && (
          <div className="border-t border-info/15 px-4 pb-4 pt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">Challan number</label>
                <input
                  value={challanNo}
                  onChange={(e) => setChallanNo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">Payment date</label>
                <input
                  type="date"
                  value={challanDate}
                  onChange={(e) => setChallanDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">
                Challan / proof (PDF or image) *
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              type="button"
              disabled={submitting || !file}
              onClick={submit}
              className="w-full gap-2"
            >
              {submitting ? (
                <><ButtonOrb state="composing" /> Submitting…</>
              ) : (
                "Submit for super-admin approval"
              )}
            </Button>
          </div>
        )}

        {rejected && !openClaim && (
          <div className="border-t border-destructive/15 px-4 py-2 text-xs text-destructive">
            Previous claim rejected{rejected.rejection_reason ? `: ${rejected.rejection_reason}` : ""}. You may submit again.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
