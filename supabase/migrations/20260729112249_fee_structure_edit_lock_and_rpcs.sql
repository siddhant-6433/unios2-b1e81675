-- Fee-module hardening, step 4: fee-structure edit-lock + managed edit RPCs.
-- A fee head cannot have its amount changed or be deleted once a receipt exists
-- against it (paid_amount>0). To edit, first move the paid amount to credits
-- (transfer_fee_allocation(head->credit)) or delete the receipt. The trigger fires
-- for ALL edits (RPC and raw migration), with a super-admin GUC override for
-- deliberate corrections.

-- 1. Edit-lock trigger on fee_structure_items.
CREATE OR REPLACE FUNCTION public.fee_structure_edit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_consumed boolean;
  v_course uuid;
  v_session uuid;
BEGIN
  -- Deliberate override (set inside a super_admin RPC/migration, audited separately).
  IF current_setting('app.allow_fee_structure_edit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only guard money-affecting changes (amount/fee_code/term) and deletes.
  IF TG_OP = 'UPDATE'
     AND NEW.amount      IS NOT DISTINCT FROM OLD.amount
     AND NEW.fee_code_id IS NOT DISTINCT FROM OLD.fee_code_id
     AND NEW.term        IS NOT DISTINCT FROM OLD.term THEN
    RETURN NEW;
  END IF;

  SELECT course_id, session_id INTO v_course, v_session
    FROM public.fee_structures WHERE id = OLD.fee_structure_id;

  -- "Consumed" = any paid ledger head derived from this item, by direct FK link
  -- (789/1005 rows) OR the fee_code+term match among students on this course+session.
  SELECT EXISTS (
    SELECT 1 FROM public.fee_ledger fl
     WHERE fl.paid_amount > 0
       AND ( fl.fee_structure_item_id = OLD.id
          OR ( fl.fee_code_id = OLD.fee_code_id
               AND fl.term = OLD.term
               AND fl.student_id IN (
                 SELECT s.id FROM public.students s
                  WHERE s.course_id = v_course AND s.session_id = v_session ) ) )
  ) INTO v_consumed;

  IF v_consumed THEN
    RAISE EXCEPTION 'Cannot % this fee head — a receipt has been collected against it. Move the paid amount to credits (transfer to credit) or delete the receipt first.',
      lower(TG_OP);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_fee_structure_edit_guard ON public.fee_structure_items;
CREATE TRIGGER trg_fee_structure_edit_guard
  BEFORE UPDATE OR DELETE ON public.fee_structure_items
  FOR EACH ROW EXECUTE FUNCTION public.fee_structure_edit_guard();

-- 2. Manage-fee-structure gate (super_admin + accountant, matching table RLS).
CREATE OR REPLACE FUNCTION public.can_manage_fee_structure(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user, 'super_admin') OR public.has_role(_user, 'accountant');
$function$;
GRANT EXECUTE ON FUNCTION public.can_manage_fee_structure(uuid) TO authenticated, service_role;

-- 3. Managed edit RPCs (the only supported write path from the app).
CREATE OR REPLACE FUNCTION public.upsert_fee_structure_item(
  _fee_structure_id uuid, _fee_code_id uuid, _term text, _amount numeric,
  _due_day int DEFAULT 10, _item_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_course uuid; v_session uuid;
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fee structures'; END IF;
  IF COALESCE(_amount, -1) < 0 THEN RAISE EXCEPTION 'Amount must be >= 0'; END IF;

  IF _item_id IS NOT NULL THEN
    -- edit-lock trigger blocks this if the head is consumed
    UPDATE public.fee_structure_items
       SET fee_code_id = _fee_code_id, term = _term, amount = _amount,
           due_day = COALESCE(_due_day, due_day)
     WHERE id = _item_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Fee structure item not found'; END IF;

    -- re-sync UNPAID provisioned ledgers to the new amount (paid heads are locked,
    -- so anything editable here has paid_amount=0).
    SELECT course_id, session_id INTO v_course, v_session
      FROM public.fee_structures WHERE id = _fee_structure_id;
    UPDATE public.fee_ledger fl
       SET total_amount = _amount, updated_at = now()
     WHERE fl.paid_amount = 0
       AND ( fl.fee_structure_item_id = _item_id
          OR ( fl.fee_code_id = _fee_code_id AND fl.term = _term
               AND fl.student_id IN (SELECT s.id FROM public.students s
                    WHERE s.course_id = v_course AND s.session_id = v_session) ) );
  ELSE
    INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
    VALUES (_fee_structure_id, _fee_code_id, _term, _amount, COALESCE(_due_day, 10))
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.upsert_fee_structure_item(uuid,uuid,text,numeric,int,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_fee_structure_item(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fee structures'; END IF;
  DELETE FROM public.fee_structure_items WHERE id = _item_id;   -- trigger guards
END;
$function$;
GRANT EXECUTE ON FUNCTION public.delete_fee_structure_item(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_fee_structure_active(_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fee structures'; END IF;
  UPDATE public.fee_structures SET is_active = _active WHERE id = _id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.set_fee_structure_active(uuid, boolean) TO authenticated, service_role;
