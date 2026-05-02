-- Phase 1 (auto, lossless): once a single message in a thread is stamped with
-- a business_phone_number_id, propagate it to every NULL message on the same
-- thread. Implemented both as a trigger (continuous) and run once now to fix
-- whatever data is already stamped.

CREATE OR REPLACE FUNCTION public.propagate_business_pnid_across_thread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_phone_number_id IS NOT NULL THEN
    UPDATE public.whatsapp_messages
    SET business_phone_number_id = NEW.business_phone_number_id,
        business_phone_number    = COALESCE(business_phone_number, NEW.business_phone_number)
    WHERE phone = NEW.phone
      AND business_phone_number_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_business_pnid ON public.whatsapp_messages;
CREATE TRIGGER trg_propagate_business_pnid
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.propagate_business_pnid_across_thread();

-- One-shot run for already-stamped threads. Only updates threads where a
-- single distinct pnid exists, so ambiguous threads stay alone.
WITH thread_pnid AS (
  SELECT phone,
         MIN(business_phone_number_id) AS pnid,
         MAX(business_phone_number_id) AS pnid_max,
         MIN(business_phone_number)    AS pnum
  FROM public.whatsapp_messages
  WHERE business_phone_number_id IS NOT NULL
  GROUP BY phone
  HAVING MIN(business_phone_number_id) = MAX(business_phone_number_id)
)
UPDATE public.whatsapp_messages wm
SET business_phone_number_id = tp.pnid,
    business_phone_number    = COALESCE(wm.business_phone_number, tp.pnum)
FROM thread_pnid tp
WHERE tp.phone = wm.phone
  AND wm.business_phone_number_id IS NULL;

-- Phase 2 (heuristic, manual): once you know both pnids, call this to
-- classify the still-NULL threads. Threads with any outbound from UniOs go to
-- the primary number; threads with only inbound go to the secondary number.
CREATE OR REPLACE FUNCTION public.backfill_wa_inboxes_heuristic(
  primary_pnid    text,
  primary_number  text,
  secondary_pnid  text,
  secondary_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primary_threads   int;
  v_secondary_threads int;
  v_primary_msgs      int;
  v_secondary_msgs    int;
BEGIN
  -- Threads with outbound from our system → primary inbox
  WITH primary_phones AS (
    SELECT DISTINCT phone
    FROM public.whatsapp_messages
    WHERE direction = 'outbound'
  ), upd AS (
    UPDATE public.whatsapp_messages wm
    SET business_phone_number_id = primary_pnid,
        business_phone_number    = COALESCE(wm.business_phone_number, primary_number)
    FROM primary_phones p
    WHERE p.phone = wm.phone
      AND wm.business_phone_number_id IS NULL
    RETURNING wm.phone
  )
  SELECT COUNT(DISTINCT phone), COUNT(*) INTO v_primary_threads, v_primary_msgs FROM upd;

  -- Remaining NULL threads → secondary (AiSensy)
  WITH secondary_phones AS (
    SELECT DISTINCT phone
    FROM public.whatsapp_messages
    WHERE business_phone_number_id IS NULL
  ), upd AS (
    UPDATE public.whatsapp_messages wm
    SET business_phone_number_id = secondary_pnid,
        business_phone_number    = COALESCE(wm.business_phone_number, secondary_number)
    FROM secondary_phones s
    WHERE s.phone = wm.phone
      AND wm.business_phone_number_id IS NULL
    RETURNING wm.phone
  )
  SELECT COUNT(DISTINCT phone), COUNT(*) INTO v_secondary_threads, v_secondary_msgs FROM upd;

  RETURN jsonb_build_object(
    'primary_threads',   v_primary_threads,
    'primary_messages',  v_primary_msgs,
    'secondary_threads', v_secondary_threads,
    'secondary_messages',v_secondary_msgs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_wa_inboxes_heuristic(text,text,text,text)
  TO service_role;
