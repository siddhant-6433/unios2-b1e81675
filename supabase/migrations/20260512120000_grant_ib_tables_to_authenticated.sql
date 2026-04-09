-- Grant authenticated role access to all IB tables
-- RLS policies handle row-level access control

-- Phase 1: Reference tables
GRANT SELECT ON public.ib_learner_profile_attributes TO authenticated;
GRANT SELECT ON public.ib_atl_categories TO authenticated;
GRANT SELECT ON public.ib_atl_skills TO authenticated;
GRANT SELECT ON public.ib_key_concepts TO authenticated;
GRANT SELECT ON public.ib_td_themes TO authenticated;
GRANT SELECT ON public.ib_global_contexts TO authenticated;
GRANT SELECT ON public.ib_myp_subject_groups TO authenticated;
GRANT SELECT ON public.ib_myp_criteria TO authenticated;
GRANT ALL ON public.ib_teacher_assignments TO authenticated;

-- Phase 2: POI & Units
GRANT ALL ON public.ib_poi TO authenticated;
GRANT ALL ON public.ib_poi_entries TO authenticated;
GRANT ALL ON public.ib_units TO authenticated;
GRANT ALL ON public.ib_unit_collaborators TO authenticated;
GRANT ALL ON public.ib_lessons TO authenticated;

-- Phase 3: Assessment & Gradebook
GRANT ALL ON public.ib_assessments TO authenticated;
GRANT ALL ON public.ib_assessment_results TO authenticated;
GRANT ALL ON public.ib_myp_grade_boundaries TO authenticated;
GRANT ALL ON public.ib_gradebook_snapshots TO authenticated;

-- Phase 4: Portfolios & Action/Service
GRANT ALL ON public.ib_portfolio_entries TO authenticated;
GRANT ALL ON public.ib_action_journal TO authenticated;
GRANT ALL ON public.ib_service_as_action TO authenticated;
GRANT ALL ON public.ib_exhibitions TO authenticated;
GRANT ALL ON public.ib_exhibition_students TO authenticated;

-- Phase 5: Report Cards
GRANT ALL ON public.ib_report_templates TO authenticated;
GRANT ALL ON public.ib_report_cards TO authenticated;

-- Phase 6: MYP Projects & IDU
GRANT ALL ON public.ib_myp_projects TO authenticated;
GRANT ALL ON public.ib_interdisciplinary_units TO authenticated;
GRANT ALL ON public.ib_idu_teachers TO authenticated;
GRANT ALL ON public.ib_idu_results TO authenticated;

-- Grant execute on compute function
GRANT EXECUTE ON FUNCTION public.compute_myp_grade TO authenticated;
