-- Hiring Phase B — public careers portal support + candidate offer acceptance.
--
-- The careers portal (built in this repo) reads open `job_openings` with the
-- anon key and applies through the `apply-job` edge function (service role), so
-- no anon INSERT policy on job_applicants is needed. Offer acceptance is a
-- tokenised, anon-callable RPC — the token is the secret.

-- ── 1. Offer acceptance token ───────────────────────────────────────────────

ALTER TABLE public.hr_letters
  ADD COLUMN IF NOT EXISTS acceptance_token  uuid,
  ADD COLUMN IF NOT EXISTS acceptance_status text NOT NULL DEFAULT 'pending'
    CHECK (acceptance_status IN ('pending', 'accepted', 'declined')),
  ADD COLUMN IF NOT EXISTS accepted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at  timestamptz,
  ADD COLUMN IF NOT EXISTS acceptance_note text;

CREATE UNIQUE INDEX IF NOT EXISTS hr_letters_acceptance_token_uniq
  ON public.hr_letters (acceptance_token) WHERE acceptance_token IS NOT NULL;

UPDATE public.hr_letters
   SET acceptance_token = gen_random_uuid()
 WHERE job_applicant_id IS NOT NULL
   AND letter_code = 'offer'
   AND acceptance_token IS NULL;

CREATE OR REPLACE FUNCTION public.tg_hr_letters_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_applicant_id IS NOT NULL AND NEW.letter_code = 'offer' AND NEW.acceptance_token IS NULL THEN
    NEW.acceptance_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hr_letters_token ON public.hr_letters;
CREATE TRIGGER trg_hr_letters_token
  BEFORE INSERT ON public.hr_letters
  FOR EACH ROW EXECUTE FUNCTION public.tg_hr_letters_token();

-- ── 2. Candidate redeems the offer ──────────────────────────────────────────
-- Anon-callable by design: the token is the only credential. Approving a letter
-- already happened inside HR; this only records the candidate's response.

CREATE OR REPLACE FUNCTION public.redeem_offer_acceptance(
  _token uuid, _accept boolean, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.hr_letters;
  a public.job_applicants;
  v_profile uuid;
BEGIN
  SELECT * INTO l FROM public.hr_letters WHERE acceptance_token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or unknown offer link'; END IF;
  IF l.status NOT IN ('approved', 'issued') THEN RAISE EXCEPTION 'This offer is not available to respond to yet'; END IF;
  IF l.acceptance_status <> 'pending' THEN RAISE EXCEPTION 'You have already responded to this offer'; END IF;

  SELECT * INTO a FROM public.job_applicants WHERE id = l.job_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer is not linked to a candidate'; END IF;

  IF _accept THEN
    UPDATE public.hr_letters
       SET acceptance_status = 'accepted', accepted_at = now(), acceptance_note = _note
     WHERE id = l.id;

    -- Move the candidate into the onboarding pipeline (offer accepted).
    SELECT id INTO v_profile FROM public.employee_profiles WHERE job_applicant_id = a.id LIMIT 1;
    IF v_profile IS NULL THEN
      INSERT INTO public.employee_profiles
        (user_id, display_name, personal_email, mobile_number, job_title,
         onboarding_stage, offer_accepted_at, offer_joining_date, verification_status, job_applicant_id)
      VALUES
        (NULL, a.name, a.email, a.source_phone, a.desired_role,
         'offer_accepted', now(), NULL, 'pending', a.id);
    ELSE
      UPDATE public.employee_profiles
         SET onboarding_stage = 'offer_accepted', offer_accepted_at = now()
       WHERE id = v_profile;
    END IF;

    INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
    VALUES (a.id, auth.uid(), 'offer_accepted', 'Candidate accepted the offer' || COALESCE(' · ' || _note, ''));
    RETURN 'accepted';
  END IF;

  UPDATE public.hr_letters
     SET acceptance_status = 'declined', declined_at = now(), acceptance_note = _note
   WHERE id = l.id;
  UPDATE public.job_applicants SET status = 'withdrawn' WHERE id = a.id AND status <> 'hired';

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (a.id, auth.uid(), 'offer_declined', 'Candidate declined the offer' || COALESCE(' · ' || _note, ''));
  RETURN 'declined';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_offer_acceptance(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_offer_acceptance(uuid, boolean, text) TO anon, authenticated, service_role;

-- ── 3. Public read of an offer by token (for the acceptance page) ───────────

CREATE OR REPLACE FUNCTION public.get_offer_by_token(_token uuid)
RETURNS TABLE (
  letter_id uuid, applicant_name text, subject text, body text,
  status text, acceptance_status text, reference_no text,
  desired_role text, job_opening_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, COALESCE(a.name, 'Candidate'), l.subject, l.body,
         l.status, l.acceptance_status, l.reference_no,
         a.desired_role, jo.title
    FROM public.hr_letters l
    LEFT JOIN public.job_applicants a ON a.id = l.job_applicant_id
    LEFT JOIN public.job_openings jo ON jo.id = a.job_opening_id
   WHERE l.acceptance_token = _token
     AND l.status IN ('approved', 'issued');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_offer_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_offer_by_token(uuid) TO anon, authenticated, service_role;
