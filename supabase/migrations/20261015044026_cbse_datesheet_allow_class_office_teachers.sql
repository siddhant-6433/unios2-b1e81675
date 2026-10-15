-- Keep the two-term source validation while allowing the assigned class teacher
-- keep-migration-version: restored production migration 20261015044026; preserve its applied version.
-- or school office staff to own a paper when a subject allocation is absent.
create or replace function public.cbse_configure(_exam uuid,_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; x jsonb; sr jsonb; src cbse_exams; required_sequence integer;
begin
 select * into strict e from cbse_exams where id=_exam;
 if e.status<>'draft' then raise exception 'Configuration is frozen; reopen as draft first'; end if;
 if _payload ? 'policy_id' then update cbse_exams set policy_id=(_payload->>'policy_id')::uuid where id=e.id returning * into e; end if;
 if _payload ? 'fee_cutoff' then update cbse_exams set fee_cutoff=(_payload->>'fee_cutoff')::date where id=e.id returning * into e; end if;
 select * into strict pol from cbse_policies where id=e.policy_id;
 if pol.course_id<>e.course_id or pol.session_id<>e.session_id then raise exception 'Policy must match class and session'; end if;
 if _payload ? 'papers' then
  delete from cbse_marks where paper_id in(select id from cbse_papers where exam_id=e.id);
  delete from cbse_papers where exam_id=e.id;
  for x in select value from jsonb_array_elements(_payload->'papers') loop
   select s into sr from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=x->>'subject_id';
   if sr is null or not (
     cbse_teacher(e.id,(x->>'subject_id')::uuid,(x->>'teacher_user_id')::uuid)
     or exists(select 1 from class_teachers ct where ct.course_id=e.course_id and ct.teacher_user_id=(x->>'teacher_user_id')::uuid and ct.active and ct.batch_id is null and ct.session_id=e.session_id and (ct.section is null or ct.section=e.section))
     or exists(select 1 from user_roles ur where ur.user_id=(x->>'teacher_user_id')::uuid and ur.role::text in ('office_assistant','office_admin'))
   ) then raise exception 'Assign a teacher with a subject, class-teacher, or school-office role'; end if;
   insert into cbse_papers(exam_id,subject_id,name,code,teacher_user_id,components)
   select e.id,id,name,code,(x->>'teacher_user_id')::uuid,cbse_assessment_components(e.category,sr->'components')
   from subjects where id=(x->>'subject_id')::uuid and course_id=e.course_id;
  end loop;
 end if;
 if _payload ? 'source_exam_ids' and jsonb_typeof(_payload->'source_exam_ids')='array' and jsonb_array_length(_payload->'source_exam_ids')>0 then
  delete from cbse_sources where exam_id=e.id;
  if e.category='annual' then
   if jsonb_array_length(_payload->'source_exam_ids')<>2 then raise exception 'Final Report requires Term 1 and Term 2 reports'; end if;
   for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
    select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
    if src.category not in ('half_yearly','final') or src.sequence<>1 or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section then raise exception 'Final Report sources must be the Term 1 and Term 2 reports for this class, section and session'; end if;
    if src.status not in ('approved','released') then raise exception 'Both term reports must be approved before configuring the Final Report'; end if;
    if not exists(select 1 from jsonb_array_elements(pol.rules->'annual_weights') a where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence) then raise exception 'Term report does not have an approved policy weight'; end if;
    insert into cbse_sources(exam_id,source_exam_id,weight) select e.id,src.id,(a->>'weight')::numeric from jsonb_array_elements(pol.rules->'annual_weights') a where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence;
   end loop;
   if (select count(*) from cbse_sources where exam_id=e.id)<>2 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.category='half_yearly')<>1 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.category='final')<>1 then raise exception 'Select exactly one Term 1 and one Term 2 report'; end if;
  elsif e.category in ('half_yearly','final') then
   required_sequence:=case when e.category='half_yearly' then 1 else 3 end;
   if jsonb_array_length(_payload->'source_exam_ids')<>2 then raise exception 'Select both required Unit Test reports'; end if;
   for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
    select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
    if src.category<>'unit_test' or src.sequence not in (required_sequence,required_sequence+1) or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section then raise exception 'Source tests must match the required term, class, section and session'; end if;
    insert into cbse_sources(exam_id,source_exam_id,weight) values(e.id,src.id,1);
   end loop;
   if (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=required_sequence)<>1 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=required_sequence+1)<>1 then raise exception 'Select exactly the required pair of Unit Tests'; end if;
  else raise exception 'This assessment type cannot use source assessments'; end if;
 elsif e.category in ('half_yearly','final','annual') and _payload ? 'source_exam_ids' then
  raise exception 'Select all required source assessments';
 end if;
 perform cbse_refresh_roster(e.id);
end $$;

