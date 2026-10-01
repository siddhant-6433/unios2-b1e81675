-- keep-migration-version
-- Report content: show the class teacher and the approver's designation, and
-- carry source assessment names for aggregate reports. Adds the staff bulk-print
-- payload RPC (fee-gated like family downloads).

create or replace function public.cbse_snapshot(_exam uuid,_student uuid,_report uuid,_remarks text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; r cbse_roster; p cbse_papers; m cbse_marks; rule jsonb; c jsonb; components jsonb; subject_rows jsonb:='[]';
 source_ids jsonb:='[]'; subject_status text; score numeric; maximum numeric; obtained numeric; pct numeric; passed boolean; total numeric:=0; total_max numeric:=0;
 all_pass boolean:=true; has_present boolean:=false; rounding integer; grade text; school jsonb; approver text; class_teacher_name text; class_teacher_desig text; approver_desig text; actor_role text; source_assessments jsonb; src record; src_subject jsonb; src_component jsonb;
 numerator numeric; denominator numeric; src_count integer; contributes boolean;
begin
 select * into strict e from cbse_exams where id=_exam;
 select * into strict pol from cbse_policies where id=e.policy_id;
 select * into strict r from cbse_roster where exam_id=e.id and student_id=_student;
 rounding:=(pol.rules->>'rounding')::integer;
 if r.attendance_present is null or r.attendance_working_days is null or length(trim(coalesce(r.remarks,'')))=0 then raise exception 'Attendance and class-teacher remarks are required'; end if;
 if e.category='annual' then
  if (select count(*) from cbse_sources where exam_id=e.id)<>jsonb_array_length(pol.rules->'annual_weights') or jsonb_array_length(pol.rules->'annual_weights')=0 then raise exception 'All required annual assessments must be selected'; end if;
  if exists(select 1 from jsonb_array_elements(pol.rules->'annual_weights') w where (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.category=w->>'category' and se.sequence=(w->>'sequence')::integer)<>1) then raise exception 'Annual assessment selection is incomplete or duplicated'; end if;
  for src in select cs.*,se.revision,se.status from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id loop
   if src.status not in ('approved','released') or not exists(select 1 from cbse_reports where exam_id=src.source_exam_id and student_id=_student and revision=src.revision and status in ('approved','released')) then raise exception 'Every annual source must have a current approved report for every student'; end if;
  end loop;
  select jsonb_agg(rp.id order by rp.id) into source_ids from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.revision=se.revision and rp.student_id=_student where cs.exam_id=e.id;
 end if;
 for p in select * from cbse_papers where exam_id=e.id and subject_id=any(r.applicable_subject_ids) order by code loop
  select s into strict rule from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=p.subject_id::text;
  contributes:=coalesce((rule->>'contributes_to_total')::boolean,true);
  components:='[]'; obtained:=0; maximum:=0; passed:=true;
  if e.category<>'annual' then
   select * into m from cbse_marks where paper_id=p.id and student_id=_student;
   if not found then raise exception 'Missing marks'; end if;
   perform cbse_validate_marks(p.id,_student,m.status,m.scores,true);
   subject_status:=m.status;
  else
   subject_status:='exempt';
   for src in select rp.snapshot from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.revision=se.revision and rp.student_id=_student where cs.exam_id=e.id loop
    select s into src_subject from jsonb_array_elements(src.snapshot->'subjects') s where s->>'subject_id'=p.subject_id::text;
    if src_subject is null then raise exception 'Annual source lacks an applicable subject'; end if;
    if src_subject->>'status'='present' then subject_status:='present'; elsif src_subject->>'status'='absent' and subject_status<>'present' then subject_status:='absent'; end if;
   end loop;
  end if;
  for c in select value from jsonb_array_elements(rule->'components') loop
   score:=null;
   if e.category='annual' then
    numerator:=0;denominator:=0;
    for src in select cs.weight,rp.snapshot from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.revision=se.revision and rp.student_id=_student where cs.exam_id=e.id loop
     select s into src_subject from jsonb_array_elements(src.snapshot->'subjects') s where s->>'subject_id'=p.subject_id::text;
     if src_subject->>'status'='exempt' or (src_subject->>'status'='absent' and pol.rules->>'absent_treatment'='exclude') then continue; end if;
     select x into src_component from jsonb_array_elements(src_subject->'components') x where x->>'key'=c->>'key';
     if src_component is null or (src_component->>'max')::numeric<=0 then raise exception 'Annual component is missing in a source assessment'; end if;
     if src_subject->>'status'='present' and src_component->>'score' is null then raise exception 'Incomplete annual source component'; end if;
     numerator:=numerator+coalesce((src_component->>'score')::numeric,0)/(src_component->>'max')::numeric*src.weight;
     denominator:=denominator+src.weight;
    end loop;
    if denominator>0 then score:=round(numerator/denominator*(c->>'max')::numeric,rounding); end if;
   elsif subject_status='present' then score:=(m.scores->>(c->>'key'))::numeric;
   elsif subject_status='absent' and pol.rules->>'absent_treatment'='zero' then score:=0;
   end if;
   components:=components||jsonb_build_array(jsonb_build_object('key',c->>'key','label',c->>'label','max',(c->>'max')::numeric,'score',score));
   if score is not null then
    obtained:=obtained+score;maximum:=maximum+(c->>'max')::numeric;
    if c->>'pass_percent' is not null and score*100<(c->>'max')::numeric*(c->>'pass_percent')::numeric then passed:=false; end if;
   end if;
  end loop;
  if maximum=0 then obtained:=null;passed:=null;pct:=null;
  else pct:=round(obtained*100/maximum,rounding);
   if rule->>'pass_percent' is not null and obtained*100<maximum*(rule->>'pass_percent')::numeric then passed:=false; end if;
   if subject_status='absent' then passed:=false; end if;
   if contributes then total:=total+obtained;total_max:=total_max+maximum; end if;
  end if;
  if subject_status='present' then has_present:=true; end if;
  if passed=false then all_pass:=false; end if;
  subject_rows:=subject_rows||jsonb_build_array(jsonb_build_object('subject_id',p.subject_id,'name',p.name,'code',p.code,'status',subject_status,'components',components,
   'obtained',obtained,'max',maximum,'percentage',pct,'grade',cbse_grade(pct,pol.rules),'passed',passed,'contributes_to_total',contributes));
 end loop;
 if jsonb_array_length(subject_rows)=0 then raise exception 'Student must have applicable subjects'; end if;
 select jsonb_build_object('name',i.name,'code',i.code,'address',b.address,'logo_url',null,'asset_version',coalesce(b.updated_at::text,'beacon-v1')) into school
 from institutions i left join lateral(select address,updated_at from institution_branding where i.code=any(applies_to) order by updated_at desc limit 1)b on true where i.id=e.institution_id;
 select coalesce(display_name,'Principal') into approver from profiles where user_id=cbse_actor();
 select display_name into class_teacher_name from profiles where user_id=e.class_teacher_user_id;
 select job_title into class_teacher_desig from employee_profiles where user_id=e.class_teacher_user_id order by updated_at desc nulls last limit 1;
 select job_title into approver_desig from employee_profiles where user_id=cbse_actor() order by updated_at desc nulls last limit 1;
 if approver_desig is null then
  select initcap(replace(role::text,'_',' ')) into actor_role from user_roles where user_id=cbse_actor() order by (role::text='super_admin') desc limit 1;
  approver_desig:=actor_role;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('exam_id',se.id,'name',se.name,'category',se.category,'sequence',se.sequence,'weight',cs.weight) order by se.category,se.sequence),'[]') into source_assessments from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id;
 pct:=case when total_max>0 then round(total*100/total_max,rounding) end;
 return jsonb_build_object('template_version','beacon-v1','report_id',_report,'exam_id',e.id,'revision',e.revision,'title',e.name,'category',e.category,'academic_year',e.academic_year,
 'school',school,'class_teacher',jsonb_build_object('name',class_teacher_name,'designation',class_teacher_desig),'sources',source_assessments,'student',r.identity_snapshot,'subjects',subject_rows,'summary',jsonb_build_object('obtained',total,'max',total_max,'percentage',pct,'grade',cbse_grade(pct,pol.rules),
 'result',case when not has_present then 'absent' when not all_pass then 'fail' when total_max=0 then 'incomplete' else 'pass' end),
 'attendance',jsonb_build_object('present',r.attendance_present,'working_days',r.attendance_working_days),'remarks',r.remarks,
 'approval',jsonb_build_object('name',approver,'designation',approver_desig,'approved_at',now(),'remarks',_remarks),'policy',jsonb_build_object('id',pol.id,'version',pol.version,'source_url',pol.rules->>'source_url'),
 'source_report_ids',coalesce(source_ids,'[]'),'fee_cutoff',e.fee_cutoff);
end $$;

-- Staff bulk print: the current released reports for an exam that pass the SAME
-- fee gate as family downloads (fee clear or an approved exception).
create function public.cbse_exam_print_payloads(_exam_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e cbse_exams; v jsonb;
begin
 perform cbse_enabled();
 perform cbse_actor();
 select * into e from cbse_exams where id=_exam_id;
 if not found then raise exception 'Assessment not found'; end if;
 if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('report_id',r.id,'revision',r.revision,'snapshot',r.snapshot) order by r.snapshot->'student'->>'name'),'[]') into v
 from cbse_reports r
 where r.exam_id=e.id and r.revision=e.revision and r.status='released'
  and (coalesce(cbse_fee(r.student_id,e.fee_cutoff)->>'status','unresolved')='clear'
       or exists(select 1 from cbse_exceptions x where x.exam_id=e.id and x.student_id=r.student_id and x.revision=e.revision and x.fee_cutoff=e.fee_cutoff and x.status='approved'));
 return jsonb_build_object('exam_id',e.id,'title',e.name,'reports',v);
end $$;
revoke all on function public.cbse_exam_print_payloads(uuid) from public,anon;
grant execute on function public.cbse_exam_print_payloads(uuid) to authenticated;

notify pgrst, 'reload schema';
