-- Admission head could not assign/clear a lead's external owner: the gate
-- (can_assign_lead_external_owner + frontend hasPermission) keys off the
-- leads:assign_external_owner permission, which admission_head was never granted.
-- Grant it by default so it shows in the permission matrix and both gates pass.
-- (Same mechanism used for principal in 20260713160000.)
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'admission_head'::app_role, p.id
FROM public.permissions p
WHERE p.module = 'leads' AND p.action = 'assign_external_owner'
ON CONFLICT DO NOTHING;
