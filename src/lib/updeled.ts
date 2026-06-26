export interface UpdeledRegistrationDetails {
  id: string;
  lead_id: string;
  registration_no: string;
  document_url: string | null;
  notes: string | null;
  registered_at: string | null;
  document_signed_url?: string | null;
}

type UpdeledRegistrationRow = Omit<UpdeledRegistrationDetails, "document_signed_url">;

export interface SupabaseUpdeledClient {
  from(table: "updeled_registrations"): {
    select(columns: string): {
      eq(column: "lead_id", value: string): {
        maybeSingle(): Promise<{ data: UpdeledRegistrationRow | null }>;
      };
    };
  };
  storage: {
    from(bucket: "updeled-registrations"): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl?: string } | null }>;
    };
  };
}

interface ApplicationEntranceExam {
  exam_name?: string | null;
  registration_no?: string | null;
  registered_name?: string | null;
}

export interface ApplicationUpdeledSource {
  id?: string | null;
  application_id?: string | null;
  lead_id?: string | null;
  academic_details?: {
    entrance_exams?: ApplicationEntranceExam[] | null;
  } | null;
}

export function isDeledCourseName(courseName: string | null | undefined): boolean {
  if (!courseName) return false;
  const c = courseName.toLowerCase();
  return (
    c.includes("d.el.ed") ||
    c.includes("d el ed") ||
    c.includes("deled") ||
    (c.includes("diploma") && c.includes("elementary") && c.includes("education")) ||
    c.includes("btc")
  );
}

export function isUpdeledExamName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /up\s*d\.?\s*el\.?\s*ed|updeled|d\.?\s*el\.?\s*ed counselling|elementary education counselling/i.test(name);
}

export function formatUpdeledRegisteredAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function fetchUpdeledRegistration(
  supabase: SupabaseUpdeledClient,
  leadId: string | null | undefined,
): Promise<UpdeledRegistrationDetails | null> {
  if (!leadId) return null;
  const { data } = await supabase
    .from("updeled_registrations")
    .select("id, lead_id, registration_no, document_url, notes, registered_at")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!data) return null;

  let documentSignedUrl: string | null = null;
  if (data.document_url) {
    const { data: signed } = await supabase.storage
      .from("updeled-registrations")
      .createSignedUrl(data.document_url, 60 * 60);
    documentSignedUrl = signed?.signedUrl || null;
  }

  return {
    ...(data as UpdeledRegistrationDetails),
    document_signed_url: documentSignedUrl,
  };
}

export function updeledRegistrationFromApplication(
  app: ApplicationUpdeledSource | null | undefined,
  leadId?: string | null,
): UpdeledRegistrationDetails | null {
  const exams = app?.academic_details?.entrance_exams;
  if (!Array.isArray(exams)) return null;

  const exam = exams.find((entry) => isUpdeledExamName(String(entry?.exam_name || "")));
  const registrationNo = String(exam?.registration_no || "").trim();
  if (!registrationNo) return null;

  const registeredName = String(exam?.registered_name || "").trim();
  return {
    id: `application:${app?.application_id || app?.id || "unknown"}:updeled`,
    lead_id: leadId || app?.lead_id || "",
    registration_no: registrationNo,
    document_url: null,
    notes: registeredName ? `Name on UPDELED form: ${registeredName}` : "Entered in application form",
    registered_at: null,
    document_signed_url: null,
  };
}
