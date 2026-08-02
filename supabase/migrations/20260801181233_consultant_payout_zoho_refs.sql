-- Zoho Books sync references for consultant payouts.

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS zoho_vendor_id text;

ALTER TABLE public.consultant_payouts
  ADD COLUMN IF NOT EXISTS zoho_bill_id     text,
  ADD COLUMN IF NOT EXISTS zoho_bill_number text,
  ADD COLUMN IF NOT EXISTS zoho_payment_id  text,
  ADD COLUMN IF NOT EXISTS zoho_synced_at   timestamptz,
  ADD COLUMN IF NOT EXISTS zoho_sync_error  text;

-- Expose sync state on the sheet view so the UI can show a "Synced / Send to Zoho" badge.
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
  cp.student_fee_paid,
  cp.annual_fee,
  cp.payout_amount,
  cp.fee_paid_pct,
  cp.status,
  cp.payment_mode,
  cp.payment_reference,
  cp.payment_date,
  cp.payment_proof_path,
  cp.paid_at,
  cp.zoho_bill_id,
  cp.zoho_bill_number,
  cp.zoho_synced_at,
  cp.zoho_sync_error,
  cp.created_at
FROM public.consultant_payouts cp
JOIN public.consultants c ON c.id = cp.consultant_id
JOIN public.leads       l ON l.id = cp.lead_id
LEFT JOIN public.courses crs ON crs.id = cp.course_id;

GRANT SELECT ON public.consultant_payout_sheet TO authenticated;
