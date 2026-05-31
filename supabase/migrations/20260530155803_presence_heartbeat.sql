-- Add last_seen_at to profiles for lightweight presence tracking.
-- The frontend pings this every 60s. Counsellors with last_seen_at > now()-2min are "online".

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at ON profiles (last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

-- Allow each user to update their own last_seen_at (RLS-safe heartbeat).
-- Supabase already has a policy letting users update their own profile row;
-- this is additive and only touches the new column.
