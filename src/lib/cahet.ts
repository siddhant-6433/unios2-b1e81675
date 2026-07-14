export interface CahetRegistrationDetails {
  id: string;
  lead_id: string;
  registration_no: string;
  document_url: string | null;
  notes: string | null;
  registered_at: string | null;
  document_signed_url?: string | null;
}

type CahetRegistrationRow = Omit<CahetRegistrationDetails, "document_signed_url">;

interface SupabaseCahetClient {
  from(table: "cahet_registrations"): {
    select(columns: string): {
      eq(column: "lead_id", value: string): {
        maybeSingle(): Promise<{ data: CahetRegistrationRow | null }>;
      };
    };
  };
  storage: {
    from(bucket: "cahet-registrations"): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl?: string } | null }>;
    };
  };
}

interface ApplicationEntranceExam {
  exam_name?: string | null;
  registration_no?: string | null;
  registered_name?: string | null;
}

export interface ApplicationCahetSource {
  id?: string | null;
  application_id?: string | null;
  lead_id?: string | null;
  academic_details?: {
    entrance_exams?: ApplicationEntranceExam[] | null;
  } | null;
}

export function isBptOrBmritCourseName(courseName: string | null | undefined): boolean {
  if (!courseName) return false;
  const c = courseName.toLowerCase();
  return (
    c.includes("bpt") ||
    c.includes("physiotherapy") ||
    c.includes("bmrit") ||
    (c.includes("radiology") && c.includes("b.sc")) ||
    (c.includes("radiology") && c.includes("imaging"))
  );
}

export function formatCahetRegisteredAt(value: string | null | undefined): string | null {
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

export async function fetchCahetRegistration(
  supabase: SupabaseCahetClient,
  leadId: string | null | undefined,
): Promise<CahetRegistrationDetails | null> {
  if (!leadId) return null;
  const { data } = await supabase
    .from("cahet_registrations")
    .select("id, lead_id, registration_no, document_url, notes, registered_at")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!data) return null;

  let documentSignedUrl: string | null = null;
  if (data.document_url) {
    const { data: signed } = await supabase.storage
      .from("cahet-registrations")
      .createSignedUrl(data.document_url, 60 * 60);
    documentSignedUrl = signed?.signedUrl || null;
  }

  return {
    ...(data as CahetRegistrationDetails),
    document_signed_url: documentSignedUrl,
  };
}

export function cahetRegistrationFromApplication(
  app: ApplicationCahetSource | null | undefined,
  leadId?: string | null,
): CahetRegistrationDetails | null {
  const exams = app?.academic_details?.entrance_exams;
  if (!Array.isArray(exams)) return null;

  const exam = exams.find((entry) => /cahet/i.test(String(entry?.exam_name || "")));
  const registrationNo = String(exam?.registration_no || "").trim();
  if (!registrationNo) return null;

  const registeredName = String(exam?.registered_name || "").trim();
  return {
    id: `application:${app?.application_id || app?.id || "unknown"}:cahet`,
    lead_id: leadId || app?.lead_id || "",
    registration_no: registrationNo,
    document_url: null,
    notes: registeredName ? `Name on CAHET form: ${registeredName}` : "Entered in application form",
    registered_at: null,
    document_signed_url: null,
  };
}
