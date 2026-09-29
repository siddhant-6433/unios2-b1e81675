-- Assign the real NIMT Beacon Avantika II class teachers (from the school's
-- class-teacher list) and let a principal / super admin change the class teacher
-- of an assessment.

-- The class-teacher list maps to employee logins (all active 'teacher' accounts,
-- except XII which is the existing Swati Gupta account).
do $$
declare r record; v_uid uuid;
begin
  for r in
    select * from (values
      ('BSAV-NUR','linkan.panchal@nimt.ac.in'),
      ('BSAV-LKG','linkan.panchal@nimt.ac.in'),
      ('BSAV-UKG','linkan.panchal@nimt.ac.in'),
      ('BSAV-G1','antima.mittal@nimt.ac.in'),
      ('BSAV-G2','antima.mittal@nimt.ac.in'),
      ('BSAV-G3','muskan@nimt.ac.in'),
      ('BSAV-G4','meenakshi.goel@nimt.ac.in'),
      ('BSAV-G5','swati@nimt.ac.in'),
      ('BSAV-G6','priyanka.sharma@nimt.ac.in'),
      ('BSAV-G7','deepika.sharma@nimt.ac.in'),
      ('BSAV-G8','priyanka.aggarwal@nimt.ac.in'),
      ('BSAV-G9','shivani.singh@nimt.ac.in'),
      ('BSAV-G10','abhishek.sharma@nimt.ac.in'),
      ('BSAV-G11','isha.tyagi@nimt.ac.in'),
      ('BSAV-G12','swati.gupta@nimt.ac.in')
    ) as m(course_code, email)
  loop
    select p.user_id into v_uid from profiles p where lower(p.email)=lower(r.email) and p.login_disabled is not true limit 1;
    if v_uid is null then raise notice 'Skipping class teacher % (no active user)', r.email; continue; end if;

    if not exists (
      select 1 from class_teachers ct join courses c on c.id=ct.course_id
      where c.code=r.course_code and ct.session_id='f0000001-0000-0000-0000-000000000001'
        and ct.section is null and ct.batch_id is null
    ) then
      insert into class_teachers(course_id, teacher_user_id, session_id, section, active)
      select c.id, v_uid, 'f0000001-0000-0000-0000-000000000001', null, true from courses c where c.code=r.course_code;
    else
      update class_teachers ct set teacher_user_id=v_uid, active=true
      from courses c
      where c.id=ct.course_id and c.code=r.course_code
        and ct.session_id='f0000001-0000-0000-0000-000000000001' and ct.section is null and ct.batch_id is null;
    end if;

    update cbse_exams e set class_teacher_user_id=v_uid
    from courses c
    where c.id=e.course_id and c.code=r.course_code and e.session_id='f0000001-0000-0000-0000-000000000001';
  end loop;
end $$;

-- Principal / super admin can change an assessment's class teacher while it is
-- still in a working state (reopen first once approved/released).
create function public.cbse_set_class_teacher(_exam_id uuid,_teacher_user_id uuid,_expected_version integer,_remarks text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; e cbse_exams; v_version integer; v_remarks text;
begin
  perform cbse_enabled();
  actor:=cbse_actor();
  if _exam_id is null or _teacher_user_id is null then raise exception 'Choose a class teacher'; end if;
  select * into e from cbse_exams where id=_exam_id for update;
  if not found then raise exception 'Assessment not found'; end if;
  if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
  if not cbse_manager(e.institution_id,false) then raise exception 'Only a principal or super admin can change the class teacher'; end if;
  if _expected_version is null or e.version<>_expected_version then raise exception 'This assessment changed in another session. Reload before making further changes'; end if;
  if e.status='cancelled' then raise exception 'This assessment is cancelled'; end if;
  if e.status in ('approved','released') then raise exception 'Reopen the assessment before changing the class teacher'; end if;
  v_remarks:=btrim(coalesce(_remarks,''));
  if v_remarks='' then raise exception 'Enter a reason for changing the class teacher'; end if;
  if not exists(select 1 from profiles where user_id=_teacher_user_id and login_disabled is not true and deleted_at is null and archived_at is null) then
    raise exception 'The chosen class teacher is not an active user';
  end if;

  update cbse_exams set class_teacher_user_id=_teacher_user_id, version=version+1 where id=e.id returning version into v_version;
  update class_teachers ct set active=true
  where ct.course_id=e.course_id and ct.teacher_user_id=_teacher_user_id and ct.session_id=e.session_id
    and ct.section is not distinct from e.section and ct.batch_id is null;
  if not found then
    insert into class_teachers(course_id, teacher_user_id, session_id, section, active)
    values(e.course_id, _teacher_user_id, e.session_id, e.section, true);
  end if;

  insert into cbse_audit(exam_id,action,actor_id,remarks,details)
  values(e.id,'set_class_teacher',actor,v_remarks,jsonb_build_object('class_teacher_user_id',_teacher_user_id));
  return jsonb_build_object('id',e.id,'version',v_version);
end $$;

revoke all on function public.cbse_set_class_teacher(uuid,uuid,integer,text) from public,anon;
grant execute on function public.cbse_set_class_teacher(uuid,uuid,integer,text) to authenticated;
notify pgrst, 'reload schema';
