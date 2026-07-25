-- Add school_coordinator to the app_role enum.
-- Separate transaction required before the new value can be referenced.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'school_coordinator';
