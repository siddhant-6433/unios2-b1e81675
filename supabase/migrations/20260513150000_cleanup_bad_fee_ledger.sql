-- Step 2: Delete 4,002 bad fee_ledger entries
-- These were blindly inserted for all 138 students (ALL fee structure items including hostel for day scholars, all transport tiers, etc.)
-- Safe because paid_amount = 0 on all of them — no actual payments exist.

DELETE FROM public.fee_ledger
WHERE paid_amount = 0
  AND student_id IN (
    SELECT id FROM public.students WHERE sr_number IS NOT NULL
  );
