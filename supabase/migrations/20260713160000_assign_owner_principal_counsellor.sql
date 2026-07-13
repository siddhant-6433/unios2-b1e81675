-- Expand Assign Owner (external consultant / academic partner) beyond super_admin.
--
-- Who may assign:
--   * super_admin — always
--   * principal — always (by role)
--   * anyone with permission leads:assign_external_owner (role grant or per-user override)
--   * counsellor with consultants:view ("consultant access" — same gate as Consultants page)
--
-- Counsellor does NOT get the permission by default; grant consultants:view or
-- leads:assign_external_owner via Admin → Permissions / user overrides.

-- 1. Permission registry -------------------------------------------------------
INSERT INTO public.permissions (module, action, description)
VALUES (
  'leads',
  'assign_external_owner',
  'Assign or clear consultant / academic partner external owner on a lead'
)
ON CONFLICT (module, action) DO UPDATE
SET description = EXCLUDED.description;

-- Principal gets it by default so it shows as granted in the permission matrix.
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'principal'::app_role, p.id
FROM public.permissions p
WHERE p.module = 'leads' AND p.action = 'assign_external_owner'
ON CONFLICT DO NOTHING;

-- 2. Shared gate used by the RPC (and any future callers) ----------------------
CREATE OR REPLACE FUNCTION public.can_assign_lead_external_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'super_admin'::app_role)
      OR public.has_role(_user_id, 'principal'::app_role)
      OR 'leads:assign_external_owner' = ANY(public.get_user_permissions(_user_id))
      OR (
        public.has_role(_user_id, 'counsellor'::app_role)
        AND 'consultants:view' = ANY(public.get_user_permissions(_user_id))
      )
    );
$$;

COMMENT ON FUNCTION public.can_assign_lead_external_owner(uuid) IS
  'True when the user may assign consultant/academic-partner external owner on leads.';

GRANT EXECUTE ON FUNCTION public.can_assign_lead_external_owner(uuid) TO authenticated, service_role;

-- 3. Replace RPC guard (body unchanged) ----------------------------------------
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
