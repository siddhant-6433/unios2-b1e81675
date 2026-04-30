-- offer_letters carries a stored PDF URL once generate-offer-letter runs.
ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS letter_url text;
