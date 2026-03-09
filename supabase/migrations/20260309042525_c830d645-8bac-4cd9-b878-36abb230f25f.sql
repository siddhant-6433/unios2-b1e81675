
-- Drop existing foreign keys and recreate with ON DELETE CASCADE for lead-related tables

ALTER TABLE public.offer_letters DROP CONSTRAINT offer_letters_lead_id_fkey;
ALTER TABLE public.offer_letters ADD CONSTRAINT offer_letters_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.campus_visits DROP CONSTRAINT campus_visits_lead_id_fkey;
ALTER TABLE public.campus_visits ADD CONSTRAINT campus_visits_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_followups DROP CONSTRAINT lead_followups_lead_id_fkey;
ALTER TABLE public.lead_followups ADD CONSTRAINT lead_followups_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_notes DROP CONSTRAINT lead_notes_lead_id_fkey;
ALTER TABLE public.lead_notes ADD CONSTRAINT lead_notes_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_counsellors DROP CONSTRAINT lead_counsellors_lead_id_fkey;
ALTER TABLE public.lead_counsellors ADD CONSTRAINT lead_counsellors_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_lead_id_fkey;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_lead_id_fkey;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
