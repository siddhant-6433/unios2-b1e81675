// Shared bank-detail types, IFSC validation, and verification-status helpers.
// Used by BankDetailsFields and the three payee forms (consultants, employees,
// video editors). Dedupe target for the IFSC regex previously copied in
// EmployeeProfileDialog.tsx and employeeImport.ts.

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const isValidIfsc = (ifsc: string | null | undefined): boolean =>
  !!ifsc && IFSC_RE.test(ifsc.trim().toUpperCase());

// Normalized shape the shared component works in. Each form maps its own
// columns (bank_account_name vs account_holder_name, etc.) to/from this.
export type BankDetails = {
  holderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  upi?: string;
  branch?: string;
};

export type BankVerificationStatus = "unverified" | "verified" | "mismatch" | "failed";

export const VERIFICATION_BADGE: Record<string, { label: string; color: string }> = {
  unverified: { label: "Unverified",   color: "bg-muted text-muted-foreground" },
  verified:   { label: "Verified",     color: "bg-success/10 text-success" },
  mismatch:   { label: "Name mismatch", color: "bg-warning/10 text-warning-foreground" },
  failed:     { label: "Verify failed", color: "bg-destructive/10 text-destructive" },
  unavailable:{ label: "Name unverified", color: "bg-info/10 text-info-foreground" },
};