create unique index if not exists cbse_datesheets_one_assessment_per_campus
 on public.cbse_datesheets(institution_id,session_id,category,sequence);

create or replace function public.cbse_datesheet_finalize(_datesheet_id uuid,_release boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d cbse_datesheets; actor uuid:=cbse_actor(); c record; v_exam uuid; v_policy uuid; v_teacher uuid; v_papers jsonb; v_sources jsonb; v_end date; v_existing cbse_exams;
begin
 perform cbse_enabled();
 select * into d from cbse_datesheets where id=_datesheet_id for update;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id, _release) then raise exception 'Not authorised to finalise or release this date sheet'; end if;
 if d.status='draft' then
  for c in select dc.*,min(dp.exam_on) starts_on from cbse_datesheet_classes dc join cbse_datesheet_papers dp on dp.datesheet_class_id=dc.id where dc.datesheet_id=d.id group by dc.id loop
    select id into v_policy from cbse_policies where course_id=c.course_id and session_id=d.session_id and status='approved' order by version desc limit 1;
    if v_policy is null then raise exception 'Approve an assessment policy for every selected class first'; end if;
    select ct.teacher_user_id into v_teacher from class_teachers ct where ct.course_id=c.course_id and ct.session_id=d.session_id and ct.active and ct.batch_id is null and (ct.section is null or ct.section=c.section) order by ct.section nulls first limit 1;
    if v_teacher is null then raise exception 'Assign a class teacher for every selected class first'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('subject_id',dp.subject_id,'teacher_user_id',coalesce(ta.faculty_user_id,v_teacher,office.user_id)) order by dp.exam_on,dp.starts_at),'[]'::jsonb)
      into v_papers from cbse_datesheet_papers dp
      left join lateral (select sa.faculty_user_id from subject_allocations sa where sa.subject_id=dp.subject_id and sa.active and sa.batch_id is null and sa.session_id=d.session_id and (sa.section is null or sa.section=c.section) order by sa.created_at limit 1) ta on true
      left join lateral (select ur.user_id from user_roles ur where ur.role::text in ('office_assistant','office_admin') order by ur.user_id limit 1) office on true
      where dp.datesheet_class_id=c.id;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.sequence),'[]'::jsonb) into v_sources from (
      select distinct on(e.sequence) e.* from cbse_exams e where e.course_id=c.course_id and e.session_id=d.session_id and e.section is not distinct from c.section and e.status<>'cancelled' and e.category='unit_test' and e.sequence in (case when d.category='half_yearly' then 1 when d.category='final' then 3 else 0 end,case when d.category='half_yearly' then 2 when d.category='final' then 4 else 0 end) order by e.sequence,e.revision desc,e.created_at desc
    ) q;
    if d.category in ('half_yearly','final') and (jsonb_array_length(v_sources)<>2 or not exists(select 1 from jsonb_array_elements(v_sources) e where (e->>'sequence')::int=case when d.category='half_yearly' then 1 else 3 end) or not exists(select 1 from jsonb_array_elements(v_sources) e where (e->>'sequence')::int=case when d.category='half_yearly' then 2 else 4 end)) then raise exception 'Create both required Unit Test assessments for every selected class first'; end if;
    select * into v_existing from cbse_exams e where e.course_id=c.course_id and e.session_id=d.session_id and e.section is not distinct from c.section and e.category=d.category and e.sequence=d.sequence and e.status<>'cancelled' order by e.created_at desc limit 1;
    if found then
      if v_existing.status<>'draft' then raise exception 'An assessment already exists and is not a draft. Reopen it before changing its exam dates.'; end if;
      if exists(select 1 from cbse_marks m join cbse_papers p on p.id=m.paper_id where p.exam_id=v_existing.id) then raise exception 'An assessment already contains marks. Its date sheet cannot overwrite the assessment.'; end if;
      perform public.cbse_action(v_existing.id,'configure_exam',v_existing.version,jsonb_build_object('policy_id',v_policy,'fee_cutoff',c.starts_on,'papers',v_papers,'source_exam_ids',v_sources));
      update cbse_exams set starts_on=c.starts_on,ends_on=d.reporting_ends_on,fee_cutoff=c.starts_on,version=version+1 where id=v_existing.id;
      v_exam:=v_existing.id;
    else
      v_exam:=(public.cbse_action(null,'create_exam',null,jsonb_build_object(
        'course_id',c.course_id,'session_id',d.session_id,'section',c.section,
        'name',d.title||' · '||(select name from courses where id=c.course_id),'academic_year',(select name from admission_sessions where id=d.session_id),
        'category',d.category,'sequence',d.sequence,'starts_on',c.starts_on,'ends_on',d.reporting_ends_on,'fee_cutoff',c.starts_on,
        'policy_id',v_policy,'class_teacher_user_id',v_teacher,'papers',v_papers,'source_exam_ids',v_sources))->>'id')::uuid;
    end if;
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
