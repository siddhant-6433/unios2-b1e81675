-- Customer-facing eligibility text for WhatsApp templates.
--
-- eligibility_rules.notes is the internal admissions-team field — it often
-- contains policy details that shouldn't go out in marketing/customer
-- communications (e.g. "Lateral entry to 2nd year for Diploma holders" on
-- BMRIT, which we don't want to advertise unsolicited).
--
-- Adding a separate `marketing_eligibility` column on courses gives the
-- admissions team a clean, curated string the fn_resolve_course_info_params
-- resolver can prefer over eligibility_rules.notes for outbound messages.
-- Leaving it NULL keeps the existing notes-based behaviour.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS marketing_eligibility text;

COMMENT ON COLUMN public.courses.marketing_eligibility IS
  'Customer-facing eligibility text used in WhatsApp course_info_v1 sends. Falls back to eligibility_rules.notes when NULL. Keep concise — appears in a templated body so no policy/admin details.';

-- Seed initial values for the high-volume college programmes. The body
-- prefers structured eligibility over admin notes.
UPDATE public.courses SET marketing_eligibility = '10+2 with Physics, Chemistry, Biology. NEET UG accepted.'
 WHERE code = 'BMRIT-GN';
UPDATE public.courses SET marketing_eligibility = 'B.Sc MRIT or equivalent B.Sc with min 50%.'
 WHERE code = 'MMRIT-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 PCB with min 45% (40% for SC/ST). English compulsory.'
 WHERE code = 'BSCN-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 with English, min 40%. ANM registered also eligible.'
 WHERE code = 'GNM-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 PCB with 50% aggregate (40% for SC/ST/PwD).'
 WHERE code = 'BPT-GN';
UPDATE public.courses SET marketing_eligibility = 'BPT with min 50% and 6 months internship.'
 WHERE code = 'MPT-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 with min 50% (any stream).'
 WHERE code IN ('BCA-GN','BBA-GN');
UPDATE public.courses SET marketing_eligibility = 'Bachelor degree (3 years+) with min 50% (45% for SC/ST).'
 WHERE code = 'MBA-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 with Operation Theatre relevant subjects.'
 WHERE code = 'OTT-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 PCB / PCM with min 50%.'
 WHERE code = 'DPHARMA-GN';
UPDATE public.courses SET marketing_eligibility = '10+2 / Graduation with min 50%.'
 WHERE code IN ('BED-GN','BED-GZ','BED-KT','DELED-GZ');
UPDATE public.courses SET marketing_eligibility = '10+2 with min 50%.'
 WHERE code IN ('LLB-GN','BALLB-GN','BALLB-KT');
UPDATE public.courses SET marketing_eligibility = '10+2 with min 50%.'
 WHERE code = 'DPT-GN';
