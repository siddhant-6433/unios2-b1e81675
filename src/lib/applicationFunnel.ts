export type ApplicationFunnelStage =
  | "in_progress" | "paid" | "submitted" | "approved"
  | "offer_sent" | "token_paid" | "pre_admitted" | "admitted";

export const APPLICATION_FUNNEL_ORDER: ApplicationFunnelStage[] = [
  "in_progress", "paid", "submitted", "approved",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

export type ApplicationFunnelInput = {
  status?: string | null;
  payment_status?: string | null;
  lead_stage?: string | null;
  lead_pre_admission_no?: string | null;
  lead_admission_no?: string | null;
  has_token_fee_paid?: boolean;
  has_offer?: boolean;
};

export function applicationFunnelStageOf(a: ApplicationFunnelInput): ApplicationFunnelStage {
  // Each later stage presupposes the earlier ones. Notable guards:
  //   - "Approved" is based on applications.status, not lead.stage. Some
  //     approval paths leave lead.stage stale, but the application decision is
  //     still the lifecycle source of truth until an offer exists.
  //   - "Submitted" requires paid + post-draft status; NIMT's flow takes
  //     fee before declaration submission.
  // PAN/AN are the lifecycle source of truth; lead.stage can be stale if a
  // manual/admin path issued numbers without moving the lead stage.
  if (a.lead_admission_no) return "admitted";
  if (a.lead_stage === "admitted") return "admitted";
  if (a.lead_pre_admission_no) return "pre_admitted";
  if (a.lead_stage === "pre_admitted") return "pre_admitted";
  if (a.has_token_fee_paid) return "token_paid";
  if (a.has_offer || a.lead_stage === "offer_sent") return "offer_sent";
  if (a.status === "approved") return "approved";
  if (a.lead_stage === "application_approved" && a.payment_status === "paid") return "approved";
  if (a.payment_status === "paid" && a.status && a.status !== "draft") return "submitted";
  if (a.payment_status === "paid") return "paid";
  // Unpaid but somehow past draft — shouldn't happen in NIMT's flow. Bucket
  // as Submitted so the anomaly surfaces instead of hiding in In Progress.
  if (a.status && a.status !== "draft") return "submitted";
  return "in_progress";
}

export function isPaidBeforeOfferStage(a: ApplicationFunnelInput): boolean {
  if (a.payment_status !== "paid") return false;

  const stage = applicationFunnelStageOf(a);
  return APPLICATION_FUNNEL_ORDER.indexOf(stage) < APPLICATION_FUNNEL_ORDER.indexOf("offer_sent");
}
