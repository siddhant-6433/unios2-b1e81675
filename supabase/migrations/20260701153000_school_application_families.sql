-- School family applications
-- One family application can contain multiple child applications. Each child
-- still remains a normal applications row so offers, ledgers, PAN/AN, and
-- eventual student records stay separate.

CREATE TABLE IF NOT EXISTS public.application_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_application_id text NOT NULL UNIQUE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  parent_name text,
  primary_phone text NOT NULL DEFAULT '',
  primary_email text,
  father jsonb NOT NULL DEFAULT '{}'::jsonb,
  mother jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardian jsonb NOT NULL DEFAULT '{}'::jsonb,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  login_identity text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'application_fee_pending', 'application_fee_paid', 'offer_issued', 'admitted', 'cancelled')),
  total_application_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_application_fee >= 0),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'waived', 'refunded')),
  payment_ref text,
  paid_at timestamptz,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES public.application_families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_sequence integer,
  ADD COLUMN IF NOT EXISTS parent_shared_source text,
  ADD COLUMN IF NOT EXISTS family_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_application_families_lead
  ON public.application_families (lead_id);

CREATE INDEX IF NOT EXISTS idx_application_families_status
  ON public.application_families (status, payment_status);

CREATE INDEX IF NOT EXISTS idx_applications_family
  ON public.applications (family_id, child_sequence);

COMMENT ON TABLE public.application_families IS
  'Parent/family-level school application container for Mirai Experiential School and NIMT Beacon School multi-child flows.';

COMMENT ON COLUMN public.applications.family_id IS
  'Family application container when a school parent applies for multiple children together.';

COMMENT ON COLUMN public.applications.child_sequence IS
  'Stable ordering of children inside a family application.';

CREATE OR REPLACE FUNCTION public.generate_family_application_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_match(family_application_id, 'FAM-([0-9]+)$'))[1]::bigint), 0) + 1
    INTO next_num
    FROM public.application_families
   WHERE family_application_id ~ '^FAM-[0-9]+$';

  RETURN 'FAM-' || lpad(next_num::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_family_application_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.family_application_id IS NULL OR btrim(NEW.family_application_id) = '' THEN
    NEW.family_application_id := public.generate_family_application_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_families_set_id ON public.application_families;
CREATE TRIGGER trg_application_families_set_id
BEFORE INSERT OR UPDATE ON public.application_families
FOR EACH ROW EXECUTE FUNCTION public.set_family_application_id();

CREATE OR REPLACE FUNCTION public.mark_application_family_paid(
  _family_id uuid,
  _payment_ref text,
  _paid_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.application_families
     SET payment_status = 'paid',
         status = CASE WHEN status IN ('draft', 'submitted', 'application_fee_pending') THEN 'application_fee_paid' ELSE status END,
         payment_ref = COALESCE(_payment_ref, payment_ref),
         paid_at = COALESCE(_paid_at, now()),
         updated_at = now()
   WHERE id = _family_id;

  UPDATE public.applications
     SET payment_status = 'paid',
         payment_ref = COALESCE(_payment_ref, payment_ref),
         updated_at = now()
   WHERE family_id = _family_id;
END;
$$;

ALTER TABLE public.application_families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can create application families" ON public.application_families;
CREATE POLICY "Public can create application families"
  ON public.application_families FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can read application families" ON public.application_families;
CREATE POLICY "Public can read application families"
  ON public.application_families FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can update application families" ON public.application_families;
CREATE POLICY "Public can update application families"
  ON public.application_families FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.application_families TO anon, authenticated;
GRANT ALL ON public.application_families TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_family_application_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_application_family_paid(uuid, text, timestamptz) TO anon, authenticated, service_role;
