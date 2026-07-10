import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink } from "lucide-react";
import {
  examCodeForCourse,
  type ExamCode,
  type ExamRegistrationStatus,
  EXAM_SHORT_LABELS,
  EXAM_DISPLAY_NAMES,
  examStatusLabel,
  examStatusClass,
} from "@/lib/examRegistration";
import { fetchExamRegistrationsForLead, signExamRegistrationDoc } from "@/lib/examRegistrationClient";
import { ExamRegisterDialog, type ExamRegisterTarget } from "@/components/leads/ExamRegisterDialog";

interface Props {
  leadId: string;
  leadName: string;
  phone?: string | null;
  courseName?: string | null;
  campusName?: string | null;
  /** Fired after a successful save so the parent can refresh if needed. */
  onSaved?: () => void;
}

/**
 * Course-scoped entrance-exam registration badge for lead views. Resolves the
 * single exam the lead's course (+ campus) requires and shows its live status,
 * clickable to record the registration. Renders nothing when the course has no
 * exam gate. Replaces the per-exam CahetPendingBadge / UpdeledPendingBadge.
 */
export function ExamPendingBadge({ leadId, leadName, phone, courseName, campusName, onSaved }: Props) {
  const examCode: ExamCode | null = examCodeForCourse(courseName, campusName);
  const [status, setStatus] = useState<ExamRegistrationStatus>("unknown");
  const [regNo, setRegNo] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [open, setOpen] = useState<ExamRegisterTarget | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    if (!examCode) return;
    let cancelled = false;
    fetchExamRegistrationsForLead(leadId).then(async (byCode) => {
      if (cancelled) return;
      const row = byCode[examCode];
      setStatus(row?.status ?? "unknown");
      setRegNo(row?.registration_no || null);
      setDocUrl(row?.document_url ? await signExamRegistrationDoc(row.document_url) : null);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    const cleanup = load();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, examCode]);

  if (!examCode) return null;
  if (!loaded) return null;

  const label = EXAM_SHORT_LABELS[examCode];
  const title = `${EXAM_DISPLAY_NAMES[examCode]} — ${examStatusLabel(status)}${regNo ? ` (${regNo})` : ""}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen({ lead_id: leadId, lead_name: leadName, exam_code: examCode, phone, course_name: courseName })}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors hover:brightness-95 ${examStatusClass(status)}`}
        title={title}
      >
        <span>{label}</span>
        <span className="opacity-70">·</span>
        <span>{examStatusLabel(status)}</span>
        {regNo && <span className="font-mono opacity-80">{regNo}</span>}
      </button>
      {docUrl && (
        <a
          href={docUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-0.5 inline-flex rounded-full p-0.5 text-success hover:bg-success/10"
          title={`Open ${label} registration proof`}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      <ExamRegisterDialog
        target={open}
        onClose={() => setOpen(null)}
        onSaved={() => { setOpen(null); load(); onSaved?.(); }}
      />
    </>
  );
}
