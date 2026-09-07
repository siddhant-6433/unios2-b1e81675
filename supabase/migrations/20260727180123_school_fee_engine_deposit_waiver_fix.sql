-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260727180123 name=school_fee_engine_deposit_waiver_fix applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.lead_post_scholarship_year_1(_lead_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_course_id uuid; v_net numeric; v_y1 numeric; v_offer_id uuid; v_waivers numeric := 0; v_scholarship numeric := 0;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;
  IF public.student_course_is_school(v_course_id) THEN
    -- 25% base excludes the boarding deposit: subtract the structural deposit but
    -- add back any waiver on the deposit term (else it's double-counted, once in
    -- net_fee and once in the deposit subtraction).
    SELECT ol.id, ol.net_fee INTO v_offer_id, v_net FROM public.offer_letters ol
     WHERE ol.lead_id = _lead_id AND ol.approval_status = 'approved'
     ORDER BY ol.created_at DESC LIMIT 1;
    SELECT COALESCE(SUM(amount), 0) INTO v_waivers FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id AND status = 'approved' AND term = 'security_deposit';
    RETURN GREATEST(0, COALESCE(v_net, 0) - public.lead_school_boarding_deposit(_lead_id) + v_waivers);
  END IF;
  v_y1 := public.lead_first_year_fee(_lead_id);
  SELECT id, COALESCE(scholarship_amount, 0) INTO v_offer_id, v_scholarship
    FROM public.offer_letters WHERE lead_id = _lead_id AND approval_status = 'approved'
    ORDER BY created_at DESC LIMIT 1;
  IF v_offer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_waivers FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id AND status = 'approved' AND term = 'year_1';
    IF v_waivers = 0 THEN v_waivers := v_scholarship; END IF;
  END IF;
  RETURN GREATEST(0, v_y1 - LEAST(v_waivers, v_y1));
END;
$function$;
