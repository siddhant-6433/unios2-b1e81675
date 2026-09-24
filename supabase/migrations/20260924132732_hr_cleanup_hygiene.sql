-- HR cleanup & hygiene — closes the remaining audit items:
--   * drop the redundant unique index on employee_documents
--   * a clean per-day attendance read (multi-punch safe)
--   * make regularisation approval multi-punch correct
--   * asset depreciation (book value)
--   * reconcile the two employee-id concepts (profiles.employee_id ↔ employee_profiles.employee_number)
--   * unify the two interview models onto `interviews`

-- ── 1. Redundant unique index ───────────────────────────────────────────────
-- UNIQUE (employee_id, doc_key) already exists on the table.
DROP INDEX IF EXISTS public.employee_documents_employee_key_idx;

-- ── 2. Per-day attendance view (multi-punch safe) ───────────────────────────

CREATE OR REPLACE VIEW public.employee_attendance_daily AS
SELECT
  a.user_id,
  a.date,
  min(a.punch_in)  AS first_punch_in,
  max(a.punch_out) AS last_punch_out,
  count(*)::int    AS punch_count,
  CASE
    WHEN min(a.punch_in) IS NOT NULL AND max(a.punch_out) IS NOT NULL
    THEN round(EXTRACT(EPOCH FROM (max(a.punch_out) - min(a.punch_in))) / 60)::int
    ELSE NULL
  END AS worked_minutes,
  bool_or(a.punch_out IS NULL AND a.punch_in IS NOT NULL) AS has_open_punch
FROM public.employee_attendance a
GROUP BY a.user_id, a.date;

ALTER VIEW public.employee_attendance_daily SET (security_invoker = true);
GRANT SELECT ON public.employee_attendance_daily TO authenticated, service_role;

COMMENT ON VIEW public.employee_attendance_daily IS
  'One row per employee per day (first in / last out), safe when multiple punches exist.';

-- ── 3. Multi-punch-correct regularisation approval ──────────────────────────

