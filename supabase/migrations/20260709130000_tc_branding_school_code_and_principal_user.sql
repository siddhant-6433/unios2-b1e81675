-- TC header extras: CBSE school code + optional linkage of the printed
-- principal name to a real user account (so a principal change auto-updates
-- the TC signature). When principal_user_id is set, the generate-transfer-
-- certificate edge function prints that user's profiles.display_name and
-- ignores the static principal_name text.
ALTER TABLE public.institution_branding
  ADD COLUMN IF NOT EXISTS school_code       text,
  ADD COLUMN IF NOT EXISTS principal_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Seed the two schools' header values.
UPDATE public.institution_branding
   SET affiliation_no = '2131310',
       school_code    = '60589',
       principal_name = 'Mr Jai Gopal Jindal',
       seal_url       = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/application-documents/branding/nimt_school_avantika2/seal.png'
 WHERE slug = 'nimt_school_avantika2';

-- Arthala: same principal, no affiliation / school code / seal (the seal above
-- is Avantika-specific).
UPDATE public.institution_branding
   SET principal_name = 'Mr Jai Gopal Jindal'
 WHERE slug = 'nimt_school_arthala';
