-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations to align db push history.
-- Git must keep this timestamp so `db push` matches remote history.
--
-- Beacon school reports. RPC-only access; all actor identities come from auth.uid().
-- Created with db:migration:new. Self-contained: tables, RPCs, grants and RLS.
create table public.cbse_policies (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id),
 session_id uuid not null references public.admission_sessions(id), name text not null check(length(trim(name))>0),
 version integer not null, status text not null default 'draft' check(status in ('draft','approved')),
 rules jsonb not null, approved_by uuid, approved_at timestamptz, created_by uuid not null, created_at timestamptz not null default now(),
 unique(course_id,session_id,version)
);
create table public.cbse_exams (
 id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.institutions(id),
 course_id uuid not null references public.courses(id), session_id uuid not null references public.admission_sessions(id), section text,
 name text not null check(length(trim(name))>0), academic_year text not null,
 category text not null check(category in ('unit_test','half_yearly','final','pre_board','annual')), sequence integer not null check(sequence>0),
 starts_on date not null, ends_on date not null, fee_cutoff date not null, policy_id uuid not null references public.cbse_policies(id),
 class_teacher_user_id uuid not null, status text not null default 'draft' check(status in ('draft','open','class_review','principal_review','approved','released','cancelled')),
 version integer not null default 1, revision integer not null default 1, created_by uuid not null, created_at timestamptz not null default now(), check(ends_on>=starts_on)
);
create table public.cbse_papers (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.cbse_exams(id), subject_id uuid not null references public.subjects(id),
 name text not null, code text not null, teacher_user_id uuid not null, components jsonb not null, locked_at timestamptz, unique(exam_id,subject_id)
);
create table public.cbse_roster (
 exam_id uuid not null references public.cbse_exams(id), student_id uuid not null references public.students(id),
 identity_snapshot jsonb not null, applicable_subject_ids uuid[] not null, explicit_selection boolean not null default false,
 attendance_present integer, attendance_working_days integer, remarks text, primary key(exam_id,student_id),
 check(attendance_present>=0 and attendance_working_days>=0 and attendance_present<=attendance_working_days)
);
create table public.cbse_marks (
 paper_id uuid not null references public.cbse_papers(id), student_id uuid not null references public.students(id),
 status text not null check(status in ('present','absent','exempt')), scores jsonb not null default '{}', remarks text,
 updated_by uuid not null, updated_at timestamptz not null default now(), primary key(paper_id,student_id)
);
create table public.cbse_reports (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.cbse_exams(id), student_id uuid not null references public.students(id),
 revision integer not null, status text not null default 'approved' check(status in ('approved','released','withdrawn')),
 snapshot jsonb not null, approved_at timestamptz not null default now(), released_at timestamptz, withdrawn_at timestamptz,
 unique(exam_id,student_id,revision)
);
create table public.cbse_sources (
 exam_id uuid not null references public.cbse_exams(id), source_exam_id uuid not null references public.cbse_exams(id),
 weight numeric not null check(weight>0), primary key(exam_id,source_exam_id), check(exam_id<>source_exam_id)
);
create table public.cbse_report_sources (
 report_id uuid not null references public.cbse_reports(id), source_report_id uuid not null references public.cbse_reports(id),
 primary key(report_id,source_report_id)
);
create table public.cbse_exceptions (
 id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.cbse_exams(id), student_id uuid not null references public.students(id),
 revision integer not null, fee_cutoff date not null, status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
 request_remarks text not null check(length(trim(request_remarks))>0), review_remarks text, requested_by uuid not null, reviewed_by uuid,
 created_at timestamptz not null default now(), reviewed_at timestamptz, revoked_at timestamptz
);
create table public.cbse_audit (
 id bigint generated always as identity primary key, exam_id uuid references public.cbse_exams(id), action text not null,
 actor_id uuid not null, created_at timestamptz not null default now(), remarks text, details jsonb not null default '{}'
);
create index cbse_exams_course_session on public.cbse_exams(course_id,session_id,created_at desc);
create index cbse_roster_student on public.cbse_roster(student_id,exam_id);
create index cbse_reports_student on public.cbse_reports(student_id,exam_id,revision desc);
create index cbse_sources_reverse on public.cbse_sources(source_exam_id,exam_id);
create index cbse_report_sources_reverse on public.cbse_report_sources(source_report_id,report_id);
create index cbse_exceptions_lookup on public.cbse_exceptions(exam_id,student_id,revision,status);
create index cbse_audit_exam on public.cbse_audit(exam_id,id desc);

