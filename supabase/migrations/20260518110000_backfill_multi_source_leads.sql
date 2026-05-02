-- Retrospective backfill: find leads with the same phone from different sources
-- and populate secondary_source / tertiary_source / source_history

DO $$
DECLARE
  r RECORD;
  v_updates jsonb;
  v_history jsonb;
  v_count int := 0;
BEGIN
  -- Find phones that appear in multiple leads with different sources
  FOR r IN
    WITH phone_sources AS (
      SELECT
        phone,
        array_agg(DISTINCT source::text ORDER BY source::text) AS sources,
        array_agg(DISTINCT id) AS lead_ids,
        min(created_at) AS first_created
      FROM leads
      WHERE phone IS NOT NULL AND phone != '' AND is_mirror = false
      GROUP BY phone
      HAVING count(DISTINCT source) > 1
    ),
    -- For each phone, pick the oldest lead as the "primary" and track others
    primary_leads AS (
      SELECT
        ps.phone,
        ps.sources,
        (SELECT id FROM leads WHERE phone = ps.phone AND is_mirror = false ORDER BY created_at ASC LIMIT 1) AS primary_lead_id,
        (SELECT source::text FROM leads WHERE phone = ps.phone AND is_mirror = false ORDER BY created_at ASC LIMIT 1) AS primary_source
      FROM phone_sources ps
    )
    SELECT
      pl.primary_lead_id,
      pl.primary_source,
      pl.sources,
      l.secondary_source,
      l.tertiary_source,
      l.source_history
    FROM primary_leads pl
    JOIN leads l ON l.id = pl.primary_lead_id
    WHERE l.secondary_source IS NULL -- only backfill if not already tracked
  LOOP
    -- Build list of non-primary sources
    DECLARE
      v_other_sources text[];
      v_src text;
      v_idx int := 0;
    BEGIN
      v_other_sources := ARRAY(
        SELECT unnest(r.sources) EXCEPT SELECT r.primary_source
      );

      v_history := COALESCE(to_jsonb(r.source_history), '[]'::jsonb);

      -- Add each other source to history + secondary/tertiary
      FOR i IN 1..array_length(v_other_sources, 1) LOOP
        v_src := v_other_sources[i];
        v_history := v_history || jsonb_build_object(
          'source', v_src,
          'timestamp', now()::text,
          'data', 'Retrospective backfill: duplicate lead detected'
        );
      END LOOP;

      UPDATE leads SET
        secondary_source = CASE WHEN secondary_source IS NULL AND array_length(v_other_sources, 1) >= 1
          THEN v_other_sources[1] ELSE secondary_source END,
        tertiary_source = CASE WHEN tertiary_source IS NULL AND array_length(v_other_sources, 1) >= 2
          THEN v_other_sources[2] ELSE tertiary_source END,
        source_history = v_history
      WHERE id = r.primary_lead_id;

      v_count := v_count + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Backfilled source tracking for % leads with multiple sources', v_count;
END $$;
