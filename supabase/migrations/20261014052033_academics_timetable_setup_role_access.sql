-- keep-migration-version: restored production migration 20261014052033; preserve its applied version.
-- academics timetable setup role access

-- Ensure school leadership and teaching roles can reach the timetable, and
-- school leadership can manage class teacher assignments from Academics.
insert into public.permissions (module, action, description) values
  ('timetable', 'view', 'View timetable and lecture assignments'),
  ('timetable', 'edit', 'Manage timetable and academic assignments')
on conflict (module, action) do nothing;

insert into public.role_permissions (role, permission_id)
select r.role::public.app_role, p.id
from public.permissions p
cross join (values
  ('principal'),
  ('vice_principal'),
  ('campus_admin'),
  ('school_coordinator')
) as r(role)
where p.module = 'timetable' and p.action in ('view', 'edit')
on conflict (role, permission_id) do nothing;

insert into public.role_permissions (role, permission_id)
select r.role::public.app_role, p.id
from public.permissions p
cross join (values
  ('office_assistant'),
  ('teacher'),
  ('faculty')
) as r(role)
where p.module = 'timetable' and p.action = 'view'
on conflict (role, permission_id) do nothing;
