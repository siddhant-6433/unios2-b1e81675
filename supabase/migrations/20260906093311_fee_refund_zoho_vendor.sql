-- Per-student Zoho vendor for refunds. Each refund is its own Zoho Bill, but all
-- of a student's refunds share ONE Zoho vendor (name "Name - Father - Adm No"),
-- with the payee bank details mapped onto that vendor. Cache the resolved vendor
-- id on the student (dedup key across refunds) and on the refund (what it used).
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS zoho_vendor_id text;
ALTER TABLE public.fee_refunds ADD COLUMN IF NOT EXISTS zoho_vendor_id text;
