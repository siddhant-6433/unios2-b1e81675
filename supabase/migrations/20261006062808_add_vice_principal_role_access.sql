-- Add a distinct staff role. Kept separate from the permission seed so the
-- new enum label is committed before later migrations use it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vice_principal';
