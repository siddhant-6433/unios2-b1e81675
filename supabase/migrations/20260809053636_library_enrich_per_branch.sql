-- Per-library control + progress for scheduled enrichment. A branch is auto-enriched unless it has
-- an explicit row with auto_enabled=false (so one big library can be paused while others process).

CREATE TABLE IF NOT EXISTS public.library_enrich_branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.library_branches(id) ON DELETE CASCADE,
  auto_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.library_enrich_branch_settings ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER RPCs below (which bypass RLS) may read/write it.

-- Per-library progress + auto flag (only libraries that have digitization records).
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

-- Super-admin: enable/disable auto-enrichment for a specific library.
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
