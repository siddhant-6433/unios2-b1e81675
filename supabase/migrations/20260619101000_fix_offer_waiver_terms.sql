-- Fix 4 offer_waiver rows where all 3 pre-issuance waivers were bulk-inserted
-- as term='year_1' due to the form resetting to year_1 after each entry.
-- Correct rows keep year_1; the 2nd and 3rd waiver per offer become year_2/year_3.

-- Offer bedaa151-5faa-49c7-941f-80fbebe620c7 (lead 32064851)
UPDATE public.offer_waivers SET term = 'year_2'
WHERE id = '30a10b96-bf29-4a45-849b-75f0f26fe881';

UPDATE public.offer_waivers SET term = 'year_3'
WHERE id = '312690f7-b176-417d-9b74-5c71dd0a2f62';

-- Offer 2a76218b-fdca-4240-bfd6-e7949e8ee217 (lead 5c21209b)
UPDATE public.offer_waivers SET term = 'year_2'
WHERE id = '1ff4e5c4-d2b1-4714-b608-1de62bc8a10f';

UPDATE public.offer_waivers SET term = 'year_3'
WHERE id = '384a9674-32b0-4236-8234-14929b5a25fe';
