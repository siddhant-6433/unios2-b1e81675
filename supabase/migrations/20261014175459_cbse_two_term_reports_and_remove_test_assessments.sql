-- cbse two term reports and remove test assessments
-- keep-migration-version: restored production migration 20261014175459; preserve its applied version.

-- Two term assessment scheme: Term 1 and Term 2 each contribute 50% to the
-- Final Report. Each term report remains a 100 mark total.

create or replace function public.cbse_assessment_components(_category text, _source jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select case _category
   when 'unit_test' then jsonb_build_array(jsonb_build_object('key','marks','label','Unit Test','max',20,'pass_percent',null))
   when 'half_yearly' then jsonb_build_array(
     jsonb_build_object('key','half_yearly','label','Half Yearly Examination','max',80,'pass_percent',33),
     jsonb_build_object('key','notebook','label','Notebook','max',5,'pass_percent',null),
     jsonb_build_object('key','sea','label','Subject Enrichment Activity (SEA)','max',5,'pass_percent',null))
   when 'final' then jsonb_build_array(
     jsonb_build_object('key','annual_exam','label','Annual Examination','max',80,'pass_percent',33),
     jsonb_build_object('key','notebook','label','Notebook','max',5,'pass_percent',null),
     jsonb_build_object('key','sea','label','Subject Enrichment Activity (SEA)','max',5,'pass_percent',null))
   else _source end
$$;

-- Keep the configured assessment sets aligned with the confirmed term model.
update public.cbse_policies p
set rules=jsonb_set(p.rules,'{annual_weights}',
  '[{"category":"half_yearly","sequence":1,"weight":50},{"category":"final","sequence":1,"weight":50}]'::jsonb)
where p.status='approved'
  and p.course_id in(select c.id from public.courses c where c.code ~ '^(BSA|BSAV)-')
  and exists(select 1 from public.admission_sessions s where s.id=p.session_id and s.name='2026-27');

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
   if sr is null or not cbse_teacher(e.id,(x->>'subject_id')::uuid,(x->>'teacher_user_id')::uuid) then raise exception 'Teacher must be assigned to this subject, class, section and session'; end if;
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
    insert into cbse_sources(exam_id,source_exam_id,weight)
    select e.id,src.id,(a->>'weight')::numeric from jsonb_array_elements(pol.rules->'annual_weights') a where a->>'category'=src.category and (a->>'sequence')::integer=src.sequence;
   end loop;
   if (select count(*) from cbse_sources where exam_id=e.id)<>2 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.category='half_yearly')<>1 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.category='final')<>1 then raise exception 'Select exactly one Term 1 and one Term 2 report'; end if;
  elsif e.category in ('half_yearly','final') then
   required_sequence:=case when e.category='half_yearly' then 1 else 3 end;
   if jsonb_array_length(_payload->'source_exam_ids')<>2 then raise exception 'Select both required Unit Test reports'; end if;
   for x in select value from jsonb_array_elements(_payload->'source_exam_ids') loop
    select * into strict src from cbse_exams where id=(x#>>'{}')::uuid;
    if src.category<>'unit_test' or src.sequence not in (required_sequence,required_sequence+1) or src.course_id<>e.course_id or src.session_id<>e.session_id or src.section is distinct from e.section then raise exception 'Source tests must match the required term, class, section and session'; end if;
    if src.status not in ('approved','released') then raise exception 'Both source Unit Tests must be approved before configuring the term report'; end if;
    insert into cbse_sources(exam_id,source_exam_id,weight) values(e.id,src.id,1);
   end loop;
   if (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=required_sequence)<>1 or (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=e.id and se.sequence=required_sequence+1)<>1 then raise exception 'Select exactly the required pair of Unit Tests'; end if;
  else raise exception 'This assessment type cannot use source assessments'; end if;
 elsif e.category in ('half_yearly','final','annual') and _payload ? 'source_exam_ids' then
  raise exception 'Select all required source assessments';
 end if;
 perform cbse_refresh_roster(e.id);
end $$;

create or replace function public.cbse_best_unit_test_score(_exam uuid,_student uuid,_subject uuid)
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e cbse_exams; src record; subj jsonb; best numeric; current_score numeric; current_max numeric; expected_first integer;
begin
 select * into strict e from cbse_exams where id=_exam;
 if e.category not in ('half_yearly','final') then return null; end if;
 expected_first:=case when e.category='half_yearly' then 1 else 3 end;
 if (select count(*) from cbse_sources where exam_id=e.id)<>2 then raise exception 'Both Unit Test sources are required before opening the term report'; end if;
 for src in select se.id,se.sequence,se.status,se.revision,rp.snapshot,rp.id report_id
  from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
  left join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released')
  where cs.exam_id=e.id order by se.sequence loop
  if src.sequence not in (expected_first,expected_first+1) or src.status not in ('approved','released') or src.report_id is null then raise exception 'Current approved Unit Test reports are required for every student'; end if;
  select s into subj from jsonb_array_elements(src.snapshot->'subjects') s where s->>'subject_id'=_subject::text;
  if subj is null then raise exception 'A Unit Test report is missing a required subject'; end if;
  current_score:=nullif(subj->>'obtained','')::numeric; current_max:=nullif(subj->>'max','')::numeric;
  if current_score is not null and current_max>0 then current_score:=round(current_score/current_max*10,(select (rules->>'rounding')::integer from cbse_policies where id=e.policy_id)); best:=greatest(coalesce(best,-1),current_score); end if;
 end loop;
 return case when best is null or best<0 then null else best end;
end $$;

create or replace function public.cbse_guard_half_yearly_open()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare expected_first integer;
begin
 if new.category in ('half_yearly','final') and new.status='open' and old.status is distinct from new.status then
  expected_first:=case when new.category='half_yearly' then 1 else 3 end;
  if (select count(*) from cbse_sources where exam_id=new.id)<>2 or exists(
   select seq from (values(expected_first),(expected_first+1)) required(seq)
   where (select count(*) from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id where cs.exam_id=new.id and se.category='unit_test' and se.sequence=required.seq and se.status in ('approved','released'))<>1
  ) then raise exception 'Both current approved Unit Test reports are required before opening this term report'; end if;
 end if;
 return new;
end $$;

create or replace function public.cbse_link_report_sources()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in ('approved','released') and exists(select 1 from cbse_exams e where e.id=new.exam_id and e.category in ('annual','half_yearly','final')) then
  insert into cbse_report_sources(report_id,source_report_id)
  select new.id,srp.id from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id
   join cbse_reports srp on srp.exam_id=se.id and srp.revision=se.revision and srp.student_id=new.student_id and srp.status in ('approved','released')
   where cs.exam_id=new.exam_id on conflict do nothing;
 end if;
 return new;
end $$;

-- Extend the existing Half Yearly snapshot with Term 2's calculated best UT
-- and attach the term-by-term values to Final Report subject rows.
alter function public.cbse_snapshot(uuid,uuid,uuid,text) rename to cbse_snapshot_before_two_terms;
create function public.cbse_snapshot(_exam uuid,_student uuid,_report uuid,_remarks text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e cbse_exams; pol cbse_policies; base jsonb; row jsonb; rows jsonb:='[]'; sub jsonb; subj_id text;
 p cbse_papers; m cbse_marks; best numeric; total numeric; maximum numeric; score numeric; pct numeric; component jsonb; subject_pass boolean;
 term1_exam uuid; term2_exam uuid; term1_snap jsonb; term2_snap jsonb; ut_snap jsonb; term1_ut1 jsonb; term1_ut2 jsonb; term2_ut3 jsonb; term2_ut4 jsonb;
 a jsonb; b jsonb; c jsonb; d jsonb; h jsonb; f jsonb; term1_exam_component jsonb; term2_exam_component jsonb; final_sum numeric:=0; final_max numeric:=0; all_pass boolean:=true; has_present boolean:=false;
begin
 select * into strict e from cbse_exams where id=_exam;
 base:=cbse_snapshot_before_two_terms(_exam,_student,_report,_remarks);
 if e.category='final' then
  select * into strict pol from cbse_policies where id=e.policy_id;
  rows:='[]'; total:=0; maximum:=0;
  for row in select value from jsonb_array_elements(base->'subjects') loop
   subj_id:=row->>'subject_id'; select * into strict p from cbse_papers where exam_id=e.id and subject_id=subj_id::uuid;
   select * into strict m from cbse_marks where paper_id=p.id and student_id=_student;
   best:=cbse_best_unit_test_score(e.id,_student,p.subject_id);
   total:=coalesce((row->>'obtained')::numeric,0)+coalesce(best,0); maximum:=(row->>'max')::numeric+10;
   if row->>'status'='absent' and pol.rules->>'absent_treatment'='exclude' or row->>'status'='exempt' then total:=null; maximum:=0; pct:=null;
   else pct:=round(total*100/maximum,(pol.rules->>'rounding')::integer); end if;
   subject_pass:=true;
   for component in select value from jsonb_array_elements(p.components) loop
    score:=case when m.status='present' then nullif(m.scores->>(component->>'key'),'')::numeric when m.status='absent' and pol.rules->>'absent_treatment'='zero' then 0 else null end;
    if component->>'pass_percent' is not null and score is not null and score*100<(component->>'max')::numeric*(component->>'pass_percent')::numeric then subject_pass:=false; end if;
   end loop;
   select s into strict sub from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=p.subject_id::text;
   if sub->>'pass_percent' is not null and total is not null and total*100<maximum*(sub->>'pass_percent')::numeric then subject_pass:=false; end if;
   if m.status='absent' then subject_pass:=false; end if;
   if maximum=0 then subject_pass:=null; end if;
   row:=jsonb_set(row,'{components}',(row->'components')||jsonb_build_array(jsonb_build_object('key','best_unit_test','label','Best of UT-3 and UT-4','max',10,'score',best)));
   row:=jsonb_set(row,'{obtained}',coalesce(to_jsonb(total),'null'::jsonb)); row:=jsonb_set(row,'{max}',to_jsonb(maximum)); row:=jsonb_set(row,'{percentage}',coalesce(to_jsonb(pct),'null'::jsonb)); row:=jsonb_set(row,'{grade}',coalesce(to_jsonb(cbse_grade(pct,pol.rules)),'null'::jsonb)); row:=jsonb_set(row,'{passed}',coalesce(to_jsonb(subject_pass),'null'::jsonb));
   select s into strict sub from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=subj_id;
   for a in select value from jsonb_array_elements(sub->'components') loop
    row:=jsonb_set(row,'{components}',(row->'components')||jsonb_build_array(jsonb_build_object('key',a->>'key','label',a->>'label','max',(a->>'max')::numeric,'score',case when total is null then null else round(total/maximum*(a->>'max')::numeric,(pol.rules->>'rounding')::integer) end,'source_only',true)));
   end loop;
   if row->>'status'='present' then has_present:=true; end if;
   if subject_pass=false then all_pass:=false; end if;
   if coalesce((row->>'contributes_to_total')::boolean,true) and total is not null then final_sum:=final_sum+total; final_max:=final_max+maximum; end if;
   rows:=rows||jsonb_build_array(row);
  end loop;
  pct:=case when final_max>0 then round(final_sum*100/final_max,(pol.rules->>'rounding')::integer) end;
  base:=jsonb_set(base,'{subjects}',rows);
  base:=jsonb_set(base,'{summary}',jsonb_build_object('obtained',final_sum,'max',final_max,'percentage',pct,'grade',cbse_grade(pct,pol.rules),'result',case when not has_present then 'absent' when not all_pass then 'fail' when final_max=0 then 'incomplete' else 'pass' end));
  return base;
 end if;
 if e.category<>'annual' then return base; end if;
 select se.id,rp.snapshot into strict term1_exam,term1_snap from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=e.id and se.category='half_yearly';
 select se.id,rp.snapshot into strict term2_exam,term2_snap from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=e.id and se.category='final';
 select rp.snapshot into strict term1_ut1 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=term1_exam and se.sequence=1;
 select rp.snapshot into strict term1_ut2 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=term1_exam and se.sequence=2;
 select rp.snapshot into strict term2_ut3 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=term2_exam and se.sequence=3;
 select rp.snapshot into strict term2_ut4 from cbse_sources cs join cbse_exams se on se.id=cs.source_exam_id join cbse_reports rp on rp.exam_id=se.id and rp.student_id=_student and rp.revision=se.revision and rp.status in ('approved','released') where cs.exam_id=term2_exam and se.sequence=4;
 select * into strict pol from cbse_policies where id=e.policy_id;
 rows:='[]'; final_sum:=0; final_max:=0;
 for row in select value from jsonb_array_elements(base->'subjects') loop
  subj_id:=row->>'subject_id';
  select s into strict a from jsonb_array_elements(term1_ut1->'subjects') s where s->>'subject_id'=subj_id;
  select s into strict b from jsonb_array_elements(term1_ut2->'subjects') s where s->>'subject_id'=subj_id;
  select s into strict c from jsonb_array_elements(term2_ut3->'subjects') s where s->>'subject_id'=subj_id;
  select s into strict d from jsonb_array_elements(term2_ut4->'subjects') s where s->>'subject_id'=subj_id;
  select s into strict h from jsonb_array_elements(term1_snap->'subjects') s where s->>'subject_id'=subj_id;
  select s into strict f from jsonb_array_elements(term2_snap->'subjects') s where s->>'subject_id'=subj_id;
  select value into strict term1_exam_component from jsonb_array_elements(h->'components') where value->>'key'='half_yearly';
  select value into strict term2_exam_component from jsonb_array_elements(f->'components') where value->>'key'='annual_exam';
  score:=case when (a->>'max')::numeric>0 and (a->>'obtained') is not null then (a->>'obtained')::numeric/(a->>'max')::numeric*20 end;
  row:=jsonb_set(row,'{term_breakdown}',jsonb_build_object(
   'term1',jsonb_build_object('ut1',jsonb_build_object('score',a->'obtained','max',a->'max'),'ut2',jsonb_build_object('score',b->'obtained','max',b->'max'),'report',jsonb_build_object('score',term1_exam_component->'score','max',term1_exam_component->'max'),'total',jsonb_build_object('score',case when (h->>'max')::numeric>0 then round((h->>'obtained')::numeric/(h->>'max')::numeric*100,2) end,'max',100)),
   'term2',jsonb_build_object('ut3',jsonb_build_object('score',c->'obtained','max',c->'max'),'ut4',jsonb_build_object('score',d->'obtained','max',d->'max'),'report',jsonb_build_object('score',term2_exam_component->'score','max',term2_exam_component->'max'),'total',jsonb_build_object('score',case when (f->>'max')::numeric>0 then round((f->>'obtained')::numeric/(f->>'max')::numeric*100,2) end,'max',100)),
   'final_score',jsonb_build_object('score',case when (h->>'max')::numeric>0 and (f->>'max')::numeric>0 then round((((h->>'obtained')::numeric/(h->>'max')::numeric*100)+((f->>'obtained')::numeric/(f->>'max')::numeric*100))/2,2) end,'max',100)));
  pct:=case when (h->>'max')::numeric>0 and (f->>'max')::numeric>0 then round((((h->>'obtained')::numeric/(h->>'max')::numeric*100)+((f->>'obtained')::numeric/(f->>'max')::numeric*100))/2,2) end;
  row:=jsonb_set(row,'{obtained}',coalesce(to_jsonb(pct),'null'::jsonb)); row:=jsonb_set(row,'{max}',to_jsonb(100)); row:=jsonb_set(row,'{percentage}',coalesce(to_jsonb(pct),'null'::jsonb)); row:=jsonb_set(row,'{grade}',coalesce(to_jsonb(cbse_grade(pct,pol.rules)),'null'::jsonb));
  select s into strict sub from jsonb_array_elements(pol.rules->'subjects') s where s->>'subject_id'=subj_id;
  subject_pass:=true;
  if sub->>'pass_percent' is not null and pct is not null and pct<(sub->>'pass_percent')::numeric then subject_pass:=false; end if;
  if row->>'status'='absent' then subject_pass:=false; end if;
  if pct is null then subject_pass:=null; end if;
  row:=jsonb_set(row,'{passed}',coalesce(to_jsonb(subject_pass),'null'::jsonb));
  if row->>'status'='present' then has_present:=true; end if;
  if subject_pass=false then all_pass:=false; end if;
  if coalesce((row->>'contributes_to_total')::boolean,true) and pct is not null then final_sum:=final_sum+pct; final_max:=final_max+100; end if;
  rows:=rows||jsonb_build_array(row);
 end loop;
 pct:=case when final_max>0 then round(final_sum*100/final_max,(pol.rules->>'rounding')::integer) end;
 base:=jsonb_set(base,'{subjects}',rows); base:=jsonb_set(base,'{summary}',jsonb_build_object('obtained',final_sum,'max',final_max,'percentage',pct,'grade',cbse_grade(pct,pol.rules),'result',case when not has_present then 'absent' when not all_pass then 'fail' when final_max=0 then 'incomplete' else 'pass' end));
 return base;
end $$;

revoke all on function public.cbse_best_unit_test_score(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.cbse_snapshot(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.cbse_snapshot_before_two_terms(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Remove only the two explicitly identified test UT assessments and all their
-- test records. No production assessment is matched by these names/sequences.
do $$
declare test_ids uuid[];
begin
 select array_agg(id) into test_ids from public.cbse_exams
 where category='unit_test' and sequence in (90,98)
   and name ilike '%test%' and course_id in(select id from public.courses where code like 'BSAV-%');
 if coalesce(cardinality(test_ids),0)=0 then return; end if;
 delete from public.cbse_report_sources where report_id in(select id from public.cbse_reports where exam_id=any(test_ids)) or source_report_id in(select id from public.cbse_reports where exam_id=any(test_ids));
 delete from public.cbse_reports where exam_id=any(test_ids);
 delete from public.cbse_sources where exam_id=any(test_ids) or source_exam_id=any(test_ids);
 delete from public.cbse_exceptions where exam_id=any(test_ids);
 delete from public.cbse_marks where paper_id in(select id from public.cbse_papers where exam_id=any(test_ids));
 delete from public.cbse_papers where exam_id=any(test_ids);
 delete from public.cbse_roster where exam_id=any(test_ids);
 delete from public.cbse_audit where exam_id=any(test_ids);
 delete from public.cbse_exams where id=any(test_ids);
end $$;
