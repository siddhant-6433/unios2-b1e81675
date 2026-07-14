-- Soft-delete marker for user-management deletion.
--
-- Staff users are referenced across admissions, HR, approvals, WhatsApp, and
-- audit trails. Hard-deleting profiles/auth users breaks those foreign keys.
-- This marker lets the admin UI remove a deleted user from active management
-- views while preserving historical attribution.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_profiles_not_deleted
  ON public.profiles (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;
