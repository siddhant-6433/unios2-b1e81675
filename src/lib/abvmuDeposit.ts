import { isDPharmaCourseName } from "@/lib/examRegistration";

/** D.Pharma fee metadata is not an ABVMU deposit. */
export function resolveAbvmuDepositAmount(
  courseName: string | null | undefined,
  amount: unknown,
): number {
  if (isDPharmaCourseName(courseName)) return 0;
  return Math.max(0, Number(amount || 0));
}
