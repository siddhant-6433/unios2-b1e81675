-- Fix duplicate automation rules firing on visit_scheduled
-- Both "Visit Attended → Schedule Follow-up Call" and "Visit Scheduled → 24hr Follow-up" fire on same trigger
-- Delete any remaining duplicates, keep only one follow-up rule

-- Delete ALL "Visit Attended" variants (the old pre-seeded rule)
DELETE FROM public.automation_rules
WHERE name LIKE 'Visit Attended%';

-- Ensure only ONE "Visit Scheduled → 24hr Follow-up" exists
-- (de-duplicate by keeping the first one)
DELETE FROM public.automation_rules a
USING public.automation_rules b
WHERE a.id > b.id
  AND a.name = b.name
  AND a.name = 'Visit Scheduled → 24hr Follow-up';
