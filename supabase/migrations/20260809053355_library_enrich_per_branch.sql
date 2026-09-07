-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260809053355 name=library_enrich_per_branch applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.library_enrich_branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.library_branches(id) ON DELETE CASCADE,
  auto_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.library_enrich_branch_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.library_enrich_status_by_branch()
RETURNS TABLE(branch_id uuid, branch_name text, enriched bigint, no_match bigint, remaining bigint, auto_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.name,
    count(*) FILTER (WHERE r.enrichment_status = 'enriched'),
    count(*) FILTER (WHERE r.enrichment_status = 'no_match'),
    count(*) FILTER (WHERE r.enrichment_status IS NULL AND r.status IN ('captured','matched','needs_review')),
    COALESCE(s.auto_enabled, true)
  FROM public.library_branches b
  JOIN public.library_digitization_records r ON r.branch_id = b.id
  LEFT JOIN public.library_enrich_branch_settings s ON s.branch_id = b.id
  GROUP BY b.id, b.name, s.auto_enabled
  ORDER BY 5 DESC, b.name;
$$;
GRANT EXECUTE ON FUNCTION public.library_enrich_status_by_branch() TO authenticated;

CREATE OR REPLACE FUNCTION public.library_set_branch_enrich(_branch_id uuid, _enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can change auto-enrichment';
  END IF;
  INSERT INTO public.library_enrich_branch_settings (branch_id, auto_enabled)
  VALUES (_branch_id, _enabled)
  ON CONFLICT (branch_id) DO UPDATE SET auto_enabled = EXCLUDED.auto_enabled, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.library_set_branch_enrich(uuid, boolean) TO authenticated;
