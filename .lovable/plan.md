

## Problem

The `lead_notes.user_id` column has a foreign key constraint referencing `auth.users(id)`. However, the code inserts `profileId` (from the `profiles` table) into `user_id`, which is a `profiles.id` UUID -- not the `auth.users.id` UUID. This causes the foreign key violation.

## Fix

**File: `src/pages/LeadDetail.tsx`** (line 132)

Change the insert to use `user?.id` (the auth user ID) instead of `profileId` (the profile table ID):

```typescript
// Before
const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: profileId, content: newNote.trim() });

// After  
const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: user?.id, content: newNote.trim() });
```

Same fix needed on line 136 for `lead_activities` insert -- check if that table's `user_id` also references `auth.users(id)` vs `profiles.id`. Looking at the schema, `lead_activities.user_id` is also nullable UUID with no documented FK, but for consistency it should use the auth user ID since the original migration likely references `auth.users(id)` there too.

**Lines to change:**
- Line 132: `user_id: profileId` -> `user_id: user?.id`
- Line 136: `user_id: profileId` -> `user_id: user?.id`

This is a one-line fix in each case. The `user` object comes from the auth context and contains the correct `auth.users.id`.

