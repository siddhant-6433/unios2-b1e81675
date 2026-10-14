-- keep-migration-version: restored production migration 20261014070326; preserve its applied version.
-- timetable planner manage subject allocations

drop policy if exists "Super admins manage subject allocations" on public.subject_allocations;
drop policy if exists subject_allocations_timetable_manage on public.subject_allocations;
create policy subject_allocations_timetable_manage
  on public.subject_allocations
  for all to authenticated
  using (
    public.has_role(auth.uid(),'super_admin'::public.app_role)
    or (
      'timetable:edit'=any(public.get_user_permissions(auth.uid()))
      and exists (
        select 1 from public.courses c
        join public.departments d on d.id=c.department_id
        where c.id=coalesce(subject_allocations.course_id,(
          select b.course_id from public.batches b where b.id=subject_allocations.batch_id
        ))
          and public.has_institution_access(auth.uid(),d.institution_id)
      )
    )
  )
  with check (
    public.has_role(auth.uid(),'super_admin'::public.app_role)
    or (
      'timetable:edit'=any(public.get_user_permissions(auth.uid()))
      and exists (
        select 1 from public.courses c
        join public.departments d on d.id=c.department_id
        where c.id=coalesce(subject_allocations.course_id,(
          select b.course_id from public.batches b where b.id=subject_allocations.batch_id
        ))
          and public.has_institution_access(auth.uid(),d.institution_id)
      )
    )
  );
