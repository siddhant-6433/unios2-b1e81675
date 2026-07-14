import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, GraduationCap } from "lucide-react";
import { fetchUpdeledRegistration, isDeledCourseName, type SupabaseUpdeledClient, type UpdeledRegistrationDetails } from "@/lib/updeled";
import {
  UpdeledRegisterDialog,
  type UpdeledRegisterTarget,
} from "@/components/leads/UpdeledRegisterDialog";

interface CourseLookupRow {
  courses?: { name?: string | null } | null;
}

const updeledClient = supabase as unknown as SupabaseUpdeledClient;

interface Props {
  leadId: string;
  leadName: string;
  phone?: string | null;
  courseName?: string | null;
  registeredOverride?: boolean | null;
  onRegistered?: () => void;
}

export function UpdeledPendingBadge({ leadId, leadName, phone, courseName, registeredOverride, onRegistered }: Props) {
  const courseProvided = courseName !== undefined;
  const [resolvedCourse, setResolvedCourse] = useState<string | null | undefined>(
    courseProvided ? courseName : undefined,
  );
  const eligible = isDeledCourseName(resolvedCourse);
  const [fetchedRegistered, setFetchedRegistered] = useState<boolean | null>(null);
  const [registration, setRegistration] = useState<UpdeledRegistrationDetails | null>(null);
  const registered = registration ? true : (registeredOverride !== undefined ? registeredOverride : fetchedRegistered);
  const [open, setOpen] = useState<UpdeledRegisterTarget | null>(null);

  useEffect(() => {
    if (courseProvided) return;
    let cancelled = false;
    supabase
      .from("leads")
      .select("courses:course_id(name)")
      .eq("id", leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const name = (data as CourseLookupRow | null)?.courses?.name ?? null;
        setResolvedCourse(name);
      });
    return () => { cancelled = true; };
  }, [courseProvided, leadId]);

  useEffect(() => {
    if (registeredOverride !== undefined) return;
    if (!eligible) return;
    let cancelled = false;
    fetchUpdeledRegistration(updeledClient, leadId)
      .then((row) => {
        if (cancelled) return;
        setRegistration(row);
        setFetchedRegistered(!!row);
      });
    return () => { cancelled = true; };
  }, [registeredOverride, eligible, leadId]);

  if (!eligible) return null;
  if (registered) {
    const documentUrl = registration?.document_signed_url || registration?.document_url || null;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 text-[10px] font-semibold"
        title={registration?.registration_no ? `UPDELED registration no: ${registration.registration_no}` : "UPDELED registered"}
      >
        <GraduationCap className="h-3 w-3" />
        UPDELED
        {registration?.registration_no ? (
          <span className="font-mono">{registration.registration_no}</span>
        ) : (
          " registered"
        )}
        {documentUrl && (
          <a
            href={documentUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-0.5 rounded-full p-0.5 hover:bg-primary/15"
            title="Open UPDELED registration proof"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    );
  }
  if (registered === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen({ lead_id: leadId, lead_name: leadName, phone, course_name: courseName })}
        className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/25 hover:bg-primary/15 px-2 py-0.5 text-[10px] font-semibold transition-colors"
        title="Mark UPDELED registration for this D.El.Ed lead"
      >
        <GraduationCap className="h-3 w-3" /> UPDELED pending - register
      </button>
      <UpdeledRegisterDialog
        target={open ? { ...open, course_name: resolvedCourse ?? open.course_name ?? null } : null}
        onClose={() => setOpen(null)}
        onSaved={() => {
          setOpen(null);
          fetchUpdeledRegistration(updeledClient, leadId).then((row) => {
            setRegistration(row);
            setFetchedRegistered(true);
          });
          onRegistered?.();
        }}
      />
    </>
  );
}
