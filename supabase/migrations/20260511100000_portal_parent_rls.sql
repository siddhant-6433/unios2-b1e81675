-- RLS policies so parents can read their child's data via the parent portal.
-- Parents are linked via students.father_user_id / mother_user_id / guardian_user_id.

-- students ─────────────────────────────────────────────────────────────────
CREATE POLICY "Father can view own student" ON public.students
  FOR SELECT TO authenticated
  USING (auth.uid() = father_user_id);

CREATE POLICY "Mother can view own student" ON public.students
  FOR SELECT TO authenticated
  USING (auth.uid() = mother_user_id);

CREATE POLICY "Guardian can view own student" ON public.students
  FOR SELECT TO authenticated
  USING (auth.uid() = guardian_user_id);

-- fee_ledger ───────────────────────────────────────────────────────────────
CREATE POLICY "Parents can view child fee ledger" ON public.fee_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fee_ledger.student_id
        AND (
          s.father_user_id   = auth.uid() OR
          s.mother_user_id   = auth.uid() OR
          s.guardian_user_id = auth.uid()
        )
    )
  );

-- daily_attendance ─────────────────────────────────────────────────────────
CREATE POLICY "Parents can view child attendance" ON public.daily_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = daily_attendance.student_id
        AND (
          s.father_user_id   = auth.uid() OR
          s.mother_user_id   = auth.uid() OR
          s.guardian_user_id = auth.uid()
        )
    )
  );
