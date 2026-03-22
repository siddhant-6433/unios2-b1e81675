-- Backfill profiles.display_name from auth.users where display_name looks like a UUID
-- (i.e., was auto-set to user_id as fallback) or is null
UPDATE public.profiles p
SET display_name = COALESCE(
  NULLIF(au.raw_user_meta_data->>'display_name', ''),
  NULLIF(au.raw_user_meta_data->>'full_name', ''),
  NULLIF(au.email, ''),
  p.display_name
)
FROM auth.users au
WHERE p.user_id = au.id
  AND (
    p.display_name IS NULL
    -- display_name matches UUID pattern (was set to user_id as fallback)
    OR p.display_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- Backfill profiles.phone from auth.users where profile phone is null but auth user has a phone
UPDATE public.profiles p
SET phone = au.phone
FROM auth.users au
WHERE p.user_id = au.id
  AND p.phone IS NULL
  AND au.phone IS NOT NULL
  AND au.phone != '';
