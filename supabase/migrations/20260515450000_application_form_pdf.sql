ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS form_pdf_url text;
