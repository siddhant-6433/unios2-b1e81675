-- keep-migration-version: restored production migration 20261014065307; preserve its applied version.
-- timetable planning school college inputs

-- Shared timetable planning inputs with distinct school-grade and college-batch
-- targets. The existing tables already hold periods, rooms, grids and entries;
-- this migration adds the missing planning data and makes course schedules
-- valid first-class targets.

alter table public.courses
  add column if not exists academic_track text not null default 'college';
alter table public.courses
  drop constraint if exists courses_academic_track_check;
alter table public.courses
  add constraint courses_academic_track_check check (academic_track in ('school','college'));
update public.courses
set academic_track = 'school'
where code ~* '^(BSA|BSAV)-G([1-9]|1[0-2])$';

alter table public.subject_allocations
  add column if not exists course_id uuid references public.courses(id) on delete cascade,
  add column if not exists periods_per_week integer not null default 3,
  add column if not exists block_length integer not null default 1,
  add column if not exists required_room_type text;
alter table public.subject_allocations
  drop constraint if exists subject_allocations_planning_hours_check;
alter table public.subject_allocations
  add constraint subject_allocations_planning_hours_check
    check (periods_per_week between 1 and 40 and block_length between 1 and 4 and periods_per_week >= block_length);
create index if not exists subject_allocations_course_session_idx
  on public.subject_allocations(course_id, session_id, section) where active;
create index if not exists subject_allocations_batch_session_idx
  on public.subject_allocations(batch_id, session_id, section) where active;

alter table public.timetable_grids
  add column if not exists plan_run_id uuid;

create table if not exists public.timetable_plan_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  session_id uuid references public.admission_sessions(id),
  track text not null check (track in ('school','college')),
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  planner_score numeric,
  planner_notes jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_by uuid references auth.users(id),
  published_at timestamptz
);
alter table public.timetable_plan_runs enable row level security;
grant select, insert, update, delete on public.timetable_plan_runs to authenticated;
drop policy if exists timetable_plan_runs_read on public.timetable_plan_runs;
create policy timetable_plan_runs_read on public.timetable_plan_runs
  for select to authenticated using (public.has_institution_access(auth.uid(), institution_id));
