-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations to align db push history.
-- Git must keep this timestamp so `db push` matches remote history.
--
-- Bring NIMT Beacon School Avantika II (BSAV) onto the CBSE assessments module:
--   * extend grade handling to pre-primary (grade 0),
--   * seed pre-primary subjects,
--   * assign the interim class teacher (office assistant) to every class,
--   * create an approved CBSE policy per class and the two dated exams:
--       - Unit Test II (done)  -> created open for marks entry
--       - Half Yearly (scheduled) -> created as draft
-- Uses the school's own datesheets as the reporting periods.

-- Pre-primary classes have no grade number; they are grade 0.
create or replace function public.cbse_grade_from_code(_code text) returns integer language sql immutable set search_path=public,pg_temp as $$
 select case
  when upper(coalesce(_code,'')) ~ '^(BSA|BSAV)-(NUR|LKG|UKG|TOD)$' then 0
  when upper(coalesce(_code,'')) ~ '^(BSA|BSAV)-G([1-9]|1[0-2])$' then substring(upper(_code) from 'G([0-9]+)$')::integer
 end
$$;
revoke all on function public.cbse_grade_from_code(text) from public,anon;

create or replace function public.cbse_course_ids() returns setof uuid language sql stable security definer set search_path=public,pg_temp as $$
 select c.id from courses c
 where c.code ~* '^(BSA|BSAV)-(G([1-9]|1[0-2])|NUR|LKG|UKG|TOD)$' and (
  exists(select 1 from user_roles r where r.user_id=cbse_actor() and r.role::text='super_admin')
  or exists(select 1 from departments d join user_institution_access a on a.institution_id=d.institution_id where d.id=c.department_id and a.user_id=cbse_actor())
  or exists(select 1 from subjects s join subject_allocations sa on sa.subject_id=s.id where s.course_id=c.id and sa.faculty_user_id=cbse_actor() and sa.active)
  or exists(select 1 from class_teachers ct where ct.course_id=c.id and ct.teacher_user_id=cbse_actor() and ct.active))
$$;
revoke all on function public.cbse_course_ids() from public,anon;

-- Editable CBSE starting rules for a class, mirroring src/lib/cbseDefaults.ts.
create or replace function public.cbse_default_rules(_course uuid) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'subjects', coalesce(jsonb_agg(jsonb_build_object(
     'subject_id', s.id,
     'pass_percent', case when s.is_co_scholastic or g.grade=0 then null else 33 end,
     'contributes_to_total', not (s.is_co_scholastic or g.grade=0),
     'components', case
       when g.grade=0 then jsonb_build_array(jsonb_build_object('key','written','label','Written','max',50,'pass_percent',null),jsonb_build_object('key','oral','label','Oral','max',50,'pass_percent',null))
       when g.grade between 1 and 5 then jsonb_build_array(jsonb_build_object('key','written','label','Written','max',80,'pass_percent',33),jsonb_build_object('key','oral','label','Oral / Internal','max',20,'pass_percent',null))
       when g.grade between 6 and 8 then jsonb_build_array(jsonb_build_object('key','theory','label','Theory','max',80,'pass_percent',33),jsonb_build_object('key','internal','label','Internal assessment','max',20,'pass_percent',null))
       when g.grade between 9 and 10 then jsonb_build_array(jsonb_build_object('key','theory','label','Theory','max',80,'pass_percent',33),jsonb_build_object('key','periodic','label','Periodic assessment','max',5,'pass_percent',null),jsonb_build_object('key','multiple','label','Multiple assessment','max',5,'pass_percent',null),jsonb_build_object('key','portfolio','label','Portfolio','max',5,'pass_percent',null),jsonb_build_object('key','enrichment','label','Subject enrichment','max',5,'pass_percent',null))
       when s.code in ('PHY','CHE','BIO','CS','PE') then jsonb_build_array(jsonb_build_object('key','theory','label','Theory','max',70,'pass_percent',33),jsonb_build_object('key','practical','label','Practical','max',30,'pass_percent',null))
       else jsonb_build_array(jsonb_build_object('key','theory','label','Theory','max',80,'pass_percent',33),jsonb_build_object('key','internal','label','Internal assessment','max',20,'pass_percent',null))
     end) order by s.display_order,s.name),'[]'::jsonb),
  'grade_bands', '[{"min":91,"grade":"A1"},{"min":81,"grade":"A2"},{"min":71,"grade":"B1"},{"min":61,"grade":"B2"},{"min":51,"grade":"C1"},{"min":41,"grade":"C2"},{"min":33,"grade":"D"},{"min":0,"grade":"E"}]'::jsonb,
  'rounding',2,'absent_treatment','zero','exempt_treatment','exclude','additional_subject_treatment','all_applicable','annual_weights','[]'::jsonb,
  'confirmed',true,'source_url','https://cbseacademic.nic.in/curriculum_2027.html')
 from subjects s join courses c on c.id=s.course_id
 cross join lateral (select cbse_grade_from_code(c.code) as grade) g
 where s.course_id=_course and s.active;
