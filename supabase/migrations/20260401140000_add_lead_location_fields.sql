-- Add structured location and JustDial category fields to leads table
alter table leads
  add column if not exists city        text,
  add column if not exists area        text,
  add column if not exists jd_category text;
