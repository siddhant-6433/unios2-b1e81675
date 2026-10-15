-- cbse datesheet edit drafts
-- keep-migration-version: restored production migration 20261015044826; preserve its applied version.

create function public.cbse_datesheet_update(_datesheet_id uuid,_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 d public.cbse_datesheets; v_class jsonb; v_paper jsonb; v_course uuid; v_class_id uuid;
 v_institution uuid; v_first_institution uuid; v_count integer:=0; v_end date;
begin
 perform cbse_enabled(); perform cbse_actor();
 select * into d from public.cbse_datesheets where id=_datesheet_id for update;
 if not found then raise exception 'Date sheet not found'; end if;
 if d.status<>'draft' then raise exception 'Only a draft date sheet can be edited'; end if;
 if not cbse_manager(d.institution_id,false) then raise exception 'Not authorised to edit this date sheet'; end if;
 if (_payload->>'session_id')::uuid<>d.session_id or _payload->>'category'<>d.category or coalesce((_payload->>'sequence')::integer,1)<>d.sequence then
  raise exception 'The session and assessment type cannot be changed on a saved date sheet';
 end if;
 if exists(select 1 from public.cbse_datesheet_classes where datesheet_id=d.id and exam_id is not null) then raise exception 'This draft is already linked to assessments and cannot be edited'; end if;
 if nullif(btrim(_payload->>'title'),'') is null then raise exception 'Enter a date sheet title'; end if;
 if nullif(_payload->>'reporting_ends_on','') is null then raise exception 'Choose the reporting close date'; end if;
 v_end:=(_payload->>'reporting_ends_on')::date;
 if jsonb_typeof(_payload->'classes')<>'array' or jsonb_array_length(_payload->'classes')=0 then raise exception 'Select at least one class'; end if;
 for v_class in select value from jsonb_array_elements(_payload->'classes') loop
  v_course:=(v_class->>'course_id')::uuid;
  if not exists(select 1 from cbse_courses() c where c.id=v_course) then raise exception 'A selected class is unavailable'; end if;
  select cbse_course_institution(v_course) into v_institution;
  if v_first_institution is null then v_first_institution:=v_institution; elsif v_first_institution<>v_institution then raise exception 'A shared date sheet must cover classes from one campus'; end if;
  if v_institution<>d.institution_id or not cbse_manager(v_institution,false) then raise exception 'Not authorised for a selected class'; end if;
  if jsonb_typeof(v_class->'papers')<>'array' or jsonb_array_length(v_class->'papers')=0 then raise exception 'Add at least one subject date for each selected class'; end if;
  for v_paper in select value from jsonb_array_elements(v_class->'papers') loop
   if not exists(select 1 from public.subjects where id=(v_paper->>'subject_id')::uuid and course_id=v_course and active) then raise exception 'A subject does not belong to its selected class'; end if;
   if nullif(v_paper->>'exam_on','') is null or (v_paper->>'exam_on')::date>v_end then raise exception 'Exam dates must be on or before the reporting close date'; end if;
   if nullif(v_paper->>'starts_at','') is not null and nullif(v_paper->>'ends_at','') is not null and (v_paper->>'ends_at')::time<=(v_paper->>'starts_at')::time then raise exception 'End time must be after start time'; end if;
   v_count:=v_count+1;
  end loop;
 end loop;
 if v_count=0 then raise exception 'Add subject dates'; end if;
 update public.cbse_datesheets set title=btrim(_payload->>'title'),reporting_ends_on=v_end,updated_at=now() where id=d.id;
 delete from public.cbse_datesheet_classes where datesheet_id=d.id;
 for v_class in select value from jsonb_array_elements(_payload->'classes') loop
  v_course:=(v_class->>'course_id')::uuid;
  insert into public.cbse_datesheet_classes(datesheet_id,course_id,section) values(d.id,v_course,nullif(btrim(coalesce(v_class->>'section','')),'')) returning id into v_class_id;
  for v_paper in select value from jsonb_array_elements(v_class->'papers') loop
   insert into public.cbse_datesheet_papers(datesheet_class_id,subject_id,exam_on,starts_at,ends_at,venue)
   values(v_class_id,(v_paper->>'subject_id')::uuid,(v_paper->>'exam_on')::date,nullif(v_paper->>'starts_at','')::time,nullif(v_paper->>'ends_at','')::time,nullif(btrim(coalesce(v_paper->>'venue','')),''));
  end loop;
 end loop;
 return public.cbse_datesheet_get(d.id);
end $$;

create or replace function public.cbse_datesheet_recipients(_datesheet_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d public.cbse_datesheets;
begin
 perform cbse_enabled(); perform cbse_actor();
 select * into d from public.cbse_datesheets where id=_datesheet_id;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id,true) then raise exception 'Only a principal or super admin can notify families'; end if;
 if d.status<>'released' then raise exception 'Release the date sheet before notifying families'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('phone',p.phone) order by p.phone) from (
  select distinct regexp_replace(x.phone,'[^0-9]','','g') phone
  from cbse_datesheet_classes dc join public.students s on s.course_id=dc.course_id and s.session_id=d.session_id
  cross join lateral (values(s.father_phone),(s.father_whatsapp),(s.mother_phone),(s.mother_whatsapp),(s.guardian_phone),(s.phone)) x(phone)
  where dc.datesheet_id=d.id and s.deleted_at is null and s.archived_at is null and nullif(regexp_replace(coalesce(x.phone,''),'[^0-9]','','g'),'') is not null
 ) p),'[]'::jsonb);
end $$;

revoke all on function public.cbse_datesheet_update(uuid,jsonb) from public,anon;
grant execute on function public.cbse_datesheet_update(uuid,jsonb) to authenticated;
