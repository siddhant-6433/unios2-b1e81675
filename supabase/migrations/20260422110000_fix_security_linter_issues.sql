-- ============================================================
-- Fix Supabase security linter issues
-- 1. Replace user_auth_info VIEW with a SECURITY DEFINER RPC (safe)
-- 2. Convert all SECURITY DEFINER views to SECURITY INVOKER
-- ============================================================

-- ── 1. Replace user_auth_info view with RPC function ──
-- The view exposes auth.users to authenticated roles (linter error: auth_users_exposed).
-- An RPC function is the recommended way to access auth schema data.
DROP VIEW IF EXISTS public.user_auth_info;

CREATE OR REPLACE FUNCTION public.get_user_auth_info()
RETURNS TABLE(user_id uuid, last_sign_in_at timestamptz, auth_created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id AS user_id, last_sign_in_at, created_at AS auth_created_at
  FROM auth.users;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_auth_info() TO authenticated;

-- ── 2. Convert SECURITY DEFINER views to SECURITY INVOKER ──
-- These views bypass RLS of the querying user. SECURITY INVOKER (default)
-- makes them respect the caller's permissions instead.
ALTER VIEW public.counsellor_feedback_summary    SET (security_invoker = on);
ALTER VIEW public.sla_warning_leads              SET (security_invoker = on);
ALTER VIEW public.source_funnel                  SET (security_invoker = on);
ALTER VIEW public.visits_needing_confirmation    SET (security_invoker = on);
ALTER VIEW public.course_first_year_fee          SET (security_invoker = on);
ALTER VIEW public.lead_payment_summary           SET (security_invoker = on);
ALTER VIEW public.source_roi_summary             SET (security_invoker = on);
ALTER VIEW public.visits_needing_followup        SET (security_invoker = on);
ALTER VIEW public.alumni_pending_summary         SET (security_invoker = on);
ALTER VIEW public.team_leader_defaults_summary   SET (security_invoker = on);
ALTER VIEW public.pending_approvals              SET (security_invoker = on);
ALTER VIEW public.counsellor_leaderboard         SET (security_invoker = on);
ALTER VIEW public.followup_sla_breached          SET (security_invoker = on);
ALTER VIEW public.hourly_activity_heatmap        SET (security_invoker = on);
ALTER VIEW public.whatsapp_conversations         SET (security_invoker = on);
ALTER VIEW public.stage_aging_summary            SET (security_invoker = on);
ALTER VIEW public.counsellor_tat_defaults        SET (security_invoker = on);
ALTER VIEW public.overdue_followups              SET (security_invoker = on);
ALTER VIEW public.counsellor_performance_stats   SET (security_invoker = on);
ALTER VIEW public.consultant_dashboard           SET (security_invoker = on);
ALTER VIEW public.post_visit_pending_followups   SET (security_invoker = on);
ALTER VIEW public.seat_matrix                    SET (security_invoker = on);
ALTER VIEW public.daily_admission_trend          SET (security_invoker = on);
ALTER VIEW public.consultant_roi_summary         SET (security_invoker = on);
ALTER VIEW public.course_marketing_info          SET (security_invoker = on);
ALTER VIEW public.post_visit_pipeline            SET (security_invoker = on);
ALTER VIEW public.unassigned_leads_bucket        SET (security_invoker = on);
ALTER VIEW public.counsellor_leaderboard         SET (security_invoker = on);