create function public.cbse_actor() returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from profiles where user_id=auth.uid() and not login_disabled and deleted_at is null and archived_at is null) then raise exception 'Access denied'; end if;
 return auth.uid();
end $$;
create function public.cbse_manager(_institution uuid, _review boolean default false) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from user_roles where user_id=cbse_actor() and role::text='super_admin') or exists(
 select 1 from user_institution_access a join user_roles r on r.user_id=a.user_id and r.role=a.role
 where a.user_id=cbse_actor() and a.institution_id=_institution and
 (a.role::text='principal' or (not _review and a.role::text in ('campus_admin','school_coordinator'))))
$$;
create function public.cbse_teacher(_exam uuid,_subject uuid,_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from cbse_exams e join subjects s on s.course_id=e.course_id
 join subject_allocations a on a.subject_id=s.id
 where e.id=_exam and s.id=_subject and a.faculty_user_id=_user and a.active and a.batch_id is null
 and a.session_id=e.session_id and (a.section is null or a.section=e.section))
$$;
create function public.cbse_class_teacher(_exam uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from cbse_exams e join class_teachers c on c.course_id=e.course_id
 where e.id=_exam and e.class_teacher_user_id=cbse_actor() and c.teacher_user_id=cbse_actor() and c.active
 and c.batch_id is null and c.session_id=e.session_id and (c.section is null or c.section=e.section))
$$;
create function public.cbse_staff(_exam uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from cbse_exams e where e.id=_exam and (cbse_manager(e.institution_id) or cbse_class_teacher(e.id)
 or exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=cbse_actor() and cbse_teacher(e.id,p.subject_id,cbse_actor()))))
$$;
create function public.cbse_family(_student uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from students s where s.id=_student and s.deleted_at is null and s.archived_at is null and
 ((s.user_id=cbse_actor() and not s.login_disabled) or cbse_actor() in (s.father_user_id,s.mother_user_id,s.guardian_user_id)))
$$;
create function public.cbse_fee(_student uuid,_cutoff date) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select case when count(*)=0 or bool_or(balance is null or (balance>0 and due_date is null)) or _cutoff is null
 then jsonb_build_object('status','unresolved','due',null)
 else jsonb_build_object('status',case when coalesce(sum(greatest(balance,0)) filter(where due_date<=_cutoff),0)>0 then 'due' else 'clear' end,
 'due',coalesce(sum(greatest(balance,0)) filter(where due_date<=_cutoff),0)) end from fee_ledger where student_id=_student
$$;
create function public.cbse_grade(_percentage numeric,_rules jsonb) returns text language sql immutable set search_path=public,pg_temp as $$
 select b->>'grade' from jsonb_array_elements(_rules->'grade_bands') b where (b->>'min')::numeric<=_percentage order by (b->>'min')::numeric desc limit 1
