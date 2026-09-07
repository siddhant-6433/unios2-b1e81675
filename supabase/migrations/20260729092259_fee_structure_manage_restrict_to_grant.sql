-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260729092259 name=fee_structure_manage_restrict_to_grant applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
