-- cbse shared datesheets
-- keep-migration-version: restored production migration 20261014181258; preserve its applied version.

create table public.cbse_datesheets (
 id uuid primary key default gen_random_uuid(),
 institution_id uuid not null references public.institutions(id),
 session_id uuid not null references public.admission_sessions(id),
 title text not null,
 category text not null check(category in ('unit_test','half_yearly','final')),
 sequence integer not null default 1,
 reporting_ends_on date not null,
 status text not null default 'draft' check(status in ('draft','finalized','released')),
 created_by uuid not null,
 finalized_at timestamptz,
 released_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((category='unit_test' and sequence between 1 and 4) or (category<>'unit_test' and sequence=1))
);
create table public.cbse_datesheet_classes (
 id uuid primary key default gen_random_uuid(),
 datesheet_id uuid not null references public.cbse_datesheets(id) on delete cascade,
 course_id uuid not null references public.courses(id),
 section text,
 exam_id uuid references public.cbse_exams(id),
 unique(datesheet_id,course_id,section)
);
create table public.cbse_datesheet_papers (
 id uuid primary key default gen_random_uuid(),
 datesheet_class_id uuid not null references public.cbse_datesheet_classes(id) on delete cascade,
 subject_id uuid not null references public.subjects(id),
 exam_on date not null,
 starts_at time,
 ends_at time,
 venue text,
 unique(datesheet_class_id,subject_id),
 check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create index cbse_datesheets_institution_session_idx on public.cbse_datesheets(institution_id,session_id,created_at desc);
alter table public.cbse_papers add column if not exists exam_on date;

alter table public.cbse_datesheets enable row level security;
alter table public.cbse_datesheet_classes enable row level security;
alter table public.cbse_datesheet_papers enable row level security;

create function public.cbse_datesheet_save(_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=cbse_actor(); v_session uuid; v_institution uuid; v_first_institution uuid; v_sheet uuid; v_class jsonb; v_paper jsonb; v_course uuid; v_class_id uuid; v_category text; v_sequence integer; v_exam_date date; v_count int:=0;
begin
 perform cbse_enabled();
 v_session:=(_payload->>'session_id')::uuid;
 v_category:=_payload->>'category'; v_sequence:=coalesce((_payload->>'sequence')::integer,1);
 if v_category not in ('unit_test','half_yearly','final') then raise exception 'Choose Unit Test, Half Yearly, or Annual Examination'; end if;
 if (v_category='unit_test' and v_sequence not between 1 and 4) or (v_category<>'unit_test' and v_sequence<>1) then raise exception 'Choose a valid assessment sitting'; end if;
 if nullif(btrim(_payload->>'title'),'') is null then raise exception 'Enter a date sheet title'; end if;
 if (_payload->>'reporting_ends_on') is null then raise exception 'Choose the reporting close date'; end if;
 if jsonb_typeof(_payload->'classes')<>'array' or jsonb_array_length(_payload->'classes')=0 then raise exception 'Select at least one class'; end if;
 for v_class in select value from jsonb_array_elements(_payload->'classes') loop
  v_course:=(v_class->>'course_id')::uuid;
  if not exists(select 1 from cbse_courses() c where c.id=v_course) then raise exception 'A selected class is unavailable'; end if;
  select cbse_course_institution(v_course) into v_institution;
  if v_first_institution is null then v_first_institution:=v_institution; elsif v_first_institution<>v_institution then raise exception 'A shared date sheet must cover classes from one campus'; end if;
  if not cbse_manager(v_institution,false) then raise exception 'Not authorised to create date sheets for a selected campus'; end if;
  if exists(select 1 from cbse_courses() c where c.id=v_course and c.institution_id<>v_institution) then raise exception 'Invalid campus for selected class'; end if;
  if exists(select 1 from cbse_datesheets where institution_id=v_institution and session_id=v_session and category=v_category and sequence=v_sequence and status<>'draft') then raise exception 'A date sheet for this assessment has already been finalised for the campus'; end if;
  if jsonb_typeof(v_class->'papers')<>'array' or jsonb_array_length(v_class->'papers')=0 then raise exception 'Add at least one subject date for each selected class'; end if;
  for v_paper in select value from jsonb_array_elements(v_class->'papers') loop
   if not exists(select 1 from subjects where id=(v_paper->>'subject_id')::uuid and course_id=v_course and active) then raise exception 'A subject does not belong to its selected class'; end if;
   v_exam_date:=(v_paper->>'exam_on')::date;
   if v_exam_date is null or v_exam_date>(_payload->>'reporting_ends_on')::date then raise exception 'Exam dates must be on or before the reporting close date'; end if;
   v_count:=v_count+1;
  end loop;
 end loop;
 if v_count=0 then raise exception 'Add subject dates'; end if;
 v_institution:=v_first_institution;
 insert into cbse_datesheets(institution_id,session_id,title,category,sequence,reporting_ends_on,created_by)
 values(v_institution,v_session,btrim(_payload->>'title'),v_category,v_sequence,(_payload->>'reporting_ends_on')::date,actor) returning id into v_sheet;
 for v_class in select value from jsonb_array_elements(_payload->'classes') loop
  v_course:=(v_class->>'course_id')::uuid;
  insert into cbse_datesheet_classes(datesheet_id,course_id,section) values(v_sheet,v_course,nullif(btrim(coalesce(v_class->>'section','')),'')) returning id into v_class_id;
  for v_paper in select value from jsonb_array_elements(v_class->'papers') loop
   insert into cbse_datesheet_papers(datesheet_class_id,subject_id,exam_on,starts_at,ends_at,venue)
   values(v_class_id,(v_paper->>'subject_id')::uuid,(v_paper->>'exam_on')::date,nullif(v_paper->>'starts_at','')::time,nullif(v_paper->>'ends_at','')::time,nullif(btrim(coalesce(v_paper->>'venue','')),''));
  end loop;
 end loop;
 return public.cbse_datesheet_get(v_sheet);
end $$;

create function public.cbse_datesheet_finalize(_datesheet_id uuid,_release boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d cbse_datesheets; actor uuid:=cbse_actor(); c record; v_exam uuid; v_policy uuid; v_teacher uuid; v_papers jsonb; v_sources jsonb; v_starts date; v_end date;
begin
 perform cbse_enabled();
 select * into d from cbse_datesheets where id=_datesheet_id for update;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id, _release) then raise exception 'Not authorised to finalise or release this date sheet'; end if;
 if d.status='draft' then
  for c in select dc.*, coalesce(jsonb_agg(jsonb_build_object('subject_id',dp.subject_id,'teacher_user_id',ta.faculty_user_id)),'[]'::jsonb) papers,
    min(dp.exam_on) starts_on
   from cbse_datesheet_classes dc join cbse_datesheet_papers dp on dp.datesheet_class_id=dc.id
   left join lateral (select sa.faculty_user_id from subject_allocations sa where sa.subject_id=dp.subject_id and sa.active and sa.batch_id is null and sa.session_id=d.session_id and (sa.section is null or sa.section=dc.section) order by sa.created_at limit 1) ta on true
   where dc.datesheet_id=d.id group by dc.id loop
    select id into v_policy from cbse_policies where course_id=c.course_id and session_id=d.session_id and status='approved' order by version desc limit 1;
    if v_policy is null then raise exception 'Approve an assessment policy for every selected class first'; end if;
    select ct.teacher_user_id into v_teacher from class_teachers ct where ct.course_id=c.course_id and ct.session_id=d.session_id and ct.active and ct.batch_id is null and (ct.section is null or ct.section=c.section) order by ct.section nulls first limit 1;
    if v_teacher is null then raise exception 'Assign a class teacher for every selected class first'; end if;
    if exists(select 1 from jsonb_array_elements(c.papers) p where p->>'teacher_user_id' is null) then raise exception 'Assign a subject teacher to every scheduled paper first'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('subject_id',dp.subject_id,'teacher_user_id',ta.faculty_user_id) order by dp.exam_on,dp.starts_at)
      ,'[]'::jsonb) into v_papers from cbse_datesheet_papers dp
      left join lateral (select sa.faculty_user_id from subject_allocations sa where sa.subject_id=dp.subject_id and sa.active and sa.batch_id is null and sa.session_id=d.session_id and (sa.section is null or sa.section=c.section) order by sa.created_at limit 1) ta on true
      where dp.datesheet_class_id=c.id;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.sequence),'[]'::jsonb) into v_sources from (
      select distinct on(e.sequence) e.* from cbse_exams e where e.course_id=c.course_id and e.session_id=d.session_id and e.section is not distinct from c.section and e.status in ('approved','released') and e.category='unit_test' and e.sequence in (case when d.category='half_yearly' then 1 when d.category='final' then 3 else 0 end,case when d.category='half_yearly' then 2 when d.category='final' then 4 else 0 end) order by e.sequence,e.revision desc,e.created_at desc
    ) q;
    if d.category in ('half_yearly','final') and (jsonb_array_length(v_sources)<>2 or not exists(select 1 from jsonb_array_elements(v_sources) e where (e->>'sequence')::int=case when d.category='half_yearly' then 1 else 3 end) or not exists(select 1 from jsonb_array_elements(v_sources) e where (e->>'sequence')::int=case when d.category='half_yearly' then 2 else 4 end)) then raise exception 'Approve both required Unit Test reports for every selected class first'; end if;
    v_end:=d.reporting_ends_on;
    v_exam:=(public.cbse_action(null,'create_exam',null,jsonb_build_object(
      'course_id',c.course_id,'session_id',d.session_id,'section',c.section,
      'name',d.title||' · '||(select name from courses where id=c.course_id),'academic_year',(select name from admission_sessions where id=d.session_id),
      'category',d.category,'sequence',d.sequence,'starts_on',c.starts_on,'ends_on',v_end,'fee_cutoff',c.starts_on,
      'policy_id',v_policy,'class_teacher_user_id',v_teacher,'papers',v_papers,
      'source_exam_ids',coalesce((select jsonb_agg(e->>'id') from jsonb_array_elements(v_sources) e),'[]'::jsonb)))->>'id')::uuid;
    update cbse_papers p set exam_on=dp.exam_on from cbse_datesheet_papers dp where dp.datesheet_class_id=c.id and p.exam_id=v_exam and p.subject_id=dp.subject_id;
    update cbse_datesheet_classes set exam_id=v_exam where id=c.id;
  end loop;
  update cbse_datesheets set status='finalized',finalized_at=now(),updated_at=now() where id=d.id;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(null,'finalize_datesheet',actor,d.title,jsonb_build_object('datesheet_id',d.id));
 end if;
 if _release then
  if d.status='draft' then raise exception 'Finalise the date sheet before releasing it'; end if;
  update cbse_datesheets set status='released',released_at=now(),updated_at=now() where id=d.id;
  d.status:='released';
 end if;
 return public.cbse_datesheet_get(_datesheet_id);
