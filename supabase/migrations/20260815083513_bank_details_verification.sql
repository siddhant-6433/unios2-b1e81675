-- Bank details for video editors + shared bank-verification columns across all
-- three payee stores (consultants, employees, video editors). All additive; no
-- RLS changes — new columns inherit each table's existing policies, and the
-- employee_bank_audit trigger already captures them via to_jsonb(NEW).

-- 1. Video editors: mirror the consultant bank column shape (prefixed) so the
--    payout slip + Zoho code reads bank details uniformly across payees.
ALTER TABLE public.video_editors
  ADD COLUMN IF NOT EXISTS bank_account_name   text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc           text,
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_upi            text;

-- 2. Verification columns — identical names on all three stores so the shared
--    BankDetailsFields component + bank-verify edge fn read/write them the same
--    way regardless of payee type.
--    status: 'unverified' | 'verified' | 'mismatch' | 'failed'
--    verified_name: registered account-holder name returned by RazorpayX.
--    verification_ref: RazorpayX validation id (audit trail).

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS bank_verified_name       text,
  ADD COLUMN IF NOT EXISTS bank_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS bank_verification_ref    text,
  ADD COLUMN IF NOT EXISTS bank_verification_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.employee_bank_details
  ADD COLUMN IF NOT EXISTS bank_verified_name       text,
  ADD COLUMN IF NOT EXISTS bank_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS bank_verification_ref    text,
  ADD COLUMN IF NOT EXISTS bank_verification_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.video_editors
  ADD COLUMN IF NOT EXISTS bank_verified_name       text,
  ADD COLUMN IF NOT EXISTS bank_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS bank_verification_ref    text,
  ADD COLUMN IF NOT EXISTS bank_verification_status text NOT NULL DEFAULT 'unverified';
