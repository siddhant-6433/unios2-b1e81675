-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations to align db push history.
-- Git must keep this timestamp so `db push` matches remote history.
--
-- Allow the office assistant (and the assigned subject teacher) to enter and lock marks.
-- Adds public.cbse_office() for campus-scoped office staff and re-issues the affected RPCs.

create function public.cbse_office(_institution uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from user_roles r where r.user_id=cbse_actor() and r.role::text='super_admin')
 or exists(select 1 from user_institution_access a where a.user_id=cbse_actor() and a.institution_id=_institution and a.role::text in ('office_assistant','office_admin'))
$$;

create or replace function public.cbse_staff(_exam uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from cbse_exams e where e.id=_exam and (cbse_manager(e.institution_id) or cbse_class_teacher(e.id) or cbse_office(e.institution_id)
 or exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=cbse_actor() and cbse_teacher(e.id,p.subject_id,cbse_actor()))))
$$;

create or replace function public.cbse_configuration() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform cbse_enabled();
 perform cbse_actor();
 return jsonb_build_object(
  'courses',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'institution_id',institution_id,'institution_name',institution_name,'grade',grade) order by grade,name),'[]'::jsonb) from cbse_courses()),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by start_date desc),'[]'::jsonb) from admission_sessions where is_active),
  'subjects',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'course_id',s.course_id,'name',s.name,'code',s.code,'is_elective',s.is_elective,'is_co_scholastic',s.is_co_scholastic) order by s.display_order,s.name),'[]'::jsonb) from subjects s join cbse_courses() c on c.id=s.course_id where s.active),
  'staff',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',coalesce(nullif(btrim(coalesce(p.display_name,'')),''),p.email,p.user_id::text)) order by p.display_name nulls last,p.email),'[]'::jsonb) from profiles p where p.login_disabled is not true and p.deleted_at is null and p.archived_at is null and exists(select 1 from user_roles r where r.user_id=p.user_id and r.role::text in ('faculty','teacher','principal','campus_admin','school_coordinator','super_admin','office_admin','office_assistant'))),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.version),'[]'::jsonb) from cbse_policies p where p.course_id in (select id from cbse_courses())),
  'exams',(select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_on desc,e.created_at desc),'[]'::jsonb) from cbse_exams e where e.course_id in (select id from cbse_courses()) and e.status<>'cancelled'),
  'capabilities',jsonb_build_object(
   'manage',(select exists(select 1 from cbse_courses() c where cbse_manager(c.institution_id,false))),
   'review',(select exists(select 1 from cbse_courses() c where cbse_manager(c.institution_id,true))))
 );
end $$;

