-- Add not_interested stage to lead_stage enum
-- This is for leads who are not interested before completing application.
-- "rejected" remains for applicants who completed application but were not admitted.
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'not_interested' BEFORE 'rejected';
