-- Add a free-text note for applications in the "approved" (pending-offer) stage
-- so admins can record why an offer hasn't been issued yet.
alter table public.applications
  add column if not exists pending_offer_note text;

comment on column public.applications.pending_offer_note is
  'Free-text note set when status=''approved'' (pending offer): explains why the offer letter has not been issued yet (e.g. "Waiting for Counselling").';
