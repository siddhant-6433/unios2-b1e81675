-- Add email column to profiles and backfill from auth.users

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill email from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.user_id AND p.email IS NULL;

-- Update trigger to capture email on new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, phone, email)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NEW.email
    ),
    NULLIF(NEW.phone, ''),
    NEW.email
  )
  ON CONFLICT (user_id) DO UPDATE
    SET
      display_name = CASE
        WHEN profiles.display_name IS NULL OR profiles.display_name = '' THEN EXCLUDED.display_name
        ELSE profiles.display_name
      END,
      phone = CASE
        WHEN profiles.phone IS NULL OR profiles.phone = '' THEN EXCLUDED.phone
        ELSE profiles.phone
      END,
      email = CASE
        WHEN profiles.email IS NULL OR profiles.email = '' THEN EXCLUDED.email
        ELSE profiles.email
      END;
  RETURN NEW;
END;
$$;
