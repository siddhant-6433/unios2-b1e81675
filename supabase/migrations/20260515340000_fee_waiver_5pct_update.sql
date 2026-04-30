-- ====================================================================
-- Fee waiver re-baseline
--   - Existing ~10% (₹9,000–₹10,000) fixed annual-fee discounts on
--     fee_structures.metadata are recomputed to 5% of each year's
--     `fee` field. Affects every active structure that currently has
--     a non-zero year_N.discount (OTT, D.Pharma, DPT, GNM today).
--   - Per-structure policy is set: 5% lump-sum, 2.5% multi-year bonus
--     within 5 days of token. B.Sc Nursing structures get 0/0/0 to
--     enforce "no waivers" cleanly.
--   - lead_fee_policy() defaults are bumped to match the new baseline
--     (lump_sum 5%, multi_year 2.5%, window 5 days). Any structure
--     that doesn't override its policy now inherits these.
-- ====================================================================

-- 1. Recompute metadata.discount = round(year_N.fee * 0.05) for every
--    structure that already has a non-zero discount (preserves wording
--    of discount_condition; just changes the amount).
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
       AND c.name NOT ILIKE '%Nurs%'              -- B.Sc Nursing & GNM both NOT in nursing? GNM IS nursing-y but the user only excluded B.Sc Nursing explicitly. Treat GNM as ELIGIBLE for 5%.
  LOOP
    -- Re-include GNM (General Nursing & Midwifery) explicitly: only the
    -- "B.Sc" Nursing degree is excluded per the latest direction.
    IF v_fs.course_name ILIKE '%B.Sc%Nurs%' THEN
      CONTINUE;
    END IF;

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

    UPDATE public.fee_structures SET metadata = v_new_meta WHERE id = v_fs.id;
  END LOOP;
END $$;

-- 2. Stamp policy on every active structure.
--    All structures get 5%/2.5%/5d unless they're B.Sc Nursing.
UPDATE public.fee_structures fs
   SET policy = jsonb_build_object(
     'pan_threshold_pct',              10,
     'an_threshold_pct',               25,
     'min_token_instalment',           5000,
     'lump_sum_first_year_waiver_pct', CASE WHEN c.name ILIKE '%B.Sc%Nurs%' THEN 0 ELSE 5 END,
     'multi_year_waiver_pct',          CASE WHEN c.name ILIKE '%B.Sc%Nurs%' THEN 0 ELSE 2.5 END,
     'multi_year_window_days',         5
   )
  FROM public.courses c
 WHERE c.id = fs.course_id
   AND fs.is_active = true;

-- 3. Bump the defaults inside lead_fee_policy so any new structure that
--    hasn't been stamped yet inherits the right values.
CREATE OR REPLACE FUNCTION public.lead_fee_policy(_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH defaults AS (
    SELECT jsonb_build_object(
      'pan_threshold_pct',              10,
      'an_threshold_pct',               25,
      'min_token_instalment',           5000,
      'lump_sum_first_year_waiver_pct', 5,
      'multi_year_waiver_pct',          2.5,
      'multi_year_window_days',         5
    ) AS d
  ),
  structure_policy AS (
    SELECT COALESCE(fs.policy, '{}'::jsonb) AS p
      FROM public.leads l
      LEFT JOIN public.fee_structures fs
        ON fs.course_id = l.course_id
       AND fs.session_id = l.session_id
       AND fs.is_active = true
     WHERE l.id = _lead_id
     LIMIT 1
  )
  SELECT defaults.d || COALESCE((SELECT p FROM structure_policy), '{}'::jsonb)
    FROM defaults;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_policy TO authenticated, service_role;
