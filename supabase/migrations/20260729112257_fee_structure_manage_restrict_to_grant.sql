-- Restrict fee-structure editing (incl. due dates) to super_admin OR users EXPLICITLY
-- granted fee_structure:manage. Accountants no longer get it by default — the owner
-- assigns it per-user/role in the Permission Matrix.

-- Drop the blanket accountant default grant (super_admin keeps access via has_role).
DELETE FROM public.role_permissions rp
 USING public.permissions p
 WHERE rp.permission_id = p.id
   AND p.module = 'fee_structure' AND p.action = 'manage'
   AND rp.role = 'accountant'::public.app_role;

CREATE OR REPLACE FUNCTION public.can_manage_fee_structure(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user, 'super_admin')
      OR 'fee_structure:manage' = ANY (public.get_user_permissions(_user));
$function$;
