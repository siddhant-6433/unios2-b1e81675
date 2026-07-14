-- Archive marker for inactive users in Admin Panel.
--
-- Archived users stay in the database and keep historical attribution, but are
-- hidden from the default User Management list. This is separate from
-- deleted_at, which is used when an admin removes a login account.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_profiles_not_archived
  ON public.profiles (created_at DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_archived_at
  ON public.profiles (archived_at)
  WHERE archived_at IS NOT NULL;
