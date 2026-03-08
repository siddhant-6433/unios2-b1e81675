-- Add new stages to lead_stage enum
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'application_in_progress' AFTER 'new_lead';
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'application_submitted' AFTER 'application_in_progress';

-- Add application progress tracking to leads
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS application_progress jsonb DEFAULT '{"personal_details": false, "education_details": false, "application_fee_paid": false, "documents_uploaded": false}'::jsonb;