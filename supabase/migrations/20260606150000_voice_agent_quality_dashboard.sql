-- Phase 2 of voice-agent quality work: quantify call quality.
--
-- Why: every config change so far has been a vibe check ("sounds slow",
-- "fumbled"). Without numbers we cannot tell if a prompt rewrite or
-- model swap is actually better than the previous one. This migration
-- adds:
--   1. quality_metrics JSONB on ai_call_records — auto-computed by the
--      voice-agent at hangup (turn count, time-to-first-audio,
--      mean-turn-latency, repetition_count, voice_switch_count,
--      disposition_set, fallback_path).
--   2. quality_score (1-5) + score_by + score_at + score_notes — manual
--      rating filled by counsellor/admin from the call detail view.
--   3. voice_agent_settings_history — audit log of every change to
--      _app_config.voice_agent_settings, populated by trigger. So when
--      quality drops we can correlate against settings changes instead
--      of reasoning from memory.

-- ============================================================
-- 1. ai_call_records — quality columns
-- ============================================================
ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS quality_metrics jsonb,
  ADD COLUMN IF NOT EXISTS quality_score smallint
    CHECK (quality_score IS NULL OR quality_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS quality_score_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS quality_score_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_notes text;

-- Index for the dashboard query (filter by date + score not null).
CREATE INDEX IF NOT EXISTS idx_ai_call_records_quality_score
  ON public.ai_call_records (created_at DESC)
  WHERE quality_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_call_type_created
  ON public.ai_call_records (call_type, created_at DESC);

-- ============================================================
-- 2. RPC for setting quality_score (so the UI doesn't need direct
--    UPDATE permission and we capture the rater + timestamp atomically).
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_call_quality_score(
  _call_log_id uuid,
  _score smallint,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _score IS NOT NULL AND (_score < 1 OR _score > 5) THEN
    RAISE EXCEPTION 'quality_score must be 1-5 (got %)', _score;
  END IF;
  -- Anyone with admin/counsellor role can rate; the dashboard restricts
  -- the UI but the RPC checks at the data layer too.
  IF NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  ) THEN
    RAISE EXCEPTION 'Only super_admin, admission_head, or counsellor can rate calls';
  END IF;

  UPDATE public.ai_call_records
  SET quality_score = _score,
      quality_score_by = auth.uid(),
      quality_score_at = now(),
      quality_notes = _notes
  WHERE id = _call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_call_quality_score(uuid, smallint, text) TO authenticated;

-- ============================================================
-- 3. Settings change audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.voice_agent_settings_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id),
  old_value jsonb,
  new_value jsonb,
  fields_changed text[] -- keys whose values changed
);

CREATE INDEX IF NOT EXISTS idx_voice_agent_settings_history_changed_at
  ON public.voice_agent_settings_history (changed_at DESC);

ALTER TABLE public.voice_agent_settings_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin reads settings history" ON public.voice_agent_settings_history;
CREATE POLICY "super_admin reads settings history"
  ON public.voice_agent_settings_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admission_head'));

-- Trigger: capture every UPDATE to voice_agent_settings.
CREATE OR REPLACE FUNCTION public._app_config_voice_agent_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := ARRAY[]::text[];
  k text;
BEGIN
  IF NEW.key <> 'voice_agent_settings' THEN
    RETURN NEW;
  END IF;
  v_old := COALESCE((OLD.value)::jsonb, '{}'::jsonb);
  v_new := COALESCE((NEW.value)::jsonb, '{}'::jsonb);
  IF v_old = v_new THEN
    RETURN NEW;
  END IF;
  -- Compute which top-level keys differ
  FOR k IN SELECT jsonb_object_keys(v_old || v_new) LOOP
    IF (v_old->k) IS DISTINCT FROM (v_new->k) THEN
      v_changed := array_append(v_changed, k);
    END IF;
  END LOOP;
  INSERT INTO public.voice_agent_settings_history (changed_by, old_value, new_value, fields_changed)
  VALUES (auth.uid(), v_old, v_new, v_changed);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_config_voice_agent_audit ON public._app_config;
CREATE TRIGGER trg_app_config_voice_agent_audit
  AFTER UPDATE ON public._app_config
  FOR EACH ROW
  WHEN (NEW.key = 'voice_agent_settings')
  EXECUTE FUNCTION public._app_config_voice_agent_audit();

-- ============================================================
-- 4. Dashboard view — 7-day rolling stats per day, AI calls only.
-- ============================================================
CREATE OR REPLACE VIEW public.voice_agent_quality_daily AS
SELECT
  date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
  COUNT(*)::int                                          AS total_calls,
  COUNT(*) FILTER (WHERE quality_score IS NOT NULL)::int  AS rated_calls,
  COUNT(*) FILTER (WHERE quality_score >= 4)::int         AS good_calls,
  COUNT(*) FILTER (WHERE quality_score <= 2)::int         AS bad_calls,
  AVG(quality_score)::numeric(3,2)                       AS mean_score,
  AVG((quality_metrics->>'time_to_first_audio_ms')::numeric)::int  AS avg_ttfa_ms,
  AVG((quality_metrics->>'mean_turn_latency_ms')::numeric)::int    AS avg_turn_latency_ms,
  AVG((quality_metrics->>'total_turns')::numeric)::numeric(4,1)    AS avg_turns,
  SUM((quality_metrics->>'repetition_count')::int)::int            AS total_repetitions,
  SUM((quality_metrics->>'voice_switch_count')::int)::int          AS total_voice_switches,
  COUNT(*) FILTER (WHERE (quality_metrics->>'disposition_set')::boolean = false)::int AS missing_disposition_count
FROM public.ai_call_records
WHERE call_type = 'ai'
  AND created_at >= (now() - interval '14 days')
GROUP BY 1
ORDER BY 1 DESC;

GRANT SELECT ON public.voice_agent_quality_daily TO authenticated;
