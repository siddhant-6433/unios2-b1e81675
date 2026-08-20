-- An approved offer waiver could never be undone.
--
-- decide-offer-waiver refuses anything that is not 'pending', so once a waiver
-- was approved the concession it put on fee_ledger was permanent — no delete,
-- no trail on the ledger showing who granted it. A student carrying a
-- ₹1,29,000 concession (two approved waivers of ₹10,000 + ₹1,19,000) had no way
-- back and nothing on screen explaining where it came from.
--
-- 'revoked' becomes a real state, distinct from 'rejected' (which means refused
-- at approval time). sync_fee_ledger_concessions only counts 'approved', so a
-- revoked waiver drops off the ledger on the re-sync at the end of this RPC.

ALTER TABLE public.offer_waivers DROP CONSTRAINT IF EXISTS offer_waivers_status_check;
ALTER TABLE public.offer_waivers ADD CONSTRAINT offer_waivers_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'revoked'::text]));

CREATE OR REPLACE FUNCTION public.revoke_offer_waiver(_waiver_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_w       record;
  v_student uuid;
  v_before  numeric;
  v_after   numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can revoke a waiver';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to revoke a waiver';
  END IF;

  SELECT w.id, w.status, w.amount, w.term, w.offer_letter_id, o.lead_id
    INTO v_w
    FROM public.offer_waivers w
    JOIN public.offer_letters o ON o.id = w.offer_letter_id
   WHERE w.id = _waiver_id;

  IF v_w.id IS NULL THEN RAISE EXCEPTION 'Waiver not found'; END IF;
  IF v_w.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved waiver can be revoked (this one is %)', v_w.status;
  END IF;

  SELECT id INTO v_student FROM public.students WHERE lead_id = v_w.lead_id;

  SELECT COALESCE(SUM(concession), 0) INTO v_before
    FROM public.fee_ledger WHERE student_id = v_student;

  UPDATE public.offer_waivers
     SET status = 'revoked',
         rejection_reason = btrim(_reason),
         approved_by_name = COALESCE(approved_by_name, approved_by_name)
   WHERE id = _waiver_id;

  IF v_student IS NOT NULL THEN
    PERFORM public.sync_fee_ledger_concessions(v_student);
    SELECT COALESCE(SUM(concession), 0) INTO v_after
      FROM public.fee_ledger WHERE student_id = v_student;

    -- Same trail manual concessions leave, so the ledger can answer "who
    -- removed this, when, and why".
    INSERT INTO public.concession_audit
      (concession_id, student_id, fee_ledger_id, action,
       old_amount, new_amount, reason, actor_user_id, actor_role)
    VALUES
      (NULL, v_student, NULL, 'offer_waiver_revoked',
       v_before, v_after, btrim(_reason), auth.uid(), 'super_admin');
  END IF;

  RETURN jsonb_build_object(
    'waiver_id', _waiver_id,
    'student_id', v_student,
    'concession_before', v_before,
    'concession_after', v_after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_offer_waiver(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revoke_offer_waiver(uuid, text) TO authenticated;

-- Ledger-facing provenance for offer waivers: which waivers back the concession
-- on a student's heads, who granted them and when. The row popover reads this
-- so a concession is never an unexplained number.
CREATE OR REPLACE VIEW public.v_student_offer_waivers AS
SELECT s.id                AS student_id,
       w.id                AS waiver_id,
       w.term,
       w.amount,
       w.status,
       w.reason,
       w.rejection_reason,
       w.requested_by_name,
       w.requested_by_role,
       w.approved_by_name,
       w.created_at,
       o.id                AS offer_letter_id
  FROM public.offer_waivers w
  JOIN public.offer_letters o ON o.id = w.offer_letter_id
  JOIN public.students s ON s.lead_id = o.lead_id
 WHERE o.approval_status = 'approved';

REVOKE ALL ON public.v_student_offer_waivers FROM anon;
GRANT SELECT ON public.v_student_offer_waivers TO authenticated, service_role;
