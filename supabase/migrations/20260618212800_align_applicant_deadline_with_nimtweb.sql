-- Align the UniOs applicant/application deadline with the public NIMTWeb
-- admissions header.

INSERT INTO public._app_config (key, value)
VALUES ('fee_submission_deadline', '2026-06-10')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;
