-- Add ib_coordinator role to app_role enum
-- Must be in a separate migration since new enum values can't be used in the same transaction
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'ib_coordinator';

-- Add IB programme enum
DO $$ BEGIN
  CREATE TYPE public.ib_programme AS ENUM ('pyp', 'myp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
