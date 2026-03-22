-- Update handle_new_user trigger to also capture phone number from auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, phone)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NEW.email
    ),
    NULLIF(NEW.phone, '')
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
      END;
  RETURN NEW;
END;
$$;
