-- keep-migration-version: restored production migration 20261014045923; preserve its applied version.
-- cbse marks entry role scope

-- Keep CBSE assessment visibility, workspace access, and marks actions aligned.
-- School managers, vice principals, office assistants, and computer teachers
-- can enter marks across Beacon classes. Class teachers can enter marks for
-- their assigned class; other subject teachers remain limited to their papers.

create or replace function public.cbse_computer_teacher()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1
   from public.subject_allocations a
   join public.subjects s on s.id=a.subject_id and s.active
   join public.courses c on c.id=s.course_id
   where a.faculty_user_id=public.cbse_actor()
     and a.active
     and c.code ~* '^(BSA|BSAV)-G([1-9]|1[0-2])$'
     and (upper(coalesce(s.code,''))='COMP' or s.name ilike '%computer%')
 )
$$;

create or replace function public.cbse_marks_all_classes()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1 from public.user_roles r
   where r.user_id=public.cbse_actor()
     and r.role::text in (
       'super_admin','campus_admin','principal','school_coordinator',
       'vice_principal','office_assistant'
     )
 ) or public.cbse_computer_teacher()
$$;

create or replace function public.cbse_academic_role()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.cbse_marks_all_classes()
   or exists(
     select 1 from public.user_roles r
     where r.user_id=public.cbse_actor() and r.role::text='office_admin'
   )
$$;

create or replace function public.cbse_marks_role(_exam uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1 from public.cbse_exams e
   where e.id=_exam
     and (
       public.cbse_marks_all_classes()
       or public.cbse_class_teacher(e.id)
       or public.cbse_office(e.institution_id)
     )
 )
$$;

create or replace function public.cbse_course_ids()
returns setof uuid language sql stable security definer set search_path=public,pg_temp as $$
 select c.id
 from public.courses c
 where c.code ~* '^(BSA|BSAV)-G([1-9]|1[0-2])$'
   and (
     public.cbse_marks_all_classes()
     or exists(
       select 1 from public.departments d
       join public.user_institution_access a on a.institution_id=d.institution_id
       where d.id=c.department_id and a.user_id=public.cbse_actor()
     )
     or exists(
       select 1 from public.subjects s
       join public.subject_allocations sa on sa.subject_id=s.id
       where s.course_id=c.id and sa.faculty_user_id=public.cbse_actor() and sa.active
     )
     or exists(
       select 1 from public.class_teachers ct
       where ct.course_id=c.id and ct.teacher_user_id=public.cbse_actor() and ct.active
     )
   )
$$;

create or replace function public.cbse_staff(_exam uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1 from public.cbse_exams e
   where e.id=_exam
     and (
       public.cbse_marks_role(e.id)
       or exists(
         select 1 from public.cbse_papers p
         where p.exam_id=e.id and p.teacher_user_id=public.cbse_actor()
           and public.cbse_teacher(e.id,p.subject_id,public.cbse_actor())
       )
     )
 )
$$;

create or replace function public.cbse_exam_workspace(_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 actor uuid;
 e public.cbse_exams;
 v_papers jsonb;
 v_students jsonb;
 v_reports jsonb;
 v_exceptions jsonb;
 v_audit jsonb;
 v_sources jsonb;
begin
 perform public.cbse_enabled();
 actor:=public.cbse_actor();
 select * into e from public.cbse_exams where id=_exam_id;
 if not found then raise exception 'Assessment not found'; end if;
 if not public.cbse_staff(e.id) then raise exception 'Access denied'; end if;

 select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'exam_id',p.exam_id,'subject_id',p.subject_id,'name',p.name,
   'code',p.code,'teacher_user_id',p.teacher_user_id,'components',p.components,
   'locked_at',p.locked_at,
   'can_enter',(e.status='open' and p.locked_at is null and (
     public.cbse_marks_role(e.id)
     or (p.teacher_user_id=actor and public.cbse_teacher(e.id,p.subject_id,actor))
   ))
 ) order by p.code),'[]'::jsonb)
 into v_papers
 from public.cbse_papers p where p.exam_id=e.id;

 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'admission_no',s.admission_no,'section',s.section,
   'applicable_subject_ids',r.applicable_subject_ids,
   'attendance_present',r.attendance_present,
   'attendance_working_days',r.attendance_working_days,'remarks',r.remarks,
   'art_grade',r.art_grade,'moral_values_grade',r.moral_values_grade,
   'marks',coalesce((
     select jsonb_object_agg(m.paper_id::text,jsonb_build_object(
       'status',m.status,'scores',m.scores,'remarks',m.remarks
     )) from public.cbse_marks m
     where m.student_id=s.id
       and m.paper_id in(select id from public.cbse_papers where exam_id=e.id)
   ),'{}'::jsonb),
   'fee',public.cbse_fee(s.id,e.fee_cutoff),
   'report_id',(
     select rp.id from public.cbse_reports rp
     where rp.exam_id=e.id and rp.student_id=s.id
       and rp.revision=e.revision and rp.status<>'withdrawn'
     order by rp.approved_at desc limit 1
   )
 ) order by s.name),'[]'::jsonb)
 into v_students
 from public.cbse_roster r
 join public.students s on s.id=r.student_id
 where r.exam_id=e.id;

 select coalesce(jsonb_agg(to_jsonb(rp) order by rp.approved_at desc),'[]'::jsonb)
 into v_reports from public.cbse_reports rp where rp.exam_id=e.id;
 select coalesce(jsonb_agg(to_jsonb(ex) order by ex.created_at desc),'[]'::jsonb)
 into v_exceptions from public.cbse_exceptions ex where ex.exam_id=e.id;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'action',a.action,'actor_id',a.actor_id,'created_at',a.created_at,
   'remarks',a.remarks,'details',a.details
 ) order by a.id desc),'[]'::jsonb)
 into v_audit
 from (select * from public.cbse_audit where exam_id=e.id order by id desc limit 200) a;
 select coalesce(jsonb_agg(jsonb_build_object(
   'source_exam_id',cs.source_exam_id,'name',se.name,'category',se.category,
   'sequence',se.sequence,'weight',cs.weight
 ) order by se.category,se.sequence),'[]'::jsonb)
 into v_sources
 from public.cbse_sources cs
 join public.cbse_exams se on se.id=cs.source_exam_id
 where cs.exam_id=e.id;

 return jsonb_build_object(
   'exam',to_jsonb(e),
   'policy',(select to_jsonb(p) from public.cbse_policies p where p.id=e.policy_id),
   'papers',v_papers,'students',v_students,'reports',v_reports,
   'exceptions',v_exceptions,'audit',v_audit,'sources',v_sources,
   'capabilities',jsonb_build_object(
     'manage',public.cbse_manager(e.institution_id,false),
     'review',public.cbse_manager(e.institution_id,true),
     'class_teacher',public.cbse_class_teacher(e.id),
     'co_scholastic',public.cbse_co_scholastic_editor(e.id),
     'enter',(e.status='open' and (
       public.cbse_marks_role(e.id)
       or exists(
         select 1 from public.cbse_papers p
         where p.exam_id=e.id and p.teacher_user_id=actor
           and public.cbse_teacher(e.id,p.subject_id,actor)
       )
     ))
   )
 );
end $$;

revoke all on function public.cbse_computer_teacher() from public,anon;
revoke all on function public.cbse_marks_all_classes() from public,anon;
grant execute on function public.cbse_computer_teacher() to authenticated;
grant execute on function public.cbse_marks_all_classes() to authenticated;
