-- Add TAN capture to academic partner onboarding and document records.

ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS tan_number text;

ALTER TABLE public.academic_partner_documents
  DROP CONSTRAINT IF EXISTS academic_partner_documents_document_type_check;

ALTER TABLE public.academic_partner_documents
  ADD CONSTRAINT academic_partner_documents_document_type_check
  CHECK (document_type IN ('agreement', 'gst', 'pan', 'tan', 'fee_structure', 'brochure', 'additional'));

DROP FUNCTION IF EXISTS public.save_academic_partner_onboarding(
  uuid, text, text, text, text, text, text, text, text, integer
);

CREATE OR REPLACE FUNCTION public.save_academic_partner_onboarding(
  _partner_id uuid,
  _company_name text DEFAULT NULL,
  _company_address text DEFAULT NULL,
  _pan_number text DEFAULT NULL,
  _gst_number text DEFAULT NULL,
  _tan_number text DEFAULT NULL,
  _authorised_signatory_name text DEFAULT NULL,
  _authorised_signatory_contact text DEFAULT NULL,
  _authorised_signatory_email text DEFAULT NULL,
  _onboarding_status text DEFAULT 'in_progress',
  _onboarding_step integer DEFAULT 0
)
RETURNS public.academic_partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner public.academic_partners;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _onboarding_status NOT IN ('not_started', 'in_progress', 'skipped', 'completed') THEN
    RAISE EXCEPTION 'Invalid onboarding status';
  END IF;

  UPDATE public.academic_partners
  SET
    company_name = NULLIF(trim(_company_name), ''),
    company_address = NULLIF(trim(_company_address), ''),
    pan_number = NULLIF(upper(trim(_pan_number)), ''),
    gst_number = NULLIF(upper(trim(_gst_number)), ''),
    tan_number = NULLIF(upper(trim(_tan_number)), ''),
    authorised_signatory_name = NULLIF(trim(_authorised_signatory_name), ''),
    authorised_signatory_contact = NULLIF(trim(_authorised_signatory_contact), ''),
    authorised_signatory_email = NULLIF(lower(trim(_authorised_signatory_email)), ''),
    onboarding_status = _onboarding_status,
    onboarding_step = GREATEST(COALESCE(_onboarding_step, 0), 0),
    onboarding_skipped_at = CASE WHEN _onboarding_status = 'skipped' THEN now() ELSE onboarding_skipped_at END,
    onboarding_completed_at = CASE WHEN _onboarding_status = 'completed' THEN now() ELSE onboarding_completed_at END,
    updated_at = now()
  WHERE id = _partner_id
    AND user_id = auth.uid()
  RETURNING * INTO v_partner;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academic partner profile not found';
  END IF;

  RETURN v_partner;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_academic_partner_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, integer
) TO authenticated;
