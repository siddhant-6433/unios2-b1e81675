// Candidate offer acceptance — pure types and helpers.
//
// A candidate opens `/careers/offer/:token` from the link in their offer
// letter. The token is the only credential: the page reads the letter through
// the anon-callable `get_offer_by_token` RPC and records a response through
// `redeem_offer_acceptance`. Nothing here touches Supabase — the page owns the
// I/O, the rules that decide what a candidate may do live here so they can be
// unit-tested without a database.
//
// The RPC returns one row per offer (empty for an unknown/expired token) with
// these columns; `acceptance_status` is constrained in Postgres to the three
// values below.

export type AcceptanceStatus = "pending" | "accepted" | "declined";

export interface OfferByToken {
  letter_id: string;
  applicant_name: string;
  subject: string | null;
  body: string | null;
  /** Letter lifecycle (`approved` | `issued` for any row this RPC returns). */
  status: string;
  acceptance_status: AcceptanceStatus | string;
  reference_no: string | null;
  desired_role: string | null;
  job_opening_title: string | null;
}

const STATUS_CLASS: Record<AcceptanceStatus, string> = {
  pending: "bg-pastel-yellow text-foreground/80 border-0",
  accepted: "bg-pastel-green text-foreground/80 border-0",
  declined: "bg-pastel-red text-foreground/80 border-0",
};

/**
 * Tailwind classes for the response pill. Pastel tokens only — the app reads
 * them as a family, so a status never invents its own colour.
 */
export function acceptanceBadge(status: AcceptanceStatus | string): string {
  return STATUS_CLASS[status as AcceptanceStatus] ?? "bg-muted text-muted-foreground border-0";
}

/**
 * May the candidate still respond? Only while the offer is `pending`. A missing
 * offer (invalid token) and an already accepted/declined one both say no, which
 * is exactly when the page shows the recorded state instead of buttons.
 */
export function canRespond(
  offer: Pick<OfferByToken, "acceptance_status"> | null | undefined,
): boolean {
  return offer?.acceptance_status === "pending";
}