$$;
create function public.cbse_validate_policy(_course uuid,_rules jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare s jsonb; c jsonb; b jsonb; w jsonb;
begin
 if coalesce((_rules->>'confirmed')::boolean,false) is not true or coalesce(_rules->>'rounding','') not in ('0','1','2')
 or coalesce(_rules->>'absent_treatment','') not in ('zero','exclude') or coalesce(_rules->>'exempt_treatment','')<>'exclude'
 or coalesce(_rules->>'additional_subject_treatment','')<>'all_applicable' or coalesce(_rules->>'source_url','') !~ '^https://cbseacademic\.nic\.in/'
 or jsonb_typeof(_rules->'subjects') is distinct from 'array' or jsonb_array_length(_rules->'subjects')=0
 or jsonb_typeof(_rules->'grade_bands') is distinct from 'array' or jsonb_array_length(_rules->'grade_bands')=0
 or jsonb_typeof(_rules->'annual_weights') is distinct from 'array' then raise exception 'Confirm complete school assessment rules before approval'; end if;
 if (select count(*)<>count(distinct x->>'subject_id') from jsonb_array_elements(_rules->'subjects') x) then raise exception 'Duplicate policy subject'; end if;
 for s in select value from jsonb_array_elements(_rules->'subjects') loop
  if not exists(select 1 from subjects where id=(s->>'subject_id')::uuid and course_id=_course and active) or
    jsonb_typeof(s->'components') is distinct from 'array' or jsonb_array_length(s->'components')=0 or not s ? 'pass_percent'
    or (s->>'pass_percent')::numeric not between 0 and 100 then raise exception 'Invalid subject assessment rule'; end if;
  if s ? 'contributes_to_total' and jsonb_typeof(s->'contributes_to_total')<>'boolean' then raise exception 'Invalid total contribution'; end if;
  if (select count(*)<>count(distinct x->>'key') from jsonb_array_elements(s->'components') x) then raise exception 'Duplicate assessment component'; end if;
  for c in select value from jsonb_array_elements(s->'components') loop
   if coalesce(c->>'key','') !~ '^[a-zA-Z][a-zA-Z0-9_]*$' or length(trim(coalesce(c->>'label','')))=0 or
     jsonb_typeof(c->'max') is distinct from 'number' or (c->>'max')::numeric<=0 or not c ? 'pass_percent'
     or (c->>'pass_percent')::numeric not between 0 and 100 then raise exception 'Invalid component maximum or pass rule'; end if;
  end loop;
 end loop;
 for b in select value from jsonb_array_elements(_rules->'grade_bands') loop
  if jsonb_typeof(b->'min') is distinct from 'number' or (b->>'min')::numeric not between 0 and 100 or length(trim(coalesce(b->>'grade','')))=0 then raise exception 'Invalid grade band'; end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(_rules->'grade_bands') gb where (gb->>'min')::numeric=0) or
 (select count(*)<>count(distinct gb->>'min') from jsonb_array_elements(_rules->'grade_bands') gb) then raise exception 'Grade bands must cover zero and have distinct boundaries'; end if;
 for w in select value from jsonb_array_elements(_rules->'annual_weights') loop
  if coalesce(w->>'category','') not in ('unit_test','half_yearly','final','pre_board') or coalesce((w->>'sequence')::integer,0)<1
  or coalesce((w->>'weight')::numeric,0)<=0 then raise exception 'Invalid annual weight'; end if;
 end loop;
 if (select count(*)<>count(distinct (aw->>'category',aw->>'sequence')) from jsonb_array_elements(_rules->'annual_weights') aw) then raise exception 'Duplicate annual assessment'; end if;
 if jsonb_array_length(_rules->'annual_weights')>0 and (select sum((aw->>'weight')::numeric) from jsonb_array_elements(_rules->'annual_weights') aw)<>100 then raise exception 'Annual weights must total 100'; end if;
end $$;

