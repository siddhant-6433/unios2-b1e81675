-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260709142832 name=whatsapp_assign_unassigned_round_robin applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.whatsapp_assign_unassigned_round_robin(_counsellor_ids uuid[])
RETURNS TABLE(counsellor_id uuid, assigned_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n int := array_length(_counsellor_ids, 1);
BEGIN
  IF v_n IS NULL OR v_n = 0 THEN
    RAISE EXCEPTION 'whatsapp_assign_unassigned_round_robin: no counsellors provided';
  END IF;

  RETURN QUERY
  WITH backlog AS (
    SELECT l.id
    FROM public.leads l
    WHERE l.counsellor_id IS NULL
      AND l.stage <> 'dnc'
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_messages wm
        WHERE wm.lead_id = l.id
          AND wm.direction = 'inbound'
          AND wm.is_read = false
          AND NOT EXISTS (
            SELECT 1
            FROM public.whatsapp_messages replied
            WHERE replied.phone = wm.phone
              AND replied.direction = 'outbound'
              AND replied.created_at > wm.created_at
              AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
                = public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
          )
      )
  ),
  numbered AS (
    SELECT id,
           _counsellor_ids[1 + ((row_number() OVER (ORDER BY id) - 1)::int % v_n)] AS new_cid
    FROM backlog
  ),
  upd AS (
    UPDATE public.leads l
    SET counsellor_id = n.new_cid, updated_at = now()
    FROM numbered n
    WHERE l.id = n.id
    RETURNING l.id, n.new_cid
  ),
  logged AS (
    INSERT INTO public.lead_activities (lead_id, type, description)
    SELECT id, 'system', 'Assigned via WhatsApp unassigned backlog round-robin.'
    FROM upd
    RETURNING lead_id
  )
  SELECT u.new_cid AS counsellor_id, COUNT(*)::bigint AS assigned_count
  FROM upd u
  GROUP BY u.new_cid;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_assign_unassigned_round_robin(uuid[]) TO authenticated;
