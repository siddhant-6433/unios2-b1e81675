-- Add media_url to admissions_ai_reply_examples so admins can attach
-- images, PDFs, or other files when teaching Navya.

ALTER TABLE public.admissions_ai_reply_examples
  ADD COLUMN IF NOT EXISTS media_url text;

-- Storage bucket for knowledge media uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('navya-knowledge', 'navya-knowledge', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admissions staff can upload navya-knowledge"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'navya-knowledge'
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'admission_head')
    )
  );

CREATE POLICY "Anyone can read navya-knowledge"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'navya-knowledge');

-- Update the match RPC to return media_url
CREATE OR REPLACE FUNCTION public.match_admissions_ai_reply_examples(
  p_query text,
  p_course_id uuid DEFAULT NULL,
  p_target_channel text DEFAULT 'whatsapp',
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  query_text text,
  reply_text text,
  media_url text,
  course_id uuid,
  source_channel text,
  target_channels text[],
  language text,
  tags text[],
  quality_score numeric,
  score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    wre.id,
    wre.query_text,
    wre.reply_text,
    wre.media_url,
    wre.course_id,
    wre.source_channel,
    wre.target_channels,
    wre.language,
    wre.tags,
    wre.quality_score,
    (
      greatest(
        similarity(lower(coalesce(p_query, '')), lower(wre.query_text)),
        similarity(lower(coalesce(p_query, '')), lower(wre.reply_text)) * 0.65
      )
      + CASE WHEN p_course_id IS NOT NULL AND wre.course_id = p_course_id THEN 0.20 ELSE 0 END
      + (wre.quality_score * 0.10)
    )::numeric AS score
  FROM public.admissions_ai_reply_examples wre
  WHERE wre.status = 'active'
    AND length(coalesce(p_query, '')) >= 3
    AND coalesce(p_target_channel, 'whatsapp') = ANY(wre.target_channels)
    AND (
      lower(wre.query_text) % lower(p_query)
      OR lower(wre.reply_text) % lower(p_query)
      OR (p_course_id IS NOT NULL AND wre.course_id = p_course_id)
    )
  ORDER BY score DESC, wre.quality_score DESC, wre.updated_at DESC
  LIMIT least(greatest(coalesce(p_limit, 3), 1), 5);
$$;
