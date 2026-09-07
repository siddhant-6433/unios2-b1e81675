-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260801064348 name=20260801064303_remove_bed_full_payment_waivers applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

UPDATE public.fee_structures fs
   SET policy = fs.policy
       || jsonb_build_object(
            'lump_sum_first_year_waiver_pct', 0,
            'multi_year_waiver_pct',          0
          )
  FROM public.courses c
 WHERE fs.course_id = c.id
   AND (c.name ILIKE '%B.Ed%' OR c.name ILIKE '%Bachelor of Education%');
