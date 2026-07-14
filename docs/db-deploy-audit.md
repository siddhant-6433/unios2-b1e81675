# DB deploy audit (2026-05-20)

Snapshot of the drift between `supabase/migrations/` (git) and the
`supabase_migrations.schema_migrations` table in production at the time
the `db-push` CI workflow was added.

## Current status (2026-06-18)

`supabase db push` and `npm run db:migrations:clean` both report:

```text
Remote database is up to date.
```

There are no pending local migration files waiting to be applied to the linked
Supabase project.

## Why this file exists

The team's historical workflow was dual-track: some migrations got written
as files and applied via `supabase db push`, others were authored directly
in the Supabase Studio SQL editor. The git folder is therefore *not* a
strict source of truth — it has files that were never applied (because no
CI ran `db push`) and is missing files for changes applied via the
dashboard.

This caused ~6 features to ship dark in production through 2026-05 (their
React code deployed, their backing tables / cron jobs / RPCs didn't):

- offer-letter edit-requests workflow
- token-fee deadline WhatsApp reminders (hourly cron)
- SLA auto-reclaim of stale leads (every-15-min cron)
- intermediate-stage counsellor scoring + funnel view
- Cloud Dialer Phase 4 source attribution
- `cloud_dialer_queue` Phase 1/2 columns

All of the above were applied to remote on 2026-05-20 as part of this
clean-up. The CI workflow added in `.github/workflows/db-push.yml`
prevents future drift on the git→remote direction.

## Drift summary (2026-05-20)

| Direction | Count | Status |
|---|---|---|
| Local files with no remote match (pending) | 15 | 11 applied 2026-05-20 (8 ran clean, 1 needed bug fix, 2 were no-ops since the table/column already existed) + 3 still pending paste |
| Remote names with no local file (dashboard-only) | 35 | Not backfilled; CI uses version-not-name matching so these don't block `db push` |

## Truly-pending files at audit time (15)

| File | Verdict on 2026-05-20 |
|---|---|
| `20260331110000_create_jd_category_mappings.sql` | Already in prod (table exists) — schema_migrations just doesn't record it. Safe to leave; `db push` will skip since schema_migrations has matching version. |
| `20260423130000_lead_mirroring_trigger.sql` | Already in prod (column exists). Safe to leave. |
| `20260507130810_remote_dashboard_change.sql` | Placeholder file with no SQL — purely documentary. |
| `20260513160000_fix_app_url_to_uni.sql` | **Applied 2026-05-20** |
| `20260608110000_offer_letter_edit_requests.sql` | **Applied 2026-05-20** |
| `20260610000000_applicant_deadlines_config.sql` | **Applied 2026-05-20** (deadlines default to `2026-06-15` and `2026-09-15`; update via `set_applicant_deadline` RPC if wrong) |
| `20260610010000_token_fee_reminders_cron.sql` | **Applied 2026-05-20** with `app_role` bug fix (file referenced non-existent `'admin'` and `'team_leader'` enum values). File in main has been corrected. |
| `20260610050000_fix_applications_rls_helpers.sql` | Already in prod via the rename `fix_applications_rls_with_helpers` (in schema_migrations). Helper functions exist. |
| `20260610120000_sla_auto_reclaim.sql` | **Applied 2026-05-20** |
| `20260610130000_intermediate_scoring_and_funnel.sql` | **Applied 2026-05-20** |
| `20260610140000_call_source_and_dialer_usage.sql` | **Applied 2026-05-20** |
| `20260610150000_reclaim_count_rpc.sql` | **Applied 2026-05-20** |
| `20260610160000_cloud_dialer_queue_extras.sql` | **Pending paste** — `CREATE OR REPLACE FUNCTION cloud_dialer_queue(...)`. Idempotent. |
| `20260613100000_bucket_exclude_terminal_stages.sql` | **Pending paste** — `CREATE OR REPLACE FUNCTION get_unassigned_leads_bucket(...)`. Idempotent. |
| `20260613110000_wa_conversations_definer_fn.sql` | **Pending paste** — `CREATE OR REPLACE FUNCTION get_whatsapp_conversations(...)`. Idempotent. |

## Remote-only (35) — dashboard-applied, no git file

Recovery option: these can be backfilled from `supabase_migrations.schema_migrations.statements` (Postgres stores the full SQL text). Doing so makes the git folder a real source of truth — useful if you ever need to recreate the DB from scratch. Not blocking anything today.

```
academic_foundation              hostel_foundation                    notices_and_push_tokens
admission_issued_notify_v2       institutions_short_code              offline_payment_skip_db_trigger
admission_numbering              lead_payments_audit                  online_classes
applicant_payments_hide_waiver_  lead_year_fees_net                   online_classes_orgwide_and_notifications
attendance_pct_last_n_class_days multi_team_routing_fix_hybrid_campus payment_notify_skip_all_gateways
call_logs_dedupe_v3              nep_universities_attendance_lock     realtime_leads_publication
fee_status_post_waiver_discounts recording_mode_and_loom              refund_workflow
finance_dashboards               restore_anon_applications_select     rooms_and_room_bookings
fix_applications_rls_with_helpers student_fee_view_and_payment_intents timetable_and_lecture_attendance
gatepass_foundation              guardian_links                       grant_service_role_meta_event_log
```

Recovery query (when MCP / SQL access is available):

```sql
-- Inspect what's actually in schema_migrations for the dashboard-only ones
SELECT version, name, length(statements::text) AS sql_len
FROM supabase_migrations.schema_migrations
WHERE name IN ('academic_foundation', 'admission_numbering', ...)
ORDER BY version;
```

For each row, dump `statements` as the body of a new file
`supabase/migrations/<version>_<name>.sql`. Commit. Future `db push`
will then either no-op (version matches) or, for fresh environments, run
them in the correct order.

## How the CI guards this going forward

Create migrations through the repo helper instead of hand-writing timestamps:

```bash
npm run db:migration:new -- add_student_status_index
```

The helper writes `supabase/migrations/<unique_version>_<name>.sql`, choosing a
version greater than both the current UTC timestamp and the highest local
migration version.

`scripts/check-supabase-migration-health.mjs`:
- `npm run db:migrations:check` → validates `supabase db push --dry-run`; pending branch migrations are allowed if Supabase can apply them cleanly.
- `npm run db:migrations:apply` → rejects duplicate local migration versions, runs `supabase db push --include-all --yes`, then verifies production is clean. This is the main-branch merge path.
- `npm run db:migrations:clean` → validates `supabase db push --dry-run` and additionally requires `Remote database is up to date.`
- In CI, missing Supabase secrets are a hard failure. A green check must mean CI actually reached the linked project.

`.github/workflows/db-push.yml`:
- **Every PR to `main`** → runs `npm run db:migrations:check` so broken migration ordering, duplicate migration versions, remote drift, and duplicate-object failures block merge.
- **Every merge queue group** → runs the same dry-run check against the exact integrated merge candidate when GitHub merge queue is enabled.
- **Every push to `main`** → runs `npm run db:migrations:apply`, deploys the deletion function, then runs `npm run db:migrations:clean`. It is safe and usually a no-op when no migration files changed, but it prevents pending migrations from accumulating silently.
- **`workflow_dispatch` from `main`** → manual one-click apply for ad-hoc cases.

`.github/workflows/db-drift-check.yml`:
- **Daily + manual** → runs `npm run db:migrations:clean` and opens/updates a `migration-drift` issue if production ever stops matching the repo.

Required repo secrets:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF` (= `deylhigsisuexszsmypq`)
- `SUPABASE_DB_PASSWORD`

## Lessons captured

1. **Dual-track is the bug.** Authoring in Studio without round-tripping through git leaves the team blind to drift. Either always go via files + `db push`, or always go via Studio and accept that git isn't authoritative.
2. **Enum-typed columns need typed literals in policies.** The `token_fee_reminders_cron` file referenced `'admin'` / `'team_leader'` which silently work in unconstrained text contexts but error when compared to `app_role`. CI dry-run would have caught this on the original PR.
3. **`apply_migration` (MCP / direct) bypasses the file→remote audit trail.** If you apply ad-hoc, also commit the matching file with `IF NOT EXISTS` guards so a later `db push` is a no-op rather than a duplicate-error.
4. **Migration timestamps are identities, not labels.** If two PRs create the same timestamp prefix, rename one before merge. The migration health script fails fast on duplicates because Supabase records only the numeric version.
