export interface ReferralRow {
  id: string;
  referrer_user_id: string;
  referrer_name?: string | null;
  applicant_id: string | null;
  candidate_name: string;
  candidate_phone: string | null;
  candidate_email: string | null;
  job_opening_id: string | null;
  job_opening_title?: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

export interface ReferralSummaryRow {
  referrer_user_id: string;
  referrer_name: string | null;
  total: number;
  applied: number;
  hired: number;
}

export const REFERRAL_STATUSES = ["invited", "applied", "hired", "expired"] as const;

const STATUS_STYLE: Record<string, string> = {
  invited: "bg-pastel-yellow text-foreground/80",
  applied: "bg-pastel-blue text-foreground/80",
  hired: "bg-pastel-green text-foreground/80",
  expired: "bg-muted text-muted-foreground",
};

export const referralStatusBadge = (status: string): string =>
  STATUS_STYLE[status] ?? "bg-muted text-muted-foreground";

export const referralStatusLabel = (status: string): string =>
  status.charAt(0).toUpperCase() + status.slice(1);

export function summarizeReferrals(rows: ReferralRow[]) {
  return {
    total: rows.length,
    invited: rows.filter((r) => r.status === "invited").length,
    applied: rows.filter((r) => r.status === "applied").length,
    hired: rows.filter((r) => r.status === "hired").length,
  };
}
