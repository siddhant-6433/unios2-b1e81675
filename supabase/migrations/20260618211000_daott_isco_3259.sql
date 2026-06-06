-- DAOTT / D-OTT course metadata: ISCO Code 3259.
--
-- Current ingestion maps "ott" to DAOTT-GN, while older seed data used
-- OTT-GN for the same Greater Noida programme. Update both codes so the
-- migration is safe across databases that are mid-rename.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS marketing_eligibility text,
  ADD COLUMN IF NOT EXISTS course_summary text,
  ADD COLUMN IF NOT EXISTS highlights text[];

UPDATE public.courses
SET marketing_eligibility = '10+2 with Operation Theatre relevant subjects. ISCO Code 3259.',
    course_summary = 'Diploma in Anaesthesia and Operation Theatre Technology (DAOTT/D-OTT) prepares students for operation theatre and anaesthesia support roles. ISCO Code 3259.',
    highlights = (
      SELECT array_agg(DISTINCT h ORDER BY h)
      FROM unnest(COALESCE(highlights, ARRAY[]::text[]) || ARRAY[
        'ISCO Code 3259',
        'Operation theatre and anaesthesia support training'
      ]) AS u(h)
    )
WHERE code IN ('DAOTT-GN', 'OTT-GN');

UPDATE public.eligibility_rules er
SET notes = CASE
      WHEN er.notes IS NULL OR btrim(er.notes) = '' THEN 'ISCO Code 3259.'
      WHEN er.notes ILIKE '%ISCO Code%' THEN regexp_replace(er.notes, 'ISCO Code\s+\d+', 'ISCO Code 3259', 'i')
      ELSE er.notes || ' ISCO Code 3259.'
    END,
    updated_at = now()
FROM public.courses c
WHERE er.course_id = c.id
  AND c.code IN ('DAOTT-GN', 'OTT-GN');
