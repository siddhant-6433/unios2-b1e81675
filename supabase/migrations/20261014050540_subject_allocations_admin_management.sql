-- keep-migration-version: restored production migration 20261014050540; preserve its applied version.
-- subject allocations admin management

-- Allow super admins to manage subject-to-teacher allocations from Admin Panel.
alter table public.subject_allocations enable row level security;
grant select, insert, update, delete on public.subject_allocations to authenticated;

drop policy if exists "Super admins manage subject allocations" on public.subject_allocations;
create policy "Super admins manage subject allocations"
  on public.subject_allocations
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'super_admin'::public.app_role));
