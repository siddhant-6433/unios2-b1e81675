-- Remove one-time full-payment discounts from B.Sc Nursing, BPT, and BMRIT fee structures.
-- The discount fields are stored inside the JSONB metadata column on fee_structures.
-- We strip the discount and discount_condition from each year_N object while preserving all other metadata.

DO $$
DECLARE
  v_course_id uuid;
  v_fs_id     uuid;
  v_meta      jsonb;
  v_new_meta  jsonb;
  yr          text;
BEGIN

  -- Helper: strip discount & discount_condition from every year_N key in the metadata
  -- We iterate year_1 through year_8 and remove those two keys if they exist.

  FOR v_course_id IN
    SELECT c.id
    FROM public.courses c
    WHERE
      c.name ILIKE '%B.Sc%Nurs%'
      OR c.name ILIKE '%Bachelor%Physiotherapy%'
      OR c.name ILIKE '%BMRIT%'
      OR (c.name ILIKE '%Radiology%' AND c.name ILIKE '%B.Sc%')
  LOOP
    SELECT id, metadata INTO v_fs_id, v_meta
    FROM public.fee_structures
    WHERE course_id = v_course_id AND version = 'standard' AND is_active = true
    LIMIT 1;

    IF v_fs_id IS NULL OR v_meta IS NULL THEN
      CONTINUE;
    END IF;

    v_new_meta := v_meta;

    FOREACH yr IN ARRAY ARRAY['year_1','year_2','year_3','year_4','year_5','year_6','year_7','year_8']
    LOOP
      IF v_new_meta ? yr THEN
        v_new_meta := jsonb_set(
          v_new_meta,
          ARRAY[yr],
          (v_new_meta->yr) - 'discount' - 'discount_condition'
        );
      END IF;
    END LOOP;

    UPDATE public.fee_structures
    SET metadata = v_new_meta
    WHERE id = v_fs_id;

  END LOOP;

END $$;
