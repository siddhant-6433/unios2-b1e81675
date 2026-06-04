-- Education loan letter for issued offers.
-- Applicants can download this after paying the configured token fee. The
-- token amount defaults to 10% of net Year-1 in the admin UI and may be
-- lowered at issuance time, but never below Rs. 5,000.

ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS loan_letter_url text,
  ADD COLUMN IF NOT EXISTS admission_mode text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS entrance_exam_name text;

COMMENT ON COLUMN public.offer_letters.loan_letter_url IS
  'Generated education-loan support letter URL. Applicant portal exposes it only after token-fee completion.';

COMMENT ON COLUMN public.offer_letters.admission_mode IS
  'Admission route printed on the offer and education-loan support letter. Values: direct, entrance.';

COMMENT ON COLUMN public.offer_letters.entrance_exam_name IS
  'Entrance or counselling route printed when admission_mode is entrance. Staff can select a known entrance or type another value.';

COMMENT ON COLUMN public.offer_letters.token_fee_amount IS
  'Token fee shown on the offer letter PDF and required before the applicant can download the education-loan support letter. Defaults to 10% of post-waiver Year-1 in the admin UI. Editable at issuance time but cannot be lower than Rs. 5,000.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.offer_letters'::regclass
       AND conname = 'chk_offer_letters_token_fee_min'
  ) THEN
    ALTER TABLE public.offer_letters
      ADD CONSTRAINT chk_offer_letters_token_fee_min
      CHECK (token_fee_amount IS NULL OR token_fee_amount >= 5000)
      NOT VALID;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.offer_letters'::regclass
       AND conname = 'chk_offer_letters_admission_mode'
  ) THEN
    ALTER TABLE public.offer_letters
      ADD CONSTRAINT chk_offer_letters_admission_mode
      CHECK (admission_mode IN ('direct', 'entrance'))
      NOT VALID;
  END IF;
END$$;

-- Dashboard preload: all approved offers for a phone number's leads.
DROP FUNCTION IF EXISTS public.get_applicant_offers_by_phone(text);

CREATE FUNCTION public.get_applicant_offers_by_phone(_phone text)
RETURNS TABLE (
  lead_id         uuid,
  letter_url      text,
  loan_letter_url text,
  approval_status text,
  created_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.lead_id, ol.letter_url, ol.loan_letter_url, ol.approval_status, ol.created_at
  FROM   public.offer_letters ol
  JOIN   public.leads l ON l.id = ol.lead_id
  WHERE  l.phone = _phone
    AND  ol.approval_status = 'approved'
  ORDER  BY ol.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offers_by_phone(text) TO anon, authenticated;

-- TokenFeePanel: full offer row for a given application_id.
DROP FUNCTION IF EXISTS public.get_applicant_offer(text);

CREATE FUNCTION public.get_applicant_offer(_application_id text)
RETURNS TABLE (
  id                  uuid,
  lead_id             uuid,
  total_fee           numeric,
  scholarship_amount  numeric,
  net_fee             numeric,
  token_fee_amount    numeric,
  approval_status     text,
  status              text,
  acceptance_deadline date,
  created_at          timestamptz,
  letter_url          text,
  loan_letter_url     text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ol.id, ol.lead_id, ol.total_fee, ol.scholarship_amount,
         ol.net_fee, ol.token_fee_amount, ol.approval_status, ol.status,
         ol.acceptance_deadline, ol.created_at, ol.letter_url, ol.loan_letter_url
  FROM   public.offer_letters ol
  JOIN   public.applications  a  ON a.lead_id = ol.lead_id
  WHERE  a.application_id  = _application_id
    AND  ol.approval_status = 'approved'
  ORDER  BY ol.created_at DESC
  LIMIT  1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_offer(text) TO anon, authenticated;
