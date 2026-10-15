-- Shared schedules may contain multiple grades; families only see their child's class.
-- keep-migration-version: restored production migration 20261015044448; preserve its applied version.
create or replace function public.cbse_datesheet_get(_datesheet_id uuid,_student_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare d cbse_datesheets;
begin
 perform cbse_enabled(); perform cbse_actor();
 select * into d from cbse_datesheets where id=_datesheet_id;
 if not found then raise exception 'Date sheet not found'; end if;
 if not cbse_manager(d.institution_id,false) then
  if _student_id is null or d.status<>'released' or not cbse_family(_student_id) or not exists(select 1 from students s join cbse_datesheet_classes dc on dc.course_id=s.course_id where s.id=_student_id and dc.datesheet_id=d.id and s.session_id=d.session_id) then raise exception 'Date sheet is not available'; end if;
 end if;
 return jsonb_build_object('id',d.id,'institution_id',d.institution_id,'session_id',d.session_id,'title',d.title,'category',d.category,'sequence',d.sequence,'reporting_ends_on',d.reporting_ends_on,'status',d.status,'created_at',d.created_at,'released_at',d.released_at,
 'classes',(select coalesce(jsonb_agg(jsonb_build_object('course_id',dc.course_id,'course_name',c.name,'course_code',c.code,'section',dc.section,'exam_id',dc.exam_id,'papers',(select coalesce(jsonb_agg(jsonb_build_object('subject_id',dp.subject_id,'subject_name',s.name,'exam_on',dp.exam_on,'starts_at',dp.starts_at,'ends_at',dp.ends_at,'venue',dp.venue) order by dp.exam_on,dp.starts_at,s.display_order),'[]'::jsonb) from cbse_datesheet_papers dp join subjects s on s.id=dp.subject_id where dp.datesheet_class_id=dc.id)) order by cbse_grade_from_code(c.code),c.name),'[]'::jsonb) from cbse_datesheet_classes dc join courses c on c.id=dc.course_id where dc.datesheet_id=d.id and (_student_id is null or exists(select 1 from students child where child.id=_student_id and child.course_id=dc.course_id and child.session_id=d.session_id))));
end $$;
