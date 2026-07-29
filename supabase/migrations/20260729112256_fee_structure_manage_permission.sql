-- Granular fee_structure:manage permission so due-date / fee-item editing isn't
-- super_admin-only. Default-granted to accountant + super_admin; grantable to any
-- user from the Permission Matrix (mirrors fee_ledger:reallocate).

INSERT INTO public.permissions (module, action, description)
VALUES ('fee_structure', 'manage', 'Create/edit/delete fee structure items and due dates')
ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'accountant'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'fee_structure' AND p.action = 'manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'super_admin'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'fee_structure' AND p.action = 'manage'
ON CONFLICT DO NOTHING;

-- Gate now honors the granular permission too (super_admin/accountant keep access).
CREATE OR REPLACE FUNCTION public.can_manage_fee_structure(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user, 'super_admin')
      OR public.has_role(_user, 'accountant')
      OR 'fee_structure:manage' = ANY (public.get_user_permissions(_user));
$function$;
