-- DAOTT/DOTT Stetho Batch seat-block correction.
--
-- The DAOTT token / seat-block fee is Rs. 4,000, not Rs. 5,000. Keep this
-- limited to the Stetho Batch DAOTT/DOTT structures; application and
-- registration fees remain separate from course-fee progress.

ALTER TABLE public.offer_letters
  DROP CONSTRAINT IF EXISTS chk_offer_letters_token_fee_min;

DO $$
DECLARE
  v_seat_code_id uuid;
BEGIN
  SELECT id INTO v_seat_code_id
    FROM public.fee_codes
   WHERE code = 'DAOTT-SEAT';

  IF v_seat_code_id IS NULL THEN
    RAISE NOTICE 'DAOTT-SEAT fee code not found; skipping DAOTT seat-block correction';
    RETURN;
  END IF;

  UPDATE public.fee_structure_items fsi
     SET amount = 4000
    FROM public.fee_structures fs
    JOIN public.courses c ON c.id = fs.course_id
   WHERE fsi.fee_structure_id = fs.id
     AND fsi.fee_code_id = v_seat_code_id
     AND fsi.term = 'year_1'
     AND fs.version = 'stetho_batch'
     AND c.code IN ('DAOTT-GN','OTT-GN');

  UPDATE public.fee_structures fs
     SET metadata = jsonb_set(
       jsonb_set(
         jsonb_set(
           fs.metadata,
           '{total_fee}',
           to_jsonb(184000),
           true
         ),
         '{year_1,fee}',
         to_jsonb(39000),
         true
       ),
       '{year_1,payment_note}',
       to_jsonb('Seat block Rs 4,000 + tuition Rs 25,000 + admin & technology Rs 5,000 + examination Rs 5,000'::text),
       true
     )
    FROM public.courses c
   WHERE fs.course_id = c.id
     AND fs.version = 'stetho_batch'
     AND c.code IN ('DAOTT-GN','OTT-GN');

  UPDATE public.offer_letters ol
     SET token_fee_amount = 4000
    FROM public.leads l
    JOIN public.courses c ON c.id = l.course_id
   WHERE ol.lead_id = l.id
     AND c.code IN ('DAOTT-GN','OTT-GN')
     AND ol.approval_status = 'approved'
     AND COALESCE(ol.token_fee_amount, 0) = 5000
     AND ol.accepted_at IS NULL;
END $$;

ALTER TABLE public.lead_payments
  DROP CONSTRAINT IF EXISTS chk_lead_payments_token_fee_min;

ALTER TABLE public.lead_payments
  ADD CONSTRAINT chk_lead_payments_token_fee_min
  CHECK (type <> 'token_fee' OR amount >= 4000)
  NOT VALID;

ALTER TABLE public.lead_payments
  VALIDATE CONSTRAINT chk_lead_payments_token_fee_min;

ALTER TABLE public.offer_letters
  ADD CONSTRAINT chk_offer_letters_token_fee_min
  CHECK (token_fee_amount IS NULL OR token_fee_amount >= 4000)
  NOT VALID;

ALTER TABLE public.offer_letters
  VALIDATE CONSTRAINT chk_offer_letters_token_fee_min;
