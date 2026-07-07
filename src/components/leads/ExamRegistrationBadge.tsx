import { type ExamCode, type ExamRegistrationStatus, EXAM_SHORT_LABELS, EXAM_DISPLAY_NAMES, examStatusLabel, examStatusClass } from "@/lib/examRegistration";

interface Props {
  examCode: ExamCode;
  status: ExamRegistrationStatus;
  registrationNo?: string | null;
  /** When provided, the badge becomes a button (e.g. to open the register dialog). */
  onClick?: () => void;
  className?: string;
}

/**
 * A single course-scoped entrance-exam registration badge. Replaces the old
 * "CAHET N/A · UPGET N/A · UPDELED N/A" three-badge row — only the exam the
 * candidate's course actually requires is shown, with its live status.
 */
export function ExamRegistrationBadge({ examCode, status, registrationNo, onClick, className }: Props) {
  const label = EXAM_SHORT_LABELS[examCode];
  const statusText = examStatusLabel(status);
  const title = `${EXAM_DISPLAY_NAMES[examCode]} — ${statusText}${registrationNo ? ` (${registrationNo})` : ""}`;

  const content = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${examStatusClass(status)} ${onClick ? "cursor-pointer hover:brightness-95" : ""} ${className || ""}`}
      title={title}
    >
      <span className="font-semibold">{label}</span>
      <span className="opacity-70">·</span>
      <span>{statusText}</span>
    </span>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="appearance-none bg-transparent p-0">
        {content}
      </button>
    );
  }
  return content;
}
