-- Add librarian as a first-class staff role.
-- Kept separate because new enum values cannot be safely used in the same
-- migration transaction on all Postgres versions.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'librarian';
