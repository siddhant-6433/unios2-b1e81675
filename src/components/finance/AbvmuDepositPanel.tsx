import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { ChevronRight, Landmark } from "lucide-react";

interface AbvmuClaim {
  id: string;
  amount: number;
  status: string; // pending | approved | rejected | settled
  challan_number: string | null;
  submitted_at: string;
  rejection_reason: string | null;
}

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
  const [depositAmount, setDepositAmount] = useState(0);
  const [approvedCredit, setApprovedCredit] = useState(0);
  const [claims, setClaims] = useState<AbvmuClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  const [open, setOpen] = useState(false);
  const [challanNo, setChallanNo] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [statusRes, claimsRes] = await Promise.all([
        (supabase as any).rpc("lead_fee_status", { _lead_id: leadId }),
        (supabase as any).rpc("get_abvmu_deposit_claims", { _lead_id: leadId }),
      ]);
      if (!alive) return;
      const status = statusRes?.data || {};
      setDepositAmount(Math.max(0, Number(status.abvmu_deposit_amount || 0)));
      setApprovedCredit(Math.max(0, Number(status.abvmu_approved_credit || 0)));
      setClaims((claimsRes?.data ?? []) as AbvmuClaim[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [leadId, refresh]);

  const openClaim = claims.find((c) => c.status === "pending" || c.status === "approved");
  const rejected = claims.find((c) => c.status === "rejected");

  const submit = async () => {
    if (!file) {
      setError("Choose a challan file (PDF or image) to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `abvmu-claims/${leadId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const { error: claimErr } = await (supabase as any).rpc("submit_abvmu_deposit_claim", {
        _lead_id: leadId,
        _proof_path: path,
        _proof_file_name: file.name,
        _proof_content_type: file.type || null,
        _challan_number: challanNo || null,
        _challan_date: challanDate || null,
        _notes: notes || null,
        _amount: depositAmount || null,
      });
      if (claimErr) throw claimErr;

      setOpen(false);
      setFile(null);
      setChallanNo("");
      setChallanDate("");
      setNotes("");
      setRefresh((n) => n + 1);
      onChanged?.();
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
          <div className="border-t border-info/15 px-4 py-3 text-xs">
            {openClaim.status === "pending" && (
              <p className="text-warning-foreground font-medium">
                Claim submitted · pending super-admin review
                {openClaim.challan_number ? ` · Challan ${openClaim.challan_number}` : ""}
              </p>
            )}
            {openClaim.status === "approved" && (
              <p className="text-success font-medium">
                Approved · {fmt(openClaim.amount)} provisionally reduced from year-1 due
                (no receipt yet — remittance pending)
              </p>
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
