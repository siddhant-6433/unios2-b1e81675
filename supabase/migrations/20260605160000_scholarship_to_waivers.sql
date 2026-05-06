-- Drop the scholarship/waiver split — going forward, "scholarship" is just a
-- year_1 waiver. Existing offer_letters.scholarship_amount values are
-- migrated into offer_waivers (status=approved, term=year_1) so PDFs and
-- lead_fee_status math keep producing the same numbers.
--
-- The scholarship_amount column is left in place (zeroed out for migrated
-- offers) for backward compat — older callers still selecting it will
-- read 0, and the math in lead_post_scholarship_year_1 / generate-offer-
-- letter sums (scholarship_amount + year_1 waivers) so 0 + waiver works.

INSERT INTO public.offer_waivers (
  offer_letter_id, term, amount, reason, status,
  approved_by_name, approved_at, created_at
)
SELECT
  o.id,
  'year_1',
  o.scholarship_amount,
  'Migrated from offer_letters.scholarship_amount',
  'approved',
  'system (migration)',
  COALESCE(o.created_at, now()),
  COALESCE(o.created_at, now())
FROM public.offer_letters o
WHERE COALESCE(o.scholarship_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.offer_waivers w
     WHERE w.offer_letter_id = o.id
       AND w.reason = 'Migrated from offer_letters.scholarship_amount'
  );

UPDATE public.offer_letters
   SET scholarship_amount = 0
 WHERE COALESCE(scholarship_amount, 0) > 0
   AND EXISTS (
     SELECT 1 FROM public.offer_waivers w
     WHERE w.offer_letter_id = id
       AND w.reason = 'Migrated from offer_letters.scholarship_amount'
   );
