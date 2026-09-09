-- Meta Cloud API phone-number status (CONNECTED / DISCONNECTED / PENDING / …).
-- School senders such as Mirai 9220522282 were selectable in Marketing while
-- Meta still reported them as unregistered (error 133010) because we never
-- stored this field. Profile-sync writes it; the sender picker shows it.

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS connection_status text;

COMMENT ON COLUMN public.whatsapp_channels.connection_status IS
  'Meta Cloud API phone number status from GET /{phone-number-id}?fields=status (CONNECTED, DISCONNECTED, PENDING, FLAGGED, …). Null until the first profile-sync.';
