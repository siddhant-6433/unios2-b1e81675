# Student comms & login suppression

UniOS blocks WhatsApp, email, OTP and login for some candidate phone numbers /
emails. This is the *suppression* gate; it is separate from per-message routing.

## The rule

These functions share one predicate:

| Function | Scope |
| --- | --- |
| `phone_comms_suppressed(_phone)` | WhatsApp + OTP + **login** (called by `whatsapp-otp` via `isCandidateLoginBlocked`) |
| `lead_comms_suppressed(_lead_id)` | lifecycle `notify-event` messages |
| `email_comms_suppressed(_email)` | email sends |
| `wa_suppressed_phones(_phones)` | campaign audience skip |

A phone is suppressed when **any `students` row that is NOT deleted** is either
`login_disabled` **or** `archived_at IS NOT NULL`, and the number matches:

- the student's own `phone` or `whatsapp_no`, **or**
- the phone on the student's **linked lead** (`leads.phone` via `students.lead_id`).

`email_comms_suppressed` works the same over `students.email` /
`student_email` / `school_email` and `leads.email`.

The intent: a disabled or archived candidate must not receive comms, and must
not be able to sign in — even when the stored phone formatting differs from the
number typed into the login box (`wa_normalize_phone` handles the shape).

## Deleted students are different

Deletion is a **soft delete**: `delete_student()` sets `students.deleted_at`
(plus `deleted_by` / `delete_reason`) and writes a `student_audit_log` row. It
does *not* remove the row.

A deleted student **stops suppressing a number**. If deleting kept the block, a
number a removed student once used could stay blocked forever — including for a
*currently active* student who now owns the same number. (Real incident,
2026-09-28: an archived-then-deleted student's linked lead held a number that
was also an active student's login number, so login showed "disabled" and the
app's Delete never freed it.)

Deleted rows keep `phone` / `whatsapp_no` so admin phone-search recovery still
finds them.

## Debugging a "login is disabled" / "message not sent"

1. Check the gate directly:
   ```sql
   select public.phone_comms_suppressed('+91XXXXXXXXXX');
   ```
2. Find the causing record. Suppression can come from a **different** student
   than the one you expect, and often from a **linked lead** rather than the
   student's own phone:
   ```sql
   select s.id, s.name, s.phone, s.whatsapp_no,
          s.login_disabled, s.archived_at, s.deleted_at,
          l.phone as lead_phone
     from public.students s
     left join public.leads l on l.id = s.lead_id
    where s.deleted_at is null
      and (coalesce(s.login_disabled, false) or s.archived_at is not null)
      and public.wa_normalize_phone('+91XXXXXXXXXX') in (
            public.wa_normalize_phone(s.phone),
            public.wa_normalize_phone(s.whatsapp_no),
            public.wa_normalize_phone(l.phone)
          );
   ```
3. Resolve by un-archiving / re-enabling that record, or deleting it (which now
   frees the number). Editing the stray lead's phone also works.

## Note on the app "Delete" button

`StudentProfile` calls `delete_student`, which is the soft delete above. Before
2026-09-28 this left the number suppressed; migration
`deleted_students_stop_suppressing_numbers.sql` fixed that by excluding deleted
students from every suppression function.
