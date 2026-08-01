-- Per-application comment thread. Staff can leave free-text comments on an
-- application without changing its status; the hold/release action also logs a
-- row here so hold reasons and plain comments share one thread.

CREATE TABLE IF NOT EXISTS public.application_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'comment',   -- 'comment' | 'hold' | 'release'
  author_id uuid REFERENCES auth.users(id),
  author_name text,
  author_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_comments_app
  ON public.application_comments(application_id, created_at DESC);

ALTER TABLE public.application_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view application comments" ON public.application_comments;
CREATE POLICY "Staff can view application comments" ON public.application_comments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Staff can insert application comments" ON public.application_comments;
CREATE POLICY "Staff can insert application comments" ON public.application_comments
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

GRANT SELECT, INSERT ON public.application_comments TO authenticated;
GRANT ALL ON public.application_comments TO service_role;

-- Single write path so author name/role are captured server-side and both the
-- comment action and the hold dialog go through the same function.
CREATE OR REPLACE FUNCTION public.add_application_comment(
  _application_id uuid, _body text, _kind text DEFAULT 'comment'
) RETURNS public.application_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
  v_row application_comments;
BEGIN
  IF NOT (has_role(v_uid,'super_admin') OR has_role(v_uid,'campus_admin')
       OR has_role(v_uid,'principal') OR has_role(v_uid,'admission_head')
       OR has_role(v_uid,'counsellor')) THEN
    RAISE EXCEPTION 'Only staff can comment on applications';
  END IF;
  IF coalesce(btrim(_body), '') = '' THEN
    RAISE EXCEPTION 'Comment body cannot be empty';
  END IF;

  SELECT display_name INTO v_name FROM profiles WHERE user_id = v_uid;
  SELECT role::text INTO v_role FROM user_roles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO application_comments(application_id, body, kind, author_id, author_name, author_role)
  VALUES (_application_id, btrim(_body), coalesce(_kind, 'comment'), v_uid, v_name, v_role)
  RETURNING * INTO v_row;

  RETURN v_row;
END; $$;

GRANT EXECUTE ON FUNCTION public.add_application_comment TO authenticated, service_role;
