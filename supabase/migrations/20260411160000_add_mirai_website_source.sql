-- Add a distinct source for Mirai waitlist form submissions
-- so they're easily filterable in the CRM
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'mirai_website';
