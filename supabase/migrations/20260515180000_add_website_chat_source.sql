-- Add website_chat source for leads created via the Navya chat widget
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'website_chat';
