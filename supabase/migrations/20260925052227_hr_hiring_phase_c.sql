-- Hiring Phase C — recruitment analytics.
--
-- Headline TA metrics computable from the current data (no vendor dependency):
-- pipeline counts, offer outcomes and acceptance rate, interview activity, and
-- indicative average days-to-offer / days-to-hire. Sources come from the
-- existing hr_recruitment_funnel() RPC.

CREATE OR REPLACE FUNCTION public.hr_recruitment_metrics(_from date, _to date)
RETURNS TABLE (metric text, value numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_from date := COALESCE(_from, (CURRENT_DATE - 90));
DECLARE v_to date := COALESCE(_to, CURRENT_DATE);
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH ja AS (
    SELECT * FROM public.job_applicants WHERE created_at::date BETWEEN v_from AND v_to
  ),
  offers AS (
    SELECT l.*, a.created_at AS applicant_created
      FROM public.hr_letters l
      JOIN public.job_applicants a ON a.id = l.job_applicant_id
     WHERE l.letter_code = 'offer'
       AND l.created_at::date BETWEEN v_from AND v_to
  ),
  iv AS (
    SELECT * FROM public.interviews WHERE scheduled_at::date BETWEEN v_from AND v_to
  ),
  parts AS (
    SELECT 'applicants'::text AS metric, count(*)::numeric AS value FROM ja
    UNION ALL SELECT 'new', count(*)::numeric FROM ja WHERE status = 'new'
    UNION ALL SELECT 'in_pipeline', count(*)::numeric FROM ja WHERE status IN ('reviewing','shortlisted','interview','offered')
    UNION ALL SELECT 'hired', count(*)::numeric FROM ja WHERE status = 'hired'
    UNION ALL SELECT 'rejected', count(*)::numeric FROM ja WHERE status = 'rejected'
    UNION ALL SELECT 'withdrawn', count(*)::numeric FROM ja WHERE status = 'withdrawn'
    UNION ALL SELECT 'offers_generated', count(*)::numeric FROM offers
    UNION ALL SELECT 'offers_accepted', count(*)::numeric FROM offers WHERE acceptance_status = 'accepted'
    UNION ALL SELECT 'offers_declined', count(*)::numeric FROM offers WHERE acceptance_status = 'declined'
    UNION ALL SELECT 'offers_pending', count(*)::numeric FROM offers WHERE acceptance_status = 'pending'
    UNION ALL SELECT 'interviews_scheduled', count(*)::numeric FROM iv
    UNION ALL SELECT 'interviews_completed', count(*)::numeric FROM iv WHERE status = 'completed'
    UNION ALL SELECT 'interviews_no_show', count(*)::numeric FROM iv WHERE status = 'no_show'
    UNION ALL
      SELECT 'avg_days_to_offer',
             COALESCE(round(avg(EXTRACT(EPOCH FROM (o.created_at - o.applicant_created)) / 86400)::numeric, 1), 0)
        FROM offers o
    UNION ALL
      SELECT 'avg_days_to_hire',
             COALESCE(round(avg(EXTRACT(EPOCH FROM (a.stage_changed_at - a.created_at)) / 86400)::numeric, 1), 0)
        FROM public.job_applicants a
       WHERE a.status = 'hired' AND a.stage_changed_at IS NOT NULL
         AND a.stage_changed_at::date BETWEEN v_from AND v_to
    UNION ALL
      SELECT 'offer_acceptance_pct',
             CASE WHEN count(*) FILTER (WHERE acceptance_status IN ('accepted','declined')) = 0 THEN 0
                  ELSE round(100.0 * count(*) FILTER (WHERE acceptance_status = 'accepted')
                       / count(*) FILTER (WHERE acceptance_status IN ('accepted','declined')), 1) END
        FROM offers
  )
  SELECT p.metric, p.value FROM parts p;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_recruitment_metrics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_recruitment_metrics(date, date) TO authenticated, service_role;

-- Timeline of one applicant (activity feed) for the detail drawer.
CREATE OR REPLACE FUNCTION public.job_applicant_timeline(_applicant_id uuid)
RETURNS TABLE (id uuid, type text, description text, actor text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT act.id, act.type, act.description,
         COALESCE(prof.display_name, 'System'),
         act.created_at
    FROM public.job_applicant_activities act
    LEFT JOIN public.profiles prof ON prof.user_id = act.user_id
   WHERE act.applicant_id = _applicant_id
     AND (
       (SELECT public.has_permission(auth.uid(), 'hr:view'))
       OR (SELECT public.has_permission(auth.uid(), 'hr:recruitment_edit'))
       OR (SELECT public.has_permission(auth.uid(), 'hr:interviews_edit'))
     )
   ORDER BY act.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.job_applicant_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_applicant_timeline(uuid) TO authenticated, service_role;
