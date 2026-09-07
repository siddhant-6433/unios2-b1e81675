-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260902151537 name=20260902151514_fix_bed_academic_system_gn_gz_annual_kt_semester applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

update public.course_facts cf
   set duration = '2 Years (Annual System)', updated_at = now()
  from public.courses c
 where c.id = cf.course_id
   and c.code in ('BED-GN', 'BED-GZ');

update public.course_facts cf
   set duration = '2 Years (Semester System - 4 Semesters)', updated_at = now()
  from public.courses c
 where c.id = cf.course_id
   and c.code = 'BED-KT';

update public.courses
   set type = 'semester'
 where code = 'BED-KT';
