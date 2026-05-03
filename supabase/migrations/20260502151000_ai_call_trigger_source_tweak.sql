-- Tweak source classification for the AI call trigger:
--   • whatsapp  → real-time (active inbound interest, same as website)
--   • mirai_website → real-time (their own website, not third-party)

CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_new_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay_min int;
BEGIN
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  CASE NEW.source
    -- Real-time intent → 4 min delay (jumps ahead of bulk in FIFO)
    WHEN 'website', 'website_chat', 'mirai_website',
         'meta_ads', 'google_ads', 'whatsapp', 'enquiry'
      THEN v_delay_min := 4;
    -- Bulk publishers → 30 min delay
    WHEN 'collegedunia', 'collegehai', 'salahlo', 'justdial', 'shiksha'
      THEN v_delay_min := 30;
    -- Manual entry → no auto call (a human is already on it)
    WHEN 'consultant', 'walk_in', 'reference', 'referral', 'education_fair'
      THEN RETURN NEW;
    ELSE v_delay_min := 4; -- unknown source defaults to real-time
  END CASE;

  INSERT INTO ai_call_queue (lead_id, status, scheduled_at)
  VALUES (NEW.id, 'pending', fn_next_business_hour(v_delay_min))
  ON CONFLICT (lead_id) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AI call queue insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
