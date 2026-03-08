
-- Make phone unique (allow nulls, but non-null values must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique ON public.profiles (phone) WHERE phone IS NOT NULL;
