-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260825082931 name=add_missing_uniform_fee_items applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_date)
SELECT fs.id,
       (SELECT id FROM public.fee_codes WHERE code = 'UNIFORM'),
       'uniform_2026',
       (fs.metadata->>'uniform_cost')::numeric,
       DATE '2026-08-14'
FROM public.fee_structures fs
WHERE fs.is_active
  AND COALESCE(fs.metadata->>'uniform_cost', '0') NOT IN ('0', '')
  AND NOT EXISTS (
    SELECT 1 FROM public.fee_structure_items si
    WHERE si.fee_structure_id = fs.id
      AND si.fee_code_id = (SELECT id FROM public.fee_codes WHERE code = 'UNIFORM'));
