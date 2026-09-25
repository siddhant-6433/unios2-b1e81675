-- Unit Test I (11-16 May 2026) for NIMT Beacon School Avantika II, from the
-- school's UT-1 datesheet. Classes Nursery/KG/UKG, I-X and XII (Class XI is not
-- on the datesheet). Classes IX/X include Computer, so it is added to their
-- subject master and to a fresh approved policy version. UT-1 is created open
-- for marks entry where the class has students.

-- Computer is examined in Classes IX/X (a regular paper on the UT-1 sheet).
insert into public.subjects (course_id, name, code, term, is_elective, is_co_scholastic, display_order, active)
select c.id, 'Computer', 'COMP', coalesce((select term from public.subjects limit 1), 'annual'), false, false, 6, true
from public.courses c
where c.code in ('BSAV-G9','BSAV-G10')
  and not exists (select 1 from public.subjects s where s.course_id=c.id and s.code='COMP');

do $$
declare
  v_session uuid := 'f0000001-0000-0000-0000-000000000001';
  v_admin uuid;
  r record;
  v_policy uuid;
  v_exam uuid;
  v_papers jsonb;
  v_needs boolean;
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.user_id=ur.user_id
    where ur.role::text='super_admin' and p.display_name ilike 'Siddhant%' order by ur.user_id limit 1;
  if v_admin is null then select ur.user_id into v_admin from user_roles ur where ur.role::text='super_admin' order by ur.user_id limit 1; end if;
  if v_admin is null then raise exception 'UT-1 seed needs a super admin user'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  for r in
    select c.id, c.code,
      (select ct.teacher_user_id from class_teachers ct where ct.course_id=c.id and ct.session_id=v_session and ct.section is null and ct.active order by ct.created_at limit 1) as teacher
    from public.courses c
    where c.code ~* '^BSAV-(NUR|LKG|UKG|G1|G2|G3|G4|G5|G6|G7|G8|G9|G10|G12)$'
      and exists (select 1 from public.subjects s where s.course_id=c.id and s.active)
    order by c.code
  loop
    if r.teacher is null then raise exception 'No class teacher assigned for %', r.code; end if;

    -- Reuse the latest approved policy unless it is missing one of the class's subjects.
    select id into v_policy from cbse_policies where course_id=r.id and session_id=v_session and status='approved' order by version desc limit 1;
    select exists (
      select 1 from public.subjects s
      where s.course_id=r.id and s.active
        and not exists (
          select 1 from jsonb_array_elements(coalesce((select rules->'subjects' from cbse_policies where id=v_policy),'[]'::jsonb)) x
          where x->>'subject_id'=s.id::text)
    ) into v_needs;
    if v_policy is null or v_needs then
      v_policy := (public.cbse_action(null,'create_policy',null,jsonb_build_object(
        'course_id',r.id,'session_id',v_session,'name','CBSE assessment 2026-27 · '||r.code,'rules',public.cbse_default_rules(r.id)))->>'id')::uuid;
      perform public.cbse_action(null,'approve_policy',null,jsonb_build_object('policy_id',v_policy,
        'remarks','School assessment rules confirmed against the CBSE curriculum source.'));
    end if;

    if not exists (select 1 from public.cbse_exams where course_id=r.id and session_id=v_session and category='unit_test' and sequence=1) then
      select coalesce(jsonb_agg(jsonb_build_object('subject_id',s.id,'teacher_user_id',r.teacher)),'[]'::jsonb) into v_papers
      from public.subjects s where s.course_id=r.id and s.active and not s.is_co_scholastic;
      if jsonb_array_length(v_papers)>0 then
        v_exam := (public.cbse_action(null,'create_exam',null,jsonb_build_object(
          'course_id',r.id,'session_id',v_session,'section',null,'name','Unit Test I · '||r.code,'academic_year','2026-27',
          'category','unit_test','sequence',1,'starts_on','2026-05-11','ends_on','2026-05-16','fee_cutoff','2026-05-11',
          'policy_id',v_policy,'class_teacher_user_id',r.teacher,'papers',v_papers,'source_exam_ids','[]'::jsonb))->>'id')::uuid;
        if exists (select 1 from public.cbse_roster where exam_id=v_exam) then
          perform public.cbse_action(v_exam,'open',1,'{}'::jsonb);
        end if;
      end if;
    end if;
  end loop;
end $$;