create or replace function public.cbse_configure(_exam uuid,_payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; x jsonb; sr jsonb; src cbse_exams; w numeric;
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
   if sr is null or not (cbse_teacher(e.id,(x->>'subject_id')::uuid,(x->>'teacher_user_id')::uuid) or exists(select 1 from class_teachers ct where ct.course_id=e.course_id and ct.teacher_user_id=(x->>'teacher_user_id')::uuid and ct.active and ct.batch_id is null and ct.session_id=e.session_id and (ct.section is null or ct.section=e.section)) or exists(select 1 from user_roles ur where ur.user_id=(x->>'teacher_user_id')::uuid and ur.role::text in ('office_assistant','office_admin'))) then raise exception 'Teacher must be assigned to this subject, class, section and session, or be the class teacher / office staff'; end if;
   insert into cbse_papers(exam_id,subject_id,name,code,teacher_user_id,components)
   select e.id,id,name,code,(x->>'teacher_user_id')::uuid,sr->'components' from subjects where id=(x->>'subject_id')::uuid and course_id=e.course_id;
  end loop;
 end if;
 if _payload ? 'source_exam_ids' then
  delete from cbse_sources where exam_id=e.id;
  for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
   select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
   select (a->>'weight')::numeric into w from jsonb_array_elements(pol.rules->'annual_weights') a where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence;
   if e.category<>'annual' or src.category='annual' or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section or w is null then raise exception 'Annual sources must match this class, section, session and approved weighting'; end if;
   insert into cbse_sources(exam_id,source_exam_id,weight) values(e.id,src.id,w);
  end loop;
 end if;
 perform cbse_refresh_roster(e.id);
end $$;

create or replace function public.cbse_exam_workspace(_exam_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; e cbse_exams; v_papers jsonb; v_students jsonb; v_reports jsonb; v_exceptions jsonb; v_audit jsonb; v_sources jsonb;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 select * into e from cbse_exams where id=_exam_id;
 if not found then raise exception 'Assessment not found'; end if;
 if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'exam_id',p.exam_id,'subject_id',p.subject_id,'name',p.name,'code',p.code,'teacher_user_id',p.teacher_user_id,'components',p.components,'locked_at',p.locked_at,
  'can_enter',(e.status='open' and p.locked_at is null and ((p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor)) or cbse_office(e.institution_id)))) order by p.code),'[]'::jsonb) into v_papers from cbse_papers p where p.exam_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'admission_no',s.admission_no,'section',s.section,'applicable_subject_ids',r.applicable_subject_ids,
  'attendance_present',r.attendance_present,'attendance_working_days',r.attendance_working_days,'remarks',r.remarks,
  'marks',coalesce((select jsonb_object_agg(m.paper_id::text,jsonb_build_object('status',m.status,'scores',m.scores,'remarks',m.remarks)) from cbse_marks m where m.student_id=s.id and m.paper_id in (select id from cbse_papers where exam_id=e.id)),'{}'::jsonb),
  'fee',cbse_fee(s.id,e.fee_cutoff),
  'report_id',(select rp.id from cbse_reports rp where rp.exam_id=e.id and rp.student_id=s.id and rp.revision=e.revision and rp.status<>'withdrawn' order by rp.approved_at desc limit 1)) order by s.name),'[]'::jsonb) into v_students
 from cbse_roster r join students s on s.id=r.student_id where r.exam_id=e.id;
 select coalesce(jsonb_agg(to_jsonb(rp) order by rp.approved_at desc),'[]'::jsonb) into v_reports from cbse_reports rp where rp.exam_id=e.id;
 select coalesce(jsonb_agg(to_jsonb(ex) order by ex.created_at desc),'[]'::jsonb) into v_exceptions from cbse_exceptions ex where ex.exam_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actor_id',a.actor_id,'created_at',a.created_at,'remarks',a.remarks,'details',a.details) order by a.id desc),'[]'::jsonb) into v_audit
 from (select * from cbse_audit where exam_id=e.id order by id desc limit 200) a;
 select coalesce(jsonb_agg(jsonb_build_object('source_exam_id',cs.source_exam_id,'name',se.name,'category',se.category,'sequence',se.sequence,'weight',cs.weight) order by se.category,se.sequence),'[]'::jsonb) into v_sources
 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id;
 return jsonb_build_object('exam',to_jsonb(e),
  'policy',(select to_jsonb(p) from cbse_policies p where p.id=e.policy_id),
  'papers',v_papers,'students',v_students,'reports',v_reports,'exceptions',v_exceptions,'audit',v_audit,'sources',v_sources,
  'capabilities',jsonb_build_object('manage',cbse_manager(e.institution_id,false),'review',cbse_manager(e.institution_id,true),'class_teacher',cbse_class_teacher(e.id),
   'enter',(e.status='open' and (cbse_office(e.institution_id) or exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor))))));
end $$;

