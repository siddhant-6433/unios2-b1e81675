-- keep-migration-version: restored production migration 20261014131930; preserve its applied version.
-- backfill bsav ut half yearly components

begin;

create temporary table _bsav_assessment_component_backfill on commit drop as
select p.id as paper_id,
       e.id as exam_id,
       public.cbse_assessment_components(e.category, subject_rule.value->'components') as components
from public.cbse_papers p
join public.cbse_exams e on e.id = p.exam_id
join public.courses c on c.id = e.course_id
join public.cbse_policies policy on policy.id = e.policy_id
cross join lateral jsonb_array_elements(policy.rules->'subjects') as subject_rule(value)
where c.code like 'BSAV-%'
  and e.academic_year = '2026-27'
  and e.status in ('draft', 'open')
  and ((e.category = 'unit_test' and e.sequence in (1, 2))
    or (e.category = 'half_yearly' and e.sequence = 1))
  and subject_rule.value->>'subject_id' = p.subject_id::text;

do $$
begin
  if exists (
    select 1
    from public.cbse_papers p
    join public.cbse_exams e on e.id = p.exam_id
    join public.courses c on c.id = e.course_id
    where c.code like 'BSAV-%'
      and e.academic_year = '2026-27'
      and e.status in ('draft', 'open')
      and ((e.category = 'unit_test' and e.sequence in (1, 2))
        or (e.category = 'half_yearly' and e.sequence = 1))
      and not exists (
        select 1 from _bsav_assessment_component_backfill target
        where target.paper_id = p.id
      )
  ) then
    raise exception 'A BSAV UT or Half Yearly paper has no matching subject policy component';
  end if;
end;
$$;

create temporary table _bsav_assessment_changed_exams on commit drop as
select distinct target.exam_id
from _bsav_assessment_component_backfill target
join public.cbse_papers paper on paper.id = target.paper_id
where paper.components is distinct from target.components;

-- These open/draft assessments still had the old components. Their marks were
-- entered against those old maxima, so clear those scores before exposing the
-- corrected entry fields. Test assessments UT-90 and UT-98 are intentionally
-- outside this backfill.
delete from public.cbse_marks marks
using public.cbse_papers paper,
      _bsav_assessment_component_backfill target
where marks.paper_id = paper.id
  and paper.id = target.paper_id
  and paper.components is distinct from target.components;

update public.cbse_papers paper
set components = target.components,
    locked_at = null
from _bsav_assessment_component_backfill target
where paper.id = target.paper_id
  and paper.components is distinct from target.components;

update public.cbse_exams exam
set version = version + 1
where exam.id in (select changed.exam_id from _bsav_assessment_changed_exams changed);

commit;