create function public.cbse_refresh_roster(_exam uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; all_subjects uuid[];
begin
 select * into strict e from cbse_exams where id=_exam;
 select array_agg(subject_id) into all_subjects from cbse_papers where exam_id=e.id;
 delete from cbse_roster r where r.exam_id=e.id and not exists(select 1 from students s where s.id=r.student_id and s.course_id=e.course_id and s.session_id=e.session_id and (e.section is null or s.section=e.section) and s.deleted_at is null and s.archived_at is null);
 insert into cbse_roster(exam_id,student_id,identity_snapshot,applicable_subject_ids)
 select e.id,s.id,jsonb_build_object('id',s.id,'name',s.name,'admission_no',s.admission_no,'roll_no',s.class_roll_no,'section',s.section,
 'father_name',s.father_name,'mother_name',s.mother_name,'dob',s.dob,'course_name',c.name),coalesce(all_subjects,'{}')
 from students s join courses c on c.id=s.course_id where s.course_id=e.course_id and s.session_id=e.session_id
 and (e.section is null or s.section=e.section) and s.deleted_at is null and s.archived_at is null
 on conflict(exam_id,student_id) do update set identity_snapshot=excluded.identity_snapshot,
 applicable_subject_ids=case when cbse_roster.explicit_selection then cbse_roster.applicable_subject_ids else excluded.applicable_subject_ids end;
end $$;

create function public.cbse_configure(_exam uuid,_payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
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
   if sr is null or not cbse_teacher(e.id,(x->>'subject_id')::uuid,(x->>'teacher_user_id')::uuid) then raise exception 'Teacher must be assigned to this subject, class, section and session'; end if;
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

-- Rollout is independently gated in database, browser and PDF edge function.
insert into public._app_config(key,value) values('beacon_academics_enabled','false') on conflict(key) do nothing;
create function public.cbse_enabled() returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform cbse_actor();
 if not exists(select 1 from _app_config where key='beacon_academics_enabled' and value='true') then raise exception 'Beacon academic reports are not enabled'; end if;
end $$;

create function public.cbse_validate_marks(_paper uuid,_student uuid,_status text,_scores jsonb,_complete boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p cbse_papers; c jsonb; score jsonb;
begin
 select * into strict p from cbse_papers where id=_paper;
 if not exists(select 1 from cbse_roster where exam_id=p.exam_id and student_id=_student and p.subject_id=any(applicable_subject_ids)) then raise exception 'Student is not assigned this paper'; end if;
 if _status is null or _status not in ('present','absent','exempt') or jsonb_typeof(_scores) is distinct from 'object' then raise exception 'Invalid mark status or scores'; end if;
 if exists(select 1 from jsonb_object_keys(_scores) k where not exists(select 1 from jsonb_array_elements(p.components) comp where comp->>'key'=k)) then raise exception 'Unknown assessment component'; end if;
 for c in select value from jsonb_array_elements(p.components) loop
  score:=_scores->(c->>'key');
  if _status<>'present' and score is not null and score<>'null'::jsonb then raise exception 'Absent and exempt papers cannot contain scores'; end if;
  if _status='present' then
   if score is null or score='null'::jsonb then
    if _complete then raise exception 'Enter every required component before locking'; end if;
   elsif jsonb_typeof(score)<>'number' or (score#>>'{}')::numeric<0 or (score#>>'{}')::numeric>(c->>'max')::numeric then raise exception 'Score must be between zero and the component maximum'; end if;
  end if;
 end loop;
end $$;

create function public.cbse_snapshot(_exam uuid,_student uuid,_report uuid,_remarks text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; r cbse_roster; p cbse_papers; m cbse_marks; rule jsonb; c jsonb; components jsonb; subject_rows jsonb:='[]';
 source_ids jsonb:='[]'; subject_status text; score numeric; maximum numeric; obtained numeric; pct numeric; passed boolean; total numeric:=0; total_max numeric:=0;
 all_pass boolean:=true; has_present boolean:=false; rounding integer; grade text; school jsonb; approver text; src record; src_subject jsonb; src_component jsonb;
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
 pct:=case when total_max>0 then round(total*100/total_max,rounding) end;
 return jsonb_build_object('template_version','beacon-v1','report_id',_report,'exam_id',e.id,'revision',e.revision,'title',e.name,'category',e.category,'academic_year',e.academic_year,
 'school',school,'student',r.identity_snapshot,'subjects',subject_rows,'summary',jsonb_build_object('obtained',total,'max',total_max,'percentage',pct,'grade',cbse_grade(pct,pol.rules),
 'result',case when not has_present then 'absent' when not all_pass then 'fail' when total_max=0 then 'incomplete' else 'pass' end),
 'attendance',jsonb_build_object('present',r.attendance_present,'working_days',r.attendance_working_days),'remarks',r.remarks,
 'approval',jsonb_build_object('name',approver,'approved_at',now(),'remarks',_remarks),'policy',jsonb_build_object('id',pol.id,'version',pol.version,'source_url',pol.rules->>'source_url'),
 'source_report_ids',coalesce(source_ids,'[]'),'fee_cutoff',e.fee_cutoff);
end $$;

-- ===========================================================================
-- Read helpers for configuration and workspaces.
-- ===========================================================================
create function public.cbse_grade_from_code(_code text) returns integer language sql immutable set search_path=public,pg_temp as $$
 select case when upper(coalesce(_code,'')) ~ '^(BSA|BSAV)-G([1-9]|1[0-2])$'
  then substring(upper(_code) from 'G([0-9]+)$')::integer end
$$;
create function public.cbse_course_institution(_course uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select d.institution_id from courses c join departments d on d.id=c.department_id where c.id=_course
$$;
create function public.cbse_course_ids() returns setof uuid language sql stable security definer set search_path=public,pg_temp as $$
 select c.id from courses c
 where c.code ~* '^(BSA|BSAV)-G([1-9]|1[0-2])$' and (
  exists(select 1 from user_roles r where r.user_id=cbse_actor() and r.role::text='super_admin')
  or exists(select 1 from departments d join user_institution_access a on a.institution_id=d.institution_id where d.id=c.department_id and a.user_id=cbse_actor())
  or exists(select 1 from subjects s join subject_allocations sa on sa.subject_id=s.id where s.course_id=c.id and sa.faculty_user_id=cbse_actor() and sa.active)
  or exists(select 1 from class_teachers ct where ct.course_id=c.id and ct.teacher_user_id=cbse_actor() and ct.active))
$$;
create function public.cbse_courses() returns table(id uuid,name text,code text,institution_id uuid,institution_name text,grade integer) language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,c.name,c.code,d.institution_id,i.name,cbse_grade_from_code(c.code)
 from courses c join departments d on d.id=c.department_id join institutions i on i.id=d.institution_id
 where c.id in (select cbse_course_ids())
$$;

create function public.cbse_configuration() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform cbse_enabled();
 perform cbse_actor();
 return jsonb_build_object(
  'courses',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'institution_id',institution_id,'institution_name',institution_name,'grade',grade) order by grade,name),'[]'::jsonb) from cbse_courses()),
  'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by start_date desc),'[]'::jsonb) from admission_sessions where is_active),
  'subjects',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'course_id',s.course_id,'name',s.name,'code',s.code,'is_elective',s.is_elective,'is_co_scholastic',s.is_co_scholastic) order by s.display_order,s.name),'[]'::jsonb) from subjects s join cbse_courses() c on c.id=s.course_id where s.active),
  'staff',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',coalesce(nullif(btrim(coalesce(p.display_name,'')),''),p.email,p.user_id::text)) order by p.display_name nulls last,p.email),'[]'::jsonb) from profiles p where p.login_disabled is not true and p.deleted_at is null and p.archived_at is null and exists(select 1 from user_roles r where r.user_id=p.user_id and r.role::text in ('faculty','teacher','principal','campus_admin','school_coordinator','super_admin','office_admin'))),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.version),'[]'::jsonb) from cbse_policies p where p.course_id in (select id from cbse_courses())),
  'exams',(select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_on desc,e.created_at desc),'[]'::jsonb) from cbse_exams e where e.course_id in (select id from cbse_courses()) and e.status<>'cancelled'),
  'capabilities',jsonb_build_object(
   'manage',(select exists(select 1 from cbse_courses() c where cbse_manager(c.institution_id,false))),
   'review',(select exists(select 1 from cbse_courses() c where cbse_manager(c.institution_id,true))))
 );