create or replace function public.cbse_action(_exam_id uuid,_action text,_expected_version integer,_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; e cbse_exams; pol cbse_policies; v_id uuid; v_version integer; v_payload jsonb;
 v_remarks text; v_manage boolean; v_review boolean; v_class_teacher boolean;
 v_course uuid; v_session uuid; v_institution uuid; v_grade integer; v_code text;
 v_paper cbse_papers; v_marks cbse_marks; v_student uuid; v_status text; x jsonb;
 v_student_ids uuid[]; v_draft boolean; v_paper_id uuid; v_withdrawn uuid[]; v_dep uuid[];
 v_fee jsonb; v_exception cbse_exceptions; v_decision text;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 v_payload:=coalesce(_payload,'{}'::jsonb);

 if _action='create_policy' then
  if _exam_id is not null or _expected_version is not null then raise exception 'Creating a policy does not take an assessment'; end if;
  v_course:=(v_payload->>'course_id')::uuid;
  v_institution:=cbse_course_institution(v_course);
  if v_institution is null then raise exception 'Choose a valid class and campus'; end if;
  if not cbse_manager(v_institution,false) then raise exception 'Not authorised to configure assessment policies'; end if;
  if nullif(btrim(coalesce(v_payload->>'name','')),'') is null then raise exception 'Enter a policy name'; end if;
  if (v_payload->>'session_id') is null then raise exception 'Choose an academic session'; end if;
  perform cbse_validate_policy(v_course,v_payload->'rules');
  select coalesce(max(version),0)+1 into v_version from cbse_policies where course_id=v_course and session_id=(v_payload->>'session_id')::uuid;
  insert into cbse_policies(course_id,session_id,name,version,rules,created_by)
   values(v_course,(v_payload->>'session_id')::uuid,btrim(v_payload->>'name'),v_version,v_payload->'rules',actor) returning id into v_id;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(null,_action,actor,btrim(v_payload->>'name'),jsonb_build_object('policy_id',v_id,'version',v_version));
  return jsonb_build_object('id',v_id,'version',v_version);

 elsif _action='approve_policy' then
  if _exam_id is not null or _expected_version is not null then raise exception 'Approving a policy does not take an assessment'; end if;
  select * into pol from cbse_policies where id=nullif(v_payload->>'policy_id','')::uuid;
  if not found then raise exception 'Assessment policy not found'; end if;
  if not cbse_manager(cbse_course_institution(pol.course_id),true) then raise exception 'Only a principal or super admin can approve an assessment policy'; end if;
  v_remarks:=btrim(coalesce(v_payload->>'remarks',''));
  if v_remarks='' then raise exception 'Enter the policy approval remarks'; end if;
  if pol.status='approved' then raise exception 'This policy version is already approved'; end if;
  update cbse_policies set status='approved',approved_by=actor,approved_at=now() where id=pol.id;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(null,_action,actor,v_remarks,jsonb_build_object('policy_id',pol.id,'version',pol.version));
  return jsonb_build_object('id',pol.id,'version',pol.version);

 elsif _action='create_exam' then
  if _exam_id is not null or _expected_version is not null then raise exception 'Creating an assessment does not take an assessment'; end if;
  v_course:=(v_payload->>'course_id')::uuid; v_session:=(v_payload->>'session_id')::uuid;
  v_institution:=cbse_course_institution(v_course);
  if v_institution is null then raise exception 'Choose a valid class and campus'; end if;
  if not cbse_manager(v_institution,false) then raise exception 'Not authorised to create assessments'; end if;
  select code into v_code from courses where id=v_course;
  v_grade:=cbse_grade_from_code(v_code);
  if v_grade is null then raise exception 'Only Beacon school classes I-XII can have assessments'; end if;
  if coalesce(v_payload->>'category','') not in ('unit_test','half_yearly','final','pre_board','annual') then raise exception 'Choose a valid assessment type'; end if;
  if v_payload->>'category'='pre_board' and v_grade not in (10,12) then raise exception 'Pre-Boards apply only to Classes X and XII'; end if;
  if nullif(btrim(coalesce(v_payload->>'name','')),'') is null then raise exception 'Enter a report title'; end if;
  if nullif(btrim(coalesce(v_payload->>'academic_year','')),'') is null then raise exception 'Enter the academic year'; end if;
  if (v_payload->>'starts_on') is null or (v_payload->>'ends_on') is null then raise exception 'Enter the reporting period'; end if;
  if (v_payload->>'ends_on')::date<(v_payload->>'starts_on')::date then raise exception 'The reporting period cannot end before it starts'; end if;
  if (v_payload->>'fee_cutoff') is null then raise exception 'Enter the fee cutoff date'; end if;
  if coalesce((v_payload->>'sequence')::integer,0)<1 then raise exception 'Enter a positive sitting number'; end if;
  select * into pol from cbse_policies where id=nullif(v_payload->>'policy_id','')::uuid;
  if not found then raise exception 'Choose an approved assessment policy'; end if;
  if pol.status<>'approved' or pol.course_id<>v_course or pol.session_id<>v_session then raise exception 'The policy must be approved for this class and session'; end if;
  if not exists(select 1 from class_teachers c where c.course_id=v_course and c.teacher_user_id=nullif(v_payload->>'class_teacher_user_id','')::uuid and c.active and c.batch_id is null and c.session_id=v_session and (c.section is null or c.section=nullif(v_payload->>'section',''))) then raise exception 'The class teacher needs an active assignment to this class, section and session'; end if;
  insert into cbse_exams(institution_id,course_id,session_id,section,name,academic_year,category,sequence,starts_on,ends_on,fee_cutoff,policy_id,class_teacher_user_id,created_by)
   values(v_institution,v_course,v_session,nullif(btrim(coalesce(v_payload->>'section','')),''),btrim(v_payload->>'name'),btrim(v_payload->>'academic_year'),v_payload->>'category',(v_payload->>'sequence')::integer,(v_payload->>'starts_on')::date,(v_payload->>'ends_on')::date,(v_payload->>'fee_cutoff')::date,pol.id,nullif(v_payload->>'class_teacher_user_id','')::uuid,actor)
   returning id into v_id;
  if v_payload->>'category'='annual' then
   perform cbse_sync_annual_papers(v_id);
   perform cbse_configure(v_id,v_payload-'papers');
  else
   perform cbse_configure(v_id,v_payload);
  end if;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(v_id,_action,actor,null,jsonb_build_object('category',v_payload->>'category','sequence',(v_payload->>'sequence')::integer));
  return jsonb_build_object('id',v_id,'version',1);
 end if;

 if _exam_id is null then raise exception 'Choose an assessment'; end if;
 select * into e from cbse_exams where id=_exam_id for update;
 if not found then raise exception 'Assessment not found'; end if;
 if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
 if _expected_version is null or e.version<>_expected_version then raise exception 'This assessment changed in another session. Reload before making further changes'; end if;
 v_manage:=cbse_manager(e.institution_id,false);
 v_review:=cbse_manager(e.institution_id,true);
 v_class_teacher:=cbse_class_teacher(e.id);
 v_remarks:=btrim(coalesce(v_payload->>'remarks',''));

 if _action='configure_roster' then
  if e.status<>'draft' then raise exception 'Subject applicability is frozen; reopen as draft first'; end if;
  if not v_manage then raise exception 'Not authorised to configure this assessment'; end if;
  for x in select value from jsonb_array_elements(coalesce(v_payload->'students','[]'::jsonb)) loop
   v_student:=(x->>'student_id')::uuid;
   if not exists(select 1 from cbse_roster where exam_id=e.id and student_id=v_student) then raise exception 'A selected student is not in this assessment roster'; end if;
   update cbse_roster set applicable_subject_ids=coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(x->'applicable_subject_ids','[]'::jsonb)) as t(value)),'{}'::uuid[]),explicit_selection=true where exam_id=e.id and student_id=v_student;
  end loop;
  if exists(select 1 from cbse_roster r cross join lateral unnest(r.applicable_subject_ids) as sid(value) where r.exam_id=e.id and not exists(select 1 from cbse_papers p where p.exam_id=e.id and p.subject_id=sid.value)) then raise exception 'Subject applicability references a subject without a paper'; end if;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,jsonb_build_object('students',jsonb_array_length(coalesce(v_payload->'students','[]'::jsonb))));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='configure_exam' then
  if e.status<>'draft' then raise exception 'Configuration is frozen; reopen as draft first'; end if;
  if not v_manage then raise exception 'Not authorised to configure this assessment'; end if;
  perform cbse_configure(e.id,v_payload);
  if e.category='annual' then perform cbse_sync_annual_papers(e.id); perform cbse_refresh_roster(e.id); end if;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,'{}'::jsonb);
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='open' then
  if e.status<>'draft' then raise exception 'This assessment is not a draft'; end if;
  if not v_manage then raise exception 'Not authorised to open marks entry'; end if;
  select * into pol from cbse_policies where id=e.policy_id;
  if not found or pol.status<>'approved' then raise exception 'Approve the assessment policy before opening marks entry'; end if;
  perform cbse_refresh_roster(e.id);
  if not exists(select 1 from cbse_roster where exam_id=e.id) then raise exception 'No students are in this assessment'; end if;
  if e.category<>'annual' then
   if not exists(select 1 from cbse_papers where exam_id=e.id) then raise exception 'Assign at least one subject paper before opening'; end if;
  else
   if not exists(select 1 from cbse_sources where exam_id=e.id) then raise exception 'Select the annual source assessments before opening'; end if;
  end if;
  if exists(select 1 from cbse_roster where exam_id=e.id and coalesce(array_length(applicable_subject_ids,1),0)=0) then raise exception 'Every student needs at least one applicable subject'; end if;
  update cbse_papers set locked_at=null where exam_id=e.id;
  update cbse_exams set status='open',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,jsonb_build_object('students',(select count(*) from cbse_roster where exam_id=e.id)));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='save_marks' then
  if e.status<>'open' then raise exception 'Marks entry is not open for this assessment'; end if;
  v_paper_id:=nullif(v_payload->>'paper_id','')::uuid;
  select * into v_paper from cbse_papers where id=v_paper_id and exam_id=e.id;
  if not found then raise exception 'Paper not found in this assessment'; end if;
  if v_paper.locked_at is not null then raise exception 'This paper is locked. Ask for it to be returned before editing'; end if;
  if not ((v_paper.teacher_user_id=actor and cbse_teacher(e.id,v_paper.subject_id,actor)) or cbse_office(e.institution_id)) then raise exception 'You are not assigned to this paper'; end if;
  for x in select value from jsonb_array_elements(coalesce(v_payload->'rows','[]'::jsonb)) loop
   v_student:=(x->>'student_id')::uuid; v_status:=x->>'status';
   perform cbse_validate_marks(v_paper.id,v_student,v_status,coalesce(x->'scores','{}'::jsonb),false);
   insert into cbse_marks(paper_id,student_id,status,scores,remarks,updated_by,updated_at)
    values(v_paper.id,v_student,v_status,coalesce(x->'scores','{}'::jsonb),nullif(btrim(coalesce(x->>'remarks','')),''),actor,now())
    on conflict(paper_id,student_id) do update set status=excluded.status,scores=excluded.scores,remarks=excluded.remarks,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  end loop;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,jsonb_build_object('paper_id',v_paper.id,'rows',jsonb_array_length(coalesce(v_payload->'rows','[]'::jsonb))));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='lock_paper' then
  if e.status<>'open' then raise exception 'Marks entry is not open for this assessment'; end if;
  v_paper_id:=nullif(v_payload->>'paper_id','')::uuid;
  select * into v_paper from cbse_papers where id=v_paper_id and exam_id=e.id;
  if not found then raise exception 'Paper not found in this assessment'; end if;
  if v_paper.locked_at is not null then raise exception 'This paper is already locked'; end if;
  if not ((v_paper.teacher_user_id=actor and cbse_teacher(e.id,v_paper.subject_id,actor)) or v_manage or cbse_office(e.institution_id)) then raise exception 'You are not assigned to this paper'; end if;
  for v_student in select r.student_id from cbse_roster r where r.exam_id=e.id and v_paper.subject_id=any(r.applicable_subject_ids) loop
   select * into v_marks from cbse_marks where paper_id=v_paper.id and student_id=v_student;
   if not found then raise exception 'Enter marks for every applicable student before locking this paper'; end if;
   perform cbse_validate_marks(v_paper.id,v_student,v_marks.status,v_marks.scores,true);
  end loop;
  update cbse_papers set locked_at=now() where id=v_paper.id;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,jsonb_build_object('paper_id',v_paper.id));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='student_details' then
  if e.status not in ('open','class_review') then raise exception 'Attendance and remarks can be edited during marks entry or class review'; end if;
  if not (v_class_teacher or v_manage) then raise exception 'Only the class teacher or an administrator can update attendance and remarks'; end if;
  for x in select value from jsonb_array_elements(coalesce(v_payload->'rows','[]'::jsonb)) loop
   v_student:=(x->>'student_id')::uuid;
   if not exists(select 1 from cbse_roster where exam_id=e.id and student_id=v_student) then raise exception 'A selected student is not in this assessment roster'; end if;
   if coalesce((x->>'attendance_present')::integer,0)<0 or coalesce((x->>'attendance_working_days')::integer,0)<0 or coalesce((x->>'attendance_present')::integer,0)>coalesce((x->>'attendance_working_days')::integer,0) then raise exception 'Attendance days must be non-negative and present days cannot exceed working days'; end if;
   update cbse_roster set attendance_present=(x->>'attendance_present')::integer,attendance_working_days=(x->>'attendance_working_days')::integer,remarks=nullif(btrim(coalesce(x->>'remarks','')),'') where exam_id=e.id and student_id=v_student;
  end loop;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,jsonb_build_object('rows',jsonb_array_length(coalesce(v_payload->'rows','[]'::jsonb))));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='submit_class_review' then
  if e.status<>'open' then raise exception 'This assessment is not in marks entry'; end if;
  if not (v_class_teacher or v_manage) then raise exception 'Only the class teacher or an administrator can submit this assessment'; end if;
  if e.category<>'annual' and exists(select 1 from cbse_papers where exam_id=e.id and locked_at is null) then raise exception 'Lock every paper before submitting to class-teacher review'; end if;
  update cbse_exams set status='class_review',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,null,'{}'::jsonb);
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='submit_principal_review' then
  if e.status<>'class_review' then raise exception 'This assessment is not in class-teacher review'; end if;
  if not (v_class_teacher or v_manage) then raise exception 'Only the class teacher or an administrator can submit this assessment'; end if;
  if v_remarks='' then raise exception 'Enter the review remarks'; end if;
  if exists(select 1 from cbse_roster where exam_id=e.id and (attendance_present is null or attendance_working_days is null or btrim(coalesce(remarks,''))='')) then raise exception 'Attendance and class-teacher remarks are required for every student'; end if;
  update cbse_exams set status='principal_review',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,'{}'::jsonb);
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='return_paper' then
  if e.status not in ('open','class_review','principal_review') then raise exception 'This assessment can no longer be returned for correction'; end if;
  if not (v_class_teacher or v_review) then raise exception 'Only the class teacher or a reviewing administrator can return a paper'; end if;
  if v_remarks='' then raise exception 'Enter the correction reason'; end if;
  v_paper_id:=nullif(v_payload->>'paper_id','')::uuid;
  select * into v_paper from cbse_papers where id=v_paper_id and exam_id=e.id;
  if not found then raise exception 'Paper not found in this assessment'; end if;
  update cbse_papers set locked_at=null where id=v_paper.id;
  update cbse_exams set status='open',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('paper_id',v_paper.id));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='approve' then
  if e.status<>'principal_review' then raise exception 'This assessment is not awaiting academic approval'; end if;
  if not v_review then raise exception 'Only a principal or super admin can approve academic reports'; end if;
  if v_remarks='' then raise exception 'Enter the approval remarks'; end if;
  for v_student in select student_id from cbse_roster where exam_id=e.id loop
   v_id:=gen_random_uuid();
   insert into cbse_reports(id,exam_id,student_id,revision,status,snapshot,approved_at)
    values(v_id,e.id,v_student,e.revision,'approved',cbse_snapshot(e.id,v_student,v_id,v_remarks),now())
    on conflict(exam_id,student_id,revision) do update set status='approved',snapshot=excluded.snapshot,approved_at=excluded.approved_at,released_at=null,withdrawn_at=null;
  end loop;
  if e.category='annual' then
   delete from cbse_report_sources where report_id in (select id from cbse_reports where exam_id=e.id and revision=e.revision);
   insert into cbse_report_sources(report_id,source_report_id)
    select rp.id,srp.id from cbse_reports rp join cbse_sources cs on cs.exam_id=rp.exam_id join cbse_exams se on se.id=cs.source_exam_id
    join cbse_reports srp on srp.exam_id=se.id and srp.revision=se.revision and srp.student_id=rp.student_id
    where rp.exam_id=e.id and rp.revision=e.revision;
  end if;
  update cbse_exams set status='approved',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('reports',(select count(*) from cbse_reports where exam_id=e.id and revision=e.revision)));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='release' then
  if e.status not in ('approved','released') then raise exception 'Approve the academic reports before releasing them'; end if;
  if not v_review then raise exception 'Only a principal or super admin can release reports'; end if;
  if v_remarks='' then raise exception 'Enter the release remarks'; end if;
  v_student_ids:=null;
  if jsonb_typeof(v_payload->'student_ids')='array' and jsonb_array_length(v_payload->'student_ids')>0 then
   select array_agg(value::uuid) into v_student_ids from jsonb_array_elements_text(v_payload->'student_ids') as t(value);
  end if;
  update cbse_reports set status='released',released_at=now()
   where exam_id=e.id and revision=e.revision and status='approved' and (v_student_ids is null or student_id=any(v_student_ids));
  if not found then raise exception 'There are no approved reports ready to release'; end if;
  update cbse_exams set status='released',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('released',v_student_ids));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='reopen' then
  if e.status in ('draft','cancelled') then raise exception 'This assessment cannot be reopened'; end if;
  if not v_review then raise exception 'Only a principal or super admin can reopen an assessment'; end if;
  if v_remarks='' then raise exception 'Enter the correction remarks'; end if;
  v_draft:=coalesce((v_payload->>'draft')::boolean,false);
  v_paper_id:=nullif(v_payload->>'paper_id','')::uuid;
  if not v_draft and v_paper_id is not null and not exists(select 1 from cbse_papers where id=v_paper_id and exam_id=e.id) then raise exception 'Paper not found in this assessment'; end if;
  select array_agg(id) into v_withdrawn from cbse_reports where exam_id=e.id and revision=e.revision and status<>'withdrawn';
  update cbse_reports set status='withdrawn',withdrawn_at=now() where exam_id=e.id and revision=e.revision and status<>'withdrawn';
  if v_withdrawn is not null then
   with recursive deps(id) as (
    select rs.report_id from cbse_report_sources rs where rs.source_report_id=any(v_withdrawn)
    union
    select rs.report_id from cbse_report_sources rs join deps d on rs.source_report_id=d.id)
   select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_dep from deps;
   if array_length(v_dep,1) is not null then
    update cbse_reports set status='withdrawn',withdrawn_at=now() where id=any(v_dep) and status<>'withdrawn';
    update cbse_exams set revision=revision+1,version=version+1,status='principal_review' where id in (select distinct exam_id from cbse_reports where id=any(v_dep)) and status not in ('draft','cancelled');
   end if;
  end if;
  if v_draft then update cbse_papers set locked_at=null where exam_id=e.id;
  elsif v_paper_id is not null then update cbse_papers set locked_at=null where id=v_paper_id;
  else update cbse_papers set locked_at=null where exam_id=e.id; end if;
  update cbse_exams set revision=revision+1,version=version+1,status=case when v_draft then 'draft' else 'open' end where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('paper_id',v_paper_id,'draft',v_draft,'withdrawn',v_withdrawn));
  return jsonb_build_object('id',e.id,'version',v_version);

 elsif _action='request_exception' then
  if e.status not in ('approved','released') then raise exception 'Fee exceptions apply to an approved or released assessment'; end if;
  if not (v_manage or v_class_teacher or v_review) then raise exception 'Not authorised to request a fee exception'; end if;
  if v_remarks='' then raise exception 'Enter the exception reason'; end if;
  v_student:=nullif(v_payload->>'student_id','')::uuid;
  if not exists(select 1 from cbse_roster where exam_id=e.id and student_id=v_student) then raise exception 'Student is not in this assessment'; end if;
  v_fee:=cbse_fee(v_student,e.fee_cutoff);
  if v_fee->>'status'='clear' then raise exception 'This student has no outstanding fees for the cutoff date'; end if;
  if exists(select 1 from cbse_exceptions where exam_id=e.id and student_id=v_student and revision=e.revision and fee_cutoff=e.fee_cutoff and status in ('pending','approved')) then raise exception 'A fee exception is already active for this student'; end if;
  insert into cbse_exceptions(exam_id,student_id,revision,fee_cutoff,status,request_remarks,requested_by)
   values(e.id,v_student,e.revision,e.fee_cutoff,'pending',v_remarks,actor) returning id into v_id;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('exception_id',v_id,'student_id',v_student));
  return jsonb_build_object('id',v_id,'version',v_version);

 elsif _action='review_exception' then
  if not v_review then raise exception 'Only a principal or super admin can review a fee exception'; end if;
  select * into v_exception from cbse_exceptions where id=nullif(v_payload->>'exception_id','')::uuid and exam_id=e.id;
  if not found then raise exception 'Fee exception not found'; end if;
  v_decision:=v_payload->>'decision';
  if v_decision not in ('approved','rejected','revoked') then raise exception 'Choose a valid exception decision'; end if;
  if not ((v_exception.status='pending' and v_decision in ('approved','rejected')) or (v_exception.status='approved' and v_decision='revoked')) then raise exception 'This exception cannot be moved to that state'; end if;
  if v_remarks='' then raise exception 'Enter the review remarks'; end if;
  update cbse_exceptions set status=v_decision,review_remarks=v_remarks,reviewed_by=actor,reviewed_at=now(),revoked_at=case when v_decision='revoked' then now() else revoked_at end where id=v_exception.id;
  update cbse_exams set version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,jsonb_build_object('exception_id',v_exception.id,'decision',v_decision));
  return jsonb_build_object('id',v_exception.id,'version',v_version);

 elsif _action='cancel' then
  if e.status not in ('draft','open') then raise exception 'Only a draft or open assessment can be cancelled'; end if;
  if not v_manage then raise exception 'Not authorised to cancel this assessment'; end if;
  if v_remarks='' then raise exception 'Enter the cancellation reason'; end if;
  update cbse_exams set status='cancelled',version=version+1 where id=e.id returning version into v_version;
  insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,_action,actor,v_remarks,'{}'::jsonb);
  return jsonb_build_object('id',e.id,'version',v_version);
 end if;

 raise exception 'Unsupported assessment action';
end $$;

revoke all on function public.cbse_office(uuid) from public,anon;
notify pgrst, 'reload schema';
