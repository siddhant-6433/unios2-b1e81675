-- Create a public storage bucket for WhatsApp inbound media
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow service_role to upload (edge functions use service role key)
CREATE POLICY "Service role can upload whatsapp media"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'whatsapp-media');

-- Allow anyone to read (public bucket, used in inbox UI)
CREATE POLICY "Anyone can view whatsapp media"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'whatsapp-media');
