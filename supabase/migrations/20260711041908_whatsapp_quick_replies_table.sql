-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260711041908 name=whatsapp_quick_replies_table applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.whatsapp_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  text text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.whatsapp_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active quick replies"
  ON public.whatsapp_quick_replies FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage quick replies"
  ON public.whatsapp_quick_replies
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  );

GRANT SELECT ON public.whatsapp_quick_replies TO authenticated;
GRANT ALL ON public.whatsapp_quick_replies TO service_role;
