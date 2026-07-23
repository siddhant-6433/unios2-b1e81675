-- Fix: assigning an external owner (consultant / academic partner) fails with
-- "Lead source is locked after creation" for principals and consultant-access
-- counsellors.
--
-- Root cause: assign_lead_external_owner internally does
--   UPDATE leads SET source = 'consultant'/'academic_partner'
-- which fires trg_lock_lead_source. That trigger only whitelists super_admin
-- and admission_head, so any *other* authorized owner-assigner (principal,
-- counsellor with consultants:view, or leads:assign_external_owner grantees) is
-- rejected — even though they are only changing the owner, not manually editing
-- the source.
--
-- Fix: the owner-assignment RPC sets a transaction-local flag; the lock trigger
-- honors it (still auditing the change). This scopes the bypass to the vetted,
-- permission-checked RPC path only — direct manual source edits stay locked.

-- 1. Lock trigger honors the owner-assignment bypass flag ----------------------
CREATE OR REPLACE FUNCTION public.fn_lock_lead_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source THEN
    -- service-role/system changes (auth.uid() IS NULL) are allowed but audited.
    -- The owner-assignment RPC sets app.assign_owner_source = 'on' (tx-local) so
    -- its source write is not treated as a manual, locked edit.
    IF auth.uid() IS NOT NULL
       AND coalesce(current_setting('app.assign_owner_source', true), '') <> 'on'
       AND NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head')) THEN
      RAISE EXCEPTION 'Lead source is locked after creation. Ask an admission head to change it.';
    END IF;
    INSERT INTO public.lead_source_audit (lead_id, old_source, new_source, changed_by)
    VALUES (NEW.id, OLD.source::text, NEW.source::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

-- 2. RPC raises the bypass flag before its source-changing UPDATEs -------------
CREATE OR REPLACE FUNCTION public.assign_lead_external_owner(
  _lead_id uuid,
  _owner_type text,
  _consultant_id uuid DEFAULT NULL,
  _academic_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_profile_id uuid;
  v_old_consultant_id uuid;
  v_old_academic_partner_id uuid;
  v_old_owner text := 'None';
  v_new_owner text := 'None';
BEGIN
  IF NOT public.can_assign_lead_external_owner(v_uid) THEN
    RAISE EXCEPTION 'Not allowed to assign lead external owners';
  END IF;

  -- Owner assignment legitimately re-stamps source; let it through the lock.
  PERFORM set_config('app.assign_owner_source', 'on', true);

  SELECT consultant_id, academic_partner_id
    INTO v_old_consultant_id, v_old_academic_partner_id
  FROM public.leads
  WHERE id = _lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  IF v_old_consultant_id IS NOT NULL THEN
    SELECT 'Consultant: ' || name INTO v_old_owner
    FROM public.consultants
    WHERE id = v_old_consultant_id;
  ELSIF v_old_academic_partner_id IS NOT NULL THEN
    SELECT 'Academic Partner: ' || name INTO v_old_owner
    FROM public.academic_partners
    WHERE id = v_old_academic_partner_id;
  END IF;

  SELECT id INTO v_actor_profile_id
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF _owner_type = 'consultant' THEN
    IF _consultant_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.consultants
      WHERE id = _consultant_id AND stage <> 'inactive'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive consultant';
    END IF;

    SELECT 'Consultant: ' || name INTO v_new_owner
    FROM public.consultants
    WHERE id = _consultant_id;

    UPDATE public.leads
    SET consultant_id = _consultant_id,
        academic_partner_id = NULL,
        source = 'consultant'::lead_source,
        updated_at = now()
    WHERE id = _lead_id;
  ELSIF _owner_type = 'academic_partner' THEN
    IF _academic_partner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.academic_partners
      WHERE id = _academic_partner_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive academic partner';
    END IF;

    SELECT 'Academic Partner: ' || name INTO v_new_owner
    FROM public.academic_partners
    WHERE id = _academic_partner_id;

    UPDATE public.leads
    SET consultant_id = NULL,
        academic_partner_id = _academic_partner_id,
        source = 'academic_partner'::lead_source,
        updated_at = now()
    WHERE id = _lead_id;
  ELSIF _owner_type = 'none' THEN
    UPDATE public.leads
    SET consultant_id = NULL,
        academic_partner_id = NULL,
        updated_at = now()
    WHERE id = _lead_id;
  ELSE
    RAISE EXCEPTION 'Invalid owner type';
  END IF;

  IF v_old_owner IS DISTINCT FROM v_new_owner THEN
    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (
      _lead_id,
      v_actor_profile_id,
      'info_update',
      'External owner changed from "' || COALESCE(v_old_owner, 'None') || '" to "' || COALESCE(v_new_owner, 'None') || '"'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'updated',
    'lead_id', _lead_id,
    'owner_type', _owner_type,
    'old_owner', COALESCE(v_old_owner, 'None'),
    'new_owner', COALESCE(v_new_owner, 'None')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_lead_external_owner(uuid, text, uuid, uuid) TO authenticated;
