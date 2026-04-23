-- Step 1: Add new enum values to lead_stage
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'ineligible';
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'dnc';
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'deferred';
