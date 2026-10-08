-- cbse half yearly ut best and co scholastic grades
-- Half Yearly reports combine the better of UT-1/UT-2 with the school exam,
-- notebook submission and subject enrichment. Co-scholastic grades are
-- recorded on the per-student report roster and copied into report snapshots.

alter table public.cbse_roster
  add column art_grade text check (art_grade is null or art_grade in ('A1','A2','B1','B2','C1','C2','D','E')),
  add column moral_values_grade text check (moral_values_grade is null or moral_values_grade in ('A1','A2','B1','B2','C1','C2','D','E'));

create or replace function public.cbse_assessment_components(_category text, _source jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select case _category
   when 'unit_test' then jsonb_build_array(jsonb_build_object('key','marks','label','Unit Test','max',20,'pass_percent',null))
   when 'half_yearly' then jsonb_build_array(
     jsonb_build_object('key','half_yearly','label','Half Yearly Examination','max',80,'pass_percent',33),
     jsonb_build_object('key','notebook','label','Notebook','max',5,'pass_percent',null),
     jsonb_build_object('key','sea','label','Subject Enrichment Activity (SEA)','max',5,'pass_percent',null))
   else _source end
$$;

create or replace function public.cbse_configure(_exam uuid,_payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; x jsonb; sr jsonb; src cbse_exams;
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
   if sr is null or not cbse_teacher(e.id,(x->>'subject_id')::uuid,(x->>'teacher_user_id')::uuid) then raise exception 'Teacher must be assigned to this subject, class, section and session'; end if;
   insert into cbse_papers(exam_id,subject_id,name,code,teacher_user_id,components)
   select e.id,id,name,code,(x->>'teacher_user_id')::uuid,cbse_assessment_components(e.category,sr->'components')
   from subjects where id=(x->>'subject_id')::uuid and course_id=e.course_id;
  end loop;
 end if;
 if _payload ? 'source_exam_ids' and jsonb_typeof(_payload->'source_exam_ids')='array' and jsonb_array_length(_payload->'source_exam_ids')>0 then
  delete from cbse_sources where exam_id=e.id;
  if e.category='annual' then
   for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
    select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
    if src.category='annual' or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section then raise exception 'Annual sources must match this class, section and session'; end if;
    if not exists(select 1 from jsonb_array_elements(pol.rules->'annual_weights') a where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence) then raise exception 'Assessment does not have an approved annual weight'; end if;
    insert into cbse_sources(exam_id,source_exam_id,weight)
     select e.id,src.id,(a->>'weight')::numeric from jsonb_array_elements(pol.rules->'annual_weights') a
     where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence;
   end loop;
  elsif e.category='half_yearly' then
   if jsonb_array_length(coalesce(_payload->'source_exam_ids','[]'::jsonb))<>2 then raise exception 'Select both UT-1 and UT-2 as Half Yearly sources'; end if;
   for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
    select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
    if src.category<>'unit_test' or src.sequence not in (1,2) or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section then raise exception 'Half Yearly sources must be UT-1 and UT-2 for this class, section and session'; end if;
    if src.status not in ('approved','released') then raise exception 'UT-1 and UT-2 must be approved before configuring Half Yearly'; end if;
    insert into cbse_sources(exam_id,source_exam_id,weight) values(e.id,src.id,1);
   end loop;
   if (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=1)=1
      and (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=2)=1 then null;
   else raise exception 'Select exactly one UT-1 and one UT-2'; end if;
  else
   raise exception 'Only annual and Half Yearly reports can use source assessments';
  end if;
 elsif e.category='half_yearly' and _payload ? 'source_exam_ids' then
  raise exception 'Select both UT-1 and UT-2 as Half Yearly sources';
 end if;
 perform cbse_refresh_roster(e.id);
end $$;

create or replace function public.cbse_best_unit_test_score(_exam uuid,_student uuid,_subject uuid)
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e cbse_exams; src record; subj jsonb; best numeric; current_score numeric; current_max numeric;
begin
 select * into strict e from cbse_exams where id=_exam;
 if e.category<>'half_yearly' then return null; end if;
 if (select count(*) from cbse_sources where exam_id=e.id)<>2 then raise exception 'Select both UT-1 and UT-2 before opening Half Yearly'; end if;
 for src in
  select se.id,se.sequence,se.status,se.revision,rp.snapshot,rp.id report_id
  from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
  left join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released')
  where cs.exam_id=e.id order by se.sequence
 loop
  if src.status not in ('approved','released') or src.report_id is null then raise exception 'Current approved UT-1 and UT-2 reports are required for every student'; end if;
  select s into subj from jsonb_array_elements(src.snapshot->'subjects') s where s->>'subject_id'=_subject::text;
  if subj is null then raise exception 'A UT report is missing a required subject'; end if;
  current_score:=nullif(subj->>'obtained','')::numeric;
  current_max:=nullif(subj->>'max','')::numeric;
  if current_score is not null and current_max>0 then
   current_score:=round(current_score/current_max*10,(select (rules->>'rounding')::integer from cbse_policies where id=e.policy_id));
   best:=greatest(coalesce(best,-1),current_score);
  end if;
 end loop;
 return case when best is null or best<0 then null else best end;
end $$;

-- Keep the existing report builder for its identity, attendance, fee, policy and
-- approval fields, then replace non-annual marks using the exam-specific paper
-- components and append the calculated UT component for Half Yearly reports.
create or replace function public.cbse_guard_half_yearly_open()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.category='half_yearly' and new.status='open' and old.status is distinct from new.status then
  if (select count(*) from cbse_sources where exam_id=new.id)<>2
     or exists(select 1 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
       where cs.exam_id=new.id and (se.category<>'unit_test' or se.sequence not in (1,2) or se.status not in ('approved','released')))
     or (select count(distinct se.sequence) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=new.id and se.sequence in (1,2))<>2
  then raise exception 'Current approved UT-1 and UT-2 reports are required before opening Half Yearly'; end if;
 end if;
 return new;
end $$;
create trigger cbse_guard_half_yearly_open before update of status on public.cbse_exams
for each row execute function public.cbse_guard_half_yearly_open();

create or replace function public.cbse_link_report_sources()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in ('approved','released') and exists(select 1 from cbse_exams e where e.id=new.exam_id and e.category in ('annual','half_yearly')) then
  insert into cbse_report_sources(report_id,source_report_id)
  select new.id,srp.id from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
   join cbse_reports srp on srp.exam_id=se.id and srp.revision=se.revision and srp.student_id=new.student_id
    and srp.status in ('approved','released') where cs.exam_id=new.exam_id
  on conflict do nothing;
 end if;
 return new;
end $$;
create trigger cbse_link_report_sources after insert or update of status on public.cbse_reports
for each row execute function public.cbse_link_report_sources();

alter function public.cbse_snapshot(uuid,uuid,uuid,text) rename to cbse_snapshot_before_half_yearly;
create function public.cbse_snapshot(_exam uuid,_student uuid,_report uuid,_remarks text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; base jsonb; row jsonb; v_student uuid; new_rows jsonb:='[]'; comps jsonb; comp jsonb; subject_rule jsonb;
 p cbse_papers; m cbse_marks; score numeric; obtained numeric; maximum numeric; pct numeric; passed boolean;
 total numeric:=0; total_max numeric:=0; all_pass boolean:=true; has_present boolean:=false; subject_status text;
 contributes boolean; source_ids jsonb; art text; moral text;
begin
 select * into strict e from cbse_exams where id=_exam;
 if e.category='half_yearly' then
  if (select count(*) from cbse_sources where exam_id=e.id)<>2 then raise exception 'Half Yearly requires both UT-1 and UT-2'; end if;
  if exists(select 1 from cbse_roster where exam_id=e.id and student_id=_student and (art_grade is null or moral_values_grade is null)) then raise exception 'Enter Art and Moral Values grades for every student before approval'; end if;
  for v_student in select student_id from cbse_roster where exam_id=e.id loop
   if exists(select 1 from cbse_papers pp where pp.exam_id=e.id and exists(select 1 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id left join cbse_reports rp on rp.exam_id=se.id and rp.student_id=v_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=e.id and (se.status not in ('approved','released') or rp.id is null))) then raise exception 'Current approved UT-1 and UT-2 reports are required for every student'; end if;
  end loop;
 end if;
 base:=cbse_snapshot_before_half_yearly(_exam,_student,_report,_remarks);
 if e.category='annual' then return base; end if;
 select * into strict pol from cbse_policies where id=e.policy_id;
 select coalesce(jsonb_agg(rp.id order by se.sequence),'[]'::jsonb) into source_ids
  from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
  join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released')
  where cs.exam_id=e.id;
 select art_grade,moral_values_grade into art,moral from cbse_roster where exam_id=e.id and student_id=_student;
 for row in select value from jsonb_array_elements(base->'subjects') loop
  select * into p from cbse_papers where exam_id=e.id and subject_id=(row->>'subject_id')::uuid;
  select * into m from cbse_marks where paper_id=p.id and student_id=_student;
  select s into strict subject_rule from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=p.subject_id::text;
  contributes:=coalesce((subject_rule->>'contributes_to_total')::boolean,true);
  subject_status:=m.status; comps:='[]'::jsonb; obtained:=0; maximum:=0; passed:=true;
  for comp in select value from jsonb_array_elements(p.components) loop
   score:=case when subject_status='present' then nullif(m.scores->>(comp->>'key'),'')::numeric
               when subject_status='absent' and pol.rules->>'absent_treatment'='zero' then 0 else null end;
   comps:=comps||jsonb_build_array(jsonb_build_object('key',comp->>'key','label',comp->>'label','max',(comp->>'max')::numeric,'score',score));
   if score is not null then
    obtained:=obtained+score; maximum:=maximum+(comp->>'max')::numeric;
    if comp->>'pass_percent' is not null and score*100<(comp->>'max')::numeric*(comp->>'pass_percent')::numeric then passed:=false; end if;
   end if;
  end loop;
  if e.category='half_yearly' then
   score:=cbse_best_unit_test_score(e.id,_student,p.subject_id);
   comps:=comps||jsonb_build_array(jsonb_build_object('key','best_unit_test','label','Best of UT-1 and UT-2','max',10,'score',score));
   if score is not null then obtained:=obtained+score; maximum:=maximum+10; end if;
  end if;
  if subject_status='exempt' or (subject_status='absent' and pol.rules->>'absent_treatment'='exclude') then obtained:=null; maximum:=0; pct:=null; passed:=null;
  elsif maximum>0 then
   pct:=round(obtained*100/maximum,(pol.rules->>'rounding')::integer);
   if (select nullif(s->>'pass_percent','')::numeric from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=p.subject_id::text) is not null
      and obtained*100<maximum*(select (s->>'pass_percent')::numeric from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=p.subject_id::text) then passed:=false; end if;
  else pct:=null; passed:=null; end if;
  -- Keep the existing weighted annual aggregate interoperable when source
  -- assessments use different direct-entry maxima (UT=20, Half Yearly=90+10).
  if (subject_status='present' or subject_status='absent' and pol.rules->>'absent_treatment'='zero') and maximum>0 then
   for comp in select value from jsonb_array_elements(subject_rule->'components') loop
    comps:=comps||jsonb_build_array(jsonb_build_object('key',comp->>'key','label',comp->>'label','max',(comp->>'max')::numeric,
      'score',round(obtained/maximum*(comp->>'max')::numeric,(pol.rules->>'rounding')::integer),'source_only',true));
   end loop;
  end if;
  if subject_status='present' then has_present:=true; end if;
  if passed=false then all_pass:=false; end if;
  if contributes and obtained is not null then total:=total+obtained; total_max:=total_max+maximum; end if;
  row:=jsonb_set(row,'{status}',to_jsonb(subject_status));
  row:=jsonb_set(row,'{components}',comps);
  row:=jsonb_set(row,'{obtained}',coalesce(to_jsonb(round(obtained,(pol.rules->>'rounding')::integer)),'null'::jsonb));
  row:=jsonb_set(row,'{max}',to_jsonb(maximum));
  row:=jsonb_set(row,'{percentage}',coalesce(to_jsonb(pct),'null'::jsonb));
  row:=jsonb_set(row,'{grade}',coalesce(to_jsonb(cbse_grade(pct,pol.rules)),'null'::jsonb));
  row:=jsonb_set(row,'{passed}',coalesce(to_jsonb(passed),'null'::jsonb));
  row:=jsonb_set(row,'{contributes_to_total}',to_jsonb(contributes));
  new_rows:=new_rows||jsonb_build_array(row);
 end loop;
 pct:=case when total_max>0 then round(total*100/total_max,(pol.rules->>'rounding')::integer) end;
 base:=jsonb_set(base,'{subjects}',new_rows);
 base:=jsonb_set(base,'{summary}',jsonb_build_object('obtained',round(total,(pol.rules->>'rounding')::integer),'max',total_max,'percentage',pct,'grade',cbse_grade(pct,pol.rules),
  'result',case when not has_present then 'absent' when not all_pass then 'fail' when total_max=0 then 'incomplete' else 'pass' end));
 base:=jsonb_set(base,'{source_report_ids}',source_ids);
 if e.category='half_yearly' then base:=jsonb_set(base,'{co_scholastic_grades}',jsonb_build_object('art',art,'moral_values',moral));
 else base:=base-'co_scholastic_grades'; end if;
 return base;
end $$;

create or replace function public.cbse_co_scholastic_editor(_exam uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.cbse_class_teacher(_exam)
  or exists(select 1 from cbse_exams e join user_institution_access a on a.user_id=auth.uid() and a.institution_id=e.institution_id
    where e.id=_exam and a.role::text in ('office_assistant','office_admin'))
  or exists(select 1 from cbse_exams e join subjects s on s.course_id=e.course_id
    join subject_allocations a on a.subject_id=s.id and a.faculty_user_id=auth.uid() and a.active and a.batch_id is null
      and a.session_id=e.session_id and (a.section is null or a.section=e.section)
    where e.id=_exam and (upper(s.code)='COMP' or s.name ilike '%computer%'))
$$;

create or replace function public.cbse_staff(_exam uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from cbse_exams e where e.id=_exam and (cbse_manager(e.institution_id) or cbse_class_teacher(e.id)
  or cbse_co_scholastic_editor(e.id)
  or exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=cbse_actor() and cbse_teacher(e.id,p.subject_id,cbse_actor()))))
$$;

create or replace function public.cbse_exam_workspace(_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; e cbse_exams; v_papers jsonb; v_students jsonb; v_reports jsonb; v_exceptions jsonb; v_audit jsonb; v_sources jsonb;
begin
 perform cbse_enabled(); actor:=cbse_actor(); select * into e from cbse_exams where id=_exam_id;
 if not found then raise exception 'Assessment not found'; end if;
 if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'exam_id',p.exam_id,'subject_id',p.subject_id,'name',p.name,'code',p.code,'teacher_user_id',p.teacher_user_id,'components',p.components,'locked_at',p.locked_at,
  'can_enter',(e.status='open' and p.locked_at is null and (cbse_office(e.institution_id) or p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor)))) order by p.code),'[]'::jsonb) into v_papers from cbse_papers p where p.exam_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'admission_no',s.admission_no,'section',s.section,'applicable_subject_ids',r.applicable_subject_ids,
  'attendance_present',r.attendance_present,'attendance_working_days',r.attendance_working_days,'remarks',r.remarks,'art_grade',r.art_grade,'moral_values_grade',r.moral_values_grade,
  'marks',coalesce((select jsonb_object_agg(m.paper_id::text,jsonb_build_object('status',m.status,'scores',m.scores,'remarks',m.remarks)) from cbse_marks m where m.student_id=s.id and m.paper_id in(select id from cbse_papers where exam_id=e.id)),'{}'::jsonb),
  'fee',cbse_fee(s.id,e.fee_cutoff),'report_id',(select rp.id from cbse_reports rp where rp.exam_id=e.id and rp.student_id=s.id and rp.revision=e.revision and rp.status<>'withdrawn' order by rp.approved_at desc limit 1)) order by s.name),'[]'::jsonb) into v_students
 from cbse_roster r join students s on s.id=r.student_id where r.exam_id=e.id;
 select coalesce(jsonb_agg(to_jsonb(rp) order by rp.approved_at desc),'[]'::jsonb) into v_reports from cbse_reports rp where rp.exam_id=e.id;
 select coalesce(jsonb_agg(to_jsonb(ex) order by ex.created_at desc),'[]'::jsonb) into v_exceptions from cbse_exceptions ex where ex.exam_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actor_id',a.actor_id,'created_at',a.created_at,'remarks',a.remarks,'details',a.details) order by a.id desc),'[]'::jsonb) into v_audit from(select * from cbse_audit where exam_id=e.id order by id desc limit 200)a;
 select coalesce(jsonb_agg(jsonb_build_object('source_exam_id',cs.source_exam_id,'name',se.name,'category',se.category,'sequence',se.sequence,'weight',cs.weight) order by se.category,se.sequence),'[]'::jsonb) into v_sources
  from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id;
 return jsonb_build_object('exam',to_jsonb(e),'policy',(select to_jsonb(p) from cbse_policies p where p.id=e.policy_id),'papers',v_papers,'students',v_students,'reports',v_reports,'exceptions',v_exceptions,'audit',v_audit,'sources',v_sources,
  'capabilities',jsonb_build_object('manage',cbse_manager(e.institution_id,false),'review',cbse_manager(e.institution_id,true),'class_teacher',cbse_class_teacher(e.id),'co_scholastic',cbse_co_scholastic_editor(e.id),
  'enter',(e.status='open' and (cbse_office(e.institution_id) or exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor))))));
