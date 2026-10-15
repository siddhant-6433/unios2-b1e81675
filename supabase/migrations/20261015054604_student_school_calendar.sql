-- Student-facing school calendar/almanac for academic sessions.

create table public.school_calendar_events (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id) on delete cascade,
 session_id uuid not null references public.admission_sessions(id) on delete cascade,
 title text not null,
 event_type text not null check(event_type in ('holiday','vacation','school_event','activity','ptm','result_day','other')),
 starts_on date not null,
 ends_on date not null,
 notes text,
 no_school boolean not null default false,
 blocks_exams boolean not null default false,
 status text not null default 'draft' check(status in ('draft','published','cancelled')),
 created_by uuid not null references auth.users(id),
 published_by uuid references auth.users(id),
 published_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_on>=starts_on),
 check(not blocks_exams or no_school)
);
create index school_calendar_events_scope_dates_idx on public.school_calendar_events(institution_id,session_id,starts_on,ends_on) where status='published';

create or replace function public.cbse_family_school_calendar(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_session uuid; v_institution uuid;
begin
 if not public.cbse_family(_student_id) then raise exception 'Access denied'; end if;
 select s.session_id,c.institution_id into v_session,v_institution from public.students s join public.courses c on c.id=s.course_id where s.id=_student_id;
 return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_type',e.event_type,'starts_on',e.starts_on,'ends_on',e.ends_on,'notes',e.notes,'no_school',e.no_school) order by e.starts_on,e.title)
  from public.school_calendar_events e where e.institution_id=v_institution and e.session_id=v_session and e.status='published'),'[]'::jsonb);
end $$;

alter table public.school_calendar_events enable row level security;

create policy school_calendar_events_read on public.school_calendar_events for select to authenticated using(
 status='published' and exists(select 1 from public.students s join public.courses c on c.id=s.course_id
  where c.institution_id=school_calendar_events.institution_id and s.session_id=school_calendar_events.session_id and public.cbse_family(s.id))
 or public.cbse_manager(institution_id,false));
create policy school_calendar_events_write on public.school_calendar_events for all to authenticated
 using(public.cbse_manager(institution_id,false)) with check(public.cbse_manager(institution_id,false));

create or replace function public.cbse_datesheet_school_closures(_datesheet_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'course_name',c.name,'subject_name',s.name,'exam_on',dp.exam_on,'event_title',e.title
 ) order by dp.exam_on,c.name,s.display_order),'[]'::jsonb)
 from public.cbse_datesheets d
 join public.cbse_datesheet_classes dc on dc.datesheet_id=d.id
 join public.courses c on c.id=dc.course_id
 join public.cbse_datesheet_papers dp on dp.datesheet_class_id=dc.id
 join public.subjects s on s.id=dp.subject_id
 join public.school_calendar_events e on e.institution_id=d.institution_id and e.session_id=d.session_id
  and e.status='published' and e.blocks_exams and dp.exam_on between e.starts_on and e.ends_on
 where d.id=_datesheet_id and public.cbse_manager(d.institution_id,false)
$$;

create or replace function public.cbse_datesheet_calendar_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare conflicts jsonb;
begin
 if new.status in ('finalized','released') and old.status is distinct from new.status then
  conflicts:=public.cbse_datesheet_school_closures(new.id);
  if jsonb_array_length(conflicts)>0 then
   raise exception 'Date sheet conflicts with published student no-school dates: %',conflicts;
  end if;
 end if;
 return new;
end $$;
create trigger cbse_datesheet_calendar_guard_before_status
 before update of status on public.cbse_datesheets
 for each row execute function public.cbse_datesheet_calendar_guard();

revoke all on function public.cbse_family_school_calendar(uuid) from public,anon;
grant select,insert,update,delete on public.school_calendar_events to authenticated;
grant execute on function public.cbse_family_school_calendar(uuid) to authenticated;
