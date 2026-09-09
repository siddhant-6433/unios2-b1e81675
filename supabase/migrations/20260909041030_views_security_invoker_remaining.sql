-- Switch remaining public views from SECURITY DEFINER to SECURITY INVOKER.
--
-- Postgres runs views as the owner (postgres) unless security_invoker is set,
-- which bypasses the calling user's RLS. Advisor flags that as ERROR.
-- 20260513173419 already flipped five views; CREATE OR REPLACE since then
-- left 23 more on the default. Invoker means results follow the caller's
-- grants and RLS, same as the May change.
--
-- Intentionally left DEFINER: public.course_marketing_info.
-- nimt.ac.in (anon) reads that view as a column-limited projection of
-- course_facts, which stays staff-only. Invoker would return zero rows
-- for the marketing site unless course_facts were opened to anon.

-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.counsellor_performance_stats SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.inactive_leads SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.unapplied_lead_payments SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.academic_partner_dashboard SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.academic_partner_assignment_summary SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.v_unaccounted_ledger_credit SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.v_duplicate_payments SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.pending_approvals SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.v_student_offer_waivers SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.library_branch_student_members SET (security_invoker = true);
ALTER VIEW public.counsellor_funnel_stats SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.counsellor_dialer_usage SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.updeled_deled_leads SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.cahet_bpt_bmrit_leads SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.consultant_payout_sheet SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.consultant_performance SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.admissions_ai_reply_review_queue SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.job_applicants_inbox SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.post_visit_pending_followups SET (security_invoker = true);
-- lint-allow: Advisor security_definer_view; RLS scoping is intentional
ALTER VIEW public.student_fee_reconciliation SET (security_invoker = true);
ALTER VIEW public.v_assignable_counsellors SET (security_invoker = true);
ALTER VIEW public.hiring_venues SET (security_invoker = true);

COMMENT ON VIEW public.course_marketing_info IS
  'Public course information for the marketing website. Curated fields resolve from course_facts, falling back to legacy courses columns. Readable by anon. Kept SECURITY DEFINER on purpose: course_facts stays staff-only, and this view is the column-limited projection anon is allowed to read.';