$$;
revoke all on function public.cbse_default_rules(uuid) from public,anon;

-- Pre-primary subjects (Half Yearly datesheet: Hindi, English, Maths, GK/Art, Poem).
insert into public.subjects (course_id, name, code, term, is_elective, is_co_scholastic, display_order, active)
select c.id, v.name, v.code, coalesce((select term from public.subjects limit 1),'annual'), false, v.co, v.ord, true
from public.courses c
join (values ('ENG','English',false,1),('HIN','Hindi',false,2),('MAT','Maths',false,3),('GK','GK / Art',true,4),('POEM','Poem Recitation',true,5)) as v(code,name,co,ord) on true
where c.code ~* '^BSAV-(NUR|LKG|UKG|TOD)$'
  and not exists (select 1 from public.subjects existing where existing.course_id=c.id);

do $$
declare
  v_session uuid := 'f0000001-0000-0000-0000-000000000001';
  v_admin uuid;
  v_office uuid;
  r record;
  v_policy uuid;
  v_exam uuid;
  v_papers jsonb;
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.user_id=ur.user_id
    where ur.role::text='super_admin' and p.display_name ilike 'Siddhant%' order by ur.user_id limit 1;
  if v_admin is null then select ur.user_id into v_admin from user_roles ur where ur.role::text='super_admin' order by ur.user_id limit 1; end if;
  select ur.user_id into v_office from user_roles ur join profiles p on p.user_id=ur.user_id
    where ur.role::text='office_assistant' and p.display_name ilike 'Swati%' order by ur.user_id limit 1;
  if v_office is null then select ur.user_id into v_office from user_roles ur where ur.role::text in ('office_assistant','office_admin') order by ur.user_id limit 1; end if;
  if v_admin is null or v_office is null then raise exception 'Beacon exam seed needs a super admin and an office user'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.class_teachers(course_id, teacher_user_id, session_id, section, active)
  select c.id, v_office, v_session, null, true
  from public.courses c
  where c.code ~* '^BSAV-(G([1-9]|1[0-2])|NUR|LKG|UKG|TOD)$'
    and not exists (select 1 from public.class_teachers ct where ct.course_id=c.id and ct.session_id=v_session and ct.section is null and ct.batch_id is null);

  for r in
    select c.id, c.code from public.courses c
    where c.code ~* '^BSAV-(G([1-9]|1[0-2])|NUR|LKG|UKG|TOD)$'
      and exists (select 1 from public.subjects s where s.course_id=c.id and s.active)
    order by c.code
  loop
    select id into v_policy from public.cbse_policies where course_id=r.id and session_id=v_session and status='approved' order by version desc limit 1;
    if v_policy is null then
      v_policy := (public.cbse_action(null,'create_policy',null,jsonb_build_object(
        'course_id',r.id,'session_id',v_session,'name','CBSE assessment 2026-27 · '||r.code,'rules',public.cbse_default_rules(r.id)))->>'id')::uuid;
      perform public.cbse_action(null,'approve_policy',null,jsonb_build_object('policy_id',v_policy,
        'remarks','School assessment rules confirmed against the CBSE curriculum source.'));
    end if;

    if not exists (select 1 from public.cbse_exams where course_id=r.id and session_id=v_session and category='unit_test' and sequence=2) then
      select coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'teacher_user_id',v_office)),'[]'::jsonb) into v_papers
      from public.subjects s where s.course_id=r.id and s.active and not s.is_co_scholastic;
      if jsonb_array_length(v_papers)>0 then
        v_exam := (public.cbse_action(null,'create_exam',null,jsonb_build_object(
          'course_id',r.id,'session_id',v_session,'section',null,'name','Unit Test II · '||r.code,'academic_year','2026-27',
          'category','unit_test','sequence',2,'starts_on','2026-08-20','ends_on','2026-08-27','fee_cutoff','2026-08-20',
          'policy_id',v_policy,'class_teacher_user_id',v_office,'papers',v_papers,'source_exam_ids','[]'::jsonb))->>'id')::uuid;
        if exists (select 1 from public.cbse_roster where exam_id=v_exam) then
          perform public.cbse_action(v_exam,'open',1,'{}'::jsonb);
        end if;
      end if;
    end if;

    if not exists (select 1 from public.cbse_exams where course_id=r.id and session_id=v_session and category='half_yearly' and sequence=1) then
      select coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'teacher_user_id',v_office)),'[]'::jsonb) into v_papers
      from public.subjects s where s.course_id=r.id and s.active;
      if jsonb_array_length(v_papers)>0 then
        perform public.cbse_action(null,'create_exam',null,jsonb_build_object(
          'course_id',r.id,'session_id',v_session,'section',null,'name','Half Yearly · '||r.code,'academic_year','2026-27',
          'category','half_yearly','sequence',1,'starts_on','2026-10-05','ends_on','2026-10-14','fee_cutoff','2026-10-05',
          'policy_id',v_policy,'class_teacher_user_id',v_office,'papers',v_papers,'source_exam_ids','[]'::jsonb));
      end if;
    end if;
  end loop;
end $$;
