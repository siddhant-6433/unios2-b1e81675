import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Finance/cashier roles allowed to record the ABVMU remittance receipt (mirrors the
// server-side guard in settle_abvmu_deposit_claim).
export const CAN_SETTLE_ROLES = ["super_admin", "accountant", "campus_admin"];

export interface AbvmuClaim {
  id: string;
  amount: number;
  status: string; // pending | approved | rejected | settled
  challan_number: string | null;
  submitted_at: string;
  rejection_reason: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
}

/**
 * Shared ABVMU seat-reservation-deposit data + actions for a lead. Powers both the
 * standalone AbvmuDepositPanel card and the inline Year-1 fee-head split in
 * StudentFeePanel. Self-fetches the configured deposit amount + approved credit
 * (lead_fee_status) and the claim rows (get_abvmu_deposit_claims). `depositAmount === 0`
 * means the course carries no ABVMU deposit (callers should render nothing).
 */
export function useAbvmuDeposit(leadId: string | null | undefined, onChanged?: () => void) {
  const { role } = useAuth();
  const canSettle = CAN_SETTLE_ROLES.includes(role || "");

  const [depositAmount, setDepositAmount] = useState(0);
  const [approvedCredit, setApprovedCredit] = useState(0);
  const [firstYearDue, setFirstYearDue] = useState(0); // net of the approved ABVMU credit
  const [claims, setClaims] = useState<AbvmuClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  useEffect(() => {
    if (!leadId) {
      setDepositAmount(0);
      setClaims([]);
      setLoading(false);
      return;
    }
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
      setFirstYearDue(Math.max(0, Number(status.full_first_year_amount_due || 0)));
      setClaims((claimsRes?.data ?? []) as AbvmuClaim[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [leadId, refreshTick]);

  // pending or approved (still open); settled once the university has remitted.
  const openClaim = claims.find((c) => c.status === "pending" || c.status === "approved");
  const rejected = claims.find((c) => c.status === "rejected");
  const settledClaim = claims.find((c) => c.status === "settled");
  const settledAmount = settledClaim ? Number(settledClaim.amount || 0) : 0;

  // How much of the Year-1 balance the ABVMU deposit provisionally covers and therefore
  // must NOT be directly collectable at the counter. A settled claim is already booked in
  // the ledger's paid_amount, so nothing is deducted for it here; only an open (pending/
  // approved, not-yet-remitted) claim reserves the deposit amount.
  const directCollectDeduction = openClaim ? depositAmount : 0;

  // Open the uploaded ABVMU challan in a new tab via a short-lived signed URL.
  const viewChallan = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage
      .from("application-documents")
      .createSignedUrl(path, 60 * 30);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }, []);

  // Cashier/finance: settle the approved claim → creates the real receipt payment, then
  // generate the receipt PDF immediately (rather than waiting for the backfill cron).
  const settle = useCallback(
    async (
      claim: AbvmuClaim,
      opts: { paymentDate?: string; paymentRef?: string; notes?: string } = {},
    ) => {
      const { data, error } = await (supabase as any).rpc("settle_abvmu_deposit_claim", {
        _claim_id: claim.id,
        _payment_date: opts.paymentDate || null,
        _payment_ref: opts.paymentRef || claim.challan_number || null,
        _notes: opts.notes || null,
      });
      if (error) throw error;
      const paymentId = (data as any)?.payment_id;
      // Fire-and-forget: builds the receipt PDF (+ notifies) via notify-event's ensureReceipt.
      supabase.functions
        .invoke("notify-event", {
          body: { event: "payment_received", lead_id: leadId, context: { payment_id: paymentId } },
        })
        .catch(() => {});
      refresh();
      onChanged?.();
      return data;
    },
    [leadId, onChanged, refresh],
  );

  // Staff/cashier: upload the challan proof and open a deposit claim for review.
  const submitClaim = useCallback(
    async (opts: { file: File; challanNumber?: string; challanDate?: string; notes?: string }) => {
      const safeName = opts.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `abvmu-claims/${leadId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("application-documents")
        .upload(path, opts.file, { contentType: opts.file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const { error: claimErr } = await (supabase as any).rpc("submit_abvmu_deposit_claim", {
        _lead_id: leadId,
        _proof_path: path,
        _proof_file_name: opts.file.name,
        _proof_content_type: opts.file.type || null,
        _challan_number: opts.challanNumber || null,
        _challan_date: opts.challanDate || null,
        _notes: opts.notes || null,
        _amount: depositAmount || null,
      });
      if (claimErr) throw claimErr;
      refresh();
      onChanged?.();
    },
    [leadId, depositAmount, onChanged, refresh],
  );

  return {
    depositAmount,
    approvedCredit,
    firstYearDue,
    claims,
    loading,
    openClaim,
    rejected,
    settledClaim,
    settledAmount,
    directCollectDeduction,
    canSettle,
    viewChallan,
    settle,
    submitClaim,
    refresh,
  };
}
