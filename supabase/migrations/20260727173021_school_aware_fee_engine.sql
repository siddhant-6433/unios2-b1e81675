-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260727173021 name=school_aware_fee_engine applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.lead_school_boarding_deposit(_lead_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (
      SELECT ol.student_type FROM public.offer_letters ol
       WHERE ol.lead_id = _lead_id AND ol.approval_status = 'approved'
       ORDER BY ol.created_at DESC LIMIT 1
    ) = 'boarder'
    THEN COALESCE((
      SELECT SUM(fsi.amount) FROM public.fee_structure_items fsi
        JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
       WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
         AND UPPER(fc.code) LIKE '%SEC'
    ), 0)::numeric
    ELSE 0::numeric
  END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_first_year_fee(_lead_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_course_id uuid; v_total numeric;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;
  IF public.student_course_is_school(v_course_id) THEN
    SELECT ol.total_fee INTO v_total FROM public.offer_letters ol
     WHERE ol.lead_id = _lead_id AND ol.approval_status = 'approved'
     ORDER BY ol.created_at DESC LIMIT 1;
    RETURN GREATEST(0, COALESCE(v_total, 0) - public.lead_school_boarding_deposit(_lead_id));
  END IF;
  RETURN (
    SELECT COALESCE(SUM(fsi.amount), 0)::numeric FROM public.fee_structure_items fsi
    WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id) AND fsi.term = 'year_1'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_post_scholarship_year_1(_lead_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_course_id uuid; v_net numeric; v_y1 numeric; v_offer_id uuid; v_waivers numeric := 0; v_scholarship numeric := 0;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;
  IF public.student_course_is_school(v_course_id) THEN
    SELECT ol.net_fee INTO v_net FROM public.offer_letters ol
     WHERE ol.lead_id = _lead_id AND ol.approval_status = 'approved'
     ORDER BY ol.created_at DESC LIMIT 1;
    RETURN GREATEST(0, COALESCE(v_net, 0) - public.lead_school_boarding_deposit(_lead_id));
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

CREATE OR REPLACE FUNCTION public.lead_total_course_fee(_lead_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_course_id uuid;
BEGIN
  SELECT course_id INTO v_course_id FROM public.leads WHERE id = _lead_id;
  IF public.student_course_is_school(v_course_id) THEN
    RETURN public.lead_first_year_fee(_lead_id);
  END IF;
  RETURN (
    SELECT COALESCE(SUM(fsi.amount), 0)::numeric FROM public.fee_structure_items fsi
    WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
      AND fsi.term LIKE 'year\_%' ESCAPE '\'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_stage_on_waiver_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead uuid;
BEGIN
  SELECT lead_id INTO v_lead FROM public.offer_letters
   WHERE id = COALESCE(NEW.offer_letter_id, OLD.offer_letter_id);
  IF v_lead IS NOT NULL THEN PERFORM public.recompute_lead_fee_stage(v_lead); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_stage_on_offer_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN PERFORM public.recompute_lead_fee_stage(NEW.lead_id); END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recompute_stage_on_waiver ON public.offer_waivers;
CREATE TRIGGER trg_recompute_stage_on_waiver
  AFTER INSERT OR UPDATE OR DELETE ON public.offer_waivers
  FOR EACH ROW EXECUTE FUNCTION public.recompute_stage_on_waiver_change();

DROP TRIGGER IF EXISTS trg_recompute_stage_on_offer ON public.offer_letters;
CREATE TRIGGER trg_recompute_stage_on_offer
  AFTER UPDATE OF net_fee, total_fee, token_fee_amount, approval_status
  ON public.offer_letters
  FOR EACH ROW EXECUTE FUNCTION public.recompute_stage_on_offer_change();
