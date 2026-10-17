-- Super-admin bulk custom fee: one or many batches (course+session), optionally
-- narrowed to / excluding specific students, with per-installment due dates.
-- p_dry_run returns the matched students without writing.
CREATE OR REPLACE FUNCTION public.apply_custom_fee_bulk(
  p_batches          jsonb,                 -- [{"course_id":..,"session_id":..}]
  p_installments     jsonb,                 -- [{"term":..,"amount":..,"due_date":..}]
  p_fee_code_id      uuid    DEFAULT NULL,
  p_new_code         text    DEFAULT NULL,
  p_new_name         text    DEFAULT NULL,
  p_new_category     text    DEFAULT 'other',
  p_include_students uuid[]  DEFAULT NULL,  -- only these (within the batches)
  p_exclude_students uuid[]  DEFAULT NULL,
  p_save_template    boolean DEFAULT false, -- also add to batch fee structures
  p_late_fee_config  jsonb   DEFAULT NULL,
  p_dry_run          boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_code uuid; v_students uuid[]; inst jsonb; b jsonb; v_struct uuid; v_item uuid;
  v_term text; v_amt numeric; v_due date; v_rows int := 0; n int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super admin can apply custom fees';
  END IF;
  IF p_batches IS NULL OR jsonb_array_length(p_batches) = 0 THEN
    RAISE EXCEPTION 'Select at least one batch';
  END IF;
  IF p_installments IS NULL OR jsonb_array_length(p_installments) = 0 THEN
    RAISE EXCEPTION 'At least one installment is required';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT s.id), '{}') INTO v_students
    FROM public.students s
    JOIN jsonb_to_recordset(p_batches) AS x(course_id uuid, session_id uuid)
      ON s.course_id = x.course_id AND s.session_id IS NOT DISTINCT FROM x.session_id
   WHERE (p_include_students IS NULL OR s.id = ANY (p_include_students))
     AND (p_exclude_students IS NULL OR NOT s.id = ANY (p_exclude_students));

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'students_affected', cardinality(v_students));
  END IF;

  IF p_fee_code_id IS NOT NULL THEN
    v_code := p_fee_code_id;
  ELSE
    IF p_new_code IS NULL OR p_new_name IS NULL THEN
      RAISE EXCEPTION 'New fee head requires code and name';
    END IF;
    INSERT INTO public.fee_codes (code, name, category, is_recurring)
    VALUES (upper(p_new_code), p_new_name, p_new_category, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_code;
  END IF;

  FOR inst IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
    v_term := inst->>'term';
    v_amt  := (inst->>'amount')::numeric;
    v_due  := NULLIF(inst->>'due_date', '')::date;
    IF v_term IS NULL OR v_amt IS NULL OR v_amt < 0 THEN
      RAISE EXCEPTION 'Each installment needs a term and a non-negative amount';
    END IF;

    IF p_save_template THEN
      -- template items go on each batch's active structure; ledger rows link to their batch's item
      FOR b IN SELECT * FROM jsonb_array_elements(p_batches) LOOP
        SELECT id INTO v_struct FROM public.fee_structures
         WHERE course_id = (b->>'course_id')::uuid AND session_id = (b->>'session_id')::uuid
           AND is_active ORDER BY created_at DESC LIMIT 1;
        IF v_struct IS NULL THEN
          RAISE EXCEPTION 'No active fee structure for batch %', b;
        END IF;
        SELECT id INTO v_item FROM public.fee_structure_items
         WHERE fee_structure_id = v_struct AND fee_code_id = v_code AND term = v_term;
        IF v_item IS NULL THEN
          INSERT INTO public.fee_structure_items
            (fee_structure_id, fee_code_id, term, amount, due_day, due_date, late_fee_config)
          VALUES (v_struct, v_code, v_term, v_amt, COALESCE(EXTRACT(day FROM v_due)::int, 10), v_due, p_late_fee_config)
          RETURNING id INTO v_item;
        END IF;
        INSERT INTO public.fee_ledger
          (student_id, fee_code_id, fee_structure_item_id, term, total_amount, due_date, status, late_fee_config)
        SELECT s.id, v_code, v_item, v_term, v_amt, v_due, 'due', p_late_fee_config
          FROM public.students s
         WHERE s.id = ANY (v_students) AND s.course_id = (b->>'course_id')::uuid
           AND s.session_id IS NOT DISTINCT FROM (b->>'session_id')::uuid
           AND NOT EXISTS (SELECT 1 FROM public.fee_ledger x
                            WHERE x.student_id = s.id AND x.fee_code_id = v_code AND x.term = v_term);
        GET DIAGNOSTICS n = ROW_COUNT; v_rows := v_rows + n;
      END LOOP;
    ELSE
      INSERT INTO public.fee_ledger
        (student_id, fee_code_id, term, total_amount, due_date, status, late_fee_config)
      SELECT sid, v_code, v_term, v_amt, v_due, 'due', p_late_fee_config
        FROM unnest(v_students) AS sid
       WHERE NOT EXISTS (SELECT 1 FROM public.fee_ledger x
                          WHERE x.student_id = sid AND x.fee_code_id = v_code AND x.term = v_term);
      GET DIAGNOSTICS n = ROW_COUNT; v_rows := v_rows + n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('fee_code_id', v_code, 'rows_created', v_rows,
                            'students_affected', cardinality(v_students));
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_custom_fee_bulk(jsonb, jsonb, uuid, text, text, text, uuid[], uuid[], boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_custom_fee_bulk(jsonb, jsonb, uuid, text, text, text, uuid[], uuid[], boolean, jsonb, boolean) TO authenticated;
