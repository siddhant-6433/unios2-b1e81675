-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260709120945 name=tc_branding_school_code_and_principal_user applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.institution_branding
  ADD COLUMN IF NOT EXISTS school_code       text,
  ADD COLUMN IF NOT EXISTS principal_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.institution_branding
   SET affiliation_no = '2131310',
       school_code    = '60589',
       principal_name = 'Mr Jai Gopal Jindal',
       seal_url       = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_school_avantika2/seal.png'
 WHERE slug = 'nimt_school_avantika2';

UPDATE public.institution_branding
   SET principal_name = 'Mr Jai Gopal Jindal'
 WHERE slug = 'nimt_school_arthala';
