-- Consultants directory becomes opt-in per counsellor instead of role-wide.
--
-- consultants:view was granted to the counsellor ROLE, so every counsellor saw
-- the Consultants tab and no per-user revoke could take it away — the override
-- table can only subtract from a role grant one user at a time.
--
-- It was doing double duty though: can_assign_lead_external_owner() treats
-- "counsellor + consultants:view" as permission to attribute a lead to a
-- consultant, and that drives commission/payout attribution. Revoking alone
-- would have silently removed that from all 15 counsellors.
--
-- So: grant counsellors leads:assign_external_owner, which is already an
-- independent accepted branch of the same function (and of the client checks in
-- LeadDetail / AdminApplicationView), THEN drop consultants:view. Attribution is
-- preserved; only the directory becomes per-user.

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'counsellor'::public.app_role, pm.id
FROM public.permissions pm
WHERE pm.module = 'leads' AND pm.action = 'assign_external_owner'
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permissions rp
USING public.permissions pm
WHERE rp.permission_id = pm.id
  AND rp.role = 'counsellor'::public.app_role
  AND pm.module = 'consultants'
  AND pm.action = 'view';
