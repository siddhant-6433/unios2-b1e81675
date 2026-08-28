-- add extracted name to application documents

ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS extracted_name text;
