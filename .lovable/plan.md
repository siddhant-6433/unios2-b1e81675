

## Issue: Empty Intake Cycle Dropdown

The "Admission Session" / "Intake Cycle" dropdown on `/apply/nimt` is empty because the `admission_sessions` table in the database has **zero rows**.

### Fix

Insert at least one active admission session record. For example:

**Database migration** — Insert a session like `2025-26` or `2026-27`:

```sql
INSERT INTO admission_sessions (name, start_date, end_date, is_active)
VALUES ('2025-26', '2025-04-01', '2026-03-31', true);
```

You can add multiple sessions if needed. Only rows with `is_active = true` appear in the dropdown.

### No code changes required
The `CourseSelector` component already queries `admission_sessions` correctly with `.eq("is_active", true)`. This is purely a missing-data issue.