CREATE OR REPLACE FUNCTION public.approve_attendance_regularisation(_ids uuid[], _approve boolean, _note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_count integer := 0; v_hit integer;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:attendance_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR r IN
    SELECT * FROM public.attendance_regularisations
     WHERE id = ANY(_ids) AND status = 'pending'
  LOOP
    IF _approve AND r.user_id IS NOT NULL THEN
      -- Correct the day's FIRST in and LAST out rather than stamping every punch
      -- row with the same time.
      IF r.requested_punch_in IS NOT NULL THEN
        UPDATE public.employee_attendance
           SET punch_in = r.requested_punch_in, notes = 'Regularised: ' || r.reason
         WHERE id = (
           SELECT id FROM public.employee_attendance
            WHERE user_id = r.user_id AND date = r.date
            ORDER BY punch_in NULLS FIRST
            LIMIT 1
         );
      END IF;

      IF r.requested_punch_out IS NOT NULL THEN
        UPDATE public.employee_attendance
           SET punch_out = r.requested_punch_out, notes = 'Regularised: ' || r.reason
         WHERE id = (
           SELECT id FROM public.employee_attendance
            WHERE user_id = r.user_id AND date = r.date
            ORDER BY punch_out NULLS LAST
            LIMIT 1
         );
      END IF;

      SELECT count(*) INTO v_hit FROM public.employee_attendance
       WHERE user_id = r.user_id AND date = r.date;

      IF v_hit = 0 THEN
        INSERT INTO public.employee_attendance (user_id, date, punch_in, punch_out, notes)
        VALUES (r.user_id, r.date, r.requested_punch_in, r.requested_punch_out,
                'Regularised: ' || r.reason);
      END IF;
    END IF;

    UPDATE public.attendance_regularisations
       SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
           reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── 4. Asset depreciation ───────────────────────────────────────────────────

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS depreciation_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salvage_value     numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_method text NOT NULL DEFAULT 'straight_line';

CREATE OR REPLACE FUNCTION public.hr_asset_depreciation()
RETURNS TABLE (
  asset_id uuid, asset_tag text, name text, category text, status text,
  purchase_date date, purchase_cost numeric, salvage_value numeric,
  depreciation_rate numeric, years_elapsed numeric, book_value numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:view')
          OR public.has_permission(auth.uid(), 'hr:assets_manage')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.asset_tag, a.name, COALESCE(c.name, '—'), a.status,
    a.purchase_date, a.purchase_cost, a.salvage_value, a.depreciation_rate,
    COALESCE(round(EXTRACT(EPOCH FROM (now() - a.purchase_date::timestamptz)) / (365.25 * 86400), 2), 0) AS years_elapsed,
    GREATEST(
      a.salvage_value,
      COALESCE(a.purchase_cost, 0)
        - (COALESCE(a.purchase_cost, 0) * COALESCE(a.depreciation_rate, 0) / 100
           * COALESCE(EXTRACT(EPOCH FROM (now() - a.purchase_date::timestamptz)) / (365.25 * 86400), 0))
    )::numeric(14,2) AS book_value
  FROM public.assets a
  LEFT JOIN public.asset_categories c ON c.id = a.category_id
  ORDER BY a.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_asset_depreciation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_asset_depreciation() TO authenticated, service_role;

-- ── 5. Reconcile the two employee-id concepts ───────────────────────────────

UPDATE public.profiles p
   SET employee_id = e.employee_number
  FROM public.employee_profiles e
 WHERE p.user_id = e.user_id
   AND e.employee_number IS NOT NULL
   AND (p.employee_id IS NULL OR p.employee_id <> e.employee_number)
   AND NOT EXISTS (
     SELECT 1 FROM public.profiles p2
      WHERE p2.employee_id = e.employee_number AND p2.user_id <> e.user_id
   );

CREATE OR REPLACE FUNCTION public.tg_sync_profile_employee_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR NEW.employee_number IS DISTINCT FROM OLD.employee_number THEN
    BEGIN
      UPDATE public.profiles
         SET employee_id = NEW.employee_number
       WHERE user_id = NEW.user_id
         AND (employee_id IS NULL OR employee_id <> NEW.employee_number);
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- another profile already claims this employee id; leave it.
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_employee_id ON public.employee_profiles;
CREATE TRIGGER trg_sync_profile_employee_id
  AFTER INSERT OR UPDATE OF employee_number ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_profile_employee_id();

-- ── 6. Unify the interview models ───────────────────────────────────────────
-- `interviews` is the model the UI uses. Backfill any panel rounds + feedback
-- from the unused pair, then drop them so there is one source of truth.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'interview_rounds') THEN
    INSERT INTO public.interviews
      (job_applicant_id, scheduled_at, mode, location, panel, duration_mins, status, notes, created_by, created_at)
    SELECT ir.applicant_id, COALESCE(ir.scheduled_at, ir.created_at), ir.mode, ir.location,
           ir.panel, ir.duration_mins, ir.status, ir.round_name, ir.created_by, ir.created_at
      FROM public.interview_rounds ir
     WHERE NOT EXISTS (
       SELECT 1 FROM public.interviews i
        WHERE i.job_applicant_id = ir.applicant_id
          AND i.scheduled_at = COALESCE(ir.scheduled_at, ir.created_at)
     );

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'interview_feedback') THEN
      UPDATE public.interviews i
         SET rating = f.rating, recommend = f.recommend, feedback_notes = f.notes
        FROM (
          SELECT DISTINCT ON (round_id) round_id, rating, recommend, notes
            FROM public.interview_feedback
           ORDER BY round_id, created_at DESC
        ) f
        JOIN public.interview_rounds ir ON ir.id = f.round_id
       WHERE i.job_applicant_id = ir.applicant_id
         AND i.scheduled_at = COALESCE(ir.scheduled_at, ir.created_at);
    END IF;

    DROP TABLE IF EXISTS public.interview_feedback;
    DROP TABLE IF EXISTS public.interview_rounds;
  END IF;
END $$;
