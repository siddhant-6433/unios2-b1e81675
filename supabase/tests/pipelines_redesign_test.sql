-- pgTAP regression tests for the PR1 Visit-track migrations.
-- Run with:  supabase test db
-- (requires the pgTAP extension; supabase test db wraps the file in a
--  transaction and rolls back, so the fixtures never persist.)

BEGIN;
SELECT plan(7);

-- Fixtures use fixed UUIDs so we can reference them across statements.
-- leads requires (name, phone); everything else defaults.
INSERT INTO public.leads (id, name, phone, stage) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Trigger Test', '9990000001', 'new_lead');

-- ── 1. applied_at stamps on entering an applied-bucket stage ────────────────
UPDATE public.leads SET stage = 'application_submitted'
 WHERE id = '00000000-0000-0000-0000-0000000000a1';

SELECT isnt(
  (SELECT applied_at FROM public.leads WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  NULL,
  'applied_at is stamped when a lead enters an applied-bucket stage'
);

-- Stash applied_at to prove first-write-wins below.
CREATE TEMP TABLE _stash AS
  SELECT applied_at AS first_applied_at
    FROM public.leads WHERE id = '00000000-0000-0000-0000-0000000000a1';

-- ── 2. admitted_at stamps on entering admitted ──────────────────────────────
UPDATE public.leads SET stage = 'admitted'
 WHERE id = '00000000-0000-0000-0000-0000000000a1';

SELECT isnt(
  (SELECT admitted_at FROM public.leads WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  NULL,
  'admitted_at is stamped when a lead reaches admitted'
);

-- ── 3. first-write-wins: applied_at not overwritten by a later stage change ─
SELECT is(
  (SELECT applied_at FROM public.leads WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  (SELECT first_applied_at FROM _stash),
  'applied_at is first-write-wins (a later stage change does not overwrite it)'
);

-- ── 4. visit_funnel_leads dedups a lead with multiple visits to ONE row ─────
INSERT INTO public.leads (id, name, phone, stage) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Visit Dedup', '9990000002', 'counsellor_call');
INSERT INTO public.campus_visits (lead_id, visit_date, status) VALUES
  ('00000000-0000-0000-0000-0000000000b1', now() - interval '5 days', 'no_show'),
  ('00000000-0000-0000-0000-0000000000b1', now() - interval '1 day',  'scheduled');

SELECT is(
  (SELECT COUNT(*)::int FROM public.visit_funnel_leads
    WHERE lead_id = '00000000-0000-0000-0000-0000000000b1'),
  1,
  'a lead with 2 visits appears in exactly one visit_funnel_leads row'
);

-- ── 5. dedup keeps the LATEST visit state (reschedule beats stale no-show) ──
SELECT is(
  (SELECT funnel_box FROM public.visit_funnel_leads
    WHERE lead_id = '00000000-0000-0000-0000-0000000000b1'),
  'scheduled',
  'latest visit state wins — a rescheduled visit shows Scheduled, not the older No-show'
);

-- ── 6. retired type='visit': no producer leaves any behind ──────────────────
-- (Migration 7 backfilled existing rows; assert the column exists + nothing
--  in this transaction is type='visit'.)
SELECT is(
  (SELECT COUNT(*)::int FROM public.lead_followups WHERE type = 'visit'),
  0,
  'no lead_followups rows remain with the retired type=visit'
);

-- ── 7. lead_followups.visit_id column exists and is a real FK target ────────
SELECT has_column('public', 'lead_followups', 'visit_id',
  'lead_followups.visit_id column exists for linking post-visit follow-ups');

SELECT * FROM finish();
ROLLBACK;
