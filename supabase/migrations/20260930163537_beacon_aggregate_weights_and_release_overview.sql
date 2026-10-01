-- keep-migration-version
-- Combined/aggregate support:
--  * publish an approved policy version per class carrying the term weights
--    (Unit Test 1 20% / Unit Test 2 20% / Half Yearly 60%) so a combined report
--    can be created; and
--  * a release-overview read model: every assessment for a class + session with
--    its report and fee status, so an approver can release them individually.

do $$
declare
  v_session uuid := 'f0000001-0000-0000-0000-000000000001';
  v_admin uuid; r record; v_policy uuid; v_rules jsonb;
begin
  select ur.user_id into v_admin from user_roles ur join profiles p on p.user_id=ur.user_id
    where ur.role::text='super_admin' and p.display_name ilike 'Siddhant%' order by ur.user_id limit 1;
  if v_admin is null then select ur.user_id into v_admin from user_roles ur where ur.role::text='super_admin' order by ur.user_id limit 1; end if;
  if v_admin is null then raise exception 'Aggregate weights migration needs a super admin user'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  for r in
    select c.id, c.code from courses c
    where c.code ~* '^BSAV-(G([1-9]|1[0-2])|NUR|LKG|UKG|TOD)$'
      and exists(select 1 from subjects s where s.course_id=c.id and s.active)
    order by c.code
  loop
    if not exists (
      select 1 from cbse_policies
      where course_id=r.id and session_id=v_session and status='approved'
        and jsonb_array_length(coalesce(rules->'annual_weights','[]'::jsonb))>0
    ) then
      v_rules := jsonb_set(cbse_default_rules(r.id), '{annual_weights}',
        '[{"category":"unit_test","sequence":1,"weight":20},{"category":"unit_test","sequence":2,"weight":20},{"category":"half_yearly","sequence":1,"weight":60}]'::jsonb);
      v_policy := (cbse_action(null,'create_policy',null,jsonb_build_object(
        'course_id',r.id,'session_id',v_session,'name','CBSE assessment 2026-27 (combined weights) · '||r.code,'rules',v_rules))->>'id')::uuid;
      perform cbse_action(null,'approve_policy',null,jsonb_build_object('policy_id',v_policy,
        'remarks','Term weights confirmed for combined reports: UT-1 20% / UT-2 20% / Half Yearly 60%.'));
    end if;
  end loop;
end $$;

create function public.cbse_release_overview(_course_id uuid,_session_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
  perform cbse_enabled();
  perform cbse_actor();
  if not (cbse_manager(cbse_course_institution(_course_id),false) or cbse_academic_role()) then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.name,'category',e.category,'sequence',e.sequence,'status',e.status,'revision',e.revision,'version',e.version,
    'students',(select count(*)::int from cbse_roster ro where ro.exam_id=e.id),
    'reports_approved',(select count(*)::int from cbse_reports r where r.exam_id=e.id and r.revision=e.revision and r.status='approved'),
    'reports_released',(select count(*)::int from cbse_reports r where r.exam_id=e.id and r.revision=e.revision and r.status='released'),
    'fee_ready',(select count(*)::int from cbse_roster ro where ro.exam_id=e.id and (
      coalesce(cbse_fee(ro.student_id,e.fee_cutoff)->>'status','unresolved')='clear'
      or exists(select 1 from cbse_exceptions x where x.exam_id=e.id and x.student_id=ro.student_id and x.revision=e.revision and x.fee_cutoff=e.fee_cutoff and x.status='approved'))),
    'exceptions_pending',(select count(*)::int from cbse_exceptions x where x.exam_id=e.id and x.revision=e.revision and x.status='pending')
  ) order by case e.category when 'unit_test' then 1 when 'half_yearly' then 2 when 'final' then 3 when 'pre_board' then 4 else 5 end, e.sequence),'[]'::jsonb) into v
  from cbse_exams e
  where e.course_id=_course_id and e.session_id=_session_id and e.status<>'cancelled';
  return jsonb_build_object('course_id',_course_id,'session_id',_session_id,'exams',v);
end $$;
revoke all on function public.cbse_release_overview(uuid,uuid) from public,anon;
grant execute on function public.cbse_release_overview(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
