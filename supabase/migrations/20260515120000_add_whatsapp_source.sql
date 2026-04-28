-- Add 'whatsapp' to lead_source enum for WhatsApp AI agent auto-created leads
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'whatsapp';
