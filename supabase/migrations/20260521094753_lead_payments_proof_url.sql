-- Supporting document / image attached when recording an offline
-- payment (cash slip photo, cheque scan, bank-transfer screenshot, UPI
-- proof, etc). Kept separate from receipt_url so the system-generated
-- receipt PDF doesn't clobber the proof and vice-versa.
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS proof_url text;
