

## Update Intake Cycle to 2026-27

The current active session is `2025-26`. Need to:

1. **Insert** a new `2026-27` session record into `admission_sessions`
2. **Deactivate** the old `2025-26` session

### Steps
- Insert: `INSERT INTO admission_sessions (name, start_date, end_date, is_active) VALUES ('2026-27', '2026-04-01', '2027-03-31', true);`
- Update old session: `UPDATE admission_sessions SET is_active = false WHERE name = '2025-26';`

No code changes needed — the `CourseSelector` already filters by `is_active = true`.

