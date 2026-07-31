-- Consultant bank details (for accountant payout sheets) + staff-facing
-- performance and payout-sheet views. All additive; no data changes.

-- 1. Structured bank/account fields on consultants ---------------------------
-- Onboarding only captured a "Bank Details" file upload, which an accountant
-- can't key a payment off. These give the payout sheet real account details.
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS bank_account_name   text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc           text,
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_upi            text;

-- 2. Staff performance view — one row per consultant with the funnel counts ---
-- consultant_dashboard already exists but is scoped to the portal's shape.
-- This adds the milestone breakdown the admin overview needs. RLS on the
-- underlying tables scopes rows (staff see all, a consultant sees only self).
-- ponytail: plain view; GROUP BY runs leads RLS per-row (known perf hotspot),
-- fine for a 79-row admin overview. Move to a DEFINER RPC if it gets slow.
DROP VIEW IF EXISTS public.consultant_performance;
CREATE VIEW public.consultant_performance AS
SELECT
  c.id   AS consultant_id,
  c.name AS consultant_name,
  c.phone,
  c.stage,
  c.payout_model,
  COUNT(l.id)                                                              AS leads_entered,
  COUNT(l.id) FILTER (WHERE l.stage IN ('offer_sent','token_paid','pre_admitted','admitted'))
                                                                            AS applications,
  COUNT(l.id) FILTER (WHERE l.pre_admission_no IS NOT NULL)                AS token_paid,
  COUNT(l.id) FILTER (WHERE l.admission_no IS NOT NULL)                    AS admissions,
  COALESCE(p.payout_total,   0)::numeric(12,2) AS payout_total,
  COALESCE(p.payout_pending, 0)::numeric(12,2) AS payout_pending,
  COALESCE(p.payout_paid,    0)::numeric(12,2) AS payout_paid
FROM public.consultants c
LEFT JOIN public.leads l ON l.consultant_id = c.id
LEFT JOIN LATERAL (
  SELECT
    SUM(cp.payout_amount)                                                    AS payout_total,
    SUM(cp.payout_amount) FILTER (WHERE cp.status IN ('pending','approved')) AS payout_pending,
    SUM(cp.payout_amount) FILTER (WHERE cp.status = 'paid')                  AS payout_paid
  FROM public.consultant_payouts cp WHERE cp.consultant_id = c.id
) p ON true
GROUP BY c.id, c.name, c.phone, c.stage, c.payout_model, p.payout_total, p.payout_pending, p.payout_paid;

GRANT SELECT ON public.consultant_performance TO authenticated;

-- 3. Payout sheet view — payable rows joined to candidate + bank details ------
-- One row per (consultant, lead) payout, carrying everything the accountant
-- needs: candidate name, admission no, course, amount, and bank details.
DROP VIEW IF EXISTS public.consultant_payout_sheet;
CREATE VIEW public.consultant_payout_sheet AS
SELECT
  cp.id            AS payout_id,
  cp.consultant_id,
  c.name           AS consultant_name,
  c.bank_account_name,
  c.bank_account_number,
  c.bank_ifsc,
  c.bank_name,
  c.bank_upi,
  cp.lead_id,
  l.name           AS candidate_name,
  COALESCE(l.admission_no, l.pre_admission_no) AS admission_no,
  crs.name         AS course_name,
  cp.payout_amount,
  cp.fee_paid_pct,
  cp.status,
  cp.created_at
FROM public.consultant_payouts cp
JOIN public.consultants c ON c.id = cp.consultant_id
JOIN public.leads       l ON l.id = cp.lead_id
LEFT JOIN public.courses crs ON crs.id = cp.course_id;

GRANT SELECT ON public.consultant_payout_sheet TO authenticated;
