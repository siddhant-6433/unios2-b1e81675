-- fix bed academic system gn gz annual kt semester
--
-- Navya (WhatsApp/voice AI) reads course_facts.duration to state the academic
-- system. All three B.Ed campuses were seeded "2 Years (4 Semesters)", so Navya
-- wrongly told students Ghaziabad & Greater Noida are semester (they are annual)
-- and gave no clear signal for Kotputli (which is semester). This reconciles
-- both surfaces (course_facts.duration + courses.type) with reality.
-- Idempotent: keyed by course code, safe to re-run.

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