end $$;

create function public.cbse_exam_workspace(_exam_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; e cbse_exams; v_papers jsonb; v_students jsonb; v_reports jsonb; v_exceptions jsonb; v_audit jsonb; v_sources jsonb;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 select * into e from cbse_exams where id=_exam_id;
 if not found then raise exception 'Assessment not found'; end if;
 if not cbse_staff(e.id) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'exam_id',p.exam_id,'subject_id',p.subject_id,'name',p.name,'code',p.code,'teacher_user_id',p.teacher_user_id,'components',p.components,'locked_at',p.locked_at,
  'can_enter',(e.status='open' and p.locked_at is null and p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor))) order by p.code),'[]'::jsonb) into v_papers from cbse_papers p where p.exam_id=e.id;
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
   'enter',(e.status='open' and exists(select 1 from cbse_papers p where p.exam_id=e.id and p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor)))));
end $$;

-- ===========================================================================
-- Family reads and the authenticated final-download gate.
-- ===========================================================================
create function public.cbse_family_reports(_student_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_out jsonb;
begin
 perform cbse_enabled();
 perform cbse_actor();
 if not cbse_family(_student_id) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(obj order by released_at desc nulls last, created_at desc),'[]'::jsonb) into v_out from (
  select jsonb_build_object('id',coalesce(rp.id,ex.id),'exam_id',ex.id,'student_id',_student_id,'title',ex.name,'academic_year',ex.academic_year,'category',ex.category,'revision',ex.revision,
   'status',case
    when rp.id is null then case when ex.status='released' then 'unavailable' else 'awaiting_release' end
    when rp.status='withdrawn' then 'withdrawn'
    when rp.status='approved' then 'awaiting_release'
    when rp.status='released' then case when f.fee->>'status'='clear' or exc.id is not null then 'available' when f.fee->>'status'='due' then 'fee_hold' else 'unavailable' end
    else 'unavailable' end,
   'fee_due',case when ex.status='released' then nullif(f.fee->>'due','')::numeric else null end,
   'fee_cutoff',ex.fee_cutoff,'released_at',rp.released_at) as obj,
   rp.released_at, ex.created_at
  from cbse_exams ex
  join cbse_roster ros on ros.exam_id=ex.id and ros.student_id=_student_id
  left join cbse_reports rp on rp.exam_id=ex.id and rp.student_id=_student_id and rp.revision=ex.revision
  cross join lateral (select cbse_fee(_student_id,ex.fee_cutoff) as fee) f
  left join lateral (select e2.id from cbse_exceptions e2 where e2.exam_id=ex.id and e2.student_id=_student_id and e2.revision=ex.revision and e2.fee_cutoff=ex.fee_cutoff and e2.status='approved' limit 1) exc on true
  where ex.status<>'cancelled'
 ) rows;
 return v_out;
