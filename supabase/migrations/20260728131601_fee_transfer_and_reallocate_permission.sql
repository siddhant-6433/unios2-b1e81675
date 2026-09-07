-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260728131601 name=fee_transfer_and_reallocate_permission applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

INSERT INTO public.permissions (module, action, description)
VALUES ('fee_ledger', 'reallocate', 'Transfer/reallocate paid amounts between fee heads (and head to credit)')
ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'accountant'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'fee_ledger' AND p.action = 'reallocate' ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'super_admin'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'fee_ledger' AND p.action = 'reallocate' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_reallocate_fee(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user, 'super_admin') OR public.has_role(_user, 'accountant')
      OR 'fee_ledger:reallocate' = ANY (public.get_user_permissions(_user));
$function$;
GRANT EXECUTE ON FUNCTION public.can_reallocate_fee(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_fee_allocation(
  _from_fee_ledger_id uuid, _to_fee_ledger_id uuid, _amount numeric, _reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_role text; v_from RECORD; v_to RECORD; v_student uuid; v_apply_to numeric := 0;
BEGIN
  IF NOT public.can_reallocate_fee(v_actor) THEN RAISE EXCEPTION 'Not authorized to reallocate fees'; END IF;
  IF COALESCE(NULLIF(btrim(_reason), ''), '') = '' THEN RAISE EXCEPTION 'A reason is required to reallocate fees'; END IF;
  IF COALESCE(_amount, 0) <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _from_fee_ledger_id IS NULL THEN RAISE EXCEPTION 'Source head required (use apply_student_credit)'; END IF;

  SELECT fl.*, fc.code AS fee_code INTO v_from FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.id = _from_fee_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source head not found'; END IF;
  v_student := v_from.student_id;
  IF v_from.paid_amount < _amount THEN RAISE EXCEPTION 'Source head has only % paid; cannot move %', v_from.paid_amount, _amount; END IF;

  IF _to_fee_ledger_id IS NOT NULL THEN
    SELECT fl.*, fc.code AS fee_code INTO v_to FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.id = _to_fee_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target head not found'; END IF;
    IF v_to.student_id <> v_student THEN RAISE EXCEPTION 'Source and target heads belong to different students'; END IF;
    v_apply_to := LEAST(_amount, v_to.total_amount - v_to.concession - v_to.paid_amount);
  END IF;

  UPDATE public.fee_ledger SET paid_amount = paid_amount - _amount,
     status = CASE WHEN (total_amount - concession - (paid_amount - _amount)) <= 0 THEN 'paid' ELSE 'due' END, updated_at = now()
   WHERE id = _from_fee_ledger_id;
  IF _to_fee_ledger_id IS NOT NULL AND v_apply_to > 0 THEN
    UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_to,
       status = CASE WHEN (total_amount - concession - (paid_amount + v_apply_to)) <= 0 THEN 'paid'
                     WHEN status = 'overdue' THEN 'overdue' ELSE 'due' END, updated_at = now()
     WHERE id = _to_fee_ledger_id;
  END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;
  INSERT INTO public.fee_ledger_reallocation_audit
    (student_id, action, from_fee_ledger_id, to_fee_ledger_id, from_fee_code, from_term, to_fee_code, to_term, amount, reason,
     actor_user_id, actor_role, before_json, after_json)
  VALUES (v_student, CASE WHEN _to_fee_ledger_id IS NULL THEN 'unapply_to_credit' ELSE 'transfer' END,
     _from_fee_ledger_id, _to_fee_ledger_id, v_from.fee_code, v_from.term, v_to.fee_code, v_to.term,
     _amount, btrim(_reason), v_actor, v_role,
     jsonb_build_object('from_paid', v_from.paid_amount, 'to_paid', v_to.paid_amount),
     jsonb_build_object('from_paid', v_from.paid_amount - _amount, 'to_paid', COALESCE(v_to.paid_amount,0) + v_apply_to,
                        'to_credit_overflow', _amount - v_apply_to));
  RETURN jsonb_build_object('moved', _amount, 'to_head', v_apply_to, 'to_credit', _amount - v_apply_to);
END; $function$;
GRANT EXECUTE ON FUNCTION public.transfer_fee_allocation(uuid, uuid, numeric, text) TO authenticated, service_role;
