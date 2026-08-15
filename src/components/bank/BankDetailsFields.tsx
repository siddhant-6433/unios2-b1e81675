import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { BankDetails, isValidIfsc, VERIFICATION_BADGE } from "@/lib/bankDetails";

// Verdict the parent folds into its own save payload (maps to bank_verified_*).
export type BankVerification = { status: string; name: string | null; ref: string | null; at: string | null };

type Props = {
  value: BankDetails;
  onChange: (v: BankDetails) => void;
  showUpi?: boolean;
  showBranch?: boolean;
  /** Last stored verification (from the payee row) to seed the badge. */
  verification?: { status: string; name: string | null };
  /** Fires on verify success AND when account/IFSC edits invalidate a prior verdict. */
  onVerification?: (v: BankVerification) => void;
  disabled?: boolean;
};

const inputCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";
const labelCls = "block text-[11px] font-medium text-muted-foreground mb-1";

export function BankDetailsFields({
  value, onChange, showUpi = true, showBranch = false, verification, onVerification, disabled,
}: Props) {
  const { toast } = useToast();
  const [verifying, setVerifying] = useState(false);
  // Local badge: seeded from stored verification, updated on verify / invalidated on edit.
  const [status, setStatus] = useState<string>(verification?.status || "unverified");
  const [verifiedName, setVerifiedName] = useState<string | null>(verification?.name || null);

  const ifscValid = isValidIfsc(value.ifsc);
  const ifscTouched = value.ifsc.trim().length > 0;
  const canVerify = ifscValid && value.accountNumber.trim().length > 0 && !disabled;

  // Editing account/IFSC after a verdict makes it stale — reset badge + tell parent.
  const invalidate = () => {
    if (status !== "unverified") {
      setStatus("unverified");
      setVerifiedName(null);
      onVerification?.({ status: "unverified", name: null, ref: null, at: null });
    }
  };

  const set = (patch: Partial<BankDetails>) => onChange({ ...value, ...patch });

  const verify = async () => {
    setVerifying(true);
    const { data, error } = await supabase.functions.invoke("bank-verify", {
      body: {
        account_number: value.accountNumber.trim(),
        ifsc: value.ifsc.trim().toUpperCase(),
        name: value.holderName.trim(),
      },
    });
    setVerifying(false);
    const res = data as any;
    const errMsg = error?.message || res?.error;
    if (errMsg) { toast({ title: "Verification failed", description: errMsg, variant: "destructive" }); return; }

    if (res.ifsc_valid === false) {
      toast({ title: "IFSC not found", description: "Check the IFSC — no matching bank branch.", variant: "destructive" });
      return;
    }
    // Autofill bank + branch from the IFSC lookup.
    const patch: Partial<BankDetails> = {};
    if (res.bank && !value.bankName.trim()) patch.bankName = res.bank;
    if (res.branch && showBranch && !value.branch?.trim()) patch.branch = res.branch;
    if (Object.keys(patch).length) set(patch);

    const v = res.verification || {};
    const newStatus = v.status && v.status !== "skipped" ? v.status : "unavailable";
    setStatus(newStatus);
    setVerifiedName(v.registered_name || null);
    onVerification?.({ status: newStatus, name: v.registered_name || null, ref: v.ref || null, at: new Date().toISOString() });

    const label = newStatus === "verified" ? `Verified · ${v.registered_name}`
      : newStatus === "mismatch" ? `Name mismatch — bank has "${v.registered_name}"`
      : newStatus === "unavailable" ? "IFSC valid · name unverified (RazorpayX off)"
      : "Could not verify the account";
    toast({ title: label, variant: newStatus === "mismatch" || newStatus === "failed" ? "destructive" : undefined });
  };

  const badge = VERIFICATION_BADGE[status] || VERIFICATION_BADGE.unverified;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Account Holder Name</label>
          <input value={value.holderName} onChange={e => set({ holderName: e.target.value })} className={inputCls} disabled={disabled} />
        </div>
        <div>
          <label className={labelCls}>Account Number</label>
          <input value={value.accountNumber} onChange={e => { set({ accountNumber: e.target.value }); invalidate(); }} className={inputCls} disabled={disabled} />
        </div>
        <div>
          <label className={labelCls}>IFSC</label>
          <input value={value.ifsc} onChange={e => { set({ ifsc: e.target.value.toUpperCase() }); invalidate(); }}
            className={`${inputCls} ${ifscTouched && !ifscValid ? "border-destructive" : ""}`} placeholder="HDFC0001234" disabled={disabled} />
          {ifscTouched && !ifscValid && <p className="text-[10px] text-destructive mt-1">Invalid IFSC format</p>}
        </div>
        <div>
          <label className={labelCls}>Bank Name</label>
          <input value={value.bankName} onChange={e => set({ bankName: e.target.value })} className={inputCls} disabled={disabled} />
        </div>
        {showBranch && (
          <div>
            <label className={labelCls}>Branch</label>
            <input value={value.branch || ""} onChange={e => set({ branch: e.target.value })} className={inputCls} disabled={disabled} />
          </div>
        )}
        {showUpi && (
          <div className={showBranch ? "" : "col-span-2"}>
            <label className={labelCls}>UPI ID (optional)</label>
            <input value={value.upi || ""} onChange={e => set({ upi: e.target.value })} className={inputCls} disabled={disabled} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5 h-8 text-xs" disabled={!canVerify || verifying} onClick={verify}
          title={canVerify ? "Validate IFSC + verify account holder name" : "Enter an account number and a valid IFSC first"}>
          {verifying ? <ButtonOrb state="searching" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify
        </Button>
        <Badge className={`border-0 text-[10px] font-semibold ${badge.color}`}>{badge.label}</Badge>
        {verifiedName && status === "verified" && <span className="text-[10px] text-muted-foreground">{verifiedName}</span>}
      </div>
    </div>
  );
}
