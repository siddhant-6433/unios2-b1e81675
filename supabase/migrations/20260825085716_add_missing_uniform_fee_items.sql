-- Add the missing UNIFORM fee_structure_items.
--
-- Uniform is a real fee head (fee_codes.UNIFORM, category 'other') and provisioning
-- copies it into a student's ledger like any other item. The uniform items were seeded
-- live (not via committed migration — DB-push CI drift) and three active structures were
-- missed: GNM (uniform_cost 8000), D.Pharma and DPT (6000). Their metadata declares a
-- uniform_cost but no matching fee_structure_items row exists, so re-provision is a no-op
-- and GNM/D.Pharma/DPT students never get charged the uniform fee.
--
-- Insert a uniform_2026 item (amount from metadata->>'uniform_cost', due_date matching the
-- siblings) into every active structure that declares a uniform cost but lacks the item.
-- Idempotent NOT EXISTS guard → safe to re-apply and safe against the live-seeded rows.

INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_date)
SELECT fs.id,
       (SELECT id FROM public.fee_codes WHERE code = 'UNIFORM'),
       'uniform_2026',
       (fs.metadata->>'uniform_cost')::numeric,
       DATE '2026-08-14'
FROM public.fee_structures fs
WHERE fs.is_active
  AND COALESCE(fs.metadata->>'uniform_cost', '0') NOT IN ('0', '')
  AND NOT EXISTS (
    SELECT 1
    FROM public.fee_structure_items si
    WHERE si.fee_structure_id = fs.id
      AND si.fee_code_id = (SELECT id FROM public.fee_codes WHERE code = 'UNIFORM')
  );
