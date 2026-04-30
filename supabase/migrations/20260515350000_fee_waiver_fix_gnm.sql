-- Re-apply 5%-of-fee discount to GNM (the previous migration's outer
-- WHERE clause excluded any course matching "Nurs" — that caught GNM
-- by mistake; only B.Sc Nursing is meant to be skipped).
DO $$
DECLARE
  v_fs       record;
  v_meta     jsonb;
  v_new_meta jsonb;
  v_yr       text;
  v_yr_obj   jsonb;
  v_fee      numeric;
  v_new_disc numeric;
BEGIN
  FOR v_fs IN
    SELECT fs.id, fs.metadata, c.name AS course_name
      FROM public.fee_structures fs
      JOIN public.courses c ON c.id = fs.course_id
     WHERE fs.is_active = true
       AND fs.metadata IS NOT NULL
       AND c.name NOT ILIKE '%B.Sc%Nurs%'
  LOOP
    v_meta := v_fs.metadata;
    v_new_meta := v_meta;

    FOREACH v_yr IN ARRAY ARRAY['year_1','year_2','year_3','year_4','year_5','year_6','year_7','year_8']
    LOOP
      IF v_meta ? v_yr THEN
        v_yr_obj := v_meta->v_yr;
        v_fee := COALESCE(NULLIF(v_yr_obj->>'fee','')::numeric, 0);
        IF v_fee > 0 AND COALESCE((v_yr_obj->>'discount')::numeric, 0) > 0 THEN
          v_new_disc := ROUND(v_fee * 0.05);
          v_new_meta := jsonb_set(v_new_meta, ARRAY[v_yr,'discount'], to_jsonb(v_new_disc));
        END IF;
      END IF;
    END LOOP;

    IF v_new_meta IS DISTINCT FROM v_meta THEN
      UPDATE public.fee_structures SET metadata = v_new_meta WHERE id = v_fs.id;
    END IF;
  END LOOP;
END $$;
