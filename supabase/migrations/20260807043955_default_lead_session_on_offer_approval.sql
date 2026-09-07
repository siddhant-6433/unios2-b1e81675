-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807043955 name=default_lead_session_on_offer_approval applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.handle_offer_letter_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_year numeric;
  v_token      numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads
     SET session_id = COALESCE(
           session_id,
           NEW.session_id,
           (SELECT id FROM public.admission_sessions
             WHERE CURRENT_DATE BETWEEN start_date AND end_date
             ORDER BY is_active DESC, start_date DESC
             LIMIT 1)
         )
   WHERE id = NEW.lead_id;

  v_first_year := public.lead_first_year_fee(NEW.lead_id);
  v_token      := ROUND(v_first_year * 0.10, 2);

  IF v_token > 0 THEN
    UPDATE public.leads
       SET token_amount = v_token
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;
