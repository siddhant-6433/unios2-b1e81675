// Course printed on a fee receipt, and the note attached when that receipt
// was issued for a previous programme and the student later migrated.
//
// Duplicated in supabase/functions/_shared/receiptCourseMigration.ts because
// edge functions cannot import from src/. Keep the two in lockstep;
// src/test/receipt-course-migration.test.ts asserts identical output.

export type CourseChange = {
  created_at: string;
  old_label?: string | null;
  new_label?: string | null;
};

const firstNonEmpty = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const trimmed = (value || "").trim();
    if (trimmed) return trimmed;
  }
  return null;
};

export function courseNameFromRelation(rel: unknown): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return courseNameFromRelation(rel[0]);
  if (typeof rel === "object" && rel !== null && "name" in rel) {
    const name = (rel as { name?: unknown }).name;
    return typeof name === "string" ? firstNonEmpty(name) : null;
  }
  return null;
}

export function resolveReceiptCourseName(opts: {
  studentCourseName?: string | null;
  leadCourseName?: string | null;
  applicationCourseName?: string | null;
}): string | null {
  // The student record is the live placement. The lead keeps the original
  // enquiry course on purpose, so it must not win once a student exists.
  return firstNonEmpty(
    opts.studentCourseName,
    opts.leadCourseName,
    opts.applicationCourseName,
  );
}

export function receiptCourseMigrationNote(
  paymentAt: string | null | undefined,
  currentCourseName: string | null | undefined,
  changes: CourseChange[],
): string | null {
  if (!changes.length) return null;
  const paidAt = paymentAt ? new Date(paymentAt).getTime() : NaN;
  if (!Number.isFinite(paidAt)) return null;
  const after = changes
    .filter((change) => {
      const at = new Date(change.created_at).getTime();
      return Number.isFinite(at) && at > paidAt;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (!after.length) return null;
  const previous = firstNonEmpty(after[0].old_label);
  const current = firstNonEmpty(currentCourseName, after[after.length - 1].new_label);
  if (!previous || !current || previous === current) return null;
  return `This receipt was migrated from previous course ${previous} to current course ${current}`;
}

export function combineReceiptNotes(
  migrationNote?: string | null,
  operatorNotes?: string | null,
): string | null {
  const parts = [migrationNote, operatorNotes]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function isReceiptStaleForCourse(opts: {
  paymentCreatedAt?: string | null;
  paymentDate?: string | null;
  receiptCourseId?: string | null;
  currentCourseId?: string | null;
  courseChanges: CourseChange[];
}): boolean {
  const current = opts.currentCourseId || null;
  if (opts.receiptCourseId && current && opts.receiptCourseId === current) return false;
  const paidAt = new Date(opts.paymentDate || opts.paymentCreatedAt || "").getTime();
  if (!Number.isFinite(paidAt)) return false;
  return opts.courseChanges.some((change) => {
    const at = new Date(change.created_at).getTime();
    return Number.isFinite(at) && at > paidAt;
  });
}

export function paymentsNeedingCourseRevision<T extends {
  status?: string | null;
  created_at?: string | null;
  payment_date?: string | null;
  receipt_course_id?: string | null;
}>(
  payments: T[],
  currentCourseId: string | null | undefined,
  courseChanges: CourseChange[],
): T[] {
  return payments.filter((payment) =>
    payment.status === "confirmed" &&
    isReceiptStaleForCourse({
      paymentCreatedAt: payment.created_at,
      paymentDate: payment.payment_date,
      receiptCourseId: payment.receipt_course_id,
      currentCourseId: currentCourseId || null,
      courseChanges,
    }),
  );
}
