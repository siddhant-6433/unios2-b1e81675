-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260815082015 name=bank_details_verification applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Bank details for video editors + shared bank-verification columns across all
-- three payee stores (consultants, employees, video editors). All additive.

-- 1. Video editors: mirror the consultant bank column shape (prefixed).
ALTER TABLE public.video_editors
  ADD COLUMN IF NOT EXISTS bank_account_name   text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc           text,
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_upi            text;

-- 2. Verification columns — identical names on all three stores.
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
