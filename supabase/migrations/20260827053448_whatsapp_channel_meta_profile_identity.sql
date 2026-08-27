-- Real per-number WhatsApp identity for the marketing sender picker.
--
-- whatsapp_channels had no display name or avatar, so the inbox and the LeadLists
-- sender picker showed the same hardcoded NIMT logo + phone number for every
-- number. These columns hold each number's actual Meta business profile
-- (verified name + re-hosted profile photo), synced by
-- whatsapp-channel-profiles-sync, so a picker can show distinct identity per number.
-- All nullable — a number with no synced profile falls back to the logo + label.

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS verified_name       text,
  ADD COLUMN IF NOT EXISTS profile_picture_url text,
  ADD COLUMN IF NOT EXISTS profile_synced_at   timestamptz;

-- Numbers the user designated bulk-safe for the marketing sender picker.
-- (The generic "Bulk campaign Meta sender" row is already allow_bulk=true.)
-- 1216095224919854 = 9555192192 (NIMT admissions coexistence)
-- 1110238142172240 = 9220522282 (Mirai Experiential School)
-- 1274023025796842 = 9599931443 (NIMT Beacon School) — NOTE: its Meta token is
--   not yet configured in edge env, so sends/profile-sync from it fail until added.
UPDATE public.whatsapp_channels
   SET allow_bulk = true
 WHERE meta_phone_number_id IN
   ('1216095224919854', '1110238142172240', '1274023025796842');