end $$;

create function public.cbse_save_co_scholastic_grades(_exam_id uuid,_expected_version integer,_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; actor uuid; row jsonb; student uuid; art text; moral text; next_version integer;
begin
 perform cbse_enabled(); actor:=cbse_actor();
 select * into e from cbse_exams where id=_exam_id for update;
 if not found then raise exception 'Assessment not found'; end if;
 if e.category<>'half_yearly' then raise exception 'Art and Moral Values grades are only available on Half Yearly reports'; end if;
 if not cbse_co_scholastic_editor(e.id) then raise exception 'Not authorised to enter Art and Moral Values grades'; end if;
 if e.status not in ('open','class_review') then raise exception 'Co-scholastic grades can only be edited before academic approval'; end if;
 if e.version<>_expected_version then raise exception 'This assessment changed in another session. Reload before making further changes'; end if;
 if jsonb_typeof(_rows) is distinct from 'array' then raise exception 'Grade rows must be an array'; end if;
 for row in select value from jsonb_array_elements(_rows) loop
  student:=(row->>'student_id')::uuid; art:=nullif(row->>'art_grade',''); moral:=nullif(row->>'moral_values_grade','');
  if art is not null and art not in ('A1','A2','B1','B2','C1','C2','D','E') then raise exception 'Invalid Art grade'; end if;
  if moral is not null and moral not in ('A1','A2','B1','B2','C1','C2','D','E') then raise exception 'Invalid Moral Values grade'; end if;
  update cbse_roster set art_grade=art,moral_values_grade=moral where exam_id=e.id and student_id=student;
  if not found then raise exception 'A selected student is not in this assessment roster'; end if;
 end loop;
 update cbse_exams set version=version+1 where id=e.id returning version into next_version;
 insert into cbse_audit(exam_id,action,actor_id,details) values(e.id,'co_scholastic_grades',actor,jsonb_build_object('rows',jsonb_array_length(_rows)));
 return jsonb_build_object('id',e.id,'version',next_version);
end $$;

revoke all on function public.cbse_save_co_scholastic_grades(uuid,integer,jsonb) from public,anon;
grant execute on function public.cbse_save_co_scholastic_grades(uuid,integer,jsonb) to authenticated;
revoke all on function public.cbse_best_unit_test_score(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.cbse_snapshot(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.cbse_snapshot_before_half_yearly(uuid,uuid,uuid,text) from public,anon,authenticated;