end $$;

create function public.cbse_download_payload(_report_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; r cbse_reports; e cbse_exams; s students; v_fee jsonb; v_exc uuid; v_token text;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 select * into r from cbse_reports where id=_report_id;
 if not found then raise exception 'This report is not available'; end if;
 select * into e from cbse_exams where id=r.exam_id;
 select * into s from students where id=r.student_id;
 if not (cbse_family(s.id) or cbse_staff(e.id)) then raise exception 'Access denied'; end if;
 if r.status<>'released' or e.status<>'released' or r.revision<>e.revision then raise exception 'This report is not available for download'; end if;
 v_fee:=cbse_fee(s.id,e.fee_cutoff);
 select ex2.id into v_exc from cbse_exceptions ex2 where ex2.exam_id=e.id and ex2.student_id=s.id and ex2.revision=e.revision and ex2.fee_cutoff=e.fee_cutoff and ex2.status='approved' limit 1;
 if coalesce(v_fee->>'status','unresolved')<>'clear' and v_exc is null then raise exception 'Fee clearance is required before this report can be downloaded'; end if;
 v_token:=md5(concat_ws('|',r.id::text,r.revision::text,r.status,e.revision::text,coalesce(v_fee->>'status','unresolved'),coalesce(v_fee->>'due','0'),coalesce(v_exc::text,'none')));
 return jsonb_build_object('report_id',r.id,'revision',r.revision,'eligibility_token',v_token,'snapshot',r.snapshot);
end $$;

-- Annual reports carry no marks entry, so their subject papers (the subjects
-- aggregated from source assessments) are derived from the approved policy.
create function public.cbse_sync_annual_papers(_exam uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies;
begin
 select * into strict e from cbse_exams where id=_exam;
 if e.category<>'annual' then return; end if;
 select * into strict pol from cbse_policies where id=e.policy_id;
 delete from cbse_papers where exam_id=e.id;
 insert into cbse_papers(exam_id,subject_id,name,code,teacher_user_id,components)
 select e.id,s.id,s.name,s.code,e.class_teacher_user_id,rule->'components'
 from jsonb_array_elements(pol.rules->'subjects') rule join subjects s on s.id=(rule->>'subject_id')::uuid and s.course_id=e.course_id;
end $$;

-- ===========================================================================
-- Single transactional entry point for every workspace mutation.
-- ===========================================================================
create function public.cbse_action(_exam_id uuid,_action text,_expected_version integer,_payload jsonb) returns jsonb
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
  if not (v_paper.teacher_user_id=actor and cbse_teacher(e.id,v_paper.subject_id,actor)) then raise exception 'You are not assigned to this paper'; end if;
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
  if not ((v_paper.teacher_user_id=actor and cbse_teacher(e.id,v_paper.subject_id,actor)) or v_manage) then raise exception 'You are not assigned to this paper'; end if;
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

-- ===========================================================================
-- RPC-only access. Internal tables are readable/writable only through the
-- security-definer functions above, never through PostgREST directly.
-- ===========================================================================
alter table public.cbse_policies enable row level security;
alter table public.cbse_exams enable row level security;
alter table public.cbse_papers enable row level security;
alter table public.cbse_roster enable row level security;
alter table public.cbse_marks enable row level security;
alter table public.cbse_reports enable row level security;
alter table public.cbse_sources enable row level security;
alter table public.cbse_report_sources enable row level security;
alter table public.cbse_exceptions enable row level security;
alter table public.cbse_audit enable row level security;
revoke all on public.cbse_policies,public.cbse_exams,public.cbse_papers,public.cbse_roster,public.cbse_marks,
 public.cbse_reports,public.cbse_sources,public.cbse_report_sources,public.cbse_exceptions,public.cbse_audit from anon,authenticated;
grant all on public.cbse_policies,public.cbse_exams,public.cbse_papers,public.cbse_roster,public.cbse_marks,
 public.cbse_reports,public.cbse_sources,public.cbse_report_sources,public.cbse_exceptions,public.cbse_audit to service_role;

-- Functions get EXECUTE for PUBLIC by default, which would let an anonymous
-- caller probe restricted data over /rest/v1/rpc.
revoke all on function public.cbse_actor() from public,anon;
revoke all on function public.cbse_manager(uuid,boolean) from public,anon;
revoke all on function public.cbse_teacher(uuid,uuid,uuid) from public,anon;
revoke all on function public.cbse_class_teacher(uuid) from public,anon;
revoke all on function public.cbse_staff(uuid) from public,anon;
revoke all on function public.cbse_family(uuid) from public,anon;
revoke all on function public.cbse_fee(uuid,date) from public,anon;
revoke all on function public.cbse_grade(numeric,jsonb) from public,anon;
revoke all on function public.cbse_validate_policy(uuid,jsonb) from public,anon;
revoke all on function public.cbse_refresh_roster(uuid) from public,anon;
revoke all on function public.cbse_configure(uuid,jsonb) from public,anon;
revoke all on function public.cbse_enabled() from public,anon;
revoke all on function public.cbse_validate_marks(uuid,uuid,text,jsonb,boolean) from public,anon;
revoke all on function public.cbse_snapshot(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.cbse_grade_from_code(text) from public,anon;
revoke all on function public.cbse_course_institution(uuid) from public,anon;
revoke all on function public.cbse_course_ids() from public,anon;
revoke all on function public.cbse_courses() from public,anon;
revoke all on function public.cbse_sync_annual_papers(uuid) from public,anon;

grant execute on function public.cbse_configuration() to authenticated;
grant execute on function public.cbse_exam_workspace(uuid) to authenticated;
grant execute on function public.cbse_action(uuid,text,integer,jsonb) to authenticated;
grant execute on function public.cbse_family_reports(uuid) to authenticated;
grant execute on function public.cbse_download_payload(uuid) to authenticated,service_role;

notify pgrst, 'reload schema';

