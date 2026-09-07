-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260726075955 name=offer_letter_school_mode_columns applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS student_type   text,
  ADD COLUMN IF NOT EXISTS hostel_type    text,
  ADD COLUMN IF NOT EXISTS transport_zone text;

COMMENT ON COLUMN public.offer_letters.student_type   IS 'School mode: day_scholar | day_boarder | boarder. NULL = day_scholar (base fee).';
COMMENT ON COLUMN public.offer_letters.hostel_type    IS 'Boarding tier for boarders: non_ac | ac_central | ac_individual.';
COMMENT ON COLUMN public.offer_letters.transport_zone IS 'Transport zone: zone_1 | zone_2 | zone_3. NULL = no transport.';
