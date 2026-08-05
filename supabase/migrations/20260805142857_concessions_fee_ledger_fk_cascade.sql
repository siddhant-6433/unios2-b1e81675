-- Removing an unpaid fee row (remove_fee_charge → DELETE FROM fee_ledger) failed
-- with "concessions_fee_ledger_id_fkey" whenever any concession referenced that
-- row — the FK was NO ACTION. A concession is meaningless once its fee head is
-- gone, so the reference should cascade. This fixes every fee_ledger delete path,
-- not just the cashier's row-remove button.
--
-- concession_audit keeps a plain (non-FK) concession_id, so the audit trail of a
-- cascaded concession survives the delete.

ALTER TABLE public.concessions
  DROP CONSTRAINT IF EXISTS concessions_fee_ledger_id_fkey;

ALTER TABLE public.concessions
  ADD CONSTRAINT concessions_fee_ledger_id_fkey
  FOREIGN KEY (fee_ledger_id) REFERENCES public.fee_ledger(id) ON DELETE CASCADE;