end $$;

create function public.cbse_datesheet_get(_datesheet_id uuid,_student_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d cbse_datesheets;
begin
 perform cbse_enabled(); perform cbse_actor();
 select * into d from cbse_datesheets where id=_datesheet_id;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id,false) then
  if _student_id is null or d.status<>'released' or not cbse_family(_student_id) or not exists(select 1 from students s join cbse_datesheet_classes dc on dc.course_id=s.course_id where s.id=_student_id and dc.datesheet_id=d.id and s.session_id=d.session_id) then raise exception 'Date sheet is not available'; end if;
 end if;
 return jsonb_build_object('id',d.id,'institution_id',d.institution_id,'session_id',d.session_id,'title',d.title,'category',d.category,'sequence',d.sequence,'reporting_ends_on',d.reporting_ends_on,'status',d.status,'created_at',d.created_at,'released_at',d.released_at,
 'classes',(select coalesce(jsonb_agg(jsonb_build_object('course_id',dc.course_id,'course_name',c.name,'course_code',c.code,'section',dc.section,'exam_id',dc.exam_id,'papers',(select coalesce(jsonb_agg(jsonb_build_object('subject_id',dp.subject_id,'subject_name',s.name,'exam_on',dp.exam_on,'starts_at',dp.starts_at,'ends_at',dp.ends_at,'venue',dp.venue) order by dp.exam_on,dp.starts_at,s.display_order),'[]'::jsonb) from cbse_datesheet_papers dp join subjects s on s.id=dp.subject_id where dp.datesheet_class_id=dc.id)) order by cbse_grade_from_code(c.code),c.name),'[]'::jsonb) from cbse_datesheet_classes dc join courses c on c.id=dc.course_id where dc.datesheet_id=d.id));
