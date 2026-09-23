-- HR Performance Management (new pillar).
--
-- Review cycles, per-employee reviews with a reviewer, lightweight goals/OKRs,
-- and 360 feedback. Ratings are stored as numbers plus free text; no attempt is
-- made to encode a specific appraisal scheme, so HR can run whatever template
-- they use.

CREATE TABLE IF NOT EXISTS public.performance_cycles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'closed')),
  description   text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS performance_cycles_status_idx
  ON public.performance_cycles (status, period_end DESC);

CREATE TABLE IF NOT EXISTS public.performance_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            uuid NOT NULL REFERENCES public.performance_cycles(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  reviewer_user_id    uuid REFERENCES auth.users(id),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'submitted', 'acknowledged')),
  overall_rating      numeric(3,1) CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  strengths           text,
  improvements        text,
  comments            text,
  submitted_at        timestamptz,
  acknowledged_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_profile_id, reviewer_user_id)
);
CREATE INDEX IF NOT EXISTS performance_reviews_employee_idx
  ON public.performance_reviews (employee_profile_id, cycle_id);
CREATE INDEX IF NOT EXISTS performance_reviews_reviewer_idx
  ON public.performance_reviews (reviewer_user_id, status);
CREATE INDEX IF NOT EXISTS performance_reviews_cycle_idx
  ON public.performance_reviews (cycle_id, status);

CREATE TABLE IF NOT EXISTS public.performance_goals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  cycle_id            uuid REFERENCES public.performance_cycles(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  weight              numeric(5,2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
  target              text,
  progress            numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'achieved', 'missed', 'cancelled')),
  due_date            date,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performance_goals_employee_idx
  ON public.performance_goals (employee_profile_id, status);

CREATE TABLE IF NOT EXISTS public.performance_feedback (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            uuid REFERENCES public.performance_cycles(id) ON DELETE SET NULL,
  employee_profile_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  reviewer_user_id    uuid REFERENCES auth.users(id),
  relationship        text NOT NULL DEFAULT 'peer'
                        CHECK (relationship IN ('manager', 'peer', 'report', 'self', 'external')),
  rating              numeric(3,1) CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  comments            text,
  is_anonymous        boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS performance_feedback_employee_idx
  ON public.performance_feedback (employee_profile_id, cycle_id);

-- ── Permissions ─────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, action, description) VALUES
  ('hr', 'performance_manage', 'Create review cycles, reviews and goals')
ON CONFLICT (module, action) DO NOTHING;

DO $$
DECLARE
  v_perm uuid;
  r app_role;
BEGIN
  SELECT id INTO v_perm FROM public.permissions WHERE module = 'hr' AND action = 'performance_manage';
  FOREACH r IN ARRAY ARRAY['super_admin','campus_admin','principal','hr_executive']::app_role[] LOOP
    INSERT INTO public.role_permissions (role, permission_id) VALUES (r, v_perm) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.performance_cycles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_goals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read performance cycles" ON public.performance_cycles;
CREATE POLICY "Staff read performance cycles"
  ON public.performance_cycles FOR SELECT TO authenticated
  USING (status <> 'draft' OR (SELECT public.has_permission(auth.uid(), 'hr:performance_manage')));

DROP POLICY IF EXISTS "HR manages performance cycles" ON public.performance_cycles;
CREATE POLICY "HR manages performance cycles"
  ON public.performance_cycles FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:performance_manage')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:performance_manage')));

-- An employee sees their own review and any review they are the reviewer on; HR
-- sees all.
DROP POLICY IF EXISTS "People read relevant reviews" ON public.performance_reviews;
CREATE POLICY "People read relevant reviews"
  ON public.performance_reviews FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR reviewer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_reviews.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Reviewers write reviews" ON public.performance_reviews;
CREATE POLICY "Reviewers write reviews"
  ON public.performance_reviews FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR reviewer_user_id = auth.uid()
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR reviewer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_reviews.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR creates reviews" ON public.performance_reviews;
CREATE POLICY "HR creates reviews"
  ON public.performance_reviews FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:performance_manage')));

DROP POLICY IF EXISTS "People read own goals" ON public.performance_goals;
CREATE POLICY "People read own goals"
  ON public.performance_goals FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_goals.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "People write own goals" ON public.performance_goals;
CREATE POLICY "People write own goals"
  ON public.performance_goals FOR ALL TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_goals.employee_profile_id AND e.user_id = auth.uid())
  )
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_goals.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "People read feedback about them" ON public.performance_feedback;
CREATE POLICY "People read feedback about them"
  ON public.performance_feedback FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:performance_manage'))
    OR (NOT is_anonymous AND reviewer_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = performance_feedback.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff give feedback" ON public.performance_feedback;
CREATE POLICY "Staff give feedback"
  ON public.performance_feedback FOR INSERT TO authenticated
  WITH CHECK (reviewer_user_id = auth.uid() OR (SELECT public.has_permission(auth.uid(), 'hr:performance_manage')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_cycles, public.performance_reviews,
  public.performance_goals, public.performance_feedback TO authenticated;
GRANT ALL ON public.performance_cycles, public.performance_reviews,
  public.performance_goals, public.performance_feedback TO service_role;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_performance_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_performance_cycles_touch ON public.performance_cycles;
CREATE TRIGGER trg_performance_cycles_touch
  BEFORE UPDATE ON public.performance_cycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_performance_touch();

DROP TRIGGER IF EXISTS trg_performance_reviews_touch ON public.performance_reviews;
CREATE TRIGGER trg_performance_reviews_touch
  BEFORE UPDATE ON public.performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_performance_touch();

DROP TRIGGER IF EXISTS trg_performance_goals_touch ON public.performance_goals;
CREATE TRIGGER trg_performance_goals_touch
  BEFORE UPDATE ON public.performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.tg_performance_touch();

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Employee acknowledges a submitted review.
CREATE OR REPLACE FUNCTION public.acknowledge_performance_review(_review_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.performance_reviews;
BEGIN
  SELECT * INTO r FROM public.performance_reviews WHERE id = _review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted review can be acknowledged'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee_profiles e
                  WHERE e.id = r.employee_profile_id AND e.user_id = auth.uid())
     AND NOT public.has_permission(auth.uid(), 'hr:performance_manage') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.performance_reviews
     SET status = 'acknowledged', acknowledged_at = now()
   WHERE id = _review_id;
  RETURN 'acknowledged';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acknowledge_performance_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_performance_review(uuid) TO authenticated, service_role;

-- Submit a review and mark a cycle active in one call.
CREATE OR REPLACE FUNCTION public.submit_performance_review(
  _review_id uuid, _rating numeric DEFAULT NULL, _strengths text DEFAULT NULL,
  _improvements text DEFAULT NULL, _comments text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.performance_reviews;
BEGIN
  SELECT * INTO r FROM public.performance_reviews WHERE id = _review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF NOT (public.has_permission(auth.uid(), 'hr:performance_manage') OR r.reviewer_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.performance_reviews
     SET overall_rating = _rating, strengths = _strengths, improvements = _improvements,
         comments = _comments, status = 'submitted', submitted_at = now()
   WHERE id = _review_id;
  RETURN 'submitted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_performance_review(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_performance_review(uuid, numeric, text, text, text) TO authenticated, service_role;
