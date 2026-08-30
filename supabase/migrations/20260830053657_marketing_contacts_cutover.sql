-- One-time cutover: move the inert imported rows out of `leads` into
-- `marketing_contacts`.
--
-- Companion to 20260830053655 (table) and 20260830053656 (promotion RPCs).
--
-- Executed against production on 2026-08-29 via the Supabase MCP rather than
-- `db push`, per the project's migration convention. Recorded here so the
-- repo has the exact statements and the rollback path.
--
-- Measured on the day: `leads` held 570,462 rows; 540,445 matched the inert
-- predicate below and moved; ~30,000 real leads stayed. 752,771 of 783,010
-- lead_list_members rows were re-pointed at contacts; zero campaign recipient
-- rows were affected (every existing recipient belonged to an engaged lead),
-- so no in-flight campaign was disturbed.
--
-- NOT idempotent by design — it is a data migration guarded by an explicit
-- snapshot table. Re-running it after the fact is a no-op only because the
-- snapshot is empty of surviving leads.

-- ── 1. Snapshot the inert set ──────────────────────────────────────────
-- "Inert" = no engagement of any kind and no admissions footprint. The
-- NOT EXISTS list covers every child table that would carry real work; a row
-- surviving all of them has never been contacted, called, applied, paid,
-- noted, followed up, or visited. Verified before deleting: all 16 further
-- lead-referencing tables (lead_notes, notifications, payment_links,
-- whatsapp_conversation_state, exam/cahet/updeled registrations, waitlist,
-- job_applicants, fee_proposals, email_messages, web_conversations,
-- lead_engagement_events, lead_assignment_history, lead_counsellors,
-- lead_documents) returned a count of ZERO against this snapshot.
CREATE TABLE IF NOT EXISTS public._mc_cutover AS
SELECT l.id FROM public.leads l
WHERE l.counsellor_id IS NULL
  AND l.is_mirror = false
  AND l.stage = 'new_lead'
  AND l.admission_no IS NULL
  AND l.pre_admission_no IS NULL
  AND l.application_id IS NULL
  AND l.academic_partner_id IS NULL
  AND l.admission_partner_id IS NULL
  AND l.consultant_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_call_records  c WHERE c.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.applications     a WHERE a.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.students         s WHERE s.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.lead_payments    p WHERE p.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.lead_activities  x WHERE x.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.lead_followups   f WHERE f.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.offer_letters    o WHERE o.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.call_logs        g WHERE g.lead_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.campus_visits    v WHERE v.lead_id = l.id);

ALTER TABLE public._mc_cutover ADD PRIMARY KEY (id);

-- ── 2. Copy into marketing_contacts, preserving the uuid ───────────────
-- Same id in both tables. That is what makes step 3 a plain column swap and
-- makes the rollback below exact.
INSERT INTO public.marketing_contacts
  (id, phone, name, email, city, area, state, source, created_at, updated_at, meta)
SELECT l.id, l.phone, l.name, l.email, l.city, l.area, l.state,
       COALESCE(l.source::text, 'import'), l.created_at, now(),
       CASE WHEN l.notes IS NOT NULL THEN jsonb_build_object('notes', l.notes) ELSE '{}'::jsonb END
FROM public.leads l
JOIN public._mc_cutover i ON i.id = l.id
WHERE l.phone IS NOT NULL AND btrim(l.phone) <> ''
ON CONFLICT DO NOTHING;

-- ── 3. Re-point list membership at the contact ─────────────────────────
-- Campaign reach is unchanged: the same people stay on the same lists.
UPDATE public.lead_list_members m
   SET contact_id = m.lead_id, lead_id = NULL
  FROM public._mc_cutover i
 WHERE i.id = m.lead_id;

UPDATE public.whatsapp_campaign_recipients r
   SET contact_id = r.lead_id, lead_id = NULL
  FROM public._mc_cutover i
 WHERE i.id = r.lead_id;

UPDATE public.email_campaign_recipients r
   SET contact_id = r.lead_id, lead_id = NULL
  FROM public._mc_cutover i
 WHERE i.id = r.lead_id;

-- ── 4. Delete the moved leads, in batches ──────────────────────────────
-- Batched because each DELETE fans out to ~90 FK-referencing tables. 21 of
-- those columns are unindexed, but every one of those tables was verified
-- empty (0-36 rows), so the seq scans are free.
DO $$
DECLARE n int; total int := 0;
BEGIN
  LOOP
    WITH batch AS (
      SELECT i.id FROM public._mc_cutover i
       WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = i.id)
       LIMIT 5000
    )
    DELETE FROM public.leads l USING batch b WHERE l.id = b.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    EXIT WHEN n = 0;
  END LOOP;
  RAISE NOTICE 'deleted % leads', total;
END $$;

-- ── 5. Reclaim the space ───────────────────────────────────────────────
-- Deleting rows does not shrink indexes. `leads` carried ~700 MB across 41
-- indexes sized for half a million rows; without this they stay that size.
-- Run OUTSIDE a transaction:
--   VACUUM (ANALYZE) public.leads;
--   REINDEX TABLE CONCURRENTLY public.leads;

-- ── Rollback ───────────────────────────────────────────────────────────
-- Exact, thanks to the shared uuid. Keep _mc_cutover for a week, then drop it.
--   INSERT INTO public.leads (id, name, phone, email, city, area, state, source, stage, skip_ai_call, created_at)
--   SELECT c.id, c.name, c.phone, c.email, c.city, c.area, c.state, 'other', 'new_lead', true, c.created_at
--     FROM public.marketing_contacts c JOIN public._mc_cutover i ON i.id = c.id;
--   UPDATE public.lead_list_members m SET lead_id = m.contact_id, contact_id = NULL
--     FROM public._mc_cutover i WHERE i.id = m.contact_id;
--   DELETE FROM public.marketing_contacts c USING public._mc_cutover i WHERE i.id = c.id;
