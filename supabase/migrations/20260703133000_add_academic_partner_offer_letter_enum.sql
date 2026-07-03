-- Add an elevated academic partner role that can issue offer letters.
-- Keep this isolated so later migrations can safely cast the new enum value.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'academic_partner_offer_letter';
