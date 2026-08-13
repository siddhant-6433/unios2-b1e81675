-- Add the non_teaching role (housekeeping, security, support staff).
-- Their UniOs login shows nothing but their own HR: own attendance, own leave,
-- staff directory, holidays.
--
-- Must be its own migration: a new enum value cannot be referenced in the same
-- transaction that adds it.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'non_teaching';
