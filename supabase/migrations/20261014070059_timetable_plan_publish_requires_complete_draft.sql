-- keep-migration-version: restored production migration 20261014070059; preserve its applied version.
-- timetable plan publish requires complete draft

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
  if coalesce((target.planner_notes->>'unplaced_count')::integer,0)>0 then
    raise exception 'Cannot publish a timetable with unscheduled lesson blocks';
  end if;
  if not exists (
    select 1 from public.timetable_entries e
    join public.timetable_grids g on g.id=e.grid_id
    where g.plan_run_id=_plan_id
  ) then raise exception 'Cannot publish an empty timetable'; end if;

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
