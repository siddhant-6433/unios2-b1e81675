-- Grant service_role access to fee_ledger for bulk provisioning
GRANT ALL ON public.fee_ledger TO service_role;
GRANT ALL ON public.fee_structure_items TO service_role;
GRANT ALL ON public.fee_structures TO service_role;
GRANT ALL ON public.fee_codes TO service_role;
GRANT ALL ON public.payments TO service_role;
