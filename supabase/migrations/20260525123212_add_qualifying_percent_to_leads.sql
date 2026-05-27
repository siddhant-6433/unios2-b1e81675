-- Add qualifying_percent to leads
--
-- Phase 2 of the @nimt/scholarship-slabs integration. The package's
-- calculateBestScholarship() needs two inputs from the lead:
--
--   1. qualifyingPercent  — 10+2 % for UG courses, graduation % for PG/MBA.
--                           Drives the merit-based slab match.
--   2. scores             — entrance exam ranks/percentiles keyed by exam slug
--                           (cat-mba, cat-pgdm, clat, lsat). Drives the
--                           entrance-based slab match.
--
-- Scores already have a home: leads.entrance_scores (JSONB, added earlier but
-- never populated from the frontend). We just need a typed column for the
-- qualifying %.

alter table leads
  add column if not exists qualifying_percent numeric(5,2);

comment on column leads.qualifying_percent is
  '10+2 % (UG courses) or graduation % (PG/MBA). Drives merit-based scholarship slab via @nimt/scholarship-slabs.';
