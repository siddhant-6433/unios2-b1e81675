-- Update NB-DBA display name to include monthly rate and meal info
UPDATE public.fee_codes
SET name = 'Beacon Day Boarding (₹4,000/mo — Includes After-School Lunch Meal)'
WHERE code = 'NB-DBA';