drop policy if exists timetable_plan_runs_manage on public.timetable_plan_runs;
create policy timetable_plan_runs_manage on public.timetable_plan_runs
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'::public.app_role)
    or ('timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and public.has_institution_access(auth.uid(), institution_id)))
  with check (public.has_role(auth.uid(),'super_admin'::public.app_role)
    or ('timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and public.has_institution_access(auth.uid(), institution_id)));
alter table public.timetable_grids
  drop constraint if exists timetable_grids_plan_run_id_fkey;
alter table public.timetable_grids
  add constraint timetable_grids_plan_run_id_fkey
  foreign key (plan_run_id) references public.timetable_plan_runs(id) on delete cascade;

create or replace function public.publish_timetable_plan(_plan_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.timetable_plan_runs;
begin
  select * into target from public.timetable_plan_runs where id=_plan_id for update;
  if not found then raise exception 'Timetable plan not found'; end if;
  if not (public.has_role(auth.uid(),'super_admin'::public.app_role)
    or ('timetable:edit'=any(public.get_user_permissions(auth.uid()))
      and public.has_institution_access(auth.uid(),target.institution_id))) then
    raise exception 'Not allowed to publish this timetable';
  end if;
  if exists (
    select 1 from public.timetable_entries e
    join public.timetable_grids g on g.id=e.grid_id
    where g.plan_run_id=_plan_id
  ) is false then raise exception 'Cannot publish an empty timetable'; end if;

  update public.timetable_grids g set status='archived'
  where g.status='published' and g.plan_run_id in (
    select old.id from public.timetable_plan_runs old
    where old.institution_id=target.institution_id and old.track=target.track
      and old.session_id is not distinct from target.session_id
      and old.status='published' and old.id<>_plan_id
  );
  update public.timetable_plan_runs old set status='archived'
  where old.institution_id=target.institution_id and old.track=target.track
    and old.session_id is not distinct from target.session_id
    and old.status='published' and old.id<>_plan_id;
  update public.timetable_grids set status='published',published_at=now(),published_by=auth.uid()
    where plan_run_id=_plan_id;
  update public.timetable_plan_runs set status='published',published_at=now(),published_by=auth.uid()
    where id=_plan_id;
end $$;
revoke all on function public.publish_timetable_plan(uuid) from public,anon;
grant execute on function public.publish_timetable_plan(uuid) to authenticated;

alter table public.timetable_entries
  drop constraint if exists te_target_chk;
alter table public.timetable_entries
  add constraint te_target_chk check (
    num_nonnulls(batch_id,course_id)=1
    or (batch_id is null and course_id is null and merge_group_id is not null)
  );
alter table public.timetable_entries
  add column if not exists section text,
  add column if not exists term text,
  add column if not exists grid_id uuid references public.timetable_grids(id) on delete cascade;

drop policy if exists te_inst_admin_write on public.timetable_entries;
create policy te_inst_admin_write on public.timetable_entries
  for all to authenticated
  using (
    public.has_role(auth.uid(),'super_admin'::public.app_role)
    or (
      'timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and (
        (batch_id is not null and exists (
          select 1 from public.batches b
          join public.courses c on c.id=b.course_id
          join public.departments d on d.id=c.department_id
          where b.id=timetable_entries.batch_id
            and public.has_institution_access(auth.uid(),d.institution_id)
        ))
        or (course_id is not null and exists (
          select 1 from public.courses c
          join public.departments d on d.id=c.department_id
          where c.id=timetable_entries.course_id
            and public.has_institution_access(auth.uid(),d.institution_id)
        ))
        or (merge_group_id is not null and exists (
          select 1 from public.class_merge_groups g
          where g.id=timetable_entries.merge_group_id
            and public.has_institution_access(auth.uid(),g.institution_id)
        ))
      )
    )
  )
  with check (
    public.has_role(auth.uid(),'super_admin'::public.app_role)
    or (
      'timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and (
        (batch_id is not null and exists (
          select 1 from public.batches b
          join public.courses c on c.id=b.course_id
          join public.departments d on d.id=c.department_id
          where b.id=timetable_entries.batch_id
            and public.has_institution_access(auth.uid(),d.institution_id)
        ))
        or (course_id is not null and exists (
          select 1 from public.courses c
          join public.departments d on d.id=c.department_id
          where c.id=timetable_entries.course_id
            and public.has_institution_access(auth.uid(),d.institution_id)
        ))
        or (merge_group_id is not null and exists (
          select 1 from public.class_merge_groups g
          where g.id=timetable_entries.merge_group_id
            and public.has_institution_access(auth.uid(),g.institution_id)
        ))
      )
    )
  );

alter table public.class_merge_members
  drop constraint if exists class_merge_members_pkey;
alter table public.class_merge_members
  alter column batch_id drop not null,
  add column if not exists course_id uuid references public.courses(id) on delete cascade,
  add column if not exists section text,
  add column if not exists session_id uuid references public.admission_sessions(id);
alter table public.class_merge_members
  add column if not exists id uuid default gen_random_uuid();
update public.class_merge_members set id=gen_random_uuid() where id is null;
alter table public.class_merge_members alter column id set not null;
alter table public.class_merge_members add constraint class_merge_members_pkey primary key(id);
alter table public.class_merge_members
  drop constraint if exists class_merge_members_one_class_check;
alter table public.class_merge_members
  add constraint class_merge_members_one_class_check check (num_nonnulls(batch_id,course_id)=1);
create unique index if not exists class_merge_members_batch_unique
  on public.class_merge_members(group_id,batch_id) where batch_id is not null;
create unique index if not exists class_merge_members_course_unique
  on public.class_merge_members(group_id,course_id,coalesce(section,''),coalesce(session_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where course_id is not null;
drop policy if exists cmm_inst_admin_write on public.class_merge_members;
create policy cmm_inst_admin_write on public.class_merge_members
  for all to authenticated
  using (
    exists (
      select 1 from public.class_merge_groups g
      where g.id=class_merge_members.group_id
        and public.has_institution_access(auth.uid(),g.institution_id)
        and (class_merge_members.batch_id is null or exists (
          select 1 from public.batches b join public.courses c on c.id=b.course_id
          join public.departments d on d.id=c.department_id
          where b.id=class_merge_members.batch_id and d.institution_id=g.institution_id
        ))
        and (class_merge_members.course_id is null or exists (
          select 1 from public.courses c join public.departments d on d.id=c.department_id
          where c.id=class_merge_members.course_id and d.institution_id=g.institution_id
        ))
    )
  )
  with check (
    exists (
      select 1 from public.class_merge_groups g
      where g.id=class_merge_members.group_id
        and public.has_institution_access(auth.uid(),g.institution_id)
        and (class_merge_members.batch_id is null or exists (
          select 1 from public.batches b join public.courses c on c.id=b.course_id
          join public.departments d on d.id=c.department_id
          where b.id=class_merge_members.batch_id and d.institution_id=g.institution_id
        ))
        and (class_merge_members.course_id is null or exists (
          select 1 from public.courses c join public.departments d on d.id=c.department_id
          where c.id=class_merge_members.course_id and d.institution_id=g.institution_id
        ))
    )
  );

create table if not exists public.timetable_teacher_unavailability (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  faculty_user_id uuid not null references auth.users(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 1 and 6),
  period_id uuid not null references public.class_periods(id) on delete cascade,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (faculty_user_id,day_of_week,period_id)
);
alter table public.timetable_teacher_unavailability enable row level security;
grant select, insert, update, delete on public.timetable_teacher_unavailability to authenticated;
drop policy if exists timetable_teacher_unavailability_read on public.timetable_teacher_unavailability;
create policy timetable_teacher_unavailability_read on public.timetable_teacher_unavailability
  for select to authenticated using (public.has_institution_access(auth.uid(),institution_id));
drop policy if exists timetable_teacher_unavailability_manage on public.timetable_teacher_unavailability;
create policy timetable_teacher_unavailability_manage on public.timetable_teacher_unavailability
  for all to authenticated
  using (public.has_role(auth.uid(),'super_admin'::public.app_role)
    or ('timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and public.has_institution_access(auth.uid(),institution_id)))
  with check (public.has_role(auth.uid(),'super_admin'::public.app_role)
    or ('timetable:edit' = any(public.get_user_permissions(auth.uid()))
      and public.has_institution_access(auth.uid(),institution_id)));