end $$;

create function public.cbse_datesheet_list(_session_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform cbse_enabled(); perform cbse_actor();
 return coalesce((select jsonb_agg(public.cbse_datesheet_get(id) order by created_at desc) from cbse_datesheets where session_id is not distinct from _session_id and cbse_manager(institution_id,false)),'[]'::jsonb);
end $$;

create function public.cbse_family_datesheets(_student_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_course uuid; v_session uuid;
begin
 perform cbse_enabled();
 if not cbse_family(_student_id) then raise exception 'Access denied'; end if;
 select course_id,session_id into v_course,v_session from students where id=_student_id;
 return coalesce((select jsonb_agg(public.cbse_datesheet_get(d.id,_student_id) order by d.created_at desc) from cbse_datesheets d join cbse_datesheet_classes dc on dc.datesheet_id=d.id where dc.course_id=v_course and d.session_id=v_session and d.status='released'),'[]'::jsonb);
end $$;

create function public.cbse_datesheet_recipients(_datesheet_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d cbse_datesheets;
begin
 perform cbse_enabled(); perform cbse_actor();
 select * into d from cbse_datesheets where id=_datesheet_id;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id,true) then raise exception 'Only a principal or super admin can notify families'; end if;
 if d.status<>'released' then raise exception 'Release the date sheet before notifying families'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('phone',p.phone) order by p.phone) from (
   select distinct regexp_replace(x.phone,'[^0-9]','','g') phone
   from cbse_datesheet_classes dc join students s on s.course_id=dc.course_id and s.session_id=d.session_id
   cross join lateral (values(s.father_phone),(s.mother_phone),(s.guardian_phone),(s.phone)) x(phone)
   where dc.datesheet_id=d.id and s.deleted_at is null and s.archived_at is null and nullif(regexp_replace(coalesce(x.phone,''),'[^0-9]','','g'),'') is not null
 ) p),'[]'::jsonb);
end $$;

revoke all on function public.cbse_datesheet_save(jsonb) from public,anon;
revoke all on function public.cbse_datesheet_finalize(uuid,boolean) from public,anon;
revoke all on function public.cbse_datesheet_get(uuid,uuid) from public,anon;
revoke all on function public.cbse_datesheet_list(uuid) from public,anon;
revoke all on function public.cbse_family_datesheets(uuid) from public,anon;
revoke all on function public.cbse_datesheet_recipients(uuid) from public,anon;
grant execute on function public.cbse_datesheet_save(jsonb) to authenticated;
grant execute on function public.cbse_datesheet_finalize(uuid,boolean) to authenticated;
grant execute on function public.cbse_datesheet_get(uuid,uuid) to authenticated;
grant execute on function public.cbse_datesheet_list(uuid) to authenticated;
grant execute on function public.cbse_family_datesheets(uuid) to authenticated;
grant execute on function public.cbse_datesheet_recipients(uuid) to authenticated;
