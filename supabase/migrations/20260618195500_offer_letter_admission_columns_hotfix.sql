-- Hotfix for offer issuance failing with:
--   Could not find the 'admission_mode' column of 'offer_letters' in the schema cache
--
-- The admin UI writes token_fee_amount, token_fee_user_edited, admission_mode,
-- and entrance_exam_name when issuing offers. Keep this idempotent so it is safe
-- whether the earlier token-fee and loan-letter migrations have already run or
-- not.

ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS token_fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS token_fee_user_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loan_letter_url text,
  ADD COLUMN IF NOT EXISTS admission_mode text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS entrance_exam_name text;

COMMENT ON COLUMN public.offer_letters.token_fee_amount IS
  'Token fee shown on the offer letter PDF and required before the applicant can download the education-loan support letter. Defaults to 10% of post-waiver Year-1 in the admin UI. Editable at issuance time but cannot be lower than Rs. 5,000.';

COMMENT ON COLUMN public.offer_letters.token_fee_user_edited IS
  'Set true when an admin manually edits token_fee_amount, so future scholarship or fee changes do not silently overwrite their choice.';

COMMENT ON COLUMN public.offer_letters.loan_letter_url IS
  'Generated education-loan support letter URL. Applicant portal exposes it only after token-fee completion.';

COMMENT ON COLUMN public.offer_letters.admission_mode IS
  'Admission route printed on the offer and education-loan support letter. Values: direct, entrance.';

COMMENT ON COLUMN public.offer_letters.entrance_exam_name IS
  'Entrance or counselling route printed when admission_mode is entrance. Staff can select a known entrance or type another value.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.offer_letters'::regclass
      AND conname = 'chk_offer_letters_admission_mode'
  ) THEN
    ALTER TABLE public.offer_letters
      ADD CONSTRAINT chk_offer_letters_admission_mode
      CHECK (admission_mode IN ('direct', 'entrance'))
      NOT VALID;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.offer_letters'::regclass
      AND conname = 'chk_offer_letters_token_fee_min'
  ) THEN
    ALTER TABLE public.offer_letters
      ADD CONSTRAINT chk_offer_letters_token_fee_min
      CHECK (token_fee_amount IS NULL OR token_fee_amount >= 5000)
      NOT VALID;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
